"use strict";

const { weightInLb } = require("./sqlWeight");

// Yield for a lot: what left, over what arrived.
//
// Both sides are bench weights out of batch_items, split on
// box_batches.direction with voided rows excluded, so a lot's yield and the
// manifests it is built from quote the same pounds. Shared rather than written
// inline because the lot view, the registration form and the close-out all have
// to agree, and the way two figures drift apart is by each caller spelling out
// its own arithmetic.

const DIRECTIONS = new Set(["incoming", "outgoing"]);

// Weighed pounds on one side of a lot. Expects $1 = lot_id, $2 = tenant_id.
const weighedSql = (direction) => {
  // A literal, so it is checked here rather than trusted.
  if (!DIRECTIONS.has(direction)) throw new Error(`bad direction: ${direction}`);
  return `COALESCE((SELECT SUM(${weightInLb("bi")}) FROM batch_items bi
                      JOIN box_batches b ON b.batch_id = bi.batch_id
                     WHERE b.lot_id = $1 AND b.tenant_id = $2
                       AND b.direction = '${direction}' AND bi.voided_at IS NULL), 0)::text`;
};

// Boxes on one side of a lot. Zero is what separates "nothing has been weighed
// out" from "0 lb went out", which are different claims.
const boxesSql = (direction) => {
  if (!DIRECTIONS.has(direction)) throw new Error(`bad direction: ${direction}`);
  return `COALESCE((SELECT COUNT(*) FROM batch_items bi
                      JOIN box_batches b ON b.batch_id = bi.batch_id
                     WHERE b.lot_id = $1 AND b.tenant_id = $2
                       AND b.direction = '${direction}' AND bi.voided_at IS NULL), 0)::int`;
};

// The form's typed Original Weight, for lots that were never weighed in.
// Matched on lot_id OR the number, because forms predate the registry and some
// still carry only the text.
const formWeightSql = `
  COALESCE((SELECT MAX(original_weight) FROM noblesse_registration_forms f
             WHERE f.tenant_id = $2
               AND (f.lot_id = $1
                    OR f.lot_number = (SELECT lot_number FROM lots WHERE lot_id = $1))), 0)::text`;

// The same figures for a LIST of rows that each carry their own lot — one
// lateral instead of a query per row. `alias` is the outer table holding
// lot_id / lot_number / tenant_id.
const yieldLateralSql = (alias) => `
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(${weightInLb("bi")}) FILTER (WHERE b.direction = 'incoming'), 0)::text AS weighed_in,
      COALESCE(SUM(${weightInLb("bi")}) FILTER (WHERE b.direction = 'outgoing'), 0)::text AS weighed_out,
      COUNT(*) FILTER (WHERE b.direction = 'incoming')::int AS boxes_in,
      COUNT(*) FILTER (WHERE b.direction = 'outgoing')::int AS boxes_out
      FROM batch_items bi
      JOIN box_batches b ON b.batch_id = bi.batch_id
     WHERE b.tenant_id = ${alias}.tenant_id
       AND bi.voided_at IS NULL
       -- Forms predate the registry, so some carry only the text.
       AND b.lot_id = COALESCE(${alias}.lot_id,
             (SELECT l.lot_id FROM lots l
               WHERE l.tenant_id = ${alias}.tenant_id
                 AND l.lot_number = ${alias}.lot_number))
  ) y ON TRUE`;

const mils = (v) => Math.round(Number(v || 0) * 1000);
const lbText = (m) => (m / 1000).toFixed(2);

/**
 * The yield, from the figures lotFigures() selected.
 *
 * Never a bare number: a lot weighed on the bench and one carrying a typed
 * Original Weight are not the same claim, and a lot nothing has left yet is
 * NOT 0% — it is unmeasured. Both distinctions are reported rather than
 * flattened, because 0.0% against a lot still sitting in the freezer is a lie
 * the figures cannot defend.
 */
const yieldFrom = (f) => {
  const outMils = mils(f.weighed_out);
  const weighedIn = mils(f.weighed_in);
  const formIn = mils(f.form_weight);

  const inMils = weighedIn > 0 ? weighedIn : formIn;
  const basis = weighedIn > 0 ? "weighed" : (formIn > 0 ? "registered" : null);

  // An outgoing SESSION, not a weight: a lot can genuinely weigh out at zero
  // once, and that is measured.
  const measured = Number(f.boxes_out) > 0;

  return {
    inLb: inMils > 0 ? lbText(inMils) : null,
    outLb: lbText(outMils),
    basis,
    measured,
    // Thousandths throughout, so no float divides a weight.
    percent: measured && inMils > 0
      ? Math.round((outMils * 100000) / inMils) / 1000
      : null,
    unaccountedLb: measured && inMils > 0 ? lbText(inMils - outMils) : null,
  };
};

module.exports = { weighedSql, boxesSql, formWeightSql, yieldLateralSql, yieldFrom };
