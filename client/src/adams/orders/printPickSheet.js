import logo from "../../assets/AdamsWings.png";
import { esc, printDocument } from "../../noblesse/common/printWindow";
import { isOrdered, casesOf, lbsOf, lbText, estCases, wantText } from "./orderMath";

// The floor's copy of an order: the paper sheet the office used to print from
// Excel. No prices. Each line gets a 1-10 grid for box weights, a row per ten boxes.
// "2026-11-10" as the paper sheet writes it: 11/10/2026.
const usDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : (d || "");
};

const printPickSheet = (order, opened = null) => {
  const lines = (order.lines || []).filter(isOrdered);
  const gridCells = `<td></td>${Array.from({ length: 10 }, () => '<td class="w"></td>').join("")}<td></td>`;
  const grid = () => `<tr>${gridCells}</tr>`;
  let rows = `<tr><td class="h">PL/CS/BX</td><td class="h" colspan="10">Item Description</td><td class="h">Total lb</td></tr>
    <tr><td></td>${Array.from({ length: 10 }, (_, i) => `<td class="h">${i + 1}</td>`).join("")}<td></td></tr>`;
  for (const l of lines) {
    const qty = `${casesOf(l) || ""}${lbsOf(l) ? `<span class="lbq">${esc(lbText(l.lbs))}#</span>` : ""}`;
    rows += `<tr><td class="q">${qty}</td><td class="d" colspan="10">${esc(l.code)}${l.tag ? "-" + esc(l.tag) : ""} ${esc(l.description)}`
      + `${l.note ? `<span class="ln">${esc(l.note)}</span>` : ""}</td><td></td></tr>`;
    for (let r = 0; r < Math.max(1, Math.ceil(estCases(l) / 10)); r++) rows += grid();
  }
  // Blank rows to the bottom of the page, as the paper sheet has them.
  for (let r = 0; r < 40; r++) {
    rows += r % 2 === 0 ? '<tr class="fill"><td class="q"></td><td class="d" colspan="10"></td><td></td></tr>'
      : `<tr class="fill">${gridCells}</tr>`;
  }
  const printed = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Order #${esc(order.orderNo)} — ${esc(order.customerName)}</title>
<style>
  @page { size: letter; margin: 0.4in 0.45in; }
  body { margin: 0; font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #000; }
  .paper { width: 7.6in; margin: 0 auto; font-size: 13.5px; display: flex; flex-direction: column; min-height: 10.1in; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 3px 5px; vertical-align: bottom; }
  .acct td { padding-bottom: 8px; vertical-align: middle; }
  .logo { height: 0.75in; width: auto; }
  .head td { font-size: 14.5px; }
  .head .v { border-bottom: 1px solid #000; font-weight: 700; }
  .grid { border: 1.5px solid #000; margin-top: 8px; }
  .grid td { border: 1px solid #000; height: 22px; }
  .grid .h { text-align: center; font-weight: 700; background: #f2f2f2; }
  .grid .q { width: 50px; text-align: center; font-weight: 700; font-size: 16px; }
  .grid .q .lbq { display: block; font-size: 12.5px; font-weight: 800; line-height: 1.1; }
  .grid .d { font-weight: 700; }
  .grid .d .ln { display: block; font-weight: 400; font-style: italic; }
  .grid .w { width: 8%; border-left: 1px dotted #555; border-right: 1px dotted #555; }
  .note { margin-top: 10px; border: 1.5px solid #000; }
  .note .nh { background: #f2f2f2; border-bottom: 1px solid #000; font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; padding: 3px 8px; }
  .note .nb { min-height: 40px; padding: 6px 8px; font-size: 14px; font-weight: 700; white-space: pre-wrap; }
  .foot td { padding-top: 12px; font-size: 14.5px; white-space: nowrap; }
  .foot .v { border-bottom: 1px solid #000; font-weight: 700; display: inline-block; min-width: 54px; text-align: center; }
  .stamp { margin-top: auto; padding-top: 12px; font-size: 11.5px; color: #555; display: flex; justify-content: space-between; }
  .no-print { text-align: center; margin: 12px 0; }
  @media print { .no-print { display: none; } }
</style></head><body>
<div class="no-print"><button onclick="window.print()" style="padding:8px 18px;font-size:14px;cursor:pointer">Print</button></div>
<div class="paper">
  <table class="acct"><tr><td style="width:30%">Order# <b>${esc(order.orderNo)}</b></td>
    <td style="text-align:center"><img class="logo" src="${logo}" alt="Adams Foods"></td>
    <td style="width:30%;text-align:right">${order.po ? `PO# <b>${esc(order.po)}</b>` : "Inv#_______________"}</td></tr></table>
  <table class="head"><tr><td style="width:90px">Customer</td><td class="v">${esc(order.customerName)}</td>
      <td style="width:50px;text-align:right">Date:</td><td class="v" style="width:120px">${esc(usDate(order.orderDate))}</td></tr>
    <tr><td>Ship/BL To</td><td class="v">${esc(order.shipTo || "")}</td><td style="text-align:right">Due:</td><td class="v">${esc(order.dueDay || "")}</td></tr></table>
  <table class="grid">${rows}</table>
  <div class="note"><div class="nh">ADDITIONAL NOTES</div><div class="nb">${esc(order.notes || "")}</div></div>
  <table class="foot"><tr><td>Order Qty: <span class="v">${esc(wantText(lines))}</span></td><td>Total cs: <span class="v"></span></td>
    <td>Total lb: <span class="v"></span></td><td>Assemb. by: <span class="v"></span></td><td>Check By: <span class="v"></span></td></tr></table>
  <div class="stamp"><span>PICK SHEET${order.status === "draft" ? " · DRAFT, not sent to the floor" : ""}</span><span>Printed ${esc(printed)}</span></div>
</div>
<script>
  // Blank rows only to the bottom of one page.
  (function () {
    var paper = document.querySelector(".paper");
    var fills = paper.querySelectorAll("tr.fill");
    var limit = 10.1 * 96;
    // Measured at its natural height, not the page-tall minimum.
    paper.style.minHeight = "0";
    for (var i = fills.length - 1; i >= 0 && paper.getBoundingClientRect().height > limit; i--) fills[i].remove();
    paper.style.minHeight = "";
  })();
</script>
</body></html>`;
  return printDocument(html, opened);
};

export default printPickSheet;
