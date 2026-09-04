"use strict";

// SQL fragments for reporting weights in pounds.
//
// Server-only on purpose: utils/weight.js is mirrored byte-for-byte with
// client/src/utils/weight.js and a test enforces that, so SQL cannot live
// there. This module is the single definition every route shares — the same
// figure has to come out whether it is asked for by the manifest, a session
// list, or a lot's totals, and the way two numbers drift apart is by each
// query spelling out its own arithmetic.

/**
 * A box weight, in pounds, rounded for display.
 *
 * Rows written before the KG conversion shipped are still stored in kilograms —
 * production ran that way for a while — so a total that trusted weight_unit
 * would report a kilogram figure beside a manifest printed in pounds.
 *
 * ROUND per row, THEN SUM at the call site. Never SUM then convert: each box
 * rounds independently, so the two orders disagree by a hundredth or so and the
 * printed column stops adding up to its own subtotal, which is exactly what
 * someone reconciling a shipment checks.
 *
 * Rounded TWICE on purpose: to thousandths first, matching what the client's
 * converter produces, then to the two decimals actually shown. Collapsing them
 * into one step can land a cent away at a rounding boundary, and then the
 * screen disagrees with the paper.
 *
 * @param {string} t optional table alias, e.g. "i" for batch_items i
 */
const weightInLb = (t = "") => {
  const col = t ? `${t}.` : "";
  return `ROUND(ROUND(CASE WHEN ${col}weight_unit = 'KG' THEN ${col}weight / 0.45359237 ELSE ${col}weight END, 3), 2)`;
};

/**
 * A stock weight, in pounds, rounded for display.
 *
 * nti_inventory carries no unit column — it is pounds by convention, having
 * been entered or converted on the way in — so there is nothing to convert
 * here, only the same two-decimal rounding so stock figures and box figures
 * are shown to the same precision.
 */
const stockWeightInLb = (t = "") => `ROUND(${t ? `${t}.` : ""}weight, 2)`;

module.exports = { weightInLb, stockWeightInLb };
