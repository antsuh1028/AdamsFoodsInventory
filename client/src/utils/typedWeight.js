// Typing weights at the bench, fast.
//
// A scanned box is re-derived from its barcode server-side, so a bad scan is
// caught. A TYPED box has nothing checking it — which makes the entry itself
// the only line of defence, and is why this file exists rather than the UI
// just calling parseFloat.
//
// Weights stay decimal STRINGS throughout, as everywhere else in this codebase.
// No float ever touches a value that gets stored.

// Digits only, read as a till reads them: the last two are the decimals.
//
//   "4061"  -> 40.61
//   "406"   ->  4.06
//   "40"    ->  0.40
//
// Removes a keystroke and the most common mis-key on a numeric row. A typist
// who prefers the point can still write "40.61" and it is taken literally —
// both spellings of the same box must land on the same number.
const IMPLIED_DECIMALS = 2;

const err = (code, reason) => ({ ok: false, code, reason });

/**
 * Turn what has been typed into a weight.
 *
 * Returns { ok, weight } or { ok: false, code, reason }. `weight` is a decimal
 * string with at most three decimal places, matching NUMERIC(8,3).
 */
const parseTypedWeight = (input) => {
  const raw = String(input == null ? "" : input).trim();
  if (!raw) return err("EMPTY", "Nothing typed");

  // An explicit point means what it says.
  if (raw.includes(".")) {
    if (!/^\d{0,5}(\.\d{0,3})?$/.test(raw)) {
      return err("BAD_FORMAT", "Up to 5 digits and 3 decimals");
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return err("ZERO", "Weight must be more than zero");
    // Kept as typed rather than reformatted: "40.60" and "40.6" are the same
    // box, and rewriting the operator's digits helps nobody.
    return { ok: true, weight: raw.startsWith(".") ? `0${raw}` : raw, implied: false };
  }

  if (!/^\d+$/.test(raw)) return err("NOT_DIGITS", "Digits only");
  if (raw.length > 7) return err("TOO_LONG", "Too many digits");

  const padded = raw.padStart(IMPLIED_DECIMALS + 1, "0");
  const whole = padded.slice(0, -IMPLIED_DECIMALS);
  const frac = padded.slice(-IMPLIED_DECIMALS);
  if (whole.length > 5) return err("TOO_LARGE", "Reading is implausibly large");

  const weight = `${String(Number(whole))}.${frac}`;
  if (Number(weight) <= 0) return err("ZERO", "Weight must be more than zero");
  return { ok: true, weight, implied: true };
};

// The middle value of what has been weighed so far.
//
// Median rather than mean ON PURPOSE: one fat-fingered 406.1 among forty boxes
// drags a mean far enough to make the NEXT genuine box look like the outlier,
// and then the guard is worse than useless. A median barely moves.
const medianOf = (weights) => {
  const nums = weights.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
};

// Below this there is not enough history for a median to mean anything, and
// stopping someone on box three of a lot they have only just started would
// train them to dismiss the warning.
const MIN_SAMPLE = 5;

// A missed or doubled decimal is a 10x error, so the band only has to catch
// order-of-magnitude mistakes — not natural variation. Real boxes off one line
// sit well inside 3x either way; 40.61 typed as 406.1 does not.
const HIGH = 3;
const LOW = 3;

/**
 * Does this weight look wrong next to the rest of the lot?
 *
 * Returns { outlier: false } or { outlier: true, median, ratio, direction }.
 * Advisory only — the caller asks, it never refuses. An operator looking at the
 * box knows something this does not.
 */
const looksWrong = (weight, previousWeights) => {
  const n = Number(weight);
  const median = medianOf(previousWeights || []);
  if (!Number.isFinite(n) || n <= 0) return { outlier: false };
  if (median == null || (previousWeights || []).length < MIN_SAMPLE) {
    return { outlier: false, median, sample: (previousWeights || []).length };
  }
  if (n > median * HIGH) {
    return { outlier: true, median, ratio: n / median, direction: "high" };
  }
  if (n * LOW < median) {
    return { outlier: true, median, ratio: n / median, direction: "low" };
  }
  return { outlier: false, median };
};

module.exports = {
  parseTypedWeight, looksWrong, medianOf,
  IMPLIED_DECIMALS, MIN_SAMPLE, HIGH, LOW,
};
