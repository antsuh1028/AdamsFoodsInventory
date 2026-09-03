import { kgToLb } from "../../utils/weight";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// The Noblesse Trading tally sheet, reproduced from the paper form.
//
// Ten weights to a row, with the box count for that row on the left and the
// row total on the right, then Total Boxes and Subtotal across the bottom.
// The layout is not cosmetic: people read it row by row against a pallet, so
// the ten-across grouping has to be preserved exactly.
//
// Every sum is integer thousandths. Floats would drift over sixty-odd boxes
// and the printed subtotal has to match the database to the cent.

const PER_ROW = 10;
const MIN_ROWS = 16; // the paper form always shows this many, blank or not

const toThousandths = (s) => {
  const [whole, frac = ""] = String(s ?? "0").split(".");
  return (parseInt(whole, 10) || 0) * 1000 + (parseInt((frac + "000").slice(0, 3), 10) || 0);
};

// Trailing zeros are dropped to match the form, where 63.0 is written "63"
// and 76.44 stays "76.44".
const fromThousandths = (n) => {
  const whole = Math.floor(n / 1000);
  const frac = String(n % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
};

const printWeightManifest = ({
  lotNumber, date, vendor, shipTo, billOfLading, itemDescription,
  scans = [], assembledBy = "", checkedBy = "", memo = "",
} = {}) => {
  const win = window.open("", "_blank");
  if (!win) return;

  // A rejected scan was never recorded, a duplicate is one box scanned twice,
  // and a voided one was taken off the tally on purpose. None of the three is
  // product arriving, so none belongs on the form.
  const OFF_THE_TALLY = new Set(["rejected", "duplicate", "voided"]);
  const boxes = scans.filter((s) => !OFF_THE_TALLY.has(s.status));

  // A tally is always in pounds. Rows reach this function in three shapes and
  // only one of them can be trusted to be converted already:
  //
  //   1. a live session row  — carries displayWeight, its converted twin
  //   2. a row stored since conversion shipped — weight in LB, converted_from set
  //   3. a row stored BEFORE it shipped — weight still in kilograms
  //
  // The third is why this converts here rather than trusting weightUnit.
  // Production ran without conversion for a while, so those rows are real, and
  // printing them as-is put kilograms in a column headed pounds.
  //
  // Converted per box, then summed — never summed then converted. Each box
  // rounds independently, so the two orders disagree by a thousandth or so and
  // the column would not add up to its own printed subtotal, which is precisely
  // what someone reconciling a shipment checks.
  const inKg = (s) => String(s.weightUnit || "").toUpperCase() === "KG";
  const weightOf = (s) => {
    if (s.displayWeight) return s.displayWeight;      // already converted
    return inKg(s) ? kgToLb(s.weight) : s.weight;
  };

  const unit = "LB";
  // Flagged on the row, or still carrying a kilogram unit because it predates
  // the conversion — either way the operator should see it was converted.
  const convertedCount = boxes.filter((s) => s.convertedFrom || inKg(s)).length;

  const rows = [];
  for (let i = 0; i < boxes.length; i += PER_ROW) rows.push(boxes.slice(i, i + PER_ROW));

  let grand = 0;
  const rowHtml = [];
  for (let r = 0; r < Math.max(MIN_ROWS, rows.length); r += 1) {
    const row = rows[r] || [];
    const sum = row.reduce((acc, s) => acc + toThousandths(weightOf(s)), 0);
    grand += sum;

    const cells = Array.from({ length: PER_ROW }, (_, c) => {
      const s = row[c];
      return `<td class="w">${s ? esc(fromThousandths(toThousandths(weightOf(s)))) : ""}${
        s && s.isManual ? '<span class="m">M</span>' : ""}</td>`;
    }).join("");

    rowHtml.push(
      `<tr>
         <td class="cnt">${row.length}</td>
         ${cells}
         <td class="rowtot">${row.length ? esc(fromThousandths(sum)) : "0"}</td>
       </tr>`
    );
  }

  const html = `
    <html>
      <head>
        <title>Tally${lotNumber ? " " + esc(lotNumber) : ""}</title>
        <style>
          /* Extra headroom at the top so the title is not tight against the
             sheet edge, and printers that clip the first few millimetres do
             not eat into it. */
          @page { size: letter portrait; margin: 22mm 12mm 12mm; }
          html, body {
            margin: 0; padding: 0;
            font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
            color: #000; font-size: 11px;
          }
          .sheet { max-width: 760px; margin: 0 auto; }
          h1 {
            text-align: center; font-size: 26px; font-style: italic; font-weight: 700;
            margin: 18px 0 22px;
          }
          table.head { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
          table.head td { padding: 2px 4px; font-size: 12px; vertical-align: bottom; }
          .lbl { width: 90px; white-space: nowrap; }
          .lbl-sm { font-size: 8px; line-height: 1.1; }
          .val { border-bottom: 1px solid #000; text-align: center; }
          .val-r { border-bottom: 1px solid #000; text-align: center; width: 170px; }

          table.grid { width: 100%; border-collapse: collapse; border: 1.5px solid #000; }
          table.grid td, table.grid th { border: 1px solid #000; }
          .desc-lbl { padding: 4px 6px; font-size: 12px; white-space: nowrap; border-right: none !important; }
          .desc-val { padding: 4px 6px; font-size: 12px; text-align: center; border-left: none !important; }
          th.h { padding: 3px; font-size: 11px; font-weight: 400; text-align: center; }
          td.cnt { width: 52px; text-align: right; padding: 7px 6px; }
          td.w {
            width: 8.4%; text-align: right; padding: 7px 5px;
            border-left: 1px dotted #555; border-right: 1px dotted #555;
            font-variant-numeric: tabular-nums;
          }
          td.rowtot {
            width: 62px; text-align: right; padding: 7px 6px;
            font-variant-numeric: tabular-nums;
          }
          .m { font-size: 7px; vertical-align: super; margin-left: 2px; }
          td.foot { padding: 4px 6px; font-size: 11px; font-weight: 700; }
          td.foot-r { padding: 4px 6px; font-size: 11px; font-weight: 700; text-align: right; }

          table.sign { width: 100%; border-collapse: collapse; margin-top: 16px; }
          table.sign td { padding: 10px 4px 2px; font-size: 11px; border-bottom: 1px solid #000; }
          table.sign td.gap { border-bottom: none; width: 30px; }
          .memo { margin-top: 16px; font-size: 11px; border-bottom: 1px solid #000; padding-bottom: 12px; }
          .no-print { text-align: center; margin: 16px 0; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <h1>Noblesse Trading</h1>

          <table class="head">
            <tr>
              <td class="lbl">Vendor</td>
              <td class="val">${esc(vendor || "")}</td>
              <td class="lbl" style="width:50px">Date</td>
              <td class="val-r">${esc(date || "")}</td>
            </tr>
            <tr>
              <td class="lbl lbl-sm">Ship To<br/>Bill of Lading</td>
              <td class="val">${esc(shipTo || billOfLading || "")}</td>
              <td class="lbl" style="width:50px">Lot#</td>
              <td class="val-r">${esc(lotNumber || "")}</td>
            </tr>
          </table>

          <table class="grid">
            <tr>
              <td class="desc-lbl" colspan="4">Item Description:</td>
              <td class="desc-val" colspan="8">${esc(itemDescription || "")}</td>
            </tr>
            <tr>
              <th class="h">Box/Pcs.</th>
              <th class="h" colspan="${PER_ROW}">Item</th>
              <th class="h">Total</th>
            </tr>
            ${rowHtml.join("")}
            <tr>
              <td class="foot" colspan="6">Total Boxes:&nbsp;&nbsp;${boxes.length}</td>
              <td class="foot-r" colspan="6">Subtotal:&nbsp;&nbsp;${fromThousandths(grand)} ${unit}</td>
            </tr>
          </table>

          ${convertedCount
            ? `<div style="margin-top:6px;font-size:10px;">${convertedCount} box${
                convertedCount === 1 ? "" : "es"} labelled in kilograms, converted to pounds.</div>`
            : ""}
          ${boxes.some((b) => b.isManual)
            ? '<div style="margin-top:6px;font-size:9px;">M = entered manually (damaged or unbarcoded label)</div>'
            : ""}

          <table class="sign">
            <tr>
              <td>ASSEMBLED BY${assembledBy ? "&nbsp;&nbsp;" + esc(assembledBy) : ""}</td>
              <td class="gap"></td>
              <td>CHECKED BY${checkedBy ? "&nbsp;&nbsp;" + esc(checkedBy) : ""}</td>
            </tr>
          </table>

          <div class="memo">MEMO:&nbsp;&nbsp;${esc(memo || "")}</div>

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
