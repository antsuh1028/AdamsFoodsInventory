"use strict";

// Puts a processing order's output back into stock.
//
// THE GAP THIS CLOSES. Creating a processing order deducts raw weight from
// nti_inventory. Completing one recorded `output_weight` on the ORDER and
// stopped there — nothing ever went back into stock. So once NTI had processed
// a lot there was nothing in inventory to ship, and Outgoing had nothing to
// draw on. (NtiInventoryTab already worked around it, reconstructing in/out and
// yield from the orders because the stock row itself had gone to zero.)
//
// The output is now its own nti_inventory row: `stage = 'processed'`, carrying
// the SAME lot_id as the raw it was cut from. Same lot on and off the line —
// the registry rule applied to NTI's own processing.
//
// One row per order, keyed by source_processing_order_id and backed by a unique
// index. `sync` is the only entry point and is idempotent by construction:
// it works out what the row SHOULD be and makes the database match, so editing
// an output adjusts the existing row and reverting to pending removes it.

// Same shape as the helper in routes/noblesse.pg.js. Sliced from an ISO string
// rather than read via local date components, so no timezone can shift the day
// (the scar that turned 8/17 into 8/16 reading Excel dates).
const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d || null));

// What the processed row should look like, or null when there should not be one.
//
// Deliberately returns null rather than throwing: a half-finished order is a
// normal state, not an error, and the caller's own work must not fail because
// there is nothing to re-stock yet.
const intendedRow = (order, items) => {
  if (!order || order.status !== "completed") return null;

  const weight = order.output_weight != null ? Number(order.output_weight) : null;
  if (weight == null || !(weight > 0)) return null;

  const rows = Array.isArray(items) ? items : [];
  const lotIds = [...new Set(rows.map((i) => i.lot_id).filter((v) => v != null))];
  const lotTexts = [...new Set(rows.map((i) => i.lot).filter(Boolean))];
  const first = rows[0] || {};

  // An order can hold items from several lots while recording ONE output
  // figure, so which physical lot that output came from is unknowable. Rather
  // than guess a split, the stock is still created — Outgoing needs it — but
  // attached to no lot, with the lots named in the note so a person can see
  // what it came from. Wrong attribution is worse than missing attribution.
  const ambiguous = lotIds.length > 1 || lotTexts.length > 1;

  return {
    lotId: ambiguous ? null : (lotIds[0] ?? null),
    lot: ambiguous ? null : (lotTexts[0] ?? null),
    description: first.description || null,
    brand: first.brand || null,
    species: first.species || null,
    grade: first.grade || null,
    est: null,
    weight,
    qtyCases: order.output_cases != null ? Number(order.output_cases) : null,
    receivedDate: fmtDate(order.completed_at) || fmtDate(order.order_date),
    notes: ambiguous
      ? `Processed output of PO #${order.id} — inputs spanned lots ${lotTexts.join(", ")}, so no single lot could be assigned`
      : `Processed output of PO #${order.id}`,
  };
};

/**
 * Make the processed stock row match the order's current state.
 *
 * Call it after anything that changes an order's status or output. Safe to call
 * repeatedly and safe to call when there is nothing to do.
 *
 * Returns { action: "created" | "updated" | "removed" | "none", row }.
 */
const syncProcessedStock = async (client, tenantId, orderId) => {
  const orderRes = await client.query(
    `SELECT * FROM noblesse_processing_orders WHERE id = $1 AND tenant_id = $2`,
    [orderId, tenantId]
  );
  if (!orderRes.rows.length) return { action: "none", row: null };
  const order = orderRes.rows[0];

  const itemsRes = await client.query(
    `SELECT * FROM noblesse_processing_order_items WHERE processing_order_id = $1 ORDER BY id`,
    [orderId]
  );

  const existingRes = await client.query(
    `SELECT * FROM nti_inventory WHERE source_processing_order_id = $1 AND tenant_id = $2`,
    [orderId, tenantId]
  );
  const existing = existingRes.rows[0] || null;

  const want = intendedRow(order, itemsRes.rows);

  // Reverted to pending, or the output was cleared: the product is not
  // processed any more, so its stock must not linger.
  if (!want) {
    if (!existing) return { action: "none", row: null };
    await client.query(
      `DELETE FROM nti_inventory WHERE id = $1 AND tenant_id = $2`,
      [existing.id, tenantId]
    );
    return { action: "removed", row: existing };
  }

  if (existing) {
    const updated = await client.query(
      `UPDATE nti_inventory
          SET lot = $1, lot_id = $2, description = $3, brand = $4, species = $5,
              grade = $6, weight = $7, qty_cases = $8, received_date = $9, notes = $10
        WHERE id = $11 AND tenant_id = $12
      RETURNING *`,
      [want.lot, want.lotId, want.description, want.brand, want.species,
       want.grade, want.weight, want.qtyCases, want.receivedDate, want.notes,
       existing.id, tenantId]
    );
    return { action: "updated", row: updated.rows[0] };
  }

  const inserted = await client.query(
    `INSERT INTO nti_inventory
       (tenant_id, lot, lot_id, description, brand, species, grade, est,
        weight, qty_cases, received_date, notes, stage, source_processing_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'processed',$13)
     RETURNING *`,
    [tenantId, want.lot, want.lotId, want.description, want.brand, want.species,
     want.grade, want.est, want.weight, want.qtyCases, want.receivedDate,
     want.notes, orderId]
  );
  return { action: "created", row: inserted.rows[0] };
};

module.exports = { syncProcessedStock, intendedRow };
