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

// Below this the platform counts as empty. Generous — a scale does not always
// return to exactly zero, and a smear of fat on the plate should not leave the
// machine convinced a box is still on it.
const EMPTY_BELOW = 2.0;

// How many identical settled readings before it counts as the box. At roughly
// two a second this is about a second of not moving, which is long enough that
// a reading caught mid-settle cannot win and short enough not to be felt.
const HOLD_READINGS = 3;

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
} = {}) => {
  let state = "EMPTY";
  let holdValue = null;
  let holdCount = 0;

  const reset = () => { state = "EMPTY"; holdValue = null; holdCount = 0; };

  const feed = (reading) => {
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

  return { feed, reset, peek: () => ({ state, holdValue, holdCount }) };
};

module.exports = { createCaptureMachine, EMPTY_BELOW, HOLD_READINGS };
