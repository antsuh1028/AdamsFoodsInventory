"use strict";

const { pacificToday, dayOfYearFromDate, formatMixLot, parseMixLot } = require("./lot");
const { syncRegistrationStock, parseCases } = require("./registrationStock");

// Mixed lots: N lots mixed together before processing, run and shipped as one NX lot.
// The NX lot's form carries the sources' combined figures and its stock row their
// total; each source keeps its own form and claim, with nothing left on hand.

const fail = (status, code, message, extra = {}) =>
  Object.assign(new Error(message), { status, code, ...extra });

const MAX_SEQ = 99;
const MIXED = "MIXED";

/** SQL for a lot and the lots mixed into it. `x` is a lot_id expression. */
const familySql = (x) =>
  `(SELECT ${x} UNION ALL SELECT mm.lot_id FROM lot_mix_members mm WHERE mm.mix_lot_id = ${x})`;

/** The mix a lot is in, as { mixLotId, mixLotNumber, lotNumber }, or null. */
const mixOf = async (db, tenantId, lotId) => {
  if (lotId == null) return null;
  const { rows } = await db.query(
    `SELECT m.mix_lot_id, x.lot_number AS mix_lot_number, l.lot_number
       FROM lot_mix_members m
       JOIN lots x ON x.lot_id = m.mix_lot_id
       JOIN lots l ON l.lot_id = m.lot_id
      WHERE m.lot_id = $1 AND m.tenant_id = $2`,
    [lotId, tenantId]);
  const r = rows && rows[0];
  return r && r.mix_lot_id != null
    ? { mixLotId: r.mix_lot_id, mixLotNumber: r.mix_lot_number, lotNumber: r.lot_number } : null;
};

/** Throws LOT_IN_MIX when the lot is in a mix. `doing` finishes "...under NX instead". */
const refuseInMix = async (db, tenantId, lotId, doing) => {
  const mix = await mixOf(db, tenantId, lotId);
  if (!mix) return;
  throw fail(409, "LOT_IN_MIX",
    `${mix.lotNumber} is mixed into ${mix.mixLotNumber}. ${doing} under ${mix.mixLotNumber} instead.`,
    { mixLotId: mix.mixLotId, mixLotNumber: mix.mixLotNumber });
};

/** Throws MIXED_LOT when the lot is an NX lot. */
const refuseMixedLot = async (db, tenantId, lotId, message) => {
  if (lotId == null) return;
  const { rows } = await db.query(
    "SELECT kind, lot_number FROM lots WHERE lot_id = $1 AND tenant_id = $2 AND kind = 'mixed'", [lotId, tenantId]);
  const r = rows && rows[0];
  if (r && r.kind === "mixed") throw fail(409, "MIXED_LOT", `${r.lot_number} is a mixed lot. ${message}`);
};

// What could stop each lot going into a mix. `$2` is the lot ids.
const SOURCE_CHECKS_SQL = `
  SELECT l.lot_id, l.lot_number, l.kind, l.status,
         (SELECT mx.lot_number FROM lot_mix_members m JOIN lots mx ON mx.lot_id = m.mix_lot_id
           WHERE m.lot_id = l.lot_id) AS in_mix,
         (SELECT COUNT(*) FROM noblesse_processing_reports r
           WHERE r.tenant_id = l.tenant_id AND r.status <> 'rejected'
             AND (r.lot_id = l.lot_id OR r.lot_id IN (
                   SELECT c.lot_id FROM lots c WHERE c.parent_lot_id = l.lot_id)))::int AS runs,
         (SELECT COUNT(*) FROM noblesse_registration_forms f,
                 jsonb_array_elements(COALESCE(f.processing_dates, '[]'::jsonb)) e
           WHERE f.tenant_id = l.tenant_id AND f.lot_id = l.lot_id
             AND (NULLIF(e->>'cases', '') IS NOT NULL OR NULLIF(e->>'weight', '') IS NOT NULL))::int AS hand_runs,
         (EXISTS (SELECT 1 FROM lots c WHERE c.parent_lot_id = l.lot_id)
          OR EXISTS (SELECT 1 FROM fp_tracker t
                      WHERE t.tenant_id = l.tenant_id AND t.lot_id = l.lot_id AND t.voided_at IS NULL)) AS fp,
         (SELECT COUNT(*) FROM box_batches b
           WHERE b.tenant_id = l.tenant_id AND b.lot_id = l.lot_id AND b.direction = 'outgoing')::int AS weighed_out,
         (SELECT COUNT(*) FROM noblesse_shipment_items si
            JOIN noblesse_shipments sh ON sh.shipment_id = si.shipment_id
           WHERE si.tenant_id = l.tenant_id AND si.lot_id = l.lot_id AND sh.status <> 'cancelled')::int AS loads,
         (SELECT COUNT(*) FROM noblesse_registration_forms f
           WHERE f.tenant_id = l.tenant_id AND f.lot_id = l.lot_id)::int AS forms
    FROM lots l
   WHERE l.tenant_id = $1 AND l.lot_id = ANY($2::int[])`;

