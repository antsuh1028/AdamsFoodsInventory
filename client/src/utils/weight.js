// @ts-check
/* global BigInt */
// ^ Create React App lints the mirrored copy of this file against an older
// ecmaVersion that predates BigInt. It exists in every browser this app runs on
// (iPadOS Safari 14+); only the linter needs telling.

// Weight arithmetic and unit conversion.
//
// This file is mirrored verbatim at client/src/utils/weight.js so the browser
// can show a converted figure without asking the server, and the server can
// compute the authoritative one. server/tests/weight.test.js fails if the two
// ever drift.
//
// Everything is integer thousandths. No JavaScript float appears anywhere in
// this file, and none may be introduced: a float accumulator drifts over a
// thousand-box shift, and the operator's running total has to agree exactly
// with what Postgres stores in NUMERIC(8,3).
//
// The conversion is EXACT, not approximate. One international avoirdupois
// pound is defined as 0.45359237 kg exactly, so
//
//     lb = kg / 0.45359237  =  kg * 100000000 / 45359237
//
// which is a ratio of two integers and can be evaluated in BigInt with a single
// rounding step at the end. Multiplying by a decimal literal like 2.20462262185
// would introduce float error before the rounding ever happened.

// 1 lb = 0.45359237 kg, exactly, by definition.
const LB_NUM = 100000000n;
const LB_DEN = 45359237n;

class WeightError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "WeightError";
    this.code = code;
  }
}

// "76.20" -> 76200n. Accepts up to three decimal places, which is what
// NUMERIC(8,3) holds; anything longer is a caller bug, not a value to round.
// A string, never a number: String(76.2) passes the regex, so a float would too.
/** @param {string} s @returns {bigint} */
const toThousandths = (s) => {
  const str = String(s).trim();
  if (!/^-?\d{1,7}(\.\d{1,3})?$/.test(str)) {
    throw new WeightError("BAD_WEIGHT", `Not a weight this system can hold: "${s}"`);
  }
  const negative = str.startsWith("-");
  const [whole, frac = ""] = (negative ? str.slice(1) : str).split(".");
  const value = BigInt(whole) * 1000n + BigInt((frac + "000").slice(0, 3));
  return negative ? -value : value;
};

// 76200n -> "76.200". Trailing zeros are kept: this is the storage form, and
// NUMERIC(8,3) round-trips it unchanged. Use trimTrailingZeros for display.
/** @param {bigint} n @returns {string} */
const fromThousandths = (n) => {
  const v = BigInt(n);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  return `${negative ? "-" : ""}${abs / 1000n}.${String(abs % 1000n).padStart(3, "0")}`;
};

// "63.000" -> "63", "76.200" -> "76.2". For the printed manifest, which copies
// the paper form's habit of writing the shortest unambiguous number.
/** @param {string} s @returns {string} */
const trimTrailingZeros = (s) => {
  const str = String(s);
  if (!str.includes(".")) return str;
  return str.replace(/\.?0+$/, "");
};

// Half-up rounding on an exact rational. Half-up rather than banker's rounding
// because this figure is reconciled against a paper form filled in by hand, and
// "round half up" is what a person does.
/** @param {bigint} numerator @param {bigint} denominator @returns {bigint} */
const divideRounded = (numerator, denominator) => {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const rounded = (n % d) * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
};

/** @param {bigint} kgThousandths @returns {bigint} */
const kgToLbThousandths = (kgThousandths) =>
  divideRounded(BigInt(kgThousandths) * LB_NUM, LB_DEN);

/** @param {bigint} lbThousandths @returns {bigint} */
const lbToKgThousandths = (lbThousandths) =>
  divideRounded(BigInt(lbThousandths) * LB_DEN, LB_NUM);

// Decimal string in, decimal string out.
/** @param {string} kg @returns {string} */
const kgToLb = (kg) => fromThousandths(kgToLbThousandths(toThousandths(kg)));
/** @param {string} lb @returns {string} */
const lbToKg = (lb) => fromThousandths(lbToKgThousandths(toThousandths(lb)));

/**
 * Normalise one weight to pounds.
 *
 * Returns { weight, weightUnit, convertedFrom } where convertedFrom is the
 * original unit when a conversion happened and null when it did not, so a row
 * can say on its face that it came off a kilogram label.
 *
 * @param {string} weight
 * @param {string} unit
 * @returns {{ weight: string, weightUnit: "LB", convertedFrom: "KG" | null }}
 */
const toPounds = (weight, unit) => {
  const u = String(unit || "").toUpperCase();
  if (u === "LB") {
    // Validated but returned verbatim. A pound weight needs no conversion, and
    // reformatting it ("76.20" -> "76.200") would churn the stored form of every
    // American box for no gain — NUMERIC(8,3) holds both identically.
    toThousandths(weight);
    return { weight: String(weight).trim(), weightUnit: "LB", convertedFrom: null };
  }
  if (u === "KG") return { weight: kgToLb(weight), weightUnit: "LB", convertedFrom: "KG" };
  throw new WeightError("BAD_UNIT", `Unit must be LB or KG, got "${unit}"`);
};

/**
 * Sum decimal-string weights exactly.
 *
 * Note for anyone tempted to "simplify" this: the weights passed in must
 * already be converted. Summing kilograms and converting the total gives a
 * different answer from converting each box and summing, because each box
 * rounds independently. The manifest prints one weight per box, so the total
 * has to be the sum of the printed numbers or the column will not add up on
 * paper — which is precisely the thing someone reconciling a shipment checks.
 *
 * @param {string[]} weights
 * @returns {string}
 */
const sumWeights = (weights) =>
  fromThousandths(weights.reduce((acc, w) => acc + toThousandths(w), 0n));

// ── Display rounding ─────────────────────────────────────────────────────────
// Weights are STORED in thousandths and SHOWN to two decimal places, which is
// what the paper tally carries; the third decimal is storage precision, not
// something a person writes in a column.
//
// Round per box, THEN sum — never sum then round. Three boxes at .005 are .01
// each on the page and add to .03, while the true sum is .015 and rounds to
// .02. A tally whose column does not add up to its own printed subtotal is
// exactly what someone reconciling a shipment notices, so the printed figures
// are the ones that must agree.
/** @param {string} w @returns {bigint} */
const toDisplayHundredths = (w) => {
  const t = toThousandths(w);
  const negative = t < 0n;
  const abs = negative ? -t : t;
  const rounded = (abs + 5n) / 10n; // half-up, as a person rounds
  return negative ? -rounded : rounded;
};

// A number is allowed here: hundredths are integers, and callers sum them as
// plain numbers once each box has been rounded.
/** @param {bigint | number} n @returns {string} */
const fromHundredths = (n) => {
  const v = BigInt(n);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};

// "76.059" -> "76.06". Storage form in, display form out.
/** @param {string} w @returns {string} */
const toDisplay = (w) => fromHundredths(toDisplayHundredths(w));

module.exports = {
  toThousandths, fromThousandths, trimTrailingZeros,
  toDisplayHundredths, fromHundredths, toDisplay,
  kgToLbThousandths, lbToKgThousandths, kgToLb, lbToKg,
  toPounds, sumWeights, WeightError,
  LB_NUM, LB_DEN,
};
