import { esc, printDocument } from "./printWindow";

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
      byKey.set(key, { who, lot: s.lot_number || "", item: s.item_description || "", pallets: 0, cases: 0 });
    }
    const line = byKey.get(key);
    line.pallets += 1;
    line.cases += Number(s.box_count) || 0;
  }
  return [...byKey.values()];
};

const printOutgoingDay = ({ day, sessions = [] }) => {
  const lines = linesFor(sessions);

  const entryRows = (l) => `
    <tr>
      <td class="qty">${l.pallets} PLT</td>
      <td class="item">${esc(l.item)}${l.who ? ` <span class="who">(${esc(l.who)})</span>` : ""}</td>
    </tr>
    <tr class="second">
      <td class="qty"></td>
      <td class="item"><span class="cs">${l.cases} c/s</span><span class="lot">${l.lot ? `#${esc(l.lot)}` : ""}</span></td>
    </tr>`;
  const blankRows = (n) => Array.from({ length: n },
    () => `<tr><td class="qty"></td><td class="item"></td></tr>`).join("");

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
        <h1>Noblesse Trading</h1>
        <div class="when">
          ${pages.length > 1 ? `<span class="pageno">Page ${n} of ${pages.length}</span>` : ""}
          <span class="lbl">Date</span><span class="val">${esc(shortDate(day))}</span>
        </div>
      </div>
      <div class="fill">
        <table class="sheet">
          <thead><tr><th>Box / Pcs.</th><th>Item</th></tr></thead>
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
          .top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
          h1 { font-size: 32px; font-style: italic; font-weight: 800; margin: 0; }
          .when { display: flex; align-items: baseline; gap: 6pt; font-size: 15px; }
          .when .val { min-width: 120px; padding: 0 4pt 2pt; border-bottom: 1px solid #000; font-size: 17px; font-weight: 700; }
          table.sheet { width: 100%; border-collapse: collapse; border: 1.5px solid #000; }
          table.sheet th { font-size: 15px; border: 1.5px solid #000; padding: 4pt; }
          table.sheet td { border-left: 1.5px solid #000; border-right: 1.5px solid #000;
            border-bottom: 1px solid #000; height: 36px; padding: 6pt 4pt; font-size: 16px; }
          td.qty { width: 84px; white-space: nowrap; font-weight: 700; }
          tr.second td { border-bottom: 1.5px solid #000; }
          .compact table.sheet td { height: 28px; padding: 3pt 4pt; }
          .who { font-weight: 700; }
          .cs { display: inline-block; min-width: 140px; }
          .lot { font-weight: 700; padding-left: 120px; }
          /* One letter sheet each; the table stretches its lines to the bottom margin. */
          section.page { height: 278mm; padding: 8mm 10mm; display: flex; flex-direction: column;
            overflow: hidden; break-after: page; page-break-after: always; }
          .fill { flex: 1; min-height: 0; }
          .fill table.sheet { height: 100%; }
          section.page:last-of-type { break-after: auto; page-break-after: auto; }
          .pageno { font-size: 13px; color: #444; margin-right: 10pt; }
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
