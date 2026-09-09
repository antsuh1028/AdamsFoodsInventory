// Parses one line of output from a bench scale indicator (Ohaus Defender 3000).
//
// WHY THIS IS TOLERANT RATHER THAN EXACT. The indicator's print format is
// configurable on the device — gross/net/tare prefixes, stability flags, unit
// position, field widths and line endings all vary with how it was set up, and
// nobody can be sure which options the unit in the warehouse is carrying until
// it is plugged in. So this recognises the SHAPE of a weight line rather than
// one vendor string, and reports what it could not read instead of guessing.
//
// It refuses far more readily than it invents. A line it cannot read is a
// rejection the operator sees; a wrong weight is a wrong yield that nobody
// sees. Same rule scanInput.js follows for barcodes.
//
// WEIGHTS STAY DECIMAL STRINGS. Never parseFloat into the value that gets
// stored — the whole pipeline (barcode -> parser -> HTTP -> NUMERIC(8,3)) is
// float-free and compares on integer thousandths, so "76.20" and "76.2" are
// equal. A float here would reintroduce the one bug class the rest of the
// system is built to exclude.

// LB and KG are the only units the rest of the system understands: batch_items
// stores one of the two, and toPounds() converts KG. Grams and ounces are
// recognised ONLY so they can be reported as a clear "set the indicator to lb
// or kg" rather than silently failing to match anything.
const UNIT_WORDS = {
  lb: "LB", lbs: "LB", "#": "LB",
  kg: "KG", kgs: "KG",
  g: "G", gr: "G", oz: "OZ",
};

const SUPPORTED = new Set(["LB", "KG"]);

// Stability markers. Ohaus and most MT-SICS-style indicators prefix ST/US;
// some emit a trailing "?" for an unstable reading instead.
const STABLE_TOKENS = new Set(["ST", "S"]);
const UNSTABLE_TOKENS = new Set(["US", "SD", "D"]);

// A signed decimal, with the digits kept as written. No exponent form: a scale
// does not emit one, and accepting it would let "1e5" through as 100000.
const NUMBER_RE = /[-+]?\d+(?:\.\d+)?|[-+]?\.\d+/g;

// Blanks out control characters, which an indicator commonly uses to wrap a
// reading (STX/ETX) or to pad it (NUL). Not an error, just noise.
//
// Done by char code rather than a regex character class ON PURPOSE. Writing the
// range as literal bytes is how this file first shipped a class of \x00-\x19 —
// which looked right, lint-clean, and quietly let GS (\x1D) through. There is
// no escaping to get wrong here.
const stripControl = (s) => {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out;
};

const err = (code, reason, raw) => ({ ok: false, code, reason, raw });

/**
 * Parse one line into { ok, weight, unit, stable, raw }.
 *
 * `weight` is a decimal STRING, sign stripped, exactly as the scale wrote its
 * digits. `stable` is true/false when the line says, or null when it does not —
 * null means "unknown", never "assume fine".
 */
const parseScaleLine = (line) => {
  const raw = String(line == null ? "" : line);

  const text = stripControl(raw).trim();
  if (!text) return err("EMPTY", "Blank line", raw);

  const upper = text.toUpperCase();

  // Stability, read from comma- or space-separated leading tokens so a trailing
  // "G" (grams) can never be mistaken for a status flag.
  let stable = null;
  const tokens = upper.split(/[\s,]+/).filter(Boolean);
  for (const t of tokens) {
    if (STABLE_TOKENS.has(t)) { stable = true; break; }
    if (UNSTABLE_TOKENS.has(t)) { stable = false; break; }
  }
  if (stable === null && /\?\s*$/.test(text)) stable = false;   // trailing "?" = unsettled

  // The unit, taken as a whole word so the "G" in "GROSS" or the "LB" inside a
  // product code cannot be picked up.
  let unit = null;
  for (const t of tokens) {
    const word = t.replace(/[^A-Z#]/g, "");
    if (!word) continue;
    const mapped = UNIT_WORDS[word.toLowerCase()];
    if (mapped) { unit = mapped; break; }
  }
  // Some formats run the unit onto the number ("12.345lb"), which leaves no
  // separate token to find.
  if (!unit) {
    const glued = upper.match(/\d\s*(LBS?|KGS?|OZ|GR?)\b/);
    if (glued) unit = UNIT_WORDS[glued[1].toLowerCase()] || null;
  }

  const numbers = text.match(NUMBER_RE);
  if (!numbers || numbers.length === 0) {
    return err("NO_NUMBER", "No number in the line", raw);
  }

  // More than one number means the line is not a bare reading — a date, a time,
  // a header, a tare printed beside the net. Guessing which is the weight is
  // exactly the kind of confident wrongness this must not do.
  if (numbers.length > 1) {
    return err("AMBIGUOUS", `Found ${numbers.length} numbers, cannot tell which is the weight`, raw);
  }

  if (!unit) return err("NO_UNIT", "No unit on the line", raw);
  if (!SUPPORTED.has(unit)) {
    return err("UNSUPPORTED_UNIT",
      `Reads in ${unit}. Set the indicator to lb or kg.`, raw);
  }

  const signed = numbers[0];
  // Negative is a real reading (an unzeroed platform), not a box. Rejected
  // rather than absed: the operator needs to re-zero, and silently flipping the
  // sign would hide that.
  if (signed.startsWith("-")) {
    return err("NEGATIVE", "Negative reading — re-zero the scale", raw);
  }

  let weight = signed.replace(/^\+/, "");
  if (weight.startsWith(".")) weight = `0${weight}`;      // ".5" -> "0.5"
  if (Number(weight) === 0) {
    return err("ZERO", "Zero reading — nothing on the scale", raw);
  }

  // NUMERIC(8,3): five whole digits and three decimals. Checked here so an
  // over-long reading is named rather than being silently rounded by Postgres.
  const [whole, frac = ""] = weight.split(".");
  if (whole.length > 5) return err("TOO_LARGE", "Reading is implausibly large", raw);
  if (frac.length > 3) {
    // More precision than the column holds. Trailing zeros are safe to drop;
    // real digits are not, so that is a rejection rather than a silent trim.
    const trimmed = frac.replace(/0+$/, "");
    if (trimmed.length > 3) {
      return err("TOO_PRECISE", "More than three decimal places", raw);
    }
    weight = trimmed ? `${whole}.${trimmed}` : whole;
  }

  return { ok: true, weight, unit, stable, raw };
};

module.exports = { parseScaleLine, stripControl, UNIT_WORDS, SUPPORTED };
