// What an NX form shows for a field its lots fill. Same rule as the server.

export const MIXED_TEXT = "MIXED – see source lots";

// One value when every source that has one agrees, MIXED when they differ, "" when none has one.
export const mixShared = (sources, key) => {
  const seen = new Map();
  for (const s of sources || []) {
    const t = String(s[key] ?? "").trim();
    if (t && !seen.has(t.toUpperCase())) seen.set(t.toUpperCase(), t);
  }
  if (!seen.size) return "";
  return seen.size === 1 ? [...seen.values()][0] : MIXED_TEXT;
};
