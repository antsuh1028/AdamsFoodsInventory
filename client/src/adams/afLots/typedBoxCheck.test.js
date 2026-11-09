// What Lot Registration asks before saving a typed box.
import { checkTypedBox, typedBarcode } from "./typedBoxCheck";

const box = (id, weight, itemId = 1, over = {}) => ({
  id, weight, itemId, scannedAt: `2026-11-09T16:00:${String(id).padStart(2, "0")}Z`, ...over,
});
// Five boxes of item 1 around 41 lb, enough history for the decimal check.
const FIVE = [box(1, "40.80"), box(2, "41.25"), box(3, "41.65"), box(4, "40.95"), box(5, "41.10")];

describe("same weight as the box before", () => {
  test("asks, naming the previous weight", () => {
    expect(checkTypedBox({ weight: "41.10", boxes: FIVE, itemId: 1 }))
      .toMatchObject({ ok: false, kind: "reweigh", previous: "41.10" });
  });

  test("40.6 and 40.60 are the same figure", () => {
    expect(checkTypedBox({ weight: "40.6", boxes: [box(1, "40.60")], itemId: 1 }).kind).toBe("reweigh");
  });

  test("only the box immediately before, not any earlier one", () => {
    expect(checkTypedBox({ weight: "40.80", boxes: FIVE, itemId: 1 }).ok).toBe(true);
  });

  test("the box before is by time scanned, not by list order", () => {
    const shuffled = [FIVE[4], FIVE[0], FIVE[2], FIVE[1], FIVE[3]];
    expect(checkTypedBox({ weight: "41.10", boxes: shuffled, itemId: 1 }).kind).toBe("reweigh");
  });

  test("a removed box is not the box before", () => {
    const boxes = [...FIVE, box(6, "39.00", 1, { removedAt: "2026-11-09T16:01:00Z" })];
    expect(checkTypedBox({ weight: "39.00", boxes, itemId: 1 }).ok).toBe(true);
    expect(checkTypedBox({ weight: "41.10", boxes, itemId: 1 }).kind).toBe("reweigh");
  });

  test("the box before counts across items: it is the same physical sequence", () => {
    const boxes = [...FIVE, box(6, "12.00", 2)];
    expect(checkTypedBox({ weight: "12", boxes, itemId: 1 }).kind).toBe("reweigh");
  });

  test("KG is compared in pounds, as stored", () => {
    // The box before was stored as 10 kg converted to lb; typing 10 kg again matches it.
    const lb = checkTypedBox({ weight: "10", unit: "KG", boxes: [], itemId: 1 }).lb;
    expect(checkTypedBox({ weight: "10", unit: "KG", boxes: [box(1, lb)], itemId: 1 }).kind).toBe("reweigh");
  });

  test("the first box of a lot is never questioned", () => {
    expect(checkTypedBox({ weight: "41.10", boxes: [], itemId: 1 })).toMatchObject({ ok: true });
  });
});

describe("far off this item's boxes", () => {
  test("a missed decimal (10x heavy) asks", () => {
    expect(checkTypedBox({ weight: "411.0", boxes: FIVE, itemId: 1 }))
      .toMatchObject({ ok: false, kind: "outlier", direction: "high" });
  });

  test("a doubled decimal (10x light) asks", () => {
    expect(checkTypedBox({ weight: "4.11", boxes: FIVE, itemId: 1 }))
      .toMatchObject({ ok: false, kind: "outlier", direction: "low" });
  });

  test("ordinary variation does not", () => {
    for (const w of ["35.00", "48.20", "30.5", "60"]) {
      expect(checkTypedBox({ weight: w, boxes: FIVE, itemId: 1 }).ok).toBe(true);
    }
  });

  test("judged against the same item only", () => {
    const lightItem = [1, 2, 3, 4, 5].map((i) => box(10 + i, "4.10", 2));
    const boxes = [...lightItem, ...FIVE];
    expect(checkTypedBox({ weight: "4.20", boxes, itemId: 2 }).ok).toBe(true);
    expect(checkTypedBox({ weight: "4.20", boxes, itemId: 1 }).kind).toBe("outlier");
  });

  test("fewer than five boxes of the item is not enough to judge", () => {
    expect(checkTypedBox({ weight: "411.0", boxes: FIVE.slice(0, 4), itemId: 1 }).ok).toBe(true);
  });

  test("same-weight is asked before outlier", () => {
    const boxes = [...FIVE, box(6, "411.0")];
    expect(checkTypedBox({ weight: "411.0", boxes, itemId: 1 }).kind).toBe("reweigh");
  });
});

describe("input the server will refuse anyway", () => {
  test.each(["", "0", "abc", "-5"])("%p passes through for the server to answer", (w) => {
    expect(checkTypedBox({ weight: w, boxes: FIVE, itemId: 1 }).ok).toBe(true);
  });
});

describe("typedBarcode", () => {
  test("strips the spaces people type between the printed groups", () => {
    expect(typedBarcode(" (01) 00271820000014 (3201) 000412 (21) SER001 "))
      .toBe("(01)00271820000014(3201)000412(21)SER001");
  });
  test("plain digits pass through", () => {
    expect(typedBarcode("01002718200000143201000412")).toBe("01002718200000143201000412");
  });
  test("nothing typed is empty", () => {
    expect(typedBarcode("   ")).toBe("");
    expect(typedBarcode(null)).toBe("");
  });
});
