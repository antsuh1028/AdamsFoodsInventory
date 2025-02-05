const printDetails = (item) => {
  if (!item) return;

  const printWindow = window.open("", "_blank");

  let printContent = `
    <html>
      <head>
        <title>Print Label</title>
        <style>
          @page {
            size: A4;
            margin: 5mm;
          }
          html, body {
            width: 210mm;
            height: 297mm;
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .label-container {
            width: 200mm;
            height: 287mm;
            border: 2px solid black;
            padding: 8mm;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .large-number {
            font-size: 120px;
            font-weight: bold;
            margin-bottom: 20px;
          }
          .table {
            width: 100%;
            border-collapse: collapse;
            font-size: 36px;
          }
          .table-content {
            font-size: 60px;
            font-weight: bold;
          }
          .table td, .table th {
            border: 2px solid black;
            padding: 12px;
            text-align: left;
          }
          .table th {
            font-weight: bold;
            background-color: #f8f8f8;
          }
          .footer {
            font-size: 30px;
            font-weight: bold;
            margin-top: 20px;
          }
          @media print {
            body {
              transform: scale(0.98);
            }
          }
        </style>
      </head>
      <body>
        <div class="label-container">
          <div class="large-number" id="largeNumber">0001</div>
          <table class="table" id="detailsTable">
            <tr><th>LOT#</th><td class="table-content">${item.lot || ""}</td></tr>
            <tr><th>Vendor</th><td class="table-content">${item.vendor || ""}</td></tr>
            <tr><th>Date Rcvd</th><td class="table-content">${item.date_recvd || ""}</td></tr>
            <tr><th>BRAND</th><td class="table-content">${item.brand || ""}</td></tr>
            <tr><th>QTY (CASE)</th><td class="table-content">${item.quantity || ""}</td></tr>
            <tr>
              <th>Description</th>
              <td class="table-content">${item.description || ""} <br> PD: ${item.packdate || ""}</td>
            </tr>
          </table>
          <div class="footer">
            **RCVD TOTAL ${item.receivedTotal || ""} PALLETS OF ${item.palletCase || ""} CASE/PALLET
          </div>
        </div>
        <script>
          function adjustFontSize() {
            let container = document.querySelector(".label-container");
            let detailsTable = document.getElementById("detailsTable");
            let largeNumber = document.getElementById("largeNumber");

            let maxHeight = container.clientHeight;
            let contentHeight = detailsTable.clientHeight + largeNumber.clientHeight + 100;

            if (contentHeight > maxHeight) {
              let scaleFactor = maxHeight / contentHeight;
              let newFontSize = Math.max(26, 52 * scaleFactor);
              document.querySelectorAll(".table-content").forEach(el => el.style.fontSize = newFontSize + "px");
              largeNumber.style.fontSize = Math.max(80, 100 * scaleFactor) + "px";
            }
          }

          window.onload = function() {
            adjustFontSize();
            setTimeout(() => {
              window.print();
              window.close();
            }, 300);
          }
        </script>
      </body>
    </html>`;

  printWindow.document.write(printContent);
  printWindow.document.close();
};

export default printDetails;