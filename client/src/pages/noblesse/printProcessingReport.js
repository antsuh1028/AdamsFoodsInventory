import ntiLogo from "../../assets/nti.jpg";
import { fmtDateTime } from "./shared";
import { esc, printDocument } from "./printWindow";

// Opens a printable "Processing Report" in a new tab, laid out like the
// registration form so the two read as one document family — same masthead,
// same label/field grid, same section bars.
const printProcessingReport = (report = {}) => {
  const pulls = Array.isArray(report.pulls) ? report.pulls : [];
  const totalCases = pulls.reduce((sum, p) => sum + (Number(p && p.cases) || 0), 0);
  const inedible = report.inedibleWeight
    ? Number(report.inedibleWeight).toFixed(2) : "";

  // The paper sheet keeps its rows even when unused, so blanks are padded
  // rather than dropped — somebody writes in them by hand.
  const pullRow = (p, i) => `
    <tr>
      <td class="label">(${i + 1}) Cases</td>
      <td class="field" colspan="3">${p.cases ? `${esc(p.cases)} c/s` : ""}</td>
    </tr>`;
  const pullRows = Array.from(
    { length: Math.max(3, pulls.length) },
    (_, i) => pullRow(pulls[i] || {}, i)
  ).join("");

  const workers = Array.isArray(report.workers) ? report.workers : [];

  const row = (leftLabel, leftVal, rightLabel = "", rightVal = "") => `
    <tr>
      <td class="label">${leftLabel}</td>
      <td class="field">${leftVal}</td>
      <td class="label">${rightLabel}</td>
      <td class="field">${rightVal}</td>
    </tr>`;

  const fullRow = (label, value, opts = {}) => `
    <tr>
      <td class="label">${label}</td>
      <td class="field${opts.tall ? " tall" : ""}" colspan="3">${value}</td>
    </tr>`;

  const sectionHeader = (title) => `
    <tr><td class="section" colspan="4">${title}</td></tr>`;

  // Who filed it and who took it in. A printed copy that does not say this is
  // just a sheet of numbers.
  const acceptedOn = fmtDateTime(report.acceptedAt);
  const signOff = report.status === "accepted"
    // "reception" is the same default the screen shows for an unnamed accepter.
    ? `Accepted by ${esc(report.acceptedBy) || "reception"}${acceptedOn ? " on " + esc(acceptedOn) : ""}`
    : report.status === "rejected"
      ? `Sent back${report.rejectReason ? ": " + esc(report.rejectReason) : ""}`
      : "Awaiting reception";

  const html = `
    <html>
      <head>
        <title>Processing Report${report.lotNumber ? " — " + esc(report.lotNumber) : ""}</title>
        <style>
          @page { size: letter; margin: 12mm; }
          html, body {
            margin: 20px 0 0 0; padding: 0;
            font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
            color: #1a1a1a;
          }
          .sheet { max-width: 720px; margin: 0 auto; padding: 16px; }
          .header {
            display: flex; align-items: flex-start; justify-content: space-between;
            border-bottom: 2px solid #1f3864; padding-bottom: 8px; margin-bottom: 24px;
          }
          .brand img { width: 320px; max-width: 60%; object-fit: contain; display: block; }
          .brand .addr { font-size: 13px; color: #595959; margin-top: 4px; }
          .header-right { text-align: left; font-size: 21px; font-weight: 700; color: #1f3864; white-space: nowrap; }
          .header-right .line { margin-bottom: 16px; }
          .header-right .fill { font-weight: 700; color: #1a1a1a; margin-left: 12px; }
          .title {
            text-align: center; font-size: 23px; font-weight: 800; color: #1f3864;
            margin: 7px 0 7px;
          }
          table.form { width: 100%; border-collapse: separate; margin-bottom: 24px; border-spacing: 12px 16px; }
          td.section {
            background: #c9cace; font-weight: 700; font-size: 14px; color: #000000;
            padding: 8px 14px; height: auto;
          }
          td.label {
            width: 27%; text-align: right; font-weight: 600; font-size: 14px;
            color: #1f3864; padding: 0px 12px; background: #ffffff; vertical-align: middle;
          }
          td.field {
            width: 23%; background: #f5f5f5; padding: 0px 12px 0px 24px; font-size: 14px; color: #333;
          }
          td.total { background: #ffffff; font-weight: 700; font-size: 15px; }
          td.tall { height: 60px; }
          td.separator {
            border: none; border-top: 2px solid #999;
            height: 0; padding: 0; line-height: 0; font-size: 0;
          }
          .footer-row td {
            border-top: 1px solid #d9d9d9;
            text-align: left; font-weight: 700; font-size: 15px;
            padding: 5px 6px;
          }
          .no-print { text-align: center; margin: 14px 0; }
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
              <div class="line">Lot#:<span class="fill">${esc(report.lotNumber)}</span></div>
              <div class="line">Date:<span class="fill">${esc(report.processingDate)}</span></div>
            </div>
          </div>

          <div class="title">Processing Report</div>

          <table class="form">
            ${sectionHeader("Lot &amp; Run")}
            ${row("Processing Date", esc(report.processingDate), "Line #", esc(report.lineNo))}
            ${row("Started", esc(report.startTime), "Finished", esc(report.endTime))}
            ${fullRow("Processing Type", esc(report.processingType))}

            ${sectionHeader("Product")}
            ${fullRow("Description", esc(report.description))}
            ${row("Brand", esc(report.brand), "Grade", esc(report.grade))}
            ${row("EST#", esc(report.estNumber), "Customer", esc(report.customer))}
            ${fullRow("Pack Dates",
                      esc((report.packDates || []).join(", ") || report.packDate))}
            <tr><td colspan="4" class="separator"></td></tr>

            ${sectionHeader("Cases Processed")}
            ${pullRows}
            <tr>
              <td class="label">Total</td>
              <td class="field total" colspan="3">${totalCases} c/s</td>
            </tr>
            ${row("Inedible (lbs)", inedible)}

            ${sectionHeader("Crew &amp; Notes")}
            ${fullRow("Who Ran It", esc(workers.join(", ")))}
            ${fullRow("Remarks", esc(report.notes), { tall: true })}

            <tr class="footer-row"><td colspan="2">Submitted By${report.submittedBy ? ": " + esc(report.submittedBy) : ""}</td><td colspan="2">${signOff}</td></tr>
          </table>

          <div class="no-print">
            <button onclick="window.print()" style="padding:8px 18px;font-size:14px;cursor:pointer;">
              Print
            </button>
          </div>
        </div>
      </body>
    </html>`;

  printDocument(html);
};

export default printProcessingReport;
