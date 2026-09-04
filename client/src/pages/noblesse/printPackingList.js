import { toDisplay } from "../../utils/weight";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// The packing list for an outgoing load: one line per lot, with a total.
//
// Deliberately NOT the tally sheet. The tally is the box-level document — ten
// weights to a row, reconciled against a pallet — and it already exists for a
// load that was weighed. This is the summary that travels with the truck, so it
// is one line per lot and nothing else.
//
// Weights are decimal strings all the way through and summed in integer
// thousandths, so the column adds up to the printed total exactly. A float
// accumulator drifts, and the total on a shipping document is the figure a
// customer checks first.

const toThousandths = (s) => {
  const [whole, frac = ""] = String(s ?? "0").split(".");
  return (parseInt(whole, 10) || 0) * 1000 + (parseInt((frac + "000").slice(0, 3), 10) || 0);
};

const fromThousandths = (n) => {
  const whole = Math.floor(n / 1000);
  const frac = String(n % 1000).padStart(3, "0");
  return `${whole}.${frac}`;
};

const printPackingList = (shipment = {}) => {
  const win = window.open("", "_blank");
  if (!win) return;

  const items = Array.isArray(shipment.items) ? shipment.items : [];
  const totalThousandths = items.reduce((acc, i) => acc + toThousandths(i.weight), 0);
  const totalCases = items.reduce((acc, i) => acc + (Number(i.qtyCases) || 0), 0);

  const rows = items.map((i, n) => `
    <tr>
      <td class="n">${n + 1}</td>
      <td class="lot">${esc(i.lotNumber || "—")}</td>
      <td>${esc(i.description || "")}</td>
      <td class="stage">${i.stage === "raw" ? "Raw" : ""}</td>
      <td class="num">${i.qtyCases != null ? esc(i.qtyCases) : ""}</td>
      <td class="num">${esc(toDisplay(i.weight))}</td>
    </tr>`).join("");

  const html = `
    <html>
      <head>
        <title>Packing List ${esc(shipment.billOfLading || shipment.shipmentId || "")}</title>
        <style>
          @page { size: letter portrait; margin: 20mm 14mm 14mm; }
          html, body {
            margin: 0; padding: 0; color: #000; font-size: 11px;
            font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
          }
          .sheet { max-width: 760px; margin: 0 auto; }
          h1 { text-align: center; font-size: 24px; font-style: italic; font-weight: 700; margin: 14px 0 4px; }
          .sub { text-align: center; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 18px; }
          table.head { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
          table.head td { padding: 3px 4px; font-size: 12px; vertical-align: bottom; }
          .lbl { width: 90px; white-space: nowrap; color: #444; }
          .val { border-bottom: 1px solid #000; }
          table.grid { width: 100%; border-collapse: collapse; border: 1.5px solid #000; }
          table.grid th, table.grid td { border: 1px solid #000; padding: 6px 6px; }
          table.grid th {
            font-size: 11px; font-weight: 400; text-transform: uppercase;
            letter-spacing: .04em; background: #f0f0f0;
          }
          td.n { width: 34px; text-align: right; color: #666; }
          td.lot { font-weight: 700; white-space: nowrap; }
          td.stage { width: 44px; font-size: 10px; color: #a04000; }
          td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
          tr.total td { border-top: 1.5px solid #000; font-weight: 700; padding-top: 8px; }
          tr.total .big { font-size: 18px; font-variant-numeric: tabular-nums; }
          table.sign { width: 100%; border-collapse: collapse; margin-top: 26px; }
          table.sign td { padding: 12px 4px 2px; font-size: 11px; border-bottom: 1px solid #000; }
          table.sign td.gap { border-bottom: none; width: 30px; }
          .no-print { text-align: center; margin: 16px 0; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <h1>Noblesse Trading</h1>
          <div class="sub">Packing List</div>

          <table class="head">
            <tr>
              <td class="lbl">Ship To</td>
              <td class="val">${esc(shipment.destinationName || "")}${
                shipment.shipTo ? ` — ${esc(shipment.shipTo)}` : ""}</td>
              <td class="lbl" style="width:60px">Date</td>
              <td class="val" style="width:150px">${esc(shipment.shipDate || "")}</td>
            </tr>
            <tr>
              <td class="lbl">Bill of Lading</td>
              <td class="val">${esc(shipment.billOfLading || "")}</td>
              <td class="lbl">Carrier</td>
              <td class="val">${esc(shipment.carrier || "")}</td>
            </tr>
            <tr>
              <td class="lbl">Driver</td>
              <td class="val">${esc(shipment.driver || "")}</td>
              <td class="lbl">Shipment</td>
              <td class="val">#${esc(shipment.shipmentId || "")}</td>
            </tr>
          </table>

          <table class="grid">
            <tr>
              <th></th>
              <th>Lot #</th>
              <th>Description</th>
              <th></th>
              <th class="num">Cases</th>
              <th class="num">Weight (lbs)</th>
            </tr>
            ${rows || '<tr><td colspan="6" style="text-align:center;color:#888;padding:18px">No lots on this load</td></tr>'}
            <tr class="total">
              <td colspan="4">Total &mdash; ${items.length} lot${items.length === 1 ? "" : "s"}</td>
              <td class="num big">${totalCases || ""}</td>
              <td class="num big">${toDisplay(fromThousandths(totalThousandths))}</td>
            </tr>
          </table>

          ${shipment.notes ? `<div style="margin-top:10px;font-size:11px">${esc(shipment.notes)}</div>` : ""}
          ${items.some((i) => i.stage === "raw")
            ? '<div style="margin-top:8px;font-size:10px;color:#a04000">Raw = shipped unprocessed.</div>'
            : ""}

          <table class="sign">
            <tr>
              <td>SHIPPED BY</td>
              <td class="gap"></td>
              <td>RECEIVED BY</td>
            </tr>
          </table>

          <div class="no-print">
            <button onclick="window.print()">Print</button>
          </div>
        </div>
      </body>
    </html>`;

  win.document.write(html);
  win.document.close();
};

export default printPackingList;
