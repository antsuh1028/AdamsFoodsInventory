import { esc, printDocument } from "./printWindow";
import { toDisplay } from "../../utils/weight";

// A session's pounds in thousandths, so totals add exactly.
const lbMils = (s) =>
  Math.round(Number((s.totals || []).find((t) => t.unit === "LB")?.total || 0) * 1000);

// Thousandths as a display weight with thousands commas: 2610500 -> "2,610.50".
const fmtLb = (mils) => {
  const [whole, frac] = toDisplay(`${Math.floor(mils / 1000)}.${String(mils % 1000).padStart(3, "0")}`).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
};

// The day's outgoing sheet, laid out like the paper pad the dock writes by hand:
// pallets and item (customer) on one line, cases and lot on the next, and blank
// lines underneath for anything not recorded in the system.

// Rows on a page, so the blank lines run to the foot of the sheet.
const MIN_ROWS = 26;
// Rows on a page with shorter lines, used to keep the writing space on one sheet.
const COMPACT_ROWS = 32;
// Blank lines always left on the last page for what is not in the system.
const KEEP_BLANK = 4;

// "2026-10-14" -> "10/14/26".
const shortDate = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}` : "";
};

// One line per customer, lot and item, in the order the first pallet was weighed.
const linesFor = (sessions) => {
  const byKey = new Map();
  const sorted = [...sessions].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const s of sorted) {
    const who = s.further_processing ? "F.P." : (s.ship_to || "");
    const key = [who, s.lot_number || "", s.item_description || ""].join("|");
    if (!byKey.has(key)) {
      byKey.set(key, { who, lot: s.lot_number || "", item: s.item_description || "", pallets: 0, cases: 0, mils: 0 });
    }
    const line = byKey.get(key);
    line.pallets += 1;
    line.cases += Number(s.box_count) || 0;
    line.mils += lbMils(s);
  }
  return [...byKey.values()];
};

const printOutgoingDay = ({ day, sessions = [] }) => {
  const lines = linesFor(sessions);

  const entryRows = (l) => `
    <tr>
      <td class="qty">${l.pallets} PLT</td>
      <td class="item">${esc(l.item)}${l.who ? ` <span class="who">(${esc(l.who)})</span>` : ""}</td>
      <td class="wt" rowspan="2">${l.mils ? `${fmtLb(l.mils)} lb` : ""}</td>
    </tr>
    <tr class="second">
      <td class="qty"></td>
      <td class="item"><span class="cs">${l.cases} c/s</span><span class="lot">${l.lot ? `#${esc(l.lot)}` : ""}</span></td>
    </tr>`;
  const blankRows = (n) => Array.from({ length: n },
    () => `<tr><td class="qty"></td><td class="item"></td><td class="wt"></td></tr>`).join("");

  // Whole pages: an entry's two lines never split. The last page keeps KEEP_BLANK lines,
  // on shorter rows if that keeps it to one sheet, else the rest carries to a new page.
  const pages = [];
  let rest = lines;
  for (;;) {
    const need = rest.length * 2 + KEEP_BLANK;
    if (need <= MIN_ROWS) { pages.push({ entries: rest, rows: MIN_ROWS }); break; }
    if (need <= COMPACT_ROWS) { pages.push({ entries: rest, rows: COMPACT_ROWS, compact: true }); break; }
    pages.push({ entries: rest.slice(0, MIN_ROWS / 2), rows: MIN_ROWS });
    rest = rest.slice(MIN_ROWS / 2);
  }

  const page = ({ entries, rows, compact }, n) => `
    <section class="page${compact ? " compact" : ""}">
      <div class="top">
        <span class="pageno">${pages.length > 1 ? `Page ${n} of ${pages.length}` : ""}</span>
        <h1>Noblesse Trading</h1>
        <div class="when"><span class="lbl">Date</span><span class="val">${esc(shortDate(day))}</span></div>
      </div>
      <div class="fill">
        <table class="sheet">
          <thead><tr><th>Box / Pcs.</th><th>Item</th><th>Total Weight</th></tr></thead>
          <tbody>${entries.map(entryRows).join("")}${blankRows(rows - entries.length * 2)}</tbody>
        </table>
      </div>
    </section>`;

  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Outgoing ${esc(shortDate(day))}</title>
        <style>
          /* Margins live on each page, so the browser's margin setting cannot clip the table. */
          @page { size: letter portrait; margin: 0; }
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; }
          /* Page number left, title centred, date right. */
          .top { display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline; margin-bottom: 16px; }
          h1 { font-size: 32px; font-style: italic; font-weight: 800; margin: 0; text-align: center; }
          .when { display: flex; align-items: baseline; justify-content: flex-end; gap: 6pt; font-size: 15px; }
          .when .val { min-width: 120px; padding: 0 4pt 2pt; border-bottom: 0.5px solid #000; font-size: 17px; }
          table.sheet { width: 100%; border-collapse: collapse; border: none; }
          table.sheet th { font-size: 15px; font-weight: normal; border: 1px dotted #000; padding: 4pt; }
          table.sheet td { border-left: 1px dotted #000; border-right: 1px dotted #000;
            border-bottom: 1px dotted #000; height: 36px; padding: 6pt 4pt; font-size: 16px; }
          td.qty { width: 84px; white-space: nowrap; }
          td.wt { width: 120px; white-space: nowrap; text-align: right; vertical-align: middle;
            font-variant-numeric: tabular-nums; border-bottom: 1px dotted #000; }
          tr.second td { border-bottom: 1px dotted #000; }
          /* The outer frame is one hairline; the inside lines stay dotted and stop at it. */
          table.sheet tr > :first-child { border-left: none; }
          table.sheet tr > :last-child { border-right: none; }
          table.sheet thead th { border-top: none; }
          table.sheet tbody tr:last-child td { border-bottom: none; }
          /* The weight cell spans both lines, so the second line's item cell keeps its divider. */
          table.sheet tr.second > td.item { border-right: 1px dotted #000; }
          .compact table.sheet td { height: 28px; padding: 3pt 4pt; }
          .cs { display: inline-block; min-width: 140px; }
          .lot { padding-left: 120px; }
          /* One letter sheet each; the table stretches its lines to the bottom margin. */
          section.page { height: 278mm; padding: 8mm 10mm; display: flex; flex-direction: column;
            overflow: hidden; break-after: page; page-break-after: always; }
          .fill { flex: 1; min-height: 0; border: 0.5px solid #000; }
          .fill table.sheet { height: 100%; }
          section.page:last-of-type { break-after: auto; page-break-after: auto; }
          .pageno { font-size: 13px; color: #444; }
          .no-print { text-align: center; margin: 14px 0; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        ${pages.map((p, i) => page(p, i + 1)).join("")}

        <div class="no-print">
          <button onclick="window.print()" style="padding:8px 18px;font-size:14px;cursor:pointer;">Print</button>
        </div>
      </body>
    </html>`;

  return printDocument(html);
};

export default printOutgoingDay;