/** Why a lot cannot go into a mix, in a sentence, or null. `r` is a SOURCE_CHECKS_SQL row. */
const sourceBlock = (r) => {
  const n = r.lot_number;
  if (r.kind === "mixed") return `${n} is itself a mixed lot.`;
  if (r.kind !== "internal") return `${n} is not one of our N lots, so it cannot be mixed.`;
  if (r.in_mix) return `${n} is already in ${r.in_mix}.`;
  if (r.status === "closed") return `${n} is closed.`;
  if (r.runs > 0) return `${n} already has processing runs. Lots are mixed before processing.`;
  if (r.hand_runs > 0) return `${n} has processing written on its registration form. Lots are mixed before processing.`;
  if (r.fp) return `${n} has product on the F.P Tracker.`;
  if (r.weighed_out > 0) return `${n} has already been weighed out.`;
  if (r.loads > 0) return `${n} is on an outgoing load.`;
  if (r.forms > 1) return `${n} has ${r.forms} registration forms. It needs exactly one to be mixed.`;
  return null;
};

const sourceChecks = async (db, tenantId, lotIds) =>
  (await db.query(SOURCE_CHECKS_SQL, [tenantId, lotIds])).rows;

/** Why the mix can no longer lose a lot (it has been processed or used), or null. */
const mixUseBlock = async (db, tenantId, mixLotId) => {
  const { rows } = await db.query(`
    SELECT l.lot_number,
           (SELECT COUNT(*) FROM noblesse_processing_reports r
             WHERE r.tenant_id = l.tenant_id AND r.lot_id = l.lot_id AND r.status <> 'rejected')::int AS runs,
           (SELECT COUNT(*) FROM noblesse_registration_forms f,
                   jsonb_array_elements(COALESCE(f.processing_dates, '[]'::jsonb)) e
             WHERE f.tenant_id = l.tenant_id AND f.lot_id = l.lot_id
               AND (NULLIF(e->>'cases', '') IS NOT NULL OR NULLIF(e->>'weight', '') IS NOT NULL))::int AS hand_runs,
           (SELECT COUNT(*) FROM box_batches b
             WHERE b.tenant_id = l.tenant_id AND b.lot_id = l.lot_id)::int AS sessions,
           (SELECT COUNT(*) FROM noblesse_shipment_items si
              JOIN noblesse_shipments sh ON sh.shipment_id = si.shipment_id
             WHERE si.tenant_id = l.tenant_id AND si.lot_id = l.lot_id AND sh.status <> 'cancelled')::int AS loads
      FROM lots l WHERE l.lot_id = $1 AND l.tenant_id = $2`, [mixLotId, tenantId]);
  const r = rows[0];
  if (!r) return null;
  const n = r.lot_number;
  if (r.runs > 0) return `${n} has processing runs on it, so its lots can no longer be taken out.`;
  if (r.hand_runs > 0) return `${n} has processing written on its registration form, so its lots can no longer be taken out.`;
  if (r.sessions > 0) return `${n} has been weighed, so its lots can no longer be taken out.`;
  if (r.loads > 0) return `${n} is on an outgoing load, so its lots can no longer be taken out.`;
  return null;
};

/** The NX lot, locked. Throws 404 when it is not a mixed lot of this tenant. */
const lockMix = async (client, tenantId, mixLotId) => {
  const { rows } = await client.query(
    "SELECT * FROM lots WHERE lot_id = $1 AND tenant_id = $2 AND kind = 'mixed' FOR UPDATE",
    [mixLotId, tenantId]);
  if (!rows.length) throw fail(404, "NO_SUCH_MIX", "That mixed lot was not found.");
  return rows[0];
};

