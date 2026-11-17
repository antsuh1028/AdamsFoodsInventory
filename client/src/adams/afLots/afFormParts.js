import { esc } from "../../noblesse/common/printWindow";

// What the AdamsFoods Incoming Form and Pallet Receiving Sheet share: black and white, write-in lines, one page.

export const val = (x) => (x === null || x === undefined || x === "" ? "" : esc(x));

export const field = (label, value = "", span = 1) =>
  `<div class="f"${span > 1 ? ` style="grid-column: span ${span}"` : ""}><span class="l">${label}</span><span class="v">${val(value)}</span></div>`;

export const check = (label, checked = false) =>
  `<span class="cb"><span class="sq">${checked ? "&#10003;" : ""}</span>${label}</span>`;

export const pacificDay = (when) =>
  (when ? new Date(when).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) : "");

// The ruled box top right: label and value pairs.
export const idBox = (pairs) =>
  `<div class="ids">${pairs.map(([label, value]) => `<div>${label}</div><div><b>${val(value)}</b></div>`).join("")}</div>`;

export const FORM_CSS = `
  @page { size: letter; margin: 0.45in 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .paper { width: 7.5in; margin: 0 auto; font-size: 12.5px; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 10px; border-bottom: 3px solid #000; }
  .top img { height: 0.65in; width: auto; display: block; }
  .ids { display: grid; grid-template-columns: auto 1.7in; border: 1.5px solid #000; }
  .ids div { padding: 3px 8px; min-height: 24px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid #000; }
  .ids div:nth-child(odd) { border-right: 1px solid #000; }
  .ids div:nth-last-child(-n+2) { border-bottom: 0; }
  .ids b { font-size: 15px; letter-spacing: 0; text-transform: none; }
  h1 { margin: 10px 0 2px; font-size: 22px; letter-spacing: 0.28em; text-align: center; font-weight: 800; }
  .sub { text-align: center; font-size: 11px; letter-spacing: 0.06em; margin-bottom: 8px; }
  .manifest { display: flex; align-items: center; gap: 14px; border: 3px solid #000; padding: 9px 14px; }
  .manifest .big { width: 26px; height: 26px; border: 2.5px solid #000; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; flex: none; }
  .manifest b { font-size: 17px; letter-spacing: 0.06em; }
  h2 { margin: 11px 0 5px; font-size: 11.5px; letter-spacing: 0.14em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
  h2 .k { display: inline-flex; width: 18px; height: 18px; border: 1.5px solid #000; border-radius: 50%; align-items: center; justify-content: center; font-size: 10.5px; letter-spacing: 0; }
  h2::after { content: ""; flex: 1; border-top: 1px solid #000; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px 18px; }
  .grid.two { grid-template-columns: repeat(2, 1fr); }
  .grid.four { grid-template-columns: repeat(4, 1fr); }
  .f { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .f .l { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
  .f .v { border-bottom: 1px solid #000; min-height: 20px; padding: 3px 2px 1px; font-size: 13.5px; font-weight: 700; }
  .checks { display: flex; gap: 22px; margin-top: 8px; flex-wrap: wrap; }
  .cb { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
  .sq { width: 13px; height: 13px; border: 1.3px solid #000; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
  .total { display: flex; justify-content: flex-end; gap: 22px; margin-top: 5px; font-size: 12px; }
  .total b { font-size: 14px; }
  .remarks { border: 1px solid #000; padding: 6px 8px 2px; }
  .remarks .line { border-bottom: 1px dotted #000; min-height: 20px; font-size: 13px; font-weight: 700; padding-top: 4px; }
  .remarks .line:last-child { border-bottom: 0; }
  .sign { display: grid; grid-template-columns: 1.6fr 1fr 1.6fr 1fr; gap: 10px 14px; margin-top: 12px; }
  .stamp { margin-top: 10px; display: flex; justify-content: space-between; font-size: 10px; letter-spacing: 0.04em; }
  .no-print { text-align: center; margin: 12px 0; }
  @media print { .no-print { display: none; } }
`;

export const PRINT_BUTTON =
  '<div class="no-print"><button onclick="window.print()" style="padding:8px 18px;font-size:14px;cursor:pointer">Print</button></div>';

// Always one page: anything taller is shrunk to fit, never run onto a second sheet.
export const FIT_ONE_PAGE = `<script>
  (function () {
    var paper = document.querySelector(".paper");
    var limit = (11 - 0.9) * 96 - 8;
    var h = paper.getBoundingClientRect().height;
    if (h > limit) paper.style.zoom = String(limit / h);
  })();
</script>`;
