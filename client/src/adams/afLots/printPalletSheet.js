import logo from "../../assets/AdamsWings.png";
import { esc, printDocument } from "../../noblesse/common/printWindow";
import { val, field, check, pacificDay, idBox, FORM_CSS, PRINT_BUTTON, FIT_ONE_PAGE } from "./afFormParts";

// The Pallet Incoming Sheet: one pallet of a delivery, under that delivery's Incoming Form.
// Each item on the pallet gets its own heading and its own box weights, ten to a row.
// No argument prints a blank sheet.
const BLANK_ITEMS = 2;
const BLANK_ROWS = 3;

const printPalletSheet = (sheet = {}) => {
  const reg = sheet.reg || {};
  const items = Array.isArray(sheet.items) ? sheet.items : [];
  const filled = items.length > 0;

  const weightRows = (weights, rows) => Array.from({ length: rows }, (_, r) =>
    `<tr><th class="rn">${r * 10 + 1}–${r * 10 + 10}</th>${Array.from({ length: 10 }, (_, c) =>
      `<td class="w">${val(weights[r * 10 + c])}</td>`).join("")}</tr>`).join("");
  const itemBlock = (it) => {
    const weights = Array.isArray(it.weights) ? it.weights : [];
    const head = filled
      ? `<span class="code">${val(it.code)}</span> ${val(it.description)}<span class="sum">${val(it.cases)} cs · ${val(it.lb)} lb · avg ${val(it.avg)} lb</span>`
      : '<span class="blank">Item code</span><span class="blank wide">Description</span><span class="blank">Cases</span><span class="blank">Weight (lb)</span>';
    return `<tr class="ih"><td colspan="11">${head}</td></tr>${weightRows(weights, filled ? Math.max(1, Math.ceil(weights.length / 10)) : BLANK_ROWS)}`;
  };
  const blocks = (filled ? items : Array.from({ length: BLANK_ITEMS }, () => ({}))).map(itemBlock).join("");
  const regDay = pacificDay(sheet.registeredAt);
  const stamp = !filled ? "Blank sheet"
    : sheet.registeredAt ? `Registered in Lot Registration ${regDay}${sheet.registeredBy ? ` by ${sheet.registeredBy}` : ""}`
      : "Scanned, not registered yet";

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Pallet Incoming Sheet${sheet.lotNumber ? ` — ${esc(sheet.lotNumber)} pallet ${esc(sheet.palletNo || "")}` : ""}</title>
<style>${FORM_CSS}
  table.tally { width: 100%; border-collapse: collapse; border: 1.5px solid #000; }
  .tally tr.ih td { border-top: 1.5px solid #000; border-bottom: 1px solid #000; padding: 4px 8px; font-size: 13px; font-weight: 700; background: #f0f0f0; }
  .tally tr.ih .sum { float: right; font-variant-numeric: tabular-nums; }
  .tally tr.ih .blank { display: inline-block; font-size: 9.5px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid #000; width: 1.2in; margin-right: 14px; padding-top: 10px; }
  .tally tr.ih .blank.wide { width: 2.9in; }
  .tally th.rn { width: 0.55in; font-size: 9.5px; font-weight: 400; text-align: center; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 2px; }
  .tally td.w { text-align: center; font-size: 12px; font-weight: 700; height: 21px; padding: 1px 2px; border-bottom: 1px solid #000; font-variant-numeric: tabular-nums; }
  .tally td.w + td.w { border-left: 1px dotted #000; }
</style></head><body>
${PRINT_BUTTON}
<div class="paper">
  <div class="top">
    <img src="${logo}" alt="AdamsFoods">
    ${idBox([["Lot #", sheet.lotNumber], ["Pallet #", sheet.palletNo], ["AF PO #", sheet.afPo], ["Date received", sheet.dateReceived]])}
  </div>
  <h1>PALLET INCOMING SHEET</h1>
  <div class="sub">ADAMSFOODS · ONE SHEET PER PALLET · FILED WITH INCOMING FORM ${val(sheet.lotNumber) || "__________"}</div>

  <h2><span class="k">1</span>Condition of this pallet</h2>
  <div class="grid four">
    ${field("Vendor", sheet.vendor)}
    ${field("Vendor lot #", sheet.vendorLots)}
    ${field("Product temp (°F)", reg.productTemp)}
    ${field("Damaged boxes", reg.damagedBoxes)}
  </div>
  <div class="checks">${check("Packaging OK", reg.packagingOk)}${check("Labels readable", reg.labelsReadable)}</div>

  <h2><span class="k">2</span>Items and box weights${filled && items.length > 1 ? ` · ${items.length} items on this pallet` : ""}</h2>
  <table class="tally"><tbody>${blocks}</tbody></table>
  <div class="total"><span>Pallet total</span><span><b>${filled ? val(sheet.totalCases) : "____"}</b> cs</span><span><b>${filled ? val(sheet.totalLb) : "________"}</b> lb</span></div>

  <h2><span class="k">3</span>Put-away</h2>
  <div class="grid two">
    ${field("Freezer location", sheet.location)}
    ${field("Put away by", sheet.locatedBy)}
  </div>

  <h2><span class="k">4</span>Remarks</h2>
  <div class="remarks"><div class="line">${val(reg.remarks)}</div><div class="line"></div></div>

  <div class="sign">
    ${field("Checked by", reg.checkedBy)}${field("Date", reg.checkedBy ? regDay : "")}
  </div>
  <div class="stamp"><span>${esc(stamp)}</span><span>Printed ${esc(pacificDay(Date.now()))}</span></div>
</div>
${FIT_ONE_PAGE}
</body></html>`;

  return printDocument(html);
};

export default printPalletSheet;