/** Issues the next NX number for a day (Pacific today by default). Call inside a transaction. */
const issueMixLot = async (client, tenantId, userId, date = null) => {
  const lotDate = date || pacificToday();
  const { year, dayOfYear } = dayOfYearFromDate(lotDate);
  // Two mixes made at the same moment take turns, so they cannot both read -01.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`lot-mix:${tenantId}:${lotDate}`]);
  const { rows } = await client.query(
    "SELECT lot_number FROM lots WHERE tenant_id = $1 AND kind = 'mixed' AND lot_date = $2",
    [tenantId, lotDate]);
  const seq = rows.reduce((max, r) => Math.max(max, parseMixLot(r.lot_number).seq || 0), 0) + 1;
  if (seq > MAX_SEQ) throw fail(409, "NO_SEQUENCE", `All ${MAX_SEQ} mixed lot numbers for ${lotDate} are used.`);
  // seq stays null: the N lots' day sequence is not this one.
  const ins = await client.query(
    `INSERT INTO lots (tenant_id, lot_number, lot_date, seq, kind, created_by, notes)
     VALUES ($1, $2, $3, NULL, 'mixed', $4, 'Mixed lot') RETURNING *`,
    [tenantId, formatMixLot(year % 100, dayOfYear, seq), lotDate, userId || null]);
  return ins.rows[0];
};

// Each source with its registration form, oldest lot first.
const SOURCES_SQL = `
  SELECT l.lot_id, l.lot_number, l.lot_date, m.added_at, m.added_by,
         f.id AS form_id, f.date_received, f.time_received, f.vendor, f.vendor_lot,
         f.product_description, f.brand, f.est_number, f.grade,
         f.original_weight::text AS original_weight, f.total_quantity
    FROM lot_mix_members m
    JOIN lots l ON l.lot_id = m.lot_id
    LEFT JOIN noblesse_registration_forms f ON f.tenant_id = m.tenant_id AND f.lot_id = m.lot_id
   WHERE m.mix_lot_id = $1 AND m.tenant_id = $2
   ORDER BY l.lot_date NULLS LAST, l.lot_number`;

const fmtDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d || null));

const fmtSource = (r) => ({
  lotId: r.lot_id, lotNumber: r.lot_number, addedAt: r.added_at, addedBy: r.added_by,
  formId: r.form_id ?? null,
  dateReceived: fmtDay(r.date_received), timeReceived: r.time_received || null,
  vendor: r.vendor || null, vendorLot: r.vendor_lot || null,
  productDescription: r.product_description || null,
  brand: r.brand || null, estNumber: r.est_number || null, grade: r.grade || null,
  originalWeight: r.original_weight ?? null, totalQuantity: r.total_quantity ?? null,
  cases: parseCases(r.total_quantity),
});

/** The sources of a mix, oldest first. */
const mixSources = async (db, tenantId, mixLotId) =>
  (await db.query(SOURCES_SQL, [mixLotId, tenantId])).rows.map(fmtSource);

// One value when every source that has one agrees, MIXED when they differ, null when none has one.
const shared = (values) => {
  const seen = new Map();
  for (const v of values) {
    const t = String(v ?? "").trim();
    if (t && !seen.has(t.toUpperCase())) seen.set(t.toUpperCase(), t);
  }
  if (!seen.size) return null;
  return seen.size === 1 ? [...seen.values()][0] : MIXED;
};

/**
 * Brings the NX form and its stock row up to the sources as they stand now.
 * Call after anything changes a source or the membership, inside a transaction
 * holding the NX lot's lock.
 */
const refreshMix = async (client, tenantId, mixLotId) => {
  const sources = await mixSources(client, tenantId, mixLotId);
  const totals = await client.query(
    `SELECT SUM(f.original_weight)::text AS weight
       FROM lot_mix_members m
       JOIN noblesse_registration_forms f ON f.tenant_id = m.tenant_id AND f.lot_id = m.lot_id
      WHERE m.mix_lot_id = $1 AND m.tenant_id = $2`, [mixLotId, tenantId]);
  const counted = sources.filter((s) => s.cases != null);
  const cases = counted.length ? counted.reduce((sum, s) => sum + s.cases, 0) : null;

  const form = await client.query(
    `UPDATE noblesse_registration_forms
        SET vendor = $3, vendor_lot = $4, brand = $5, est_number = $6, grade = $7,
            original_weight = $8::numeric, total_quantity = $9, updated_at = now()
      WHERE tenant_id = $1 AND lot_id = $2
    RETURNING id`,
    [tenantId, mixLotId,
     shared(sources.map((s) => s.vendor)), shared(sources.map((s) => s.vendorLot)),
     shared(sources.map((s) => s.brand)), shared(sources.map((s) => s.estNumber)),
     shared(sources.map((s) => s.grade)),
     totals.rows[0]?.weight ?? null, cases == null ? null : String(cases)]);
  const formId = form.rows[0]?.id;
  const stock = formId ? await syncRegistrationStock(client, tenantId, formId) : { action: "none" };
  return { sources, formId, stock };
};

