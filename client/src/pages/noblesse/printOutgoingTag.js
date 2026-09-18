import {
  kgToLb, toDisplayHundredths, fromHundredths,
} from "../../utils/weight";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// The tag that goes out with weighed boxes — the incoming tally sheet at half
// the size, on the top half of a letter sheet so it can be cut off and attached.
//
// The heading says OUTGOING things: where it is going and what is in it. The
// incoming sheet's Vendor / Vendor Lot fields have no meaning on the way out.

const PER_ROW = 10;
const MIN_ROWS = 6; // fills the half sheet; grows if the session is bigger

// Rounded per box BEFORE anything is added up — utils/weight.js, and the same
// order the incoming tally uses, so the two agree on the same boxes.
const cents = (s) => Number(toDisplayHundredths(s ?? "0"));
const show = (n) => fromHundredths(n);

const printOutgoingTag = ({
  lotNumber, date, shipTo, itemDescription, billOfLading,
  boxes: scans = [], weighedBy = "", memo = "",
} = {}) => {
  const win = window.open("", "_blank");
  if (!win) return;

  // A voided box was taken off the tally on purpose; a duplicate is one box
  // counted twice. Neither travels on the tag.
  const OFF_THE_TALLY = new Set(["rejected", "duplicate", "voided"]);
  const boxes = scans.filter((s) => !OFF_THE_TALLY.has(s.status) && !s.voidedAt);

  const inKg = (s) => String(s.weightUnit || "").toUpperCase() === "KG";
  const weightOf = (s) => {
    if (s.displayWeight) return s.displayWeight;
    return inKg(s) ? kgToLb(s.weight) : s.weight;
  };

  const estimated = boxes.filter((s) => s.isEstimated);
  const estimatedTotal = estimated.reduce((acc, s) => acc + cents(weightOf(s)), 0);

  const rows = [];
  for (let i = 0; i < boxes.length; i += PER_ROW) rows.push(boxes.slice(i, i + PER_ROW));

  let grand = 0;
  const rowHtml = [];
  for (let r = 0; r < Math.max(MIN_ROWS, rows.length); r += 1) {
    const row = rows[r] || [];
    const sum = row.reduce((acc, s) => acc + cents(weightOf(s)), 0);
    grand += sum;

    const cells = Array.from({ length: PER_ROW }, (_, c) => {
      const s = row[c];
      return `<td class="w">${s ? esc(show(cents(weightOf(s)))) : ""}</td>`;
    }).join("");

    rowHtml.push(
      `<tr>
         <td class="cnt">${row.length}</td>
         ${cells}
         <td class="rowtot">${row.length ? esc(show(sum)) : "0"}</td>
       </tr>`
    );
  }

  const html = `
    <html>
      <head>
        <title>Outgoing tag${lotNumber ? " " + esc(lotNumber) : ""}</title>
        <style>
          @page { size: letter portrait; margin: 14mm; }
          html, body {
            margin: 0; padding: 0;
            font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
            color: #000; font-size: 10px;
          }
          /* Half of a letter sheet. The rule at the bottom is where to cut, and
             the padding keeps the grid off that edge and off the fold. */
          .tag {
            height: 5.1in; box-sizing: border-box;
            padding: 14px 18px 16px; border-bottom: 1px dashed #999;
          }
          .cutline {
            font-size: 8px; color: #777; text-align: right;
            margin-top: 3px; padding-right: 18px; letter-spacing: 0.08em;
          }
          h1 {
            text-align: center; font-size: 17px; font-style: italic; font-weight: 700;
            margin: 0 0 2px;
          }
          .kind {
            text-align: center; font-size: 10px; font-weight: 700;
            letter-spacing: 0.18em; margin: 0 0 8px;
          }
          table.head { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
          table.head td { padding: 1px 4px; font-size: 11px; vertical-align: bottom; }
          .lbl { width: 78px; white-space: nowrap; }
          .val { border-bottom: 1px solid #000; text-align: center; }
          .val-r { border-bottom: 1px solid #000; text-align: center; width: 150px; }

          table.grid { width: 100%; border-collapse: collapse; border: 1.5px solid #000; }
          table.grid td, table.grid th { border: 1px solid #000; }
          .desc { position: relative; padding: 3px 6px; font-size: 11px; text-align: center; }
          .desc-lbl { position: absolute; left: 6px; top: 3px; white-space: nowrap; }
          .desc-val { display: inline-block; font-weight: 600; }
          th.h { padding: 2px; font-size: 10px; font-weight: 400; text-align: center; }
          td.cnt { width: 44px; text-align: right; padding: 4px 5px; }
          td.w {
            width: 8.4%; text-align: right; padding: 4px 4px;
            border-left: 1px dotted #555; border-right: 1px dotted #555;
            font-variant-numeric: tabular-nums;
          }
          td.rowtot {
            width: 56px; text-align: right; padding: 4px 5px;
            font-variant-numeric: tabular-nums;
          }
          td.foot { padding: 5px 6px; font-size: 11px; font-weight: 700; }
          td.foot-r { padding: 5px 6px; font-size: 11px; font-weight: 700; text-align: right; }
          .foot-n { font-size: 16px; font-variant-numeric: tabular-nums; }

          table.sign { width: 100%; border-collapse: collapse; margin-top: 8px; }
          table.sign td { padding: 7px 4px 1px; font-size: 10px; border-bottom: 1px solid #000; }
          table.sign td.gap { border-bottom: none; width: 24px; }
          .note { margin-top: 4px; font-size: 9px; }
          .no-print { text-align: center; margin: 14px 0; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="tag">
          <h1>Noblesse Trading</h1>
          <div class="kind">OUTGOING &mdash; WEIGHED BOXES</div>

          <table class="head">
            <tr>
              <td class="lbl">Ship To</td>
              <td class="val">${esc(shipTo || "")}</td>
              <td class="lbl" style="width:42px">Date</td>
              <td class="val-r">${esc(date || "")}</td>
            </tr>
            <tr>
              <td class="lbl">BOL #</td>
              <td class="val">${esc(billOfLading || "")}</td>
              <td class="lbl" style="width:42px">Lot#</td>
              <td class="val-r">${esc(lotNumber || "")}</td>
            </tr>
          </table>

          <table class="grid">
            <tr>
              <td class="desc" colspan="12">
                <span class="desc-lbl">Item Description:</span>
                <span class="desc-val">${esc(itemDescription || "")}</span>
              </td>
            </tr>
            <tr>
              <th class="h">Box/Pcs.</th>
              <th class="h" colspan="${PER_ROW}">Item</th>
              <th class="h">Total</th>
            </tr>
            ${rowHtml.join("")}
            <tr>
              <td class="foot" colspan="6">Total Boxes:&nbsp;&nbsp;<span class="foot-n">${boxes.length}</span></td>
              <td class="foot-r" colspan="6">Subtotal:&nbsp;&nbsp;<span class="foot-n">${show(grand)} LB</span></td>
            </tr>
          </table>

          ${estimated.length
            ? `<div class="note">${estimated.length} of these ${boxes.length} boxes carry a nominal label weight and were not weighed — ${esc(show(estimatedTotal))} LB of the total.</div>`
            : ""}

          <table class="sign">
            <tr>
              <td>WEIGHED BY${weighedBy ? "&nbsp;&nbsp;" + esc(weighedBy) : ""}</td>
              <td class="gap"></td>
              <td>CHECKED BY</td>
            </tr>
          </table>

          ${memo ? `<div class="note">MEMO:&nbsp;&nbsp;${esc(memo)}</div>` : ""}
        </div>
        <div class="cutline">CUT HERE</div>

        <div class="no-print">
          <button onclick="window.print()" style="padding:8px 18px;font-size:14px;cursor:pointer;">
            Print
          </button>
        </div>
      </body>
    </html>`;

  win.document.write(html);
  win.document.close();
};

export default printOutgoingTag;
