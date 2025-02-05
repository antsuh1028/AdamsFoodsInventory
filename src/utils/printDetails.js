const printDetails = (item) => {
    if (!item) return;
  
    const printWindow = window.open("", "_blank");
  
    let printContent = `
      <html>
        <head>
          <title>Print Label</title>
          <style>
            /* Ensure the printed page is A4 with no default margins */
            @page {
              size: A4;
              margin: 0;
            }
            html, body {
              width: 210mm;
              height: 297mm;
              margin: 0;
              padding: 0;
            }
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            /* Adjust the container to use most of the page with a small margin */
            .label-container {
              width: 190mm;
              height: 277mm;
              border: 2px solid black;
              padding: 10mm;
              box-sizing: border-box;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }
            .large-number {
              font-size: 100px;
              font-weight: bold;
              margin-bottom: 30px;
            }
            .table {
              width: 100%;
              border-collapse: collapse;
              font-size: 32px; /* Larger font size for better readability */
            }
            .table td, .table th {
              border: 2px solid black;
              padding: 15px; /* Increased padding */
              text-align: left;
            }
            .table th {
              font-weight: bold;
              background-color: #f8f8f8;
            }
            .bold {
              font-weight: bold;
            }
            .footer {
              font-size: 24px; /* Bigger footer text */
              font-weight: bold;
              margin-top: 30px;
            }
          </style>
        </head>
        <body>
          <div class="label-container">
            <div class="large-number" style="margin-top: 20%;">0001</div>
            <table class="table">
              <tr><th>LOT#</th><td class="bold">${item.lot || ""}</td></tr>
              <tr><th>Vendor</th><td class="bold">${item.vendor || ""}</td></tr>
              <tr><th>Date Rcvd</th><td>${item.date_recvd || ""}</td></tr>
              <tr><th>BRAND</th><td class="bold">${item.brand || ""}</td></tr>
              <tr><th>QTY (CASE)</th><td class="bold">${item.quantity || ""}</td></tr>
              <tr><th>Description</th><td>${item.description || ""}</td></tr>
            </table>
            <div class="footer">
              **RCVD TOTAL ${item.receivedTotal || ""} PALLETS OF ${item.palletCase || ""} CASE /PALLET
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
              window.close();
            }
          </script>
        </body>
      </html>`;
  
    printWindow.document.write(printContent);
    printWindow.document.close();
};
  
export default printDetails;
