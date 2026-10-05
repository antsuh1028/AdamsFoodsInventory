"use strict";

const { fpNumberFor } = require("./lot");

// Further-processing lots. An FP lot holds the cases of one N lot that went to
// the AF freezer for another run. Its count is computed every time, never
// stored: cases on the parent's tracker rows, less cases taken by accepted
// runs on the FP lot. A correction anywhere shows at once and nothing drifts.

// One spelling per item: trimmed, single-spaced, upper case.
const normaliseItem = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// Sent / taken for an FP lot. `fp` is a lots alias carrying lot_id, parent_lot_id, tenant_id.
const sentSql = (fp) => `
  COALESCE((SELECT SUM(t.cases) FROM fp_tracker t
             WHERE t.tenant_id = ${fp}.tenant_id AND t.lot_id = ${fp}.parent_lot_id
               AND t.voided_at IS NULL), 0)::int`;
const takenSql = (fp) => `
  COALESCE((SELECT SUM(r.input_cases) FROM noblesse_processing_reports r
             WHERE r.tenant_id = ${fp}.tenant_id AND r.lot_id = ${fp}.lot_id
               AND r.status = 'accepted'), 0)::int`;

const COUNTS_SQL = `
  SELECT ${sentSql("fp")} AS sent, ${takenSql("fp")} AS taken
    FROM lots fp WHERE fp.lot_id = $1 AND fp.tenant_id = $2 AND fp.kind = 'further'`;

/** { sent, taken, waiting } for an FP lot, or null when it is not one. */
const fpCounts = async (db, tenantId, fpLotId) => {
  const { rows } = await db.query(COUNTS_SQL, [fpLotId, tenantId]);
  if (!rows.length) return null;
  const sent = Number(rows[0].sent);
  const taken = Number(rows[0].taken);
  return { sent, taken, waiting: sent - taken };
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

module.exports = {
  normaliseItem, sentSql, takenSql, COUNTS_SQL, fpCounts, lockLot, findFpChild, ensureFpLot,
};
