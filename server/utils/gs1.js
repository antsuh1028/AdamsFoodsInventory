// @ts-check
// GS1 Application Identifier parser for catchweight box labels.
//
// This file is mirrored verbatim at client/src/utils/gs1.js so the browser can
// parse a scan offline and the server can independently re-parse it before
// trusting the client. server/tests/gs1.test.js fails if the two ever drift.
//
// Two things here cause silently wrong weights if you get them wrong:
//
//   1. Field positions are NOT fixed. AIs 10, 21, 30, 240 and friends are
//      variable length, so a single one of them shifts every byte after it.
//      We walk the string AI by AI instead of slicing at constants.
//   2. 320n is POUNDS, 310n is KILOGRAMS, and the final digit of the AI is the
//      number of implied decimal places. Reading 3202 as kilograms, or dividing
//      by a hardcoded 100, is a 2.2x or 10x error on every box.
//
// No JavaScript float is ever produced in the parse path. Weight is carried as
// a decimal string from the barcode all the way to NUMERIC in Postgres.

/** @typedef {{ ai: string, value: string }} AiPair */
/** @typedef {{ value: string, unit: "KG" | "LB", decimals: number }} Gs1Weight */
/**
 * @typedef {object} Gs1Parse
 * @property {string | null} gtin
 * @property {string | null} productionDate
 * @property {string | null} packagingDate
 * @property {string | null} serial
 * @property {string | null} lot
 * @property {Gs1Weight | null} weight
 * @property {string} raw
 * @property {string[]} unparsed
 */
// Told apart by `variable`, so a fixed AI has a length and a variable one a max.
/** @typedef {{ ai: string, variable: false, length: number } | { ai: string, variable: true, max: number }} AiSpec */

const GS = String.fromCharCode(29); // ASCII 29 — FNC1 as transmitted by most HID scanners

// AIM symbology identifiers some scanners prepend to the payload.
const SYMBOLOGY_PREFIXES = ["]C1", "]e0", "]d2", "]Q3"];

// AIs with a GS1-predefined length: the data runs exactly this many characters
// and needs no separator after it.
/** @type {{ [ai: string]: number | undefined }} */
const FIXED = {
  "00": 18, // SSCC
  "01": 14, // GTIN-14
  "02": 14, // GTIN of contained trade items
  "11": 6,  // production date  YYMMDD
  "12": 6,  // due date
  "13": 6,  // packaging date
  "15": 6,  // best before
  "16": 6,  // sell by
  "17": 6,  // expiry date
  "20": 2,  // variant
};

// AIs that run until FNC1/GS or end of string. Value is the GS1 maximum length.
/** @type {{ [ai: string]: number | undefined }} */
const VARIABLE = {
  "10": 20,  // batch / lot
  "21": 20,  // serial
  "22": 20,  // consumer product variant
  "30": 8,   // variable count
  "37": 8,   // count of trade items
  "240": 30, "241": 30, "242": 6,
  "250": 30, "251": 30, "253": 30, "254": 20, "255": 25,
  "90": 30,
  "91": 90, "92": 90, "93": 90, "94": 90,
  "95": 90, "96": 90, "97": 90, "98": 90, "99": 90,
};

// 31nn-36nn are the measurement family: 4-digit AI, 6 digits of data, where the
// last AI digit is the decimal position.
const MEASUREMENT_PREFIXES = new Set(["31", "32", "33", "34", "35", "36"]);

// Only these two are *net weight*. The rest of the measurement family parses
// correctly (so it cannot shift later fields) but is never read as a weight.
/** @type {{ [prefix: string]: "KG" | "LB" | undefined }} */
const NET_WEIGHT_UNITS = { "310": "KG", "320": "LB" };

class Gs1Error extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "Gs1Error";
    this.code = code;
    this.details = details;
  }
}

// Places the implied decimal point using string surgery only.
//   ("007620", 2) -> "76.20"      ("007620", 1) -> "762.0"
//   ("007620", 3) -> "7.620"      ("007620", 0) -> "7620"
/** @param {string} digits @param {number} decimals @returns {string} */
const applyDecimal = (digits, decimals) => {
  /** @param {string} s */
  const stripLeadingZeros = (s) => s.replace(/^0+(?=\d)/, "");
  if (decimals === 0) return stripLeadingZeros(digits);
  const padded = digits.padStart(decimals + 1, "0");
  const cut = padded.length - decimals;
  return `${stripLeadingZeros(padded.slice(0, cut))}.${padded.slice(cut)}`;
};

