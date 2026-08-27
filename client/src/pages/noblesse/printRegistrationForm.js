import ntiLogo from "../../assets/nti.jpg";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// Opens a printable "Registration Form" (Noblesse Trading Inc.) in a new tab.
// Pass a saved form object to print filled-in values, or omit for a blank template.
const printRegistrationForm = (form = {}) => {
  const win = window.open("", "_blank");
  if (!win) return;

  const val = (v) => (v === null || v === undefined || v === "" ? "" : esc(v));
  const wt = (v) => {
    if (!v && v !== 0) return "";
    const num = parseFloat(v);
    return isNaN(num) ? esc(v) : num.toFixed(2);
  };
  const checkbox = (checked) => `<span class="checkbox">${checked ? "&#10003;" : ""}</span>`;

  const row = (leftLabel, leftVal, rightLabel, rightVal, opts = {}) => `
    <tr>
      <td class="label">${leftLabel}</td>
      <td class="${opts.plain ? "plain-field" : "field"}">${leftVal}</td>
      <td class="label">${rightLabel}</td>
      <td class="${opts.plain ? "plain-field" : "field"}">${rightVal}</td>
    </tr>`;

  const fullRow = (label, value, opts = {}) => `
    <tr>
      <td class="label">${label}</td>
      <td class="field" colspan="3" style="height:${opts.tall ? "60px" : "auto"}">${value}</td>
    </tr>`;

  const sectionHeader = (title) => `
    <tr><td class="section" colspan="4">${title}</td></tr>`;

  const html = `
    <html>
      <head>
        <title>Registration Form${form.lotNumber ? " — " + esc(form.lotNumber) : ""}</title>
        <style>
          @page { size: letter; margin: 12mm; }
          html, body {
            margin: 20px 0 0 0; padding: 0;
            font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
            color: #1a1a1a;
          }
          .sheet {
            max-width: 720px; margin: 0 auto; padding: 16px;
            border: none;
          }
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
          td.plain-field {
            width: 23%; background: #f5f5f5; padding: 0px 12px 0px 24px; font-size: 14px; color: #333;
          }
          .checkbox {
            display: inline-flex; align-items: center; justify-content: center;
            width: 15px; height: 15px;
            border: 1px solid #1a1a1a; background: #fff; font-size: 12px; font-weight: 700;
          }
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
          @media print {
            .no-print { display: none; }
          }
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
              <div class="line">Lot#:<span class="fill">${val(form.lotNumber)}</span></div>
              <div class="line">Date:<span class="fill">${val(form.formDate)}</span></div>
            </div>
          </div>

          <div class="title">Registration Form</div>

          <table class="form">
            ${sectionHeader("Logistics &amp; Vendor")}
            ${row("Date Received", val(form.dateReceived), "Time Received", val(form.timeReceived))}
            ${row("Vendor Lot/(IC)#", val(form.vendorLot), "Vendor", val(form.vendor))}

            ${sectionHeader("Product Identification")}
            ${fullRow("Product Description", val(form.productDescription))}
            ${row("Processing Type", val(form.processingType), "Original Weight (lbs)", wt(form.originalWeight))}
            ${row("Spec.(##X##)", val(form.spec), "Brand", val(form.brand))}
            ${row("EST#", val(form.estNumber), "Grade", val(form.grade))}
            <tr><td colspan="4" class="separator"></td></tr>

            ${sectionHeader("Estimation/Checks")}
            ${row("Due Date?", val(form.dueDate), "Predicted Yield (%)", val(form.predictedYield) + (form.predictedYield ? "%" : ""))}
            ${row("Manifest/BL Attached?", checkbox(form.manifestBlAttached), "Process Report Attached?", checkbox(form.processReportAttached), { plain: true })}

            ${sectionHeader("Processing &amp; Yield")}
            ${row("Total Quantity (c/s)", wt(form.totalQuantity), "", "")}
            ${row("Processed Weight (lbs)", wt(form.processedWeight1), "(1)Processing Date(s)", val(form.processingDate1))}
            ${row("Processed Weight (lbs)", wt(form.processedWeight2), "(2)Processing Date(s)", val(form.processingDate2))}
            ${row("Actual Yield (%)", wt(form.actualYield) + (form.actualYield ? "%" : ""), "Temp", val(form.temp))}

            ${sectionHeader("Additional")}
            ${fullRow("Remarks", val(form.remarks), { tall: true })}

            <tr class="footer-row"><td colspan="4">Checked By${form.checkedBy ? ": " + val(form.checkedBy) : ""}</td></tr>
          </table>

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

export default printRegistrationForm;
