"use strict";

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

const GS = String.fromCharCode(29); // ASCII 29 — FNC1 as transmitted by most HID scanners

// AIM symbology identifiers some scanners prepend to the payload.
const SYMBOLOGY_PREFIXES = ["]C1", "]e0", "]d2", "]Q3"];

// AIs with a GS1-predefined length: the data runs exactly this many characters
// and needs no separator after it.
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
const NET_WEIGHT_UNITS = { "310": "KG", "320": "LB" };

class Gs1Error extends Error {
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
const applyDecimal = (digits, decimals) => {
  const stripLeadingZeros = (s) => s.replace(/^0+(?=\d)/, "");
  if (decimals === 0) return stripLeadingZeros(digits);
  const padded = digits.padStart(decimals + 1, "0");
  const cut = padded.length - decimals;
  return `${stripLeadingZeros(padded.slice(0, cut))}.${padded.slice(cut)}`;
};

// YYMMDD -> "YYYY-MM-DD". GS1 allows DD = "00" meaning "end of month".
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
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(mm)}-${pad(dd)}`;
};

// Reads the AI starting at `i`. Longest-match first: 4-digit measurement AIs,
// then 3-digit, then 2-digit.
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
  if (VARIABLE[three] !== undefined) return { ai: three, max: VARIABLE[three], variable: true };
  if (FIXED[two] !== undefined) return { ai: two, length: FIXED[two], variable: false };
  if (VARIABLE[two] !== undefined) return { ai: two, max: VARIABLE[two], variable: true };
  throw new Gs1Error("UNKNOWN_AI", `Unrecognized application identifier "${two}"`, { at: i, ai: two });
};

/**
 * Parse a GS1-128 payload.
 *
 * Returns { gtin, productionDate, serial, lot, weight: { value, unit, decimals }, raw, unparsed }
 * where weight.value is a decimal STRING.
 *
 * Throws Gs1Error. Callers should branch on err.code — in particular
 * NO_WEIGHT_AI ("this label carries no weight") is a different situation from
 * every other code ("this scan is bad"). Whatever was parsed before the failure
 * is attached as err.partial.
 */
const parseGs1 = (raw) => {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Gs1Error("EMPTY", "Empty barcode payload");
  }

  let s = raw.trim();
  for (const prefix of SYMBOLOGY_PREFIXES) {
    if (s.startsWith(prefix)) { s = s.slice(prefix.length); break; }
  }
  s = s.replace(/^\u001D+/, ""); // a leading FNC1 is a start marker, not data

  const result = {
    gtin: null, productionDate: null, serial: null, lot: null,
    weight: null, raw, unparsed: [],
  };

  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i += 1; continue; } // separator between variable fields

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

    const unitFor = NET_WEIGHT_UNITS[spec.ai.slice(0, 3)];
    if (spec.ai.length === 4 && unitFor) {
      if (result.weight) {
        throw new Gs1Error("AMBIGUOUS_WEIGHT",
          "Payload carries more than one net weight", { ai: spec.ai });
      }
      const decimals = Number(spec.ai[3]);
      result.weight = { value: applyDecimal(value, decimals), unit: unitFor, decimals };
    } else if (spec.ai === "01") {
      result.gtin = value;
    } else if (spec.ai === "11") {
      result.productionDate = parseGs1Date(value);
    } else if (spec.ai === "10") {
      result.lot = value;
    } else if (spec.ai === "21") {
      result.serial = value;
    } else {
      result.unparsed.push(spec.ai + value);
    }
  }

  if (!result.weight) {
    const err = new Gs1Error("NO_WEIGHT_AI", "Label carries no net weight AI (310n/320n)");
    err.partial = result;
    throw err;
  }

  return result;
};

module.exports = { parseGs1, Gs1Error, applyDecimal, parseGs1Date, GS };