// YYMMDD -> "YYYY-MM-DD". GS1 allows DD = "00" meaning "end of month".
/** @param {string} yymmdd @returns {string} */
const parseGs1Date = (yymmdd) => {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) {
    throw new Gs1Error("BAD_DATE", `Invalid month in date "${yymmdd}"`, { value: yymmdd });
  }
  // GS1 two-digit year window: 00-69 is 20xx, 70-99 is 19xx.
  const year = yy <= 69 ? 2000 + yy : 1900 + yy;
  if (dd === 0) dd = new Date(Date.UTC(year, mm, 0)).getUTCDate(); // last day of month
  if (dd < 1 || dd > 31) {
    throw new Gs1Error("BAD_DATE", `Invalid day in date "${yymmdd}"`, { value: yymmdd });
  }
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(mm)}-${pad(dd)}`;
};

// Reads the AI starting at `i`. Longest-match first: 4-digit measurement AIs,
// then 3-digit, then 2-digit.
/** @param {string} s @param {number} i @returns {AiSpec} */
const readAi = (s, i) => {
  const two = s.slice(i, i + 2);
  if (MEASUREMENT_PREFIXES.has(two)) {
    const ai = s.slice(i, i + 4);
    if (!/^\d{4}$/.test(ai)) {
      throw new Gs1Error("TRUNCATED", `Truncated measurement AI "${s.slice(i)}"`, { at: i });
    }
    return { ai, length: 6, variable: false };
  }
  const three = s.slice(i, i + 3);
  // Each read once, so the undefined check and the value are the same lookup.
  const variableThree = VARIABLE[three];
  if (variableThree !== undefined) return { ai: three, max: variableThree, variable: true };
  const fixedTwo = FIXED[two];
  if (fixedTwo !== undefined) return { ai: two, length: fixedTwo, variable: false };
  const variableTwo = VARIABLE[two];
  if (variableTwo !== undefined) return { ai: two, max: variableTwo, variable: true };
  throw new Gs1Error("UNKNOWN_AI", `Unrecognized application identifier "${two}"`, { at: i, ai: two });
};

// Some scanners transmit the AIs in the bracketed human-readable form:
//   (01)90076338792309(3201)000630(11)260331(21)1102019882
// It is the same data. The brackets are never in the encoded symbol — the
// scanner adds them — but they make every field boundary explicit, so this
// form needs no FNC1 and no length table to be read unambiguously.
/** @param {string} s */
const looksLikeHri = (s) => /^\(\d{2,4}\)/.test(s);

/** @param {string} s @returns {AiPair[]} */
const readHriPairs = (s) => {
  /** @type {AiPair[]} */
  const pairs = [];
  const re = /\((\d{2,4})\)([^(]*)/g;
  let expectedAt = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    // Anything between one field and the next is not part of either, and
    // guessing what it belongs to is how wrong weights happen.
    if (m.index !== expectedAt) {
      throw new Gs1Error("TRUNCATED",
        `Unexpected text before AI (${m[1]})`, { at: expectedAt });
    }
    if (m[2].length === 0) {
      throw new Gs1Error("TRUNCATED", `AI ${m[1]} has no value`, { ai: m[1] });
    }
    pairs.push({ ai: m[1], value: m[2] });
    expectedAt = re.lastIndex;
  }
  if (pairs.length === 0 || expectedAt !== s.length) {
    throw new Gs1Error("TRUNCATED", "Malformed bracketed GS1 payload", { at: expectedAt });
  }

  // The brackets make boundaries explicit, but a fixed-length AI carrying the
  // wrong number of characters still means a bad label.
  for (const p of pairs) {
    const declared = FIXED[p.ai];
    const isMeasurement = MEASUREMENT_PREFIXES.has(p.ai.slice(0, 2)) && p.ai.length === 4;
    const expected = declared !== undefined ? declared : (isMeasurement ? 6 : null);
    if (expected !== null && p.value.length !== expected) {
      throw new Gs1Error("TRUNCATED",
        `AI ${p.ai} expects ${expected} characters, got ${p.value.length}`,
        { ai: p.ai, value: p.value });
    }
    if (expected !== null && !/^\d+$/.test(p.value)) {
      throw new Gs1Error("NON_NUMERIC",
        `AI ${p.ai} expects digits, got "${p.value}"`, { ai: p.ai, value: p.value });
    }
  }
  return pairs;
};

// Walks an unbracketed payload, using the AI table to know where each field
// ends. This is the form that genuinely needs FNC1 for variable-length fields.
/** @param {string} s @returns {AiPair[]} */
const readPackedPairs = (s) => {
  /** @type {AiPair[]} */
  const pairs = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i += 1; continue; }

    const spec = readAi(s, i);
    const start = i + spec.ai.length;
    let value;

    if (spec.variable) {
      const gsAt = s.indexOf(GS, start);
      const end = gsAt === -1 ? s.length : gsAt;
      value = s.slice(start, end);
      if (value.length === 0) {
        throw new Gs1Error("TRUNCATED", `AI ${spec.ai} has no value`, { ai: spec.ai });
      }
      if (value.length > spec.max) {
        throw new Gs1Error("FIELD_TOO_LONG",
          `AI ${spec.ai} value exceeds ${spec.max} characters`, { ai: spec.ai, value });
      }
      i = end;
    } else {
      value = s.slice(start, start + spec.length);
      if (value.length < spec.length) {
        throw new Gs1Error("TRUNCATED",
          `AI ${spec.ai} expects ${spec.length} characters, got ${value.length}`,
          { ai: spec.ai, value });
      }
      if (!/^\d+$/.test(value)) {
        throw new Gs1Error("NON_NUMERIC",
          `AI ${spec.ai} expects digits, got "${value}"`, { ai: spec.ai, value });
      }
      i = start + spec.length;
    }
    pairs.push({ ai: spec.ai, value });
  }
  return pairs;
};

/**
 * Parse a GS1-128 payload.
 *
 * Returns { gtin, productionDate, packagingDate, serial, lot,
 *           weight: { value, unit, decimals }, raw, unparsed }
 * where weight.value is a decimal STRING.
 *
 * Throws Gs1Error. Callers should branch on err.code — in particular
 * NO_WEIGHT_AI ("this label carries no weight") is a different situation from
 * every other code ("this scan is bad"). Whatever was parsed before the failure
 * is attached as err.partial.
 *
 * @param {string} raw
 * @returns {Gs1Parse & { weight: Gs1Weight }}
 */
const parseGs1 = (raw) => {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Gs1Error("EMPTY", "Empty barcode payload");
  }

  let s = raw.trim();
  for (const prefix of SYMBOLOGY_PREFIXES) {
    if (s.startsWith(prefix)) { s = s.slice(prefix.length); break; }
  }
  // eslint-disable-next-line no-control-regex
  s = s.replace(/^\u001D+/, ""); // a leading FNC1 is a start marker, not data

  /** @type {Gs1Parse} */
  const result = {
    gtin: null, productionDate: null, packagingDate: null, serial: null, lot: null,
    weight: null, raw, unparsed: [],
  };

  // Both transmission forms reduce to the same list of (AI, value) pairs, so
  // everything below this point is shared.
  const pairs = looksLikeHri(s) ? readHriPairs(s) : readPackedPairs(s);

  for (const { ai, value } of pairs) {
    const unitFor = NET_WEIGHT_UNITS[ai.slice(0, 3)];
    if (ai.length === 4 && unitFor) {
      if (result.weight) {
        throw new Gs1Error("AMBIGUOUS_WEIGHT",
          "Payload carries more than one net weight", { ai });
      }
      // The decimal position comes from the AI's last digit, never a constant:
      // one supplier ships 3202 (76.20) and another 3201 (63.0), and a
      // hardcoded divisor is a 10x error on one of them.
      const decimals = Number(ai[3]);
      result.weight = { value: applyDecimal(value, decimals), unit: unitFor, decimals };
    } else if (ai === "01") {
      result.gtin = value;
    } else if (ai === "11") {
      result.productionDate = parseGs1Date(value);
    } else if (ai === "13") {
      // Packaging date. Kept distinct from AI 11 rather than merged, because
      // they are genuinely different events — but real supplier labels use one
      // or the other, so callers that just need "when was this box made" should
      // read productionDate ?? packagingDate.
      result.packagingDate = parseGs1Date(value);
    } else if (ai === "10") {
      result.lot = value;
    } else if (ai === "21") {
      result.serial = value;
    } else {
      result.unparsed.push(ai + value);
    }
  }

  if (!result.weight) {
    // Typed here rather than declared on the class, which would add the field
    // to every error at runtime.
    const err = /** @type {Gs1Error & { partial?: Gs1Parse }} */ (
      new Gs1Error("NO_WEIGHT_AI", "Label carries no net weight AI (310n/320n)"));
    err.partial = result;
    throw err;
  }

  // The throw above is what makes weight non-null on every parse that returns.
  return /** @type {Gs1Parse & { weight: Gs1Weight }} */ (result);
};

module.exports = { parseGs1, Gs1Error, applyDecimal, parseGs1Date, GS };
