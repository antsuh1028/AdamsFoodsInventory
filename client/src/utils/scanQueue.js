// Durable scan queue: the piece that decides what gets persisted, what gets sent,
// and — most importantly — what is safe to delete.

const { toPounds } = require("./weight");

// express.json() defaults to a 100kb body. A resume-flush after a long offline
// stretch can be thousands of scans, so requests are chunked well under that.
const DEFAULT_MAX_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_CHUNK_ITEMS = 250;

// Running totals are kept as integer thousandths and formatted only for display.
const newItemUuid = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

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

// Records written before conversion existed have no displayWeight.
const displayOf = (record) => record.displayWeight || record.weight;

// Totals are an ARRAY of { unit, total }, not an object keyed by unit.
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
  // How the figure reached the computer, and whether it was measured at all.
  entryMethod: record.entryMethod || undefined,
  isEstimated: record.isEstimated ? true : undefined,
  // This box's own id, so a resend is recognisable as the same box.
  clientItemUuid: record.clientItemUuid || undefined,
});

// Splits records into requests that stay under both the byte and item ceilings.
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

  // The same, for a whole batch at once.
  const bumpStatsBy = async (thousandths, unit, countDelta) => {
    const session = await backend.getSession();
    if (!session) return null;
    const stats = session.stats || emptyStats();
    const totals = { ...stats.totals };
    totals[unit] = (totals[unit] || 0) + thousandths;
    const next = {
      count: Math.max(0, (stats.count || 0) + countDelta),
      totals,
    };
    await backend.setSession({ ...session, stats: next });
    return next;
  };

  // Persist first, then report success.
  const buildRecord = (scan) => {
    // Two weights are kept, deliberately.
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
      // Provenance, so a manifest can tell a scale reading from a typed figure from
      // one of thirty added in a batch.
      entryMethod: scan.entryMethod || null,
      // A weight that was not measured.
      isEstimated: scan.isEstimated === true,
      // This box's own id, minted here and never reused. It is what makes a
      // resend recognisable as the same box after a response goes missing.
      clientItemUuid: newItemUuid(),
      status: "pending",
      scannedAt: new Date().toISOString(),
    };
    return record;
  };

  const enqueue = async (scan) => {
    const record = buildRecord(scan);
    const localId = await backend.putScan(record);
    await bumpStats(displayOf(record), STORED_UNIT, +1);
    return localId;
  };

  // Many boxes as ONE act.
  const enqueueMany = async (scans) => {
    const list = Array.isArray(scans) ? scans : [];
    if (!list.length) return [];
    const records = list.map(buildRecord);
    const ids = [];
    for (const record of records) ids.push(await backend.putScan(record));
    // Summed in integer thousandths and written once, rather than N read-modify
    // -writes of the same session object.
    let delta = 0;
    for (const r of records) delta += weightToThousandths(displayOf(r));
    await bumpStatsBy(delta, STORED_UNIT, records.length);
    return ids;
  };

  // Take back the last box.
  const undoLast = async ({ voidServer } = {}) => {
    const pending = await backend.listPending();
    if (pending.length) {
      const last = pending[pending.length - 1];
      await backend.deleteScans([last.localId]);
      await bumpStats(displayOf(last), STORED_UNIT, -1);
      return { undone: true, how: "removed", record: last };
    }

    const all = await backend.listAll();
    // Skips voided, rejected and duplicate rows — none of them can be taken back.
    const last = [...all].reverse()
      .find((r) => r.status === "synced" && r.serverItemId != null);
    if (!last) return { undone: false, reason: "nothing-to-undo" };

    const result = await voidScan(last.localId, {
      voidServer, reason: "Undone at the bench",
    });
    return result.voided
      ? { undone: true, how: "voided", record: result.record }
      : { undone: false, reason: result.reason };
  };

  // Correct a weight mid-session.
  const editScan = async (localId, newWeight, { unit = "LB", patchServer } = {}) => {
    const rows = await backend.listAll();
    const row = rows.find((r) => r.localId === localId);
    if (!row) return { edited: false, reason: "not-found" };

    // The operator types the figure in whatever unit the label carries; it is
    // converted here so the grid and the manifest stay in pounds.
    const asLb = toPounds(newWeight, unit);
    const before = displayOf(row);
    if (asLb.weight === before && !asLb.convertedFrom) {
      return { edited: false, reason: "unchanged" };
    }

    // The server is told the unit too, and does its own conversion — the client
    // is not trusted to have converted correctly.
    if (row.serverItemId && patchServer) {
      await patchServer(row.serverItemId, newWeight, unit);
    }

    const patched = await backend.patchScan(localId, {
      displayWeight: asLb.weight,
      weight: asLb.weight,
      weightUnit: "LB",
      // Kept so the row can say on its face that the figure came off a
      // kilogram label, and cleared when a correction moves it back to pounds.
      convertedFrom: asLb.convertedFrom,
      // What the label originally said, captured once so a second correction
      // does not overwrite it with the first correction.
      originalWeight: row.originalWeight || before,
      // A corrected row that has NOT yet been sent has to go up as a manual entry.
      ...(row.serverItemId ? {} : {
        isManual: true,
        rawBarcode: null,
        originalBarcode: row.originalBarcode || row.rawBarcode || null,
      }),
    });

    // Out with the old figure, in with the new.
    await bumpStats(before, STORED_UNIT, -1);
    await bumpStats(asLb.weight, STORED_UNIT, +1);
    return { edited: true, record: patched };
  };

  // Take a box off the tally. Soft, like the server: the row stays visible and
  // struck through, but stops counting toward the total.
  const voidScan = async (localId, { voidServer, reason = null } = {}) => {
    const rows = await backend.listAll();
    const row = rows.find((r) => r.localId === localId);
    if (!row) return { voided: false, reason: "not-found" };
    if (row.status === "voided") return { voided: true, record: row };

    if (row.serverItemId && voidServer) await voidServer(row.serverItemId, reason);

    const patched = await backend.patchScan(localId, {
      status: "voided",
      voidReason: reason,
      // What this row was BEFORE it was struck off.
      preVoidStatus: row.preVoidStatus || row.status,
    });
    // A duplicate never counted toward the total, so voiding one must not
    // subtract a second time.
    if (row.status !== "duplicate" && row.status !== "rejected") {
      await bumpStats(displayOf(row), STORED_UNIT, -1);
    }
    return { voided: true, record: patched };
  };

  // Put a voided box back.
  const restoreScan = async (localId, { restoreServer } = {}) => {
    const rows = await backend.listAll();
    const row = rows.find((r) => r.localId === localId);
    if (!row) return { restored: false, reason: "not-found" };
    if (row.status !== "voided") return { restored: true, record: row };

    if (row.serverItemId && restoreServer) await restoreServer(row.serverItemId);

    // A row with a server id goes back to "synced".
    const back = row.preVoidStatus || (row.serverItemId ? "synced" : "pending");
    const patched = await backend.patchScan(localId, {
      status: back,
      voidReason: null,
      preVoidStatus: null,
    });

    // Only a row that COUNTED gets its weight back. A restored duplicate is
    // still a duplicate.
    if (back !== "duplicate" && back !== "rejected") {
      await bumpStats(displayOf(row), STORED_UNIT, +1);
    }
    return { restored: true, record: patched };
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
          // 404 is different in kind: the batch is GONE, so retrying can never
          // succeed and the caller has to be told rather than left looping.
          if (err && err.response && err.response.status === 404) summary.gone = true;
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
            // The server's row id, so a synced box can still be corrected or voided.
            confirmed.push({ localId: record.localId, itemId: result.itemId ?? null });
          } else if (result.status === "duplicate") {
            // The same physical box scanned twice — the server kept the first and
            // refused this one.
            summary.duplicates += 1;
            duplicated.push(record);
          } else if (result.status === "rejected") {
            // Not deleted. The operator has to see it and re-enter it, so it is
            // parked out of the flush path rather than dropped or retried.
            summary.rejected += 1;
            await backend.markRejected(record.localId, result.reason || result.code);
          }
        }

        // Marked, not deleted.
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

  // The batch no longer exists on the server — deleted, normally. Nothing can
  // be closed and nothing pending can ever be sent to it, so the session is
  // cleared rather than left on the device: keeping it 404s every close and the
  // resumable guard then blocks starting a new one, which traps the operator.
  const abandonGoneBatch = async (batchId, lost) => {
    await clearSession();
    return { closed: true, gone: true, batchId, lost };
  };

  // Flushes what is left, then closes. If anything is still unflushed the batch
  // is deliberately left open — closing over unsent scans would strand them.
  const stop = async (remarks = null) => {
    const session = await backend.getSession();
    if (!session || !session.batchId) return { closed: false, reason: "no-open-batch" };

    const flushed = await flush();
    const stillPending = await backend.countPending();
    if (stillPending > 0) {
      if (flushed.gone) return abandonGoneBatch(session.batchId, stillPending);
      return { closed: false, reason: "unflushed-scans", stillPending, flushed };
    }

    let summary;
    try {
      summary = await api.closeBatch(session.batchId, remarks);
    } catch (err) {
      if (err && err.response && err.response.status === 404) {
        return abandonGoneBatch(session.batchId, 0);
      }
      throw err;
    }
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

  // Rejoin a session that is open ON THE SERVER but unknown to this browser.
  const adopt = async ({ batch, items = [] }) => {
    if (!batch || batch.batchId == null) {
      throw new Error("adopt requires a batch with a batchId");
    }

    // Unsent scans belong to whatever session is loaded now.
    const pendingNow = await backend.countPending();
    if (pendingNow > 0) {
      return { adopted: false, reason: "pending-scans", pending: pendingNow };
    }

    await clearSession();

    const stats = emptyStats();
    const rows = [];
    for (const item of items) {
      // A voided box stays visible and struck through but must not count —
      // the same rule the manifest and every total follow.
      const voided = Boolean(item.voidedAt);
      const record = {
        weight: item.weight,
        weightUnit: item.weightUnit || STORED_UNIT,
        // Server weights are ALREADY in pounds, so this is the display weight.
        displayWeight: item.weight,
        convertedFrom: item.convertedFrom || null,
        rawBarcode: item.rawBarcode || null,
        gtin: item.gtin || null,
        serial: item.serial || null,
        productionDate: item.productionDate || null,
        isManual: !!item.isManual,
        // Carried onto the adopted row, not dropped.
        entryMethod: item.entryMethod || null,
        isEstimated: item.isEstimated === true,
        originalWeight: item.originalWeight || null,
        editedAt: item.editedAt || null,
        voidedAt: item.voidedAt || null,
        voidReason: item.voidReason || null,
        status: voided ? "voided" : "synced",
        // Set here, not via markSynced, which would quietly un-void a voided box.
        serverItemId: item.localId,
        scannedAt: item.scannedAt || new Date().toISOString(),
      };
      const localId = await backend.putScan(record);
      rows.push({ localId, itemId: item.localId, voided });
      if (!voided) {
        stats.count += 1;
        stats.totals[STORED_UNIT] =
          (stats.totals[STORED_UNIT] || 0) + weightToThousandths(displayOf(record));
      }
    }

    await backend.setSession({
      clientUuid: batch.clientUuid || null,
      batchId: batch.batchId,
      lotNumber: batch.lotNumber || null,
      lotId: batch.lotId ?? null,
      vendor: batch.vendor || null,
      billOfLading: batch.billOfLading || null,
      shipTo: batch.shipTo || null,
      itemDescription: batch.itemDescription || null,
      brand: batch.brand || null,
      estNumber: batch.estNumber || null,
      grade: batch.grade || null,
      expectedBoxes: batch.expectedBoxes ?? null,
      direction: batch.direction || "incoming",
      status: "open",
      stats,
    });

    return {
      adopted: true,
      batchId: batch.batchId,
      boxes: rows.filter((r) => !r.voided).length,
    };
  };

  return {
    enqueue,
    enqueueMany,
    undoLast,
    editScan,
    voidScan,
    restoreScan,
    getStats,
    listSession,
    clearSession,
    flush,
    start,
    stop,
    findResumable,
    adopt,
    countPending: () => backend.countPending(),
    isFlushing: () => flushing,
  };
};

module.exports = { createScanQueue, chunkRecords, toWireItem,
  weightToThousandths, fromThousandths, formatStats,
  DEFAULT_MAX_CHUNK_BYTES, DEFAULT_MAX_CHUNK_ITEMS };
