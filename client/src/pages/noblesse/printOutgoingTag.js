import {
  kgToLb, toDisplayHundredths, fromHundredths,
} from "../../utils/weight";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// The tag that goes out with weighed boxes — the incoming tally sheet at half
// the size, printed TWICE on one letter sheet: one copy stays here, the other
// travels with the driver. Cut on the dashed rule between them.
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

  // Built once and printed twice — the two copies are the same tag, so there is
  // nothing to keep in step between them.
  const tag = `
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
              <td class="lbl-lot">Lot#</td>
              <td class="val-lot">${esc(lotNumber || "")}</td>
            </tr>
          </table>

          <div class="grid-wrap">
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
          </div>

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
        </div>`;

  // The tag is a fixed half page, so a long session tightens its rows rather
  // than running the pair onto a second sheet. Under this it stays roomy and
  // the grid stretches to fill whatever is left.
  const rowCount = Math.max(MIN_ROWS, rows.length);
  const rowPad = rowCount > 12 ? 1 : rowCount > 7 ? 2 : 6;
  const rowFont = rowCount > 12 ? 9 : rowCount > 7 ? 10 : 12;

  const html = `
    <html>
      <head>
        <title>Outgoing tag${lotNumber ? " " + esc(lotNumber) : ""}</title>
        <style>
          /* 10mm top and bottom rather than 14: two tags plus the cut line have
             to clear the printable height, and at 14mm they do not. The sides
             stay where they were — the grid is laid out against them. */
          @page { size: letter portrait; margin: 10mm 14mm; }
          html, body {
            margin: 0; padding: 0;
            font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
            color: #000; font-size: 11px;
          }
          /* Half of a letter sheet, fixed so the cut falls in the same place on
             every tag. 5in x2 plus the ~0.14in cut line is 10.14in, inside the
             10.21in a letter page leaves at these margins — so the pair fills
             the sheet instead of trailing off with a gap under the lower copy.
             A column, so the grid below takes the slack rather than it
             collecting at the foot of the tag. */
          .tag {
            height: 5in; box-sizing: border-box;
            padding: 16px 30px 18px; page-break-inside: avoid;
            display: flex; flex-direction: column;
          }
          /* The grid takes whatever height is left over and the table fills it,
             so the rows space themselves evenly rather than bunching at the top
             with a gap underneath. */
          .grid-wrap { flex: 1 1 auto; display: flex; min-height: 0; }
          /* The rule IS the cut line, so the label sits on it rather than
             floating under a border belonging to the tag above. */
          .cutline {
            border-top: 1px dashed #999;
            font-size: 8px; color: #777; text-align: right;
            padding: 2px 30px 0; letter-spacing: 0.08em;
          }
          h1 {
            text-align: center; font-size: 21px; font-style: italic; font-weight: 700;
            margin: 0 0 3px;
          }
          .kind {
            text-align: center; font-size: 12px; font-weight: 700;
            letter-spacing: 0.18em; margin: 0 0 10px;
          }
          table.head { width: 100%; border-collapse: collapse; margin-bottom: 7px; }
          table.head td { padding: 3px 6px; font-size: 13px; vertical-align: bottom; }
          .lbl { width: 88px; white-space: nowrap; }
          .val { border-bottom: 1px solid #000; text-align: center; }
          .val-r { border-bottom: 1px solid #000; text-align: center; width: 168px; }
          /* The lot is what the whole tag keys on, so it reads across a dock
             rather than sitting at the same weight as the BOL beside it.
             Qualified with table.head td, which is (0,1,2) and would otherwise
             beat a bare class and drop the font-size on the floor. */
          table.head td.val-lot {
            border-bottom: 1px solid #000; text-align: center; width: 168px;
            font-size: 23px; font-weight: 700; letter-spacing: 0.03em;
            line-height: 1.1; padding: 0 6px 1px;
          }
          table.head td.lbl-lot {
            width: 42px; white-space: nowrap; font-weight: 700; font-size: 13px;
          }

          /* height:100% inside the flex wrapper — the rows then share out the
             leftover height between them. */
          table.grid {
            width: 100%; height: 100%; border-collapse: collapse;
            border: 1.5px solid #000;
          }
          table.grid td, table.grid th { border: 1px solid #000; }
          .desc { position: relative; padding: 7px 8px; font-size: 13px; text-align: center; }
          .desc-lbl { position: absolute; left: 8px; top: 7px; white-space: nowrap; }
          .desc-val { display: inline-block; font-weight: 600; }
          th.h { padding: 5px 2px; font-size: 11px; font-weight: 400; text-align: center; }
          td.cnt {
            width: 52px; text-align: right;
            padding: ${rowPad}px 7px; font-size: ${rowFont}px;
          }
          td.w {
            width: 8.4%; text-align: right;
            padding: ${rowPad}px 5px; font-size: ${rowFont}px;
            border-left: 1px dotted #555; border-right: 1px dotted #555;
            font-variant-numeric: tabular-nums;
          }
          td.rowtot {
            width: 66px; text-align: right;
            padding: ${rowPad}px 7px; font-size: ${rowFont}px;
            font-variant-numeric: tabular-nums;
          }
          td.foot { padding: 8px; font-size: 13px; font-weight: 700; }
          td.foot-r { padding: 8px; font-size: 13px; font-weight: 700; text-align: right; }
          .foot-n { font-size: 19px; font-variant-numeric: tabular-nums; }

          table.sign { width: 100%; border-collapse: collapse; margin-top: 14px; }
          table.sign td { padding: 15px 4px 2px; font-size: 12px; border-bottom: 1px solid #000; }
          table.sign td.gap { border-bottom: none; width: 30px; }
          .note { margin-top: 5px; font-size: 10px; }
          .no-print { text-align: center; margin: 14px 0; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        ${tag}
        <div class="cutline">CUT HERE</div>
        ${tag}

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
