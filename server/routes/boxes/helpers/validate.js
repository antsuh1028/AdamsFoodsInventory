// Checks one box as it arrives: its weight, unit and how it was entered.

const { parseGs1 } = require("../../../utils/gs1");
const { toPounds } = require("../../../utils/weight");

const UNITS = new Set(["LB", "KG"]);

const DECIMAL_RE = /^\d{1,5}(\.\d{1,3})?$/;

 // fits NUMERIC(8,3)
const MAX_WEIGHT_THOUSANDTHS = 2000n * 1000n;

 // 2000 lb/kg per box is already absurd
// Matches the column's CHECK.
const ENTRY_METHODS = new Set(["scanned", "scale", "keyed"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Decimal string -> integer thousandths, so weights compare exactly with no
// float ever entering the path. "76.20" and "76.2" must compare equal.
const toThousandths = (s) => {
  const [whole, frac = ""] = String(s).split(".");
  return BigInt(whole) * 1000n + BigInt((frac + "000").slice(0, 3));
};

// Validates one incoming scan and, when it carries a barcode, re-derives the weight
// from that barcode server-side.
const validateItem = (item) => {
  if (!item || typeof item !== "object") {
    return { ok: false, code: "BAD_ITEM", reason: "Item is not an object" };
  }

  const { weight, weightUnit, rawBarcode, isManual = false } = item;

  // Supplied by the client: the server sees the same payload from scale and keypad.
  const entryMethod = ENTRY_METHODS.has(item.entryMethod) ? item.entryMethod : null;
  const clientItemUuid = UUID_RE.test(String(item.clientItemUuid || ""))
    ? String(item.clientItemUuid) : null;

  if (typeof weight !== "string" || !DECIMAL_RE.test(weight)) {
    return { ok: false, code: "BAD_WEIGHT",
      reason: "weight must be a decimal string with at most 3 decimal places" };
  }
  if (!UNITS.has(weightUnit)) {
    return { ok: false, code: "BAD_UNIT", reason: "weightUnit must be LB or KG" };
  }

  const thousandths = toThousandths(weight);
  if (thousandths <= 0n) {
    return { ok: false, code: "BAD_WEIGHT", reason: "weight must be greater than zero" };
  }
  if (thousandths > MAX_WEIGHT_THOUSANDTHS) {
    return { ok: false, code: "IMPLAUSIBLE_WEIGHT", reason: "weight exceeds plausible range" };
  }

  // A weight the server itself re-derives from a barcode is a measurement by
  // definition.
  if (rawBarcode && item.isEstimated === true) {
    return { ok: false, code: "ESTIMATE_WITH_BARCODE",
      reason: "A weight read from a barcode is not an estimate" };
  }

  if (!rawBarcode) {
    if (!isManual) {
      return { ok: false, code: "MISSING_BARCODE",
        reason: "rawBarcode is required unless isManual is true" };
    }
    const asLb = toPounds(weight, weightUnit);
    if (toThousandths(asLb.weight) > MAX_WEIGHT_THOUSANDTHS) {
      return { ok: false, code: "IMPLAUSIBLE_WEIGHT", reason: "weight exceeds plausible range" };
    }
    return { ok: true, row: {
      weight: asLb.weight, weightUnit: asLb.weightUnit, convertedFrom: asLb.convertedFrom,
      gtin: null, productionDate: null,
      serial: null, rawBarcode: null, isManual: true,
      entryMethod, clientItemUuid,
      isEstimated: item.isEstimated === true,
    } };
  }

  let parsed;
  try {
    parsed = parseGs1(rawBarcode);
  } catch (err) {
    return { ok: false, code: err.code || "PARSE_FAILED",
      reason: `Server could not parse rawBarcode: ${err.message}` };
  }

  if (toThousandths(parsed.weight.value) !== thousandths) {
    return { ok: false, code: "WEIGHT_MISMATCH",
      reason: `Client sent ${weight} but rawBarcode decodes to ${parsed.weight.value}` };
  }
  if (parsed.weight.unit !== weightUnit) {
    return { ok: false, code: "UNIT_MISMATCH",
      reason: `Client sent ${weightUnit} but rawBarcode decodes to ${parsed.weight.unit}` };
  }

  // Only now, with the barcode verified against what the client claimed, is the
  // weight converted.
  const asLb = toPounds(parsed.weight.value, parsed.weight.unit);
  if (toThousandths(asLb.weight) > MAX_WEIGHT_THOUSANDTHS) {
    return { ok: false, code: "IMPLAUSIBLE_WEIGHT",
      reason: `Converts to ${asLb.weight} LB, outside the plausible range` };
  }

  return { ok: true, row: {
    // Stored in pounds. The original kilogram figure is not lost — raw_barcode
    // holds the payload it was read from and re-parses to it exactly.
    weight: asLb.weight,
    weightUnit: asLb.weightUnit,
    convertedFrom: asLb.convertedFrom,
    gtin: parsed.gtin,
    // Suppliers use one or the other: AI 11 (production) or AI 13 (packaging).
    productionDate: parsed.productionDate || parsed.packagingDate,
    serial: parsed.serial,
    rawBarcode,
    isManual: false,
    // FORCED, not taken from the client. The provenance of a box the server
    // verified against its own barcode parse is not the client's to assert.
    entryMethod: "scanned",
    isEstimated: false,
    clientItemUuid,
  } };
};

module.exports = { UNITS, DECIMAL_RE, MAX_WEIGHT_THOUSANDTHS, toThousandths, validateItem };
