// Durable scan queue: the piece that decides what gets persisted, what gets
// sent, and — most importantly — what is safe to delete.
//
// An hour of scanning must never live only in a React variable, so every scan
// is written to storage before it is sent anywhere, and a local record is only
// removed once the server has confirmed that specific record. Every failure
// path here has to leave the scan on disk; losing a box is worse than sending
// it twice, and the server is idempotent on (batch_id, serial) anyway.
//
// Storage and transport are injected so this logic is testable without a
// browser. scanStore.js supplies the IndexedDB backend in the app.

const { toPounds } = require("./weight");

// express.json() defaults to a 100kb body. A resume-flush after a long offline
// stretch can be thousands of scans, so requests are chunked well under that.
const DEFAULT_MAX_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_CHUNK_ITEMS = 250;

// Running totals are kept as integer thousandths and formatted only for
// display. A float accumulator would drift over a thousand-box shift, and the
// operator's running total has to agree with what the server stores.
const weightToThousandths = (s) => {
  const [whole, frac = ""] = String(s).split(".");
  return parseInt(whole, 10) * 1000 + parseInt((frac + "000").slice(0, 3), 10);
};

const fromThousandths = (n) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}`;
};

const emptyStats = () => ({ count: 0, totals: {} });

// Everything is stored and printed in pounds; kilogram labels are converted.
const STORED_UNIT = "LB";

// Records written before conversion existed have no displayWeight. Falling back
// to the scanned weight keeps a resumed session from reading as zero — those
// rows are pounds already, since conversion is what introduced the field.
const displayOf = (record) => record.displayWeight || record.weight;

// Formats the stored thousandths into display strings, e.g.
// { count: 3, totals: { LB: "228.600" } }
const formatStats = (stats) => {
  const source = stats || emptyStats();
  return {
    count: source.count || 0,
    totals: Object.entries(source.totals || {}).map(([unit, thousandths]) => ({
      unit, total: fromThousandths(thousandths),
    })).sort((a, b) => a.unit.localeCompare(b.unit)),
  };
};

const toWireItem = (record) => ({
  weight: record.weight,
  weightUnit: record.weightUnit,
  rawBarcode: record.rawBarcode || undefined,
  isManual: !!record.isManual,
});

// Splits records into requests that stay under both the byte and item ceilings.
// A single record larger than maxBytes still goes out alone rather than being
// dropped — the server can reject it, but we must never silently discard it.
const chunkRecords = (records, maxBytes, maxItems) => {
  const chunks = [];
  let current = [];
  let currentBytes = 2; // "[]"

  for (const record of records) {
    const size = JSON.stringify(toWireItem(record)).length + 1;
    const wouldExceed =
      current.length > 0 &&
      (currentBytes + size > maxBytes || current.length >= maxItems);
    if (wouldExceed) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(record);
    currentBytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
};

const createScanQueue = ({
  backend,
  api,
  maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES,
  maxChunkItems = DEFAULT_MAX_CHUNK_ITEMS,
} = {}) => {
  if (!backend) throw new Error("scanQueue requires a storage backend");
  if (!api) throw new Error("scanQueue requires an api");

  let flushing = false;

  // Session-level counters, so the operator's running total survives a reload
  // and a resume rather than living in React state.
  const bumpStats = async (weight, unit, direction) => {
    const session = await backend.getSession();
    if (!session) return null;
    const stats = session.stats || emptyStats();
    const totals = { ...stats.totals };
    totals[unit] = (totals[unit] || 0) + direction * weightToThousandths(weight);
    const next = { count: Math.max(0, (stats.count || 0) + direction), totals };
    await backend.setSession({ ...session, stats: next });
    return next;
  };

  // Persist first, then report success. If the write throws, the caller must
  // hear about it — a scan that was never stored must not be treated as taken.
  const enqueue = async (scan) => {
    // Two weights are kept, deliberately.
    //
    // `weight`/`weightUnit` are exactly what the label said, and are what goes
    // on the wire: the server re-parses raw_barcode and rejects any disagreement,
    // so a kilogram label has to be sent in kilograms or the scan is refused.
    //
    // `displayWeight` is the same box in pounds, which is what gets stored and
    // what the manifest prints. The grid and the running total use it so the
    // number on screen during the session is the number on the paper afterwards.
    const asLb = toPounds(scan.weight, scan.weightUnit);
    const record = {
      weight: scan.weight,
      weightUnit: scan.weightUnit,
      displayWeight: asLb.weight,
      convertedFrom: asLb.convertedFrom,
      rawBarcode: scan.rawBarcode || null,
      gtin: scan.gtin || null,
      serial: scan.serial || null,
      productionDate: scan.productionDate || null,
      isManual: !!scan.isManual,
      status: "pending",
      scannedAt: new Date().toISOString(),
    };
    const localId = await backend.putScan(record);
    await bumpStats(displayOf(record), STORED_UNIT, +1);
    return localId;
  };

  // Removes the most recent scan that has not yet been confirmed by the server.
  // Once a scan is flushed it belongs to the batch and cannot be taken back from
  // here — there is no void endpoint — so this reports that rather than lying.
  const undoLast = async () => {
    const pending = await backend.listPending();
    if (!pending.length) {
      return { undone: false, reason: "nothing-pending" };
    }
    const last = pending[pending.length - 1];
    await backend.deleteScans([last.localId]);
    await bumpStats(displayOf(last), STORED_UNIT, -1);
    return { undone: true, record: last };
  };

  const getStats = async () => {
    const session = await backend.getSession();
    return formatStats(session && session.stats);
  };

  // Every scan in this session, oldest first, whatever its sync state. This is
  // what the operator's grid renders.
  const listSession = () => backend.listAll();

  // Wipes the local session. Only safe once the batch is closed, which means
  // the server has everything.
  const clearSession = () => backend.clearAll();

  // Sends every pending record and clears only what the server confirms.
  // Returns a summary; never throws for transport failure, because a failed
  // flush is a normal condition in a warehouse and must simply be retried.
  const flush = async () => {
    // Claim the flag synchronously, before the first await. Setting it after one
    // lets two calls in the same tick both get past the check and double-send.
    if (flushing) return { skipped: true, reason: "already-flushing" };
    flushing = true;

    const summary = { sent: 0, accepted: 0, duplicates: 0, rejected: 0, failedChunks: 0 };
    try {
      const session = await backend.getSession();
      if (!session || !session.batchId) {
        return { skipped: true, reason: "no-open-batch" };
      }

      const pending = await backend.listPending();
      if (!pending.length) return summary;

      for (const chunk of chunkRecords(pending, maxChunkBytes, maxChunkItems)) {
        let response;
        try {
          response = await api.postItems(session.batchId, chunk.map(toWireItem));
        } catch (err) {
          // Network down, 429, 5xx — leave the whole chunk pending and stop.
          // Continuing would just pile up more failures against the same cause.
          summary.failedChunks += 1;
          summary.error = err && err.message ? err.message : String(err);
          break;
        }

        summary.sent += chunk.length;
        const results = (response && response.results) || [];
        const confirmed = [];
        const duplicated = [];

        for (let i = 0; i < chunk.length; i += 1) {
          const record = chunk[i];
          const result = results[i];

          // No per-item verdict means we cannot prove the server took it.
          // Leave it pending; the (batch_id, serial) index makes a resend safe.
          if (!result) continue;

          if (result.status === "inserted") {
            summary.accepted += 1;
            confirmed.push(record.localId);
          } else if (result.status === "duplicate") {
            // The same physical box scanned twice — the server kept the first
            // and refused this one. It must NOT be counted as a saved box: the
            // running total has to match what the database actually holds, or
            // the printed manifest overstates the shipment.
            summary.duplicates += 1;
            duplicated.push(record);
          } else if (result.status === "rejected") {
            // Not deleted. The operator has to see it and re-enter it, so it is
            // parked out of the flush path rather than dropped or retried.
            summary.rejected += 1;
            await backend.markRejected(record.localId, result.reason || result.code);
          }
        }

        // Marked, not deleted. The operator's session grid shows every box
        // scanned, so a confirmed record has to outlive its flush — it just
        // leaves the pending queue. countPending() still drops to zero, which
        // is what the unflushed-work warnings key off.
        if (confirmed.length) await backend.markSynced(confirmed);

        // A duplicate stays visible so the operator can see the double-scan,
        // but its weight is backed out of the running total.
        if (duplicated.length) {
          await backend.markDuplicate(duplicated.map((r) => r.localId));
          for (const record of duplicated) {
            await bumpStats(displayOf(record), STORED_UNIT, -1);
          }
        }
      }
      return summary;
    } finally {
      flushing = false;
    }
  };

  // Opens a batch server-side immediately (spec 6.2: never defer to Stop) and
  // records it locally so a crash between the two is recoverable.
  // One session is one lot: every box scanned between start and stop belongs to
  // the same lot, and that is what the weight manifest is built from.
  const start = async (clientUuid, meta = {}) => {
    const existing = await backend.getSession();
    if (existing && existing.batchId && existing.status === "open") return existing;

    const uuid = clientUuid || existing?.clientUuid;
    if (!uuid) throw new Error("start requires a clientUuid");

    const base = { clientUuid: uuid, ...meta, status: "open", stats: emptyStats() };
    await backend.setSession({ ...base, batchId: null });
    const created = await api.createBatch(uuid, meta);
    const session = { ...base, batchId: created.batch_id };
    await backend.setSession(session);
    return session;
  };

  // Flushes what is left, then closes. If anything is still unflushed the batch
  // is deliberately left open — closing over unsent scans would strand them.
  const stop = async () => {
    const session = await backend.getSession();
    if (!session || !session.batchId) return { closed: false, reason: "no-open-batch" };

    const flushed = await flush();
    const stillPending = await backend.countPending();
    if (stillPending > 0) {
      return { closed: false, reason: "unflushed-scans", stillPending, flushed };
    }

    const summary = await api.closeBatch(session.batchId);
    await backend.setSession({ ...session, status: "closed" });
    return { closed: true, summary, flushed };
  };

  // On mount: is there a batch left open by a killed tab or a dead battery?
  const findResumable = async () => {
    const session = await backend.getSession();
    if (!session || session.status !== "open") return null;
    const pending = await backend.countPending();
    return { ...session, pending };
  };

  return {
    enqueue,
    undoLast,
    getStats,
    listSession,
    clearSession,
    flush,
    start,
    stop,
    findResumable,
    countPending: () => backend.countPending(),
    isFlushing: () => flushing,
  };
};

module.exports = { createScanQueue, chunkRecords, toWireItem,
  weightToThousandths, fromThousandths, formatStats,
  DEFAULT_MAX_CHUNK_BYTES, DEFAULT_MAX_CHUNK_ITEMS };
