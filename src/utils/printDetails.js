import findItem from "../utils/homescreen/findItem.js";

const printDetails = (item) => {
  if (!item) return;

  // console.log("Fetching item details for location:", item.location);
  // console.log(item)

  findItem(
    { location: item.location },
    (result) => {
      console.log("Items found:", result);

      if (!result || result.length === 0) {
        console.log("No items found for this location.");
        return;
      }

      const packdates = result
        .map((i) => new Date(i.packdate))
        .filter((date) => !isNaN(date));

      const weights = result
        .map((i) => parseFloat(i.weight))
        .filter((w) => !isNaN(w));

      const quantities = result
        .map((i) => parseInt(i.quantity))
        .filter((q) => !isNaN(q));

      let packdateRange = "";
      if (packdates.length > 0) {
        const earliest = new Date(Math.min(...packdates))
          .toISOString()
          .split("T")[0];
        const latest = new Date(Math.max(...packdates))
          .toISOString()
          .split("T")[0];
        packdateRange =
          earliest === latest
            ? `PD: ${earliest}`
            : `PD: ${earliest} - ${latest}`;
      }

      const totalWeight = weights.reduce((sum, w) => sum + w, 0).toFixed(2);

      const totalQuantity = quantities.reduce((sum, q) => sum + q, 0);

      const printWindow = window.open("", "_blank");

      let printContent = `
        <html>
          <head>
            <title>Print Label</title>
            <style>
              @page {
                size: A4;
                margin: 2mm;
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
                width: 205mm;
                max-height: 290mm;
                border: 2px solid black;
                padding: 3mm;
                box-sizing: border-box;
                margin: auto;
              }
              .inner-container {
                border: 1px solid black;
                padding: 2mm;
              }
              .table {
                width: 100%;
                border-collapse: collapse;
                table-layout: fixed;
              }
              .table-content {
                font-weight: bold;
                line-height: 1;
                padding: 5px 10px;
                word-break: break-word;
              }
              .location-row th, .location-row td {
                font-size: 120%;  
                font-weight: bold;
                padding: 10px !important;
              }
              .species-row td {
                  font-size: 90%;
                  font-weight: bold;
                  padding: 5px !important;
                  border-top: 2px solid black;
                  text-transform: uppercase; 
              }


              .description-content {
                font-weight: bold;
                line-height: 1.1;
                word-break: break-word;
              }
              .table td, .table th {
                border: 1px solid black;
                padding: 5px 10px;
                text-align: left;
              }
              .table th {
                font-weight: bold;
                width: 22%;
                white-space: nowrap;
                overflow: hidden;
              }
              @media print {
                body {
                  transform: scale(0.99);
                }
                .table {
                  page-break-inside: avoid;
                }
              }
            </style>
          </head>
          <body>
            <div class="label-container">
              <div class="inner-container">
                <table class="table" id="detailsTable">
                  <tr class="location-row">
                    <th>Location</th>
                    <td class="table-content">${item.location || ""}</td>
                  </tr>
                  <tr><th>LOT#</th><td class="table-content">${item.lot || ""}</td></tr>
                  <tr><th>Vendor</th><td class="table-content">${item.vendor || ""}</td></tr>
                  <tr><th>Date Rcvd</th><td class="table-content">${item.date_recvd || ""}</td></tr>
                  <tr><th>BRAND</th><td class="table-content">${item.brand || ""}</td></tr>
                  <tr><th>QTY (CS)</th><td class="table-content">${totalQuantity}</td></tr>
                  <tr><th>Total Weight</th><td class="table-content">${totalWeight} lbs</td></tr>
                  <tr>
                    <th>Description</th>
                    <td class="description-content">${item.description || ""} ${packdateRange ? `<br>${packdateRange}` : ""}</td>
                  </tr>
                  <tr class="species-row">
                    <th>Species</th>
                    <td class="table-content">${item.species || ""}</td>
                  </tr>
                </table>
              </div>
            </div>
            <script>
              function dynamicFontSize() {
                const container = document.querySelector(".label-container");
                const table = document.getElementById("detailsTable");
                const headers = document.querySelectorAll(".table th");
                const contents = document.querySelectorAll(".table-content");
                const descriptions = document.querySelectorAll(".description-content");
                
                let headerSize = 28;
                let contentSize = 70;
                let descriptionSize = 70;
                
                function checkFit() {
                  // Set sizes
                  headers.forEach(header => header.style.fontSize = headerSize + 'px');
                  contents.forEach(content => content.style.fontSize = contentSize + 'px');
                  descriptions.forEach(desc => desc.style.fontSize = descriptionSize + 'px');
                  
                  // Check if content fits
                  return table.offsetHeight <= container.offsetHeight * 0.95;
                }
                
                // Binary search for optimal font size
                while (!checkFit() && contentSize > 40) {
                  contentSize -= 5;
                  descriptionSize = contentSize * 0.875;
                  headerSize = contentSize * 0.4;
                }
              }

              window.onload = function() {
                // Initial render
                dynamicFontSize();
                
                // Wait a bit and check again
                setTimeout(() => {
                  dynamicFontSize();
                  // Wait for final render before printing
                  setTimeout(() => {
                    window.print();
                    window.close();
                  }, 200);
                }, 100);
              }
            </script>
          </body>
        </html>`;

      printWindow.document.write(printContent);
      printWindow.document.close();
    },
    null,
    null
  );
};

export default printDetails;
