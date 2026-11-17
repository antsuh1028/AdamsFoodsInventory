import logo from "../../assets/AdamsWings.png";
import { esc, printDocument } from "../../noblesse/common/printWindow";
import { val, field, check, pacificDay, idBox, FORM_CSS, PRINT_BUTTON, FIT_ONE_PAGE } from "./afFormParts";

// The Incoming Form: one delivery, the parent of its pallets' Pallet Incoming Sheets.
// Lists every pallet, a row per item on it, so a mixed pallet shows what it holds.
// No argument prints a blank form.
const BLANK_ROWS = 10;

const printIncomingForm = (form = {}) => {
  const reg = form.reg || {};
  const pallets = Array.isArray(form.pallets) ? form.pallets : [];
  const filled = pallets.length > 0;

  // One row per item; the pallet's number, location and sheet span its rows.
  const palletRows = pallets.map((p) => {
    const its = p.items && p.items.length ? p.items : [{}];
    return its.map((it, i) => `<tr${i === 0 ? ' class="first"' : ""}>${i === 0
      ? `<td class="c" rowspan="${its.length}"><b>${val(p.no)}</b>${its.length > 1 ? '<br><span class="mx">MIXED</span>' : ""}</td>` : ""}
      <td class="code">${val(it.code)}</td><td>${val(it.description)}</td><td class="n">${val(it.cases)}</td><td class="n">${val(it.lb)}</td>${i === 0
      ? `<td class="loc" rowspan="${its.length}">${val(p.location)}</td><td class="c" rowspan="${its.length}">${p.sheet ? "&#10003;" : ""}</td>` : ""}</tr>`).join("");
  }).join("");
  const used = pallets.reduce((n, p) => n + Math.max(1, (p.items || []).length), 0);
  const blankRows = Array.from({ length: Math.max(0, BLANK_ROWS - used) },
    () => '<tr><td class="c"></td><td class="code"></td><td></td><td class="n"></td><td class="n"></td><td class="loc"></td><td class="c"></td></tr>').join("");
  const regDay = pacificDay(form.registeredAt);
  const stamp = !filled && !form.lotNumber ? "Blank form"
    : form.registeredAt ? `Registered in Lot Registration ${regDay}${form.registeredBy ? ` by ${form.registeredBy}` : ""}`
      : "Not registered yet";

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Incoming Form${form.lotNumber ? ` — ${esc(form.lotNumber)}` : ""}</title>
<style>${FORM_CSS}
  table.pallets { width: 100%; border-collapse: collapse; }
  .pallets th { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; text-align: left; border-bottom: 1.5px solid #000; padding: 4px 6px; }
  .pallets td { border-bottom: 1px solid #000; height: 22px; padding: 2px 6px; font-size: 12.5px; font-weight: 700; }
  .pallets td + td, .pallets th + th { border-left: 1px solid #000; }
  .pallets tr.first td { border-top: 1.5px solid #000; }
  .pallets .n { text-align: right; width: 0.8in; font-variant-numeric: tabular-nums; }
  .pallets th.n { text-align: right; }
  .pallets .c { text-align: center; width: 0.55in; }
  .pallets th.c { text-align: center; }
  .pallets { table-layout: fixed; }
  .pallets .code { width: 0.8in; }
  .pallets .loc { width: 0.8in; }
  .mx { border: 1.3px solid #000; font-size: 8.5px; padding: 0 3px; letter-spacing: 0.06em; font-weight: 700; }
</style></head><body>
${PRINT_BUTTON}
<div class="paper">
  <div class="top">
    <img src="${logo}" alt="AdamsFoods">
    ${idBox([["Lot #", form.lotNumber], ["AF PO #", reg.afPo], ["Pallets", filled ? pallets.length : ""], ["Date received", form.dateReceived]])}
  </div>
  <h1>INCOMING FORM</h1>
  <div class="sub">ADAMSFOODS · RECEIVING · ONE FORM PER DELIVERY · EACH PALLET HAS ITS OWN PALLET INCOMING SHEET</div>

  <div class="manifest"><span class="big">${reg.manifestAttached ? "&#10003;" : ""}</span><b>MANIFEST / BILL OF LADING ATTACHED</b></div>

  <h2><span class="k">1</span>Delivery</h2>
  <div class="grid">
    ${field("Vendor", form.vendor)}
    ${field("Time received", reg.timeReceived)}
    ${field("Carrier / truck", reg.carrier)}
    ${field("Vendor lot # (from labels)", form.vendorLots)}
    ${field("Bill of lading #", reg.bol)}
    ${field("Trailer / seal #", reg.trailerSeal)}
    ${field("Truck temp (°F)", reg.truckTemp)}
  </div>
  <div class="checks">${check("Count matches the paperwork", reg.countMatches)}</div>

  <h2><span class="k">2</span>Pallets in this delivery</h2>
  <table class="pallets">
    <thead><tr><th class="c">Pallet</th><th class="code">Item code</th><th>Product</th><th class="n">Cases</th><th class="n">Weight (lb)</th><th class="loc">Location</th><th class="c">Sheet</th></tr></thead>
    <tbody>${palletRows}${blankRows}</tbody>
  </table>
  <div class="total"><span>Delivery total</span><span><b>${filled ? val(form.totalCases) : "____"}</b> cs</span><span><b>${filled ? val(form.totalLb) : "________"}</b> lb</span></div>

  <h2><span class="k">3</span>Remarks</h2>
  <div class="remarks"><div class="line">${val(reg.remarks)}</div><div class="line"></div></div>

  <div class="sign">
    ${field("Received by", reg.receivedBy)}${field("Date", reg.receivedBy ? regDay : "")}
    ${field("Checked by", reg.checkedBy)}${field("Date", reg.checkedBy ? regDay : "")}
  </div>
  <div class="stamp"><span>${esc(stamp)}</span><span>Printed ${esc(pacificDay(Date.now()))}</span></div>
</div>
${FIT_ONE_PAGE}
</body></html>`;

  return printDocument(html);
};

export default printIncomingForm;
