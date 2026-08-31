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

// express.json() defaults to a 100kb body. A resume-flush after a long offline
// stretch can be thousands of scans, so requests are chunked well under that.
const DEFAULT_MAX_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_CHUNK_ITEMS = 250;

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

  // Persist first, then report success. If the write throws, the caller must
  // hear about it — a scan that was never stored must not be treated as taken.
  const enqueue = async (scan) => {
    const record = {
      weight: scan.weight,
      weightUnit: scan.weightUnit,
      rawBarcode: scan.rawBarcode || null,
      gtin: scan.gtin || null,
      serial: scan.serial || null,
      productionDate: scan.productionDate || null,
      isManual: !!scan.isManual,
      status: "pending",
      scannedAt: new Date().toISOString(),
    };
    return backend.putScan(record);
  };

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
            // The server already holds this box. Clearing it locally is correct;
            // retrying forever would wedge the queue.
            summary.duplicates += 1;
            confirmed.push(record.localId);
          } else if (result.status === "rejected") {
            // Not deleted. The operator has to see it and re-enter it, so it is
            // parked out of the flush path rather than dropped or retried.
            summary.rejected += 1;
            await backend.markRejected(record.localId, result.reason || result.code);
          }
        }

        if (confirmed.length) await backend.deleteScans(confirmed);
      }
      return summary;
    } finally {
      flushing = false;
    }
  };

  // Opens a batch server-side immediately (spec 6.2: never defer to Stop) and
  // records it locally so a crash between the two is recoverable.
  const start = async (clientUuid) => {
    const existing = await backend.getSession();
    if (existing && existing.batchId && existing.status === "open") return existing;

    const uuid = clientUuid || existing?.clientUuid;
    if (!uuid) throw new Error("start requires a clientUuid");

    await backend.setSession({ clientUuid: uuid, batchId: null, status: "open" });
    const created = await api.createBatch(uuid);
    const session = { clientUuid: uuid, batchId: created.batch_id, status: "open" };
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
    flush,
    start,
    stop,
    findResumable,
    countPending: () => backend.countPending(),
    isFlushing: () => flushing,
  };
};

module.exports = { createScanQueue, chunkRecords, toWireItem,
  DEFAULT_MAX_CHUNK_BYTES, DEFAULT_MAX_CHUNK_ITEMS };
