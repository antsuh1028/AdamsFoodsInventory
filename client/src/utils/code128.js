// Code 128 (set B) as an inline SVG, for pallet tags. No library: the print window has none.

// Bar/space widths for values 0-106; 106 is the stop, which has a final bar.
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

// The symbol values for `text`: start B, each character, the mod-103 check, stop.
const encode = (text) => {
  const s = String(text);
  if (!s || /[^\x20-\x7e]/.test(s)) throw new Error("Code 128 set B takes printable ASCII only");
  const values = [START_B, ...[...s].map((c) => c.charCodeAt(0) - 32)];
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  return [...values, check, STOP];
};

// Bar and space widths in modules, bar first, quiet zones not included.
const widths = (text) => encode(text).flatMap((v) => [...PATTERNS[v]].map(Number));

// An SVG of the symbol with 10-module quiet zones, `height` in modules.
const svg = (text, { height = 40 } = {}) => {
  const w = widths(text);
  const total = w.reduce((a, b) => a + b, 0) + 20;
  let x = 10;
  const bars = [];
  w.forEach((n, i) => { if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${n}" height="${height}"/>`); x += n; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">${bars.join("")}</svg>`;
};

module.exports = { encode, widths, svg };
