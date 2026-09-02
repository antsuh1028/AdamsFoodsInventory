import ntiLogo from "../../assets/nti.jpg";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// Weight manifest for one scanning session — one lot, one page where possible.
//
// The weights are laid out in narrow numbered columns rather than one long
// list: a session can run to a couple of hundred boxes, and a single column
// would spill over four or five sheets for no reason.
//
// Totals are summed as integer thousandths, never floats, so the printed total
// agrees exactly with what the server stored.

const COLUMNS = 5;

const toThousandths = (s) => {
  const [whole, frac = ""] = String(s ?? "0").split(".");
  return (parseInt(whole, 10) || 0) * 1000 + (parseInt((frac + "000").slice(0, 3), 10) || 0);
};

const fromThousandths = (n) => `${Math.floor(n / 1000)}.${String(n % 1000).padStart(3, "0")}`;

const printWeightManifest = ({ lotNumber, date, scans = [], checkedBy = "" } = {}) => {
  const win = window.open("", "_blank");
  if (!win) return;

  // Rejected boxes were never recorded, so they must not appear on a document
  // that says how much product arrived.
  const rows = scans.filter((s) => s.status !== "rejected");

  const byUnit = {};
  for (const s of rows) {
    const unit = s.weightUnit || "LB";
    byUnit[unit] = (byUnit[unit] || 0) + toThousandths(s.weight);
  }
  const totals = Object.entries(byUnit)
    .map(([unit, th]) => `${fromThousandths(th)} ${unit}`)
    .join("  ·  ") || "—";

  // Fill down each column, then across, so the numbering reads naturally.
  const perColumn = Math.ceil(rows.length / COLUMNS) || 1;
  const columns = Array.from({ length: COLUMNS }, (_, c) =>
    rows.slice(c * perColumn, (c + 1) * perColumn)
      .map((s, i) => ({ n: c * perColumn + i + 1, weight: s.weight, unit: s.weightUnit, manual: s.isManual }))
  );

  const columnHtml = columns.map((col) => `
    <td class="col">
      <table class="inner">
        ${col.map((r) => `
          <tr>
            <td class="n">${r.n}</td>
            <td class="w">${esc(r.weight)}${r.manual ? '<span class="m">M</span>' : ""}</td>
          </tr>`).join("")}
      </table>
    </td>`).join("");

  const html = `
    <html>
      <head>
        <title>Weight Manifest${lotNumber ? " — " + esc(lotNumber) : ""}</title>
        <style>
          @page { size: letter; margin: 12mm; }
          html, body {
            margin: 0; padding: 0;
            font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
            color: #1a1a1a;
          }
          .sheet { max-width: 720px; margin: 0 auto; padding: 16px; }
          .header {
            display: flex; align-items: flex-start; justify-content: space-between;
            border-bottom: 2px solid #1f3864; padding-bottom: 8px; margin-bottom: 20px;
          }
          .brand img { width: 300px; max-width: 60%; object-fit: contain; display: block; }
          .brand .addr { font-size: 12px; color: #595959; margin-top: 4px; }
          .header-right { text-align: left; font-size: 20px; font-weight: 700; color: #1f3864; white-space: nowrap; }
          .header-right .line { margin-bottom: 14px; }
          .header-right .fill { font-weight: 700; color: #1a1a1a; margin-left: 12px; }
          .title {
            text-align: center; font-size: 22px; font-weight: 800; color: #1f3864;
            margin: 0 0 6px;
          }
          .sub { text-align: center; font-size: 13px; color: #595959; margin-bottom: 18px; }

          table.grid { width: 100%; border-collapse: collapse; }
          td.col { vertical-align: top; width: ${Math.floor(100 / COLUMNS)}%; padding: 0 6px; }
          table.inner { width: 100%; border-collapse: collapse; }
          table.inner td { padding: 5px 6px; font-size: 14px; border-bottom: 1px solid #e2e2e2; }
          td.n { width: 34px; color: #999; font-size: 11px; text-align: right; }
          td.w {
            text-align: right; font-weight: 600;
            font-variant-numeric: tabular-nums;
          }
          .m { font-size: 9px; color: #b7791f; margin-left: 4px; vertical-align: super; }

          .totals {
            margin-top: 22px; border-top: 2px solid #1f3864; padding-top: 10px;
            display: flex; justify-content: space-between; align-items: baseline;
          }
          .totals .count { font-size: 14px; font-weight: 700; color: #1a1a1a; }
          .totals .sum { font-size: 22px; font-weight: 800; color: #1f3864; }
          .footer {
            margin-top: 34px; border-top: 1px solid #d9d9d9; padding-top: 10px;
            font-size: 13px; font-weight: 700;
          }
          .legend { margin-top: 8px; font-size: 10px; color: #999; }
          .no-print { text-align: center; margin: 16px 0; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="header">
            <div class="brand">
              <img src="${ntiLogo}" alt="Noblesse Trading Inc." />
              <div class="addr">4035 E. 52ND ST., MAYWOOD, CA 90270&nbsp;&nbsp;&nbsp;T. 213-993-1333&nbsp;&nbsp;&nbsp;E. admin@noblessetrading.com</div>
            </div>
            <div class="header-right">
              <div class="line">Lot#:<span class="fill">${esc(lotNumber || "")}</span></div>
              <div class="line">Date:<span class="fill">${esc(date || "")}</span></div>
            </div>
          </div>

          <div class="title">Weight Manifest</div>
          <div class="sub">Individual box weights as scanned</div>

          <table class="grid"><tr>${columnHtml}</tr></table>

          <div class="totals">
            <div class="count">${rows.length} box${rows.length === 1 ? "" : "es"}</div>
            <div class="sum">${totals}</div>
          </div>

          <div class="footer">Checked By${checkedBy ? ": " + esc(checkedBy) : ": ______________________"}</div>
          ${rows.some((r) => r.isManual) ? '<div class="legend">M = entered manually (damaged or unbarcoded label)</div>' : ""}

          <div class="no-print">
            <button onclick="window.print()" style="padding:8px 18px;font-size:14px;cursor:pointer;">
              Print
            </button>
          </div>
        </div>
      </body>
    </html>`;

  win.document.write(html);
  win.document.close();
};

export default printWeightManifest;
