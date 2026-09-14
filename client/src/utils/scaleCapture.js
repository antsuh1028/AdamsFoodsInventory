// Deciding when a stream of scale readings means "a box".

// Below this the platform counts as empty.
const EMPTY_BELOW = 2.0;

// How many identical settled readings before it counts as the box.
const HOLD_READINGS = 3;

// Two lines this close together are one print event, not two boxes.
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
  // Defaults to continuous, which is what every existing caller and every existing
  // test assumes.
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
    if (reading && !reading.ok && reading.code === "ZERO") {
      reset();
      return { state, weight: 0, captured: null };
    }

    // Any other refusal tells us nothing.
    if (!reading || !reading.ok) return { state, weight: null, captured: null };

    const w = num(reading.weight);
    const settled = reading.stable !== false;   // "?" absent means it is not moving

    // The platform cleared. This is what re-arms the machine, and it is the
    // only way out of DONE.
    if (w < emptyBelow) {
      reset();
      return { state, weight: w, captured: null };
    }

    // per-label  One poll = one printed label = one box, so this line IS the box.
    if (currentMode === "per-label") {
      // Still refused when unsettled: an indicator that prints mid-wobble is
      // printing a figure nobody would write down by hand.
      if (!settled) {
        state = "SETTLING";
        return { state, weight: w, captured: null };
      }
      if (lastCaptureAt !== null && at - lastCaptureAt < minGapMs) {
        // Named rather than swallowed, so a genuinely double-printing BarTender is
        // visible instead of just producing a box count that happens to be right.
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

  // Switching mode must not drop the serial connection, so it is a method rather
  // than a construction option.
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
