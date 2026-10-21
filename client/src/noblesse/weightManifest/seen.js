// Which rows this device has opened, kept in localStorage.


// Which manifest rows THIS BROWSER has opened. Per-device on purpose: the
// question is "have I seen this", not "has anyone", so one person expanding a
// session must not clear the marker for everyone else.
//
// Every access is wrapped. Safari in private mode throws on localStorage rather
// than returning null, and a shared scanning iPad is exactly where that bites.
// A throw here must cost the highlight, never the tab.
const SEEN_KEY = "noblesse.manifestSeen.v1";

// null means "nothing has ever been stored", which is different from "stored
// and empty" — the first case seeds, the second does not.
const readSeen = () => {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const writeSeen = (set) => {
  try {
    // Capped so this cannot grow without bound. The oldest keys fall off and at
    // worst an ancient session highlights once more, which is harmless.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500)));
  } catch {
    // Private mode: the highlight simply does not persist across reloads.
  }
};

export { SEEN_KEY, readSeen, writeSeen };