/** refreshMix for whichever of these lots are in a mix, each in its own transaction. */
const refreshMixesFor = async (pool, tenantId, lotIds) => {
  const ids = [...new Set((lotIds || []).filter((v) => v != null).map(Number))];
  if (!ids.length) return [];
  const { rows } = await pool.query(
    "SELECT DISTINCT mix_lot_id FROM lot_mix_members WHERE tenant_id = $1 AND lot_id = ANY($2::int[])",
    [tenantId, ids]);
  const out = [];
  for (const { mix_lot_id: mixLotId } of (rows || []).filter((r) => r.mix_lot_id != null)) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockMix(client, tenantId, mixLotId);
      out.push({ mixLotId, ...(await refreshMix(client, tenantId, mixLotId)) });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return out;
};

// Source stock rows: the raw row of each source lot's form.
const SOURCE_ROWS = `stage = 'raw' AND tenant_id = $1 AND source_registration_form_id IN (
  SELECT id FROM noblesse_registration_forms WHERE tenant_id = $1 AND lot_id = ANY($2::int[]))`;

/**
 * Mixes lots into an NX lot. Call inside a transaction holding the NX lot's lock.
 * Throws 409 MIX_REFUSED, naming every lot that cannot go in and why.
 */
const addSources = async (client, tenantId, mixLotId, lotIds, username) => {
  const ids = [...new Set((lotIds || []).map(Number))].filter(Number.isInteger).sort((a, b) => a - b);
  if (!ids.length) throw fail(400, "NO_LOTS", "Pick at least one lot to mix.");
  const locked = await client.query(
    "SELECT lot_id FROM lots WHERE tenant_id = $1 AND lot_id = ANY($2::int[]) ORDER BY lot_id FOR UPDATE",
    [tenantId, ids]);
  if (locked.rows.length !== ids.length) throw fail(404, "NO_SUCH_LOT", "One of those lots was not found.");

  const checks = await sourceChecks(client, tenantId, ids);
  const refused = checks.map((r) => ({ lotId: r.lot_id, lotNumber: r.lot_number, reason: sourceBlock(r) }))
    .filter((r) => r.reason);
  if (refused.length) {
    throw fail(409, "MIX_REFUSED", refused.map((r) => r.reason).join(" "), { refused });
  }

  await client.query(
    `INSERT INTO lot_mix_members (lot_id, tenant_id, mix_lot_id, added_by)
     SELECT id, $1, $2, $3 FROM UNNEST($4::int[]) AS id`,
    [tenantId, mixLotId, username || null, ids]);
  // Everything they hold is the NX lot's now.
  await client.query(`UPDATE nti_inventory SET weight = 0, qty_cases = 0 WHERE ${SOURCE_ROWS}`, [tenantId, ids]);
  return { added: checks.map((r) => ({ lotId: r.lot_id, lotNumber: r.lot_number })), ...(await refreshMix(client, tenantId, mixLotId)) };
};

/**
 * Takes a lot back out of a mix, giving it back its own stock. Call inside a
 * transaction holding the NX lot's lock. Refused once the NX lot has been used.
 */
const removeSource = async (client, tenantId, mixLotId, lotId) => {
  const member = await client.query(
    `SELECT m.lot_id, l.lot_number FROM lot_mix_members m JOIN lots l ON l.lot_id = m.lot_id
      WHERE m.tenant_id = $1 AND m.mix_lot_id = $2 AND m.lot_id = $3`,
    [tenantId, mixLotId, lotId]);
  if (!member.rows.length) throw fail(404, "NOT_IN_MIX", "That lot is not in this mix.");
  const blocked = await mixUseBlock(client, tenantId, mixLotId);
  if (blocked) throw fail(409, "MIX_IN_USE", blocked);

  await client.query("DELETE FROM lot_mix_members WHERE tenant_id = $1 AND lot_id = $2", [tenantId, lotId]);
  // Nothing has been taken from the mix, so the lot gets back exactly what it registered.
  await client.query(
    `UPDATE nti_inventory SET weight = COALESCE(registered_weight, weight),
            qty_cases = COALESCE(registered_cases, qty_cases)
      WHERE ${SOURCE_ROWS}`, [tenantId, [lotId]]);
  return { removed: { lotId, lotNumber: member.rows[0].lot_number }, ...(await refreshMix(client, tenantId, mixLotId)) };
};

module.exports = {
  MIXED, familySql, mixOf, refuseInMix, refuseMixedLot, sourceChecks, sourceBlock, SOURCE_CHECKS_SQL,
  mixUseBlock, lockMix, issueMixLot, mixSources, shared, refreshMix, refreshMixesFor,
  addSources, removeSource,
};
