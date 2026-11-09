const { boxFromBarcode } = require("/Users/anthonysuh/AdamsFoodsInventory/server/utils/afBox");
const GS = String.fromCharCode(29);
const check = (d13) => { let s = 0; [...d13].reverse().forEach((c, i) => { s += Number(c) * (i % 2 ? 1 : 3); }); return d13 + ((10 - (s % 10)) % 10); };
const BEEF = check("0001234560001"), PORK = check("0001234560002"), OTHER = check("0009876540001");
const FIXED = new Set(["01", "11", "13", "15", "17"]);
const hri = (pairs) => pairs.map(([ai, v]) => `(${ai})${v}`).join("");
const raw = (pairs) => pairs.map(([ai, v], i) => {
  const variable = !FIXED.has(ai) && !/^3[12]0\d$/.test(ai);
  return `${ai}${v}${variable && i < pairs.length - 1 ? GS : ""}`;
}).join("");
const lb1 = (w) => String(Math.round(w * 10)).padStart(6, "0");   // 3201
const kg2 = (w) => String(Math.round(w * 100)).padStart(6, "0");  // 3102
const L = [];
const add = (group, name, pairs, expect, note = "") => L.push({ group, name, pairs, expect, note });
// A: ten ordinary beef boxes
[41.2, 40.8, 41.6, 39.9, 42.3, 40.5, 41.0, 41.9, 40.2, 41.4].forEach((w, i) =>
  add("A", `Beef box ${i + 1}`, [["01", BEEF], ["3201", lb1(w)], ["21", `TEST${String(i + 1).padStart(3, "0")}`]], "ok"));
// B: one box printed twice
add("B", "Box X (copy 1)", [["01", BEEF], ["3201", lb1(40.7)], ["21", "TESTX01"]], "ok", "Scan once: lands.");
add("B", "Box X (copy 2)", [["01", BEEF], ["3201", lb1(40.7)], ["21", "TESTX01"]], "dup", "Same lot: already on this lot. Other lot: already on lot …");
// C: same serial, different product
add("C", "Pork, same serial as Beef box 1", [["01", PORK], ["3201", lb1(38.4)], ["21", "TEST001"]], "ok", "Different GTIN, so a different box.");
// D: kilograms
add("D", "Kilogram label", [["01", OTHER], ["3102", kg2(18.7)], ["21", "TESTKG1"]], "ok", "Stored in pounds.");
// E: no serial
add("E", "No serial (1)", [["01", BEEF], ["3201", lb1(41.0)]], "ok", "No serial: never refused as a duplicate.");
add("E", "No serial (2)", [["01", BEEF], ["3201", lb1(41.0)]], "ok", "Identical, still accepted.");
// F: pack date + label lot (variable length, needs a separator)
add("F", "With pack date and lot", [["01", BEEF], ["3201", lb1(40.9)], ["13", "261105"], ["10", "LOT77"], ["21", "TESTPD1"]], "ok", "Tests field separators.");
// G: should be refused
add("G", "No weight", [["01", BEEF], ["21", "TESTNW1"]], "NO_WEIGHT", "Not a box label.");
add("G", "Impossible weight", [["01", BEEF], ["3201", "999999"], ["21", "TESTBIG"]], "BAD_WEIGHT", "99,999.9 lb.");
let bad = 0;
for (const l of L) {
  l.hri = hri(l.pairs); l.raw = raw(l.pairs);
  const a = boxFromBarcode(l.hri, "t"), b = boxFromBarcode(l.raw, "t");
  const res = (r) => r.error ? r.error.code : `${r.box.weight}|${r.box.serial}|${r.box.gtin}`;
  if (res(a) !== res(b)) { bad++; console.log("MISMATCH", l.name, res(a), res(b)); }
  l.parsed = a.error ? { error: a.error.code } : { weight: a.box.weight, serial: a.box.serial, gtin: a.box.gtin, packDate: a.box.packDate, lot: a.box.lot };
  const okExpected = l.expect === "ok" || l.expect === "dup";
  if (okExpected === Boolean(a.error) || (!okExpected && a.error && a.error.code !== l.expect)) { bad++; console.log("UNEXPECTED", l.name, l.parsed); }
}
require("fs").writeFileSync(__dirname + "/labels.json", JSON.stringify(L.map(({ pairs, raw: _r, ...k }) => k), null, 1));
console.log(L.length, "labels;", bad, "problems"); console.table(L.map((l) => ({ name: l.name, hri: l.hri, ...l.parsed })));
