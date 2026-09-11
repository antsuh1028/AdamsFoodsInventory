// Deciding when a stream of scale readings means "a box".
//
// The indicator sends roughly twice a second, forever. Recording every line
// would put hundreds of rows on one box, so something has to say which reading
// IS the box — and doing that wrong records a weight nobody typed, which is far
// harder to spot than one somebody did.
//
// The signal that makes it possible: this Defender marks an UNSETTLED reading
// with a trailing "?", which scaleParse turns into stable === false. Watching a
// hand pressed on the platform:
//
//     51.25       settled
//     61.15  ?    hand on
//     61.20  ?
//     51.25  ?
//     51.25       settled again
//
// So the shape of weighing a box is: empty -> something lands and wobbles ->
// it settles -> it is taken off. This walks exactly that.
//
//     EMPTY      near zero, waiting
//     SETTLING   weight on the platform, still moving
//     READY      settled and holding — the box, captured once
//     DONE       captured; will not capture again until the platform clears
//
// The rule that stops one box being counted twice is DONE -> EMPTY: the
// platform has to actually clear before the next capture is armed. Without it,
// a box left sitting there records itself over and over.
//
// ── TWO SHAPES OF TRAFFIC ────────────────────────────────────────────────────
//
// Everything above describes an indicator that STREAMS. This station does not
// always get one:
//
//   continuous  the indicator sends ~2 lines/sec unprompted. A box is a figure
//               HELD across several readings, and DONE -> EMPTY is what stops
//               one box recording itself forever.
//
//   per-label   nothing streams. BarTender sends "P" when it prints a label and
//               the indicator answers with ONE line, which we hear on COM2.
//               One poll = one printed label = one box, so that line IS the box.
//
// In per-label mode HOLD_READINGS is not merely too strict, it is UNSATISFIABLE:
// it wants three identical consecutive readings and there is only ever one per
// box. That is why weights were "only recorded when BarTender's print feature is
// active" — three prints in a row had to report the same figure before anything
// landed at all, so capture was erratic even while BarTender ran.
//
// And DONE -> EMPTY has to be off in per-label mode. It waits for a line showing
// an empty platform; with no stream that line never arrives, so box 2 and every
// box after it would be swallowed in silence.
//
// What replaces it as the don't-count-it-twice rule is MIN_GAP_MS below.

// Below this the platform counts as empty. Generous — a scale does not always
// return to exactly zero, and a smear of fat on the plate should not leave the
// machine convinced a box is still on it.
const EMPTY_BELOW = 2.0;

// How many identical settled readings before it counts as the box. At roughly
// two a second this is about a second of not moving, which is long enough that
// a reading caught mid-settle cannot win and short enough not to be felt.
const HOLD_READINGS = 3;

// Two lines this close together are one print event, not two boxes.
//
// This is what stands in for DONE -> EMPTY in per-label mode. A double print out
// of BarTender, or an indicator that echoes its own reply, arrives within tens
// of milliseconds; a person taking one box off and putting the next one on
// cannot. Run the scale diagnostic to see the real inter-line gap on this
// station before trusting the default.
const MIN_GAP_MS = 750;

const MODES = new Set(["continuous", "per-label"]);

const num = (w) => Number(w);

/**
 * A fresh capture machine.
 *
 * feed(reading) takes a parsed scaleParse result and returns
 * { state, weight, captured } — `captured` is a weight string on the ONE
 * reading that completes a box, and null on every other.
 */
const createCaptureMachine = ({
  emptyBelow = EMPTY_BELOW,
  holdReadings = HOLD_READINGS,
  minGapMs = MIN_GAP_MS,
  // Defaults to continuous, which is what every existing caller and every
  // existing test assumes. Changing this default silently would change what
  // counts as a box on a running bench.
  mode = "continuous",
} = {}) => {
  let state = "EMPTY";
  let holdValue = null;
  let holdCount = 0;
  let lastCaptureAt = null;
  let currentMode = MODES.has(mode) ? mode : "continuous";

  const reset = () => { state = "EMPTY"; holdValue = null; holdCount = 0; };

  // `at` is injected so the module stays pure and the double-print window can be
  // driven exactly in tests rather than with real timers.
  const feed = (reading, at = Date.now()) => {
    // An EMPTY platform is the one refusal that means something.
    //
    // parseScaleLine rejects a zero reading as ZERO — right for typing, where
    // nobody records a 0 lb box, but here it is the signal the machine is built
    // around: the box came off, so arm for the next one. Treating it as junk
    // left the machine stuck in DONE after the first box and it captured
    // nothing ever again, silently.
    if (reading && !reading.ok && reading.code === "ZERO") {
      reset();
      return { state, weight: 0, captured: null };
    }

    // Any other refusal tells us nothing. It must NOT reset the machine: one
    // garbled line mid-settle would otherwise throw away a hold that was
    // almost complete, and the box would be missed.
    if (!reading || !reading.ok) return { state, weight: null, captured: null };

    const w = num(reading.weight);
    const settled = reading.stable !== false;   // "?" absent means it is not moving

    // The platform cleared. This is what re-arms the machine, and it is the
    // only way out of DONE.
    if (w < emptyBelow) {
      reset();
      return { state, weight: w, captured: null };
    }

    // ── per-label ────────────────────────────────────────────────────────────
    // One poll = one printed label = one box, so this line IS the box. No hold
    // to satisfy (there is only ever one reading per box) and no DONE latch to
    // clear (the empty-platform line that would clear it never arrives).
    if (currentMode === "per-label") {
      // Still refused when unsettled: an indicator that prints mid-wobble is
      // printing a figure nobody would write down by hand.
      if (!settled) {
        state = "SETTLING";
        return { state, weight: w, captured: null };
      }
      if (lastCaptureAt !== null && at - lastCaptureAt < minGapMs) {
        // Named rather than swallowed, so a genuinely double-printing BarTender
        // is visible instead of just producing a box count that happens to be
        // right.
        state = "DONE";
        return { state, weight: w, captured: null, suppressed: "double-print" };
      }
      lastCaptureAt = at;
      state = "DONE";
      return { state, weight: w, captured: reading.weight };
    }

    // Already captured and the box is still sitting there. Say nothing.
    if (state === "DONE") return { state, weight: w, captured: null };

    if (!settled) {
      state = "SETTLING";
      holdValue = null;
      holdCount = 0;
      return { state, weight: w, captured: null };
    }

    // Settled. Hold the SAME figure long enough and it is the box.
    if (holdValue !== null && w === holdValue) {
      holdCount += 1;
    } else {
      holdValue = w;
      holdCount = 1;
    }

    if (holdCount >= holdReadings) {
      state = "DONE";
      return { state, weight: w, captured: reading.weight };
    }

    state = "SETTLING";
    return { state, weight: w, captured: null };
  };

  // Switching mode must not drop the serial connection, so it is a method
  // rather than a construction option. The hold and the double-print window are
  // cleared because they mean different things in the two modes; `state` is
  // kept, because whatever is physically on the platform has not changed.
  const setMode = (next) => {
    if (!MODES.has(next) || next === currentMode) return currentMode;
    currentMode = next;
    holdValue = null;
    holdCount = 0;
    lastCaptureAt = null;
    return currentMode;
  };

  return {
    feed,
    reset,
    setMode,
    peek: () => ({ state, holdValue, holdCount, mode: currentMode, lastCaptureAt }),
  };
};

module.exports = {
  createCaptureMachine, EMPTY_BELOW, HOLD_READINGS, MIN_GAP_MS,
  CAPTURE_MODES: [...MODES],
};
