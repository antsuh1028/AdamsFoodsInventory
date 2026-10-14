"use strict";

const { fpNumberFor } = require("./lot");
const { weightInLb } = require("./sqlWeight");

// Further-processing lots: cases of one N lot sent to the AF freezer for another
// run. Counts are computed, never stored.

// One spelling per item: trimmed, single-spaced, upper case.
const normaliseItem = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// `fp` is a lots alias carrying lot_id, parent_lot_id, tenant_id.

// Boxes weighed out to the freezer on the parent lot; one box is one case.
const weighedSql = (fp) => `
  COALESCE((SELECT COUNT(*) FROM batch_items bi
              JOIN box_batches b ON b.batch_id = bi.batch_id
             WHERE b.tenant_id = ${fp}.tenant_id AND b.lot_id = ${fp}.parent_lot_id
               AND b.direction = 'outgoing' AND b.further_processing
               AND bi.voided_at IS NULL), 0)::int`;

// Pounds of those boxes.
const weighedLbSql = (fp) => `
  COALESCE((SELECT SUM(${weightInLb("bi")}) FROM batch_items bi
              JOIN box_batches b ON b.batch_id = bi.batch_id
             WHERE b.tenant_id = ${fp}.tenant_id AND b.lot_id = ${fp}.parent_lot_id
               AND b.direction = 'outgoing' AND b.further_processing
               AND bi.voided_at IS NULL), 0)::text`;

// Trips entered by hand in the tracker, not weighed at the dock.
const byHandSql = (fp) => `
  COALESCE((SELECT SUM(t.cases) FROM fp_tracker t
             WHERE t.tenant_id = ${fp}.tenant_id AND t.lot_id = ${fp}.parent_lot_id
               AND t.voided_at IS NULL), 0)::int`;

// Everything sent to the freezer.
const sentSql = (fp) => `(${weighedSql(fp)} + ${byHandSql(fp)})`;

const takenSql = (fp) => `
  COALESCE((SELECT SUM(r.input_cases) FROM noblesse_processing_reports r
             WHERE r.tenant_id = ${fp}.tenant_id AND r.lot_id = ${fp}.lot_id
               AND r.status = 'accepted'), 0)::int`;

// Cases counted back in from the freezer. `fp` as above.
const returnedSql = (fp) => `
  COALESCE((SELECT SUM(x.cases) FROM fp_returns x
             WHERE x.tenant_id = ${fp}.tenant_id AND x.lot_id = ${fp}.parent_lot_id
               AND x.voided_at IS NULL), 0)::int`;

const COUNTS_SQL = `
  SELECT ${weighedSql("fp")} AS weighed, ${byHandSql("fp")} AS by_hand, ${weighedLbSql("fp")} AS weighed_lb,
         ${takenSql("fp")} AS taken, ${returnedSql("fp")} AS returned
    FROM lots fp WHERE fp.lot_id = $1 AND fp.tenant_id = $2 AND fp.kind = 'further'`;

/** The FP lot's figures. Sent is weighed boxes plus hand-entered trips. */
const shape = ({ weighed = 0, byHand = 0, weighedLb = "0", taken = 0, returned = 0 }) => {
  const sent = weighed + byHand;
  return {
    sent, weighed, byHand, weighedLb, taken, returned,
    // What runs may still take, back or not; runs past `ready` are warned, not refused.
    waiting: sent - taken,
    inFreezer: Math.max(0, sent - returned),
    ready: returned - taken,
  };
};

/** shape() from a row carrying weighed, by_hand, weighed_lb, taken, returned. */
const shapeRow = (r) => shape({
  weighed: Number(r.weighed) || 0, byHand: Number(r.by_hand) || 0,
  weighedLb: r.weighed_lb ?? "0", taken: Number(r.taken) || 0, returned: Number(r.returned) || 0,
});

/** The FP lot's figures (see shape), or null. */
const fpCounts = async (db, tenantId, fpLotId) => {
  const { rows } = await db.query(COUNTS_SQL, [fpLotId, tenantId]);
  return rows.length ? shapeRow(rows[0]) : null;
};

// Serialises everything that reads and then changes a lot's FP count.
const lockLot = (db, tenantId, lotId) =>
  db.query("SELECT lot_id FROM lots WHERE lot_id = $1 AND tenant_id = $2 FOR UPDATE", [lotId, tenantId]);

const findFpChild = async (db, tenantId, parentLotId) =>
  (await db.query(
    `SELECT * FROM lots WHERE tenant_id = $1 AND parent_lot_id = $2 AND kind = 'further'`,
    [tenantId, parentLotId])).rows[0] || null;

/**
 * The FP lot for an N lot, created the first time. Call inside a transaction
 * with the parent locked. Throws { status, code } when the parent cannot have one.
 */
const ensureFpLot = async (db, tenantId, parentLotId, userId) => {
  const parent = (await db.query(
    "SELECT * FROM lots WHERE lot_id = $1 AND tenant_id = $2", [parentLotId, tenantId])).rows[0];
  if (!parent) throw Object.assign(new Error("That lot is not in the registry."), { status: 400, code: "NO_SUCH_LOT" });
  const number = parent.kind === "internal" ? fpNumberFor(parent.lot_number) : null;
  if (!number) {
    throw Object.assign(new Error(`${parent.lot_number} is not one of our N lots, so it cannot have an FP lot.`),
      { status: 400, code: "NOT_AN_N_LOT" });
  }
  const existing = await findFpChild(db, tenantId, parentLotId);
  if (existing) return { lot: existing, created: false };
  // lot_date is the parent's so it sorts with it; seq stays null so the day's sequence is untouched.
  const ins = await db.query(
    `INSERT INTO lots (tenant_id, lot_number, lot_date, seq, kind, parent_lot_id, created_by, notes)
     VALUES ($1, $2, $3, NULL, 'further', $4, $5, $6) RETURNING *`,
    [tenantId, number, parent.lot_date, parentLotId, userId || null, `Further processing of ${parent.lot_number}`]);
  return { lot: ins.rows[0], created: true };
};

/** ensureFpLot in its own transaction, for callers outside one. */
const ensureFpLotNow = async (pool, tenantId, parentLotId, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockLot(client, tenantId, parentLotId);
    const out = await ensureFpLot(client, tenantId, parentLotId, userId);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  ensureFpLotNow,
  normaliseItem, sentSql, weighedSql, weighedLbSql, byHandSql, takenSql, returnedSql,
  shape, shapeRow, COUNTS_SQL, fpCounts, lockLot, findFpChild, ensureFpLot,
};
