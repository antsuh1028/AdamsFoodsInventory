// Assembles keystrokes from a Bluetooth HID barcode scanner into a payload.
//
// The scanner is a keyboard as far as the browser is concerned, so this has to
// tell "a scanner just fired" apart from "someone is typing" without any device
// API to ask. Two rules follow from that, both from hard experience:
//
//   1. The terminator key is the authoritative end-of-scan signal, never a
//      timing gap. Bluetooth latency spikes well past 50ms, and accepting a
//      buffer early yields a *partial* payload that still parses into a
//      plausible, wrong weight. Timing is used only to discard stale buffers.
//   2. A payload is only a scan if it also parses. Anything else is surfaced as
//      a rejection so the operator sees it, rather than being silently dropped.
//
// FNC1/GS is the wrinkle. Over HID keyboard emulation many scanners cannot type
// ASCII 29 at all and are configured to emit a visible stand-in instead. Which
// character that is varies by model, so it is configuration, not a constant.

const DEFAULT_TERMINATORS = ["Enter", "Tab"];

// Generous on purpose: this only discards a stale buffer, it never completes a
// scan, so erring long costs nothing while erring short corrupts data.
const DEFAULT_STALE_MS = 800;

const DEFAULT_MIN_LENGTH = 8;

const GS = String.fromCharCode(29);

const createScanAssembler = ({
  parse,
  terminators = DEFAULT_TERMINATORS,
  gsSubstitutes = [],
  staleMs = DEFAULT_STALE_MS,
  minLength = DEFAULT_MIN_LENGTH,
  prefix = "",
} = {}) => {
  if (typeof parse !== "function") {
    throw new Error("scanAssembler requires a parse function");
  }

  const terminatorSet = new Set(terminators);
  let buffer = "";
  let lastKeyAt = null;

  const reset = () => { buffer = ""; lastKeyAt = null; };

  // Normalises whatever the scanner used for FNC1 into a real GS before parsing.
  const normalize = (raw) => {
    let out = raw;
    if (prefix && out.startsWith(prefix)) out = out.slice(prefix.length);
    for (const sub of gsSubstitutes) {
      if (sub) out = out.split(sub).join(GS);
    }
    return out;
  };

  /**
   * Feed one keydown. Returns null while a scan is still assembling, or
   * { type: "scan" | "reject", ... } once a terminator arrives.
   *
   * Takes a plain { key, timeStamp } so it can be tested without a DOM.
   */
  const handleKey = (event) => {
    const { key } = event;
    const now = typeof event.timeStamp === "number" ? event.timeStamp : Date.now();

    // A long pause means whatever is in the buffer belongs to an abandoned
    // scan or to a human typing. Drop it rather than prefixing the next scan.
    if (lastKeyAt !== null && now - lastKeyAt > staleMs) buffer = "";
    lastKeyAt = now;

    if (terminatorSet.has(key)) {
      const raw = buffer;
      reset();

      if (raw.length === 0) return null; // a bare Enter is not a scan
      if (raw.length < minLength) {
        return { type: "reject", code: "TOO_SHORT", raw,
          reason: `Only ${raw.length} characters before the terminator` };
      }

      const payload = normalize(raw);
      try {
        return { type: "scan", raw: payload, parsed: parse(payload) };
      } catch (err) {
        return { type: "reject", code: err.code || "PARSE_FAILED", raw: payload,
          reason: err.message, partial: err.partial || null };
      }
    }

    // Printable characters only. Shift, Control, ArrowLeft and friends all have
    // multi-character key names and must not enter the buffer.
    if (key && key.length === 1) buffer += key;
    return null;
  };

  return {
    handleKey,
    reset,
    peek: () => buffer,
    // Exposed for the diagnostic screen, which needs to show what is mid-flight.
    isAssembling: () => buffer.length > 0,
  };
};

module.exports = {
  createScanAssembler,
  DEFAULT_TERMINATORS,
  DEFAULT_STALE_MS,
  DEFAULT_MIN_LENGTH,
  GS,
};
