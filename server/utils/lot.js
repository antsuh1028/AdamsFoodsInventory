"use strict";

// Lot numbers are `N{YY}{JJJ}-{NN}`: N, a two-digit year, a three-digit Julian
// day, then a sequence for that day. The width is fixed on purpose — sorting
// alphabetically is sorting chronologically, and half the app relies on that.
//
// This module is the ONLY place that decides whether a piece of text is a lot.
// It exists because six free-text lot columns disagree with each other today:
// 11 of 55 imported tally sheets carry cells like "P12 N26230-01" or
// "N26244-3", stored verbatim, matching nothing.
//
// The rule it enforces everywhere: normalise what is unambiguous, and REFUSE
// what is not. It never guesses. A lot that cannot be parsed is reported with
// its raw text so a person can fix it — silently inventing a lot number is how
// stock ends up attributed to the wrong shipment.

const LOT_SHAPE = /^N(\d{2})(\d{3})-(\d{1,2})$/;

// Finds a lot anywhere inside a longer string, so "P12 N26230-01" and
// "N26244-01 (rework)" both give up their lot. The negative lookahead stops
// `-001` being read as sequence 1 with a stray digit after it.
const LOT_ANYWHERE = /N(\d{2})(\d{3})-(\d{1,2})(?!\d)/i;

const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const daysInYear = (year) => (isLeap(year) ? 366 : 365);

// Two-digit years are this business's own convention. 26 is 2026; there is no
// pre-2000 data and there will not be any.
const fullYear = (yy) => 2000 + yy;

// Day-of-year to a calendar date, matching client/src/pages/noblesse/shared.jsx
// `lotNumberForDate`, where day 1 is January 1. Built in UTC and rendered as a
// bare YYYY-MM-DD, so no local timezone can shift it a day (the scar in §8:
// Excel date cells read in local components turned 8/17 into 8/16).
const dateFromDayOfYear = (year, dayOfYear) =>
  new Date(Date.UTC(year, 0, dayOfYear)).toISOString().slice(0, 10);

const pad = (n, width) => String(n).padStart(width, "0");

const formatLot = (yy, dayOfYear, seq) =>
  `N${pad(yy, 2)}${pad(dayOfYear, 3)}-${pad(seq, 2)}`;

/**
 * Parse a lot number out of arbitrary text.
 *
 * Returns either
 *   { ok: true, lotNumber, lotDate, year, dayOfYear, seq, changed, extra }
 * or
 *   { ok: false, code, reason, raw }
 *
 * `changed` says the canonical form differs from the input (padded, upcased,
 * trimmed). `extra` holds any text that surrounded the lot — kept so a note
 * like "P12" is preserved rather than thrown away.
 */
const parseLot = (input) => {
  const raw = input == null ? "" : String(input);
  const text = raw.trim();

  if (!text) {
    return { ok: false, code: "EMPTY", reason: "no lot number", raw };
  }

  const upper = text.toUpperCase();
  let extra = null;
  let match = upper.match(LOT_SHAPE);

  if (!match) {
    // Not a bare lot. Look for one inside the text before giving up.
    const found = upper.match(LOT_ANYWHERE);
    if (!found) {
      // A bare `N26244` with no sequence is the common near-miss:
      // lotNumberForDate() produces only the day prefix and the operator is
      // expected to append `-NN`. Which sequence they meant is unknowable, so
      // it is reported rather than assumed to be -01.
      if (/^N\d{5}$/.test(upper)) {
        return { ok: false, code: "NO_SEQUENCE",
          reason: "day prefix with no -NN sequence", raw };
      }
      if (/N\d{2}\d{3}-\d{3,}/.test(upper)) {
        return { ok: false, code: "AMBIGUOUS_SEQUENCE",
          reason: "sequence is more than two digits", raw };
      }
      return { ok: false, code: "UNRECOGNISED",
        reason: "does not contain N{YY}{JJJ}-{NN}", raw };
    }
    match = found;
    extra = upper.replace(found[0], " ").replace(/\s+/g, " ").trim() || null;
  }

  const yy = Number(match[1]);
  const dayOfYear = Number(match[2]);
  const seq = Number(match[3]);
  const year = fullYear(yy);

  if (dayOfYear < 1 || dayOfYear > daysInYear(year)) {
    return { ok: false, code: "BAD_DAY",
      reason: `day ${match[2]} is not a day in ${year}`, raw };
  }
  // `-00` is not a sequence anyone assigns; treat it as data entry damage
  // rather than quietly turning it into -01.
  if (seq < 1) {
    return { ok: false, code: "BAD_SEQUENCE", reason: "sequence is zero", raw };
  }

  const lotNumber = formatLot(yy, dayOfYear, seq);

  return {
    ok: true,
    lotNumber,
    lotDate: dateFromDayOfYear(year, dayOfYear),
    year,
    dayOfYear,
    seq,
    // Compared against the RAW input, not the trimmed one: stored whitespace
    // is still text the backfill should rewrite.
    changed: lotNumber !== raw,
    extra,
    raw,
  };
};

// True only for text that is already exactly canonical. Used by the backfill
// to tell "clean" apart from "cleaned up".
const isCanonicalLot = (text) => LOT_SHAPE.test(String(text ?? "").trim());

module.exports = { parseLot, formatLot, isCanonicalLot, dateFromDayOfYear, daysInYear };
