"use strict";

// Puts registered product into stock.
//
// THE GAP THIS CLOSES. A registration form recorded a lot's received weight and
// case count and stopped there — nothing was written to nti_inventory. The only
// writer was push-to-inventory off an Incoming receipt, and in practice the work
// had moved to forms and box weighing years-of-habit ago: at the time this was
// written there was exactly ONE receipt in the database, months old, while four
// current lots sat in forms with real weights. So Outgoing's "Pick from stock"
// was empty and no load could be built.
//
// Registering a lot now stocks it as `stage = 'raw'`, one row per form, keyed by
// source_registration_form_id and backed by a unique index. `sync` is the only
// entry point and is idempotent by construction.
//
// WHY A DELTA, NOT AN OVERWRITE. syncProcessedStock can assign `weight`
// outright because an order's output is settled when it completes. A form is
// not: it stays in_progress for days and is edited throughout, and shipping
// deducts from the very column a re-sync would overwrite. Editing a form after a
// load went out would then resurrect the shipped stock. So the form's own claim
// is kept in `registered_weight` / `registered_cases`, and a re-sync applies
// (new claim - old claim) to what is on hand.
//
// The arithmetic is done in SQL on NUMERIC, never in JS: weights are decimal
// strings end to end here and a float in this path is how columns stop adding
// up to their own totals.

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d || null));

// total_quantity is a TEXT column on the form — operators type things like
// "150" but also "150 cs". Anything that isn't a clean whole number becomes
// null rather than a guess.
const parseCases = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isSafeInteger(n) ? n : null;
};

// A positive-weight test that never converts the string for storage. Number()
// is fine for the comparison; the value passed to Postgres stays the original
// decimal string.
const isPositiveWeight = (s) => s != null && String(s).trim() !== "" && Number(s) > 0;

/**
 * What the stock row should look like, or null when there should not be one.
 *
 * Returns null rather than throwing for the ordinary cases — a form with no
 * weight yet is a normal half-filled state, not an error, and saving it must
 * not fail because there is nothing to stock.
 */
const intendedRow = (form) => {
  if (!form) return null;
  if (!isPositiveWeight(form.original_weight)) return null;

  return {
    // Text lot and registry id both carried, same as the processed rows.
    // A form whose lot never resolved still stocks, so inventory stays
    // truthful; Outgoing's inner join is what keeps it off a load until the
    // lot is linked.
    lot: form.lot_number || null,
    lotId: form.lot_id ?? null,
    description: form.product_description || null,
    brand: form.brand || null,
    grade: form.grade || null,
    est: form.est_number || null,
    weight: String(form.original_weight),          // decimal string, untouched
    qtyCases: parseCases(form.total_quantity),
    receivedDate: fmtDate(form.date_received) || fmtDate(form.form_date),
    notes: `Registered on form #${form.id}`,
  };
};

/**
 * Make the stock row match the form's current state.
 *
 * Call after anything that creates, edits or deletes a form. Safe to call
 * repeatedly, and safe to call for a form that no longer exists — a missing
 * form removes its stock.
 *
 * `client` may be the pool or a transaction client.
 *
 * Returns { action: "created" | "updated" | "removed" | "none", row, shortfall }.
 * `shortfall` is set when a downward revision was clamped at zero — the form
 * now claims less than has already left the building, which a person needs to
 * look at.
 */
const syncRegistrationStock = async (client, tenantId, formId) => {
  const formRes = await client.query(
    `SELECT * FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
    [formId, tenantId]
  );
  const form = formRes.rows[0] || null;

  const existingRes = await client.query(
    `SELECT * FROM nti_inventory
      WHERE source_registration_form_id = $1 AND tenant_id = $2`,
    [formId, tenantId]
  );
  const existing = existingRes.rows[0] || null;

  const want = intendedRow(form);

  // Form deleted, or its weight cleared: the registration no longer claims
  // anything, so its stock must not linger.
  if (!want) {
    if (!existing) return { action: "none", row: null };
    await client.query(
      `DELETE FROM nti_inventory WHERE id = $1 AND tenant_id = $2`,
      [existing.id, tenantId]
    );
    return { action: "removed", row: existing };
  }

  if (existing) {
    // COALESCE(registered_weight, weight, 0) so a row created before these
    // columns existed treats its current on-hand as the previous claim, which
    // makes the first re-sync a no-op instead of a doubling.
    const updated = await client.query(
      `UPDATE nti_inventory
          SET lot = $1, lot_id = $2, description = $3, brand = $4, grade = $5,
              est = $6, received_date = $7, notes = $8,
              weight = GREATEST(
                0::numeric,
                COALESCE(weight, 0) + ($9::numeric - COALESCE(registered_weight, weight, 0))
              ),
              qty_cases = GREATEST(
                0,
                COALESCE(qty_cases, 0) + (COALESCE($10::int, 0) - COALESCE(registered_cases, qty_cases, 0))
              ),
              registered_weight = $9::numeric,
              registered_cases  = $10::int
        WHERE id = $11 AND tenant_id = $12
      RETURNING *,
              -- What the delta WOULD have produced without the clamp. A
              -- negative here means the form was revised below what has
              -- already shipped.
              (COALESCE(weight, 0) + ($9::numeric - COALESCE(registered_weight, weight, 0))) AS uncapped_weight`,
      [want.lot, want.lotId, want.description, want.brand, want.grade,
       want.est, want.receivedDate, want.notes,
       want.weight, want.qtyCases, existing.id, tenantId]
    );
    const row = updated.rows[0];
    const uncapped = row ? Number(row.uncapped_weight) : 0;
    return {
      action: "updated",
      row,
      shortfall: uncapped < 0 ? String(row.uncapped_weight) : null,
    };
  }

  const inserted = await client.query(
    `INSERT INTO nti_inventory
       (tenant_id, lot, lot_id, description, brand, grade, est,
        weight, qty_cases, received_date, notes, stage,
        registered_weight, registered_cases, source_registration_form_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::int,$10,$11,'raw',$8::numeric,$9::int,$12)
     RETURNING *`,
    [tenantId, want.lot, want.lotId, want.description, want.brand, want.grade,
     want.est, want.weight, want.qtyCases, want.receivedDate, want.notes, formId]
  );
  return { action: "created", row: inserted.rows[0], shortfall: null };
};

module.exports = { syncRegistrationStock, intendedRow, parseCases };
