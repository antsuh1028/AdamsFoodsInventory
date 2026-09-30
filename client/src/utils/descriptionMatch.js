// Matching a typed item description against the standard list.

// How the list stores a name: trimmed, single-spaced, upper case.
export const normaliseName = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// Letters and digits only, so "BONE-IN" and "BONE IN" are the same key.
const key = (s) => normaliseName(s).replace(/[^A-Z0-9]/g, "");

// Edit distance, giving up once it passes `cap`.
const distance = (a, b, cap) => {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
};

/**
 * Where a typed description stands against the list.
 * "exact": on the list as typed. "spelling": the same words, spaced or
 * punctuated differently. "near": a letter or two off. "none": not close.
 */
export const matchDescription = (typed, names) => {
  const n = normaliseName(typed);
  if (!n) return { kind: "empty", name: null };
  if (names.includes(n)) return { kind: "exact", name: n };
  const k = key(n);
  const same = names.find((x) => key(x) === k);
  if (same) return { kind: "spelling", name: same };
  // Short names are too easy to be "near" by accident.
  if (k.length < 6) return { kind: "none", name: null };
  const cap = k.length < 12 ? 1 : 2;
  // Numbers are sizes and cuts: 2MM and 3.3MM are different products, not typos.
  const digits = k.replace(/\D/g, "");
  let best = null;
  for (const x of names) {
    if (key(x).replace(/\D/g, "") !== digits) continue;
    const d = distance(k, key(x), cap);
    if (d <= cap && (!best || d < best.d)) best = { d, name: x };
  }
  return best ? { kind: "near", name: best.name } : { kind: "none", name: null };
};
