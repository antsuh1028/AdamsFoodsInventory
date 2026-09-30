"use strict";

// What a lot is, in words: its registration form's product, or for a lot never
// registered, what its incoming session was weighed as. Shared so the lot
// picker and the daily report never describe one lot two ways.
// `alias` is the outer table carrying lot_id / lot_number / tenant_id.
const lotDescriptionSql = (alias) => `COALESCE(
  (SELECT NULLIF(TRIM(f.product_description), '')
     FROM noblesse_registration_forms f
    WHERE f.tenant_id = ${alias}.tenant_id
      AND (f.lot_id = ${alias}.lot_id OR f.lot_number = ${alias}.lot_number)
      AND NULLIF(TRIM(f.product_description), '') IS NOT NULL
    ORDER BY f.created_at DESC LIMIT 1),
  (SELECT NULLIF(TRIM(b.item_description), '')
     FROM box_batches b
    WHERE b.tenant_id = ${alias}.tenant_id AND b.lot_id = ${alias}.lot_id
      AND b.direction = 'incoming'
      AND NULLIF(TRIM(b.item_description), '') IS NOT NULL
    ORDER BY b.created_at DESC LIMIT 1)
)`;

module.exports = { lotDescriptionSql };
