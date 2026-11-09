// A typed box has no serial, so nothing downstream can tell it was entered twice.
// These are the two mistakes worth asking about before it is saved.
import { looksWrong, looksLikeReweigh } from "../../utils/typedWeight";
import { toPounds } from "../../utils/weight";

// Physical order: the box before is the one scanned or typed last on this lot.
const inOrder = (boxes) => boxes
  .filter((b) => !b.removedAt)
  .slice()
  .sort((a, b) => String(a.scannedAt || "").localeCompare(String(b.scannedAt || "")) || (a.id || 0) - (b.id || 0));

/**
 * { ok: true } to save as typed, or a question:
 *   { ok: false, kind: "reweigh", lb, previous }    exactly the box before's weight
 *   { ok: false, kind: "outlier", lb, median, direction, ratio }   ~10x off this item's boxes
 * A weight the server will refuse anyway (blank, zero, too big) passes through for it to say so.
 */
export const checkTypedBox = ({ weight, unit = "LB", boxes = [], itemId = null }) => {
  let lb;
  try { lb = toPounds(String(weight ?? "").trim(), unit).weight; } catch { return { ok: true }; }
  const live = inOrder(boxes);
  const last = live[live.length - 1];
  if (last && looksLikeReweigh(lb, [last.weight]).reweigh) {
    return { ok: false, kind: "reweigh", lb, previous: last.weight };
  }
  // Against this item only: two products on one lot can weigh very differently.
  const sameItem = live.filter((b) => b.itemId === itemId).map((b) => b.weight);
  const odd = looksWrong(lb, sameItem);
  if (odd.outlier) return { ok: false, kind: "outlier", lb, median: odd.median, direction: odd.direction, ratio: odd.ratio };
  return { ok: true, lb };
};

// What is typed off the label under the bars, as the scanner would send it.
export const typedBarcode = (text) => String(text || "").replace(/\s+/g, "");
