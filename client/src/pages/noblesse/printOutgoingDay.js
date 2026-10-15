import { esc, printDocument } from "./printWindow";

// The day's outgoing sheet, laid out like the paper pad the dock writes by hand:
// pallets and item (customer) on one line, cases and lot on the next, and blank
// lines underneath for anything not recorded in the system.

// Rows on every page, so the blank lines run to the foot of the sheet.
const MIN_ROWS = 21;

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

  // Whole pages: an entry's two lines never split, and every page is topped up with blank lines.
  const perPage = Math.floor(MIN_ROWS / 2);
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push([]);

  const page = (entries, n) => `
    <section class="page">
      <h1>Noblesse Trading</h1>
      <table class="head">
        <tr>
          <td class="pageno">${pages.length > 1 ? `Page ${n} of ${pages.length}` : ""}</td>
          <td class="lbl">Date</td><td class="val">${esc(shortDate(day))}</td>
        </tr>
      </table>
      <table class="sheet">
        <thead><tr><th>Box / Pcs.</th><th>Item</th></tr></thead>
        <tbody>${entries.map(entryRows).join("")}${blankRows(MIN_ROWS - entries.length * 2)}</tbody>
      </table>
    </section>`;

  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Outgoing ${esc(shortDate(day))}</title>
        <style>
          @page { size: letter portrait; margin: 20mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; }
          h1 { text-align: center; font-size: 36px; font-style: italic; font-weight: 800; margin: 0 0 14px; }
          table.head { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 16px; }
          table.head td { padding: 4pt; vertical-align: bottom; }
          td.lbl { width: 50px; white-space: nowrap; text-align: right; }
          td.val { width: 150px; border-bottom: 1px solid #000; font-size: 19px; font-weight: 700; }
          table.sheet { width: 100%; border-collapse: collapse; border: 1.5px solid #000; }
          table.sheet th { font-size: 16px; border: 1.5px solid #000; padding: 4pt; }
          table.sheet td { border-left: 1.5px solid #000; border-right: 1.5px solid #000;
            border-bottom: 1px solid #000; height: 42px; padding: 8pt 4pt; font-size: 18px; }
          td.qty { width: 92px; white-space: nowrap; font-weight: 700; }
          tr.second td { border-bottom: 1.5px solid #000; }
          .who { font-weight: 700; }
          .cs { display: inline-block; min-width: 140px; }
          .lot { font-weight: 700; padding-left: 120px; }
          section.page { break-after: page; page-break-after: always; }
          section.page:last-of-type { break-after: auto; page-break-after: auto; }
          td.pageno { font-size: 13px; color: #444; }
          .no-print { text-align: center; margin: 14px 0; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        ${pages.map((entries, i) => page(entries, i + 1)).join("")}

        <div class="no-print">
          <button onclick="window.print()" style="padding:8px 18px;font-size:14px;cursor:pointer;">Print</button>
        </div>
      </body>
    </html>`;

  return printDocument(html);
};

export default printOutgoingDay;
