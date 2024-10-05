// const XLSX = require("xlsx");
// const path = require("path");
// const fs = require("fs");

// // Exportable function to log actions to Excel
// const addToHistory = (action, item, userId) => {
//   const filePath = path.join(__dirname, "../public", "AFHistoryLog.xlsx");

//   // Load or create the workbook
//   let workbook;
//   let worksheet;

//   if (fs.existsSync(filePath)) {
//     workbook = XLSX.readFile(filePath);
//     worksheet = workbook.Sheets[workbook.SheetNames[0]];
//   }

//   // Convert worksheet to a JSON array (for easier manipulation)
//   const logs = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

//   // Add a new log entry
//   const timestamp = new Date().toISOString();
//   const newRow = [action, JSON.stringify(item), userId, timestamp]; // Add data row
//   logs.push(newRow);

//   // Convert the updated logs back to a worksheet and save the file
//   const updatedWorksheet = XLSX.utils.aoa_to_sheet(logs);
//   workbook.Sheets[workbook.SheetNames[0]] = updatedWorksheet;

//   // Save the updated workbook back to the public folder
//   XLSX.writeFile(workbook, filePath);
// };

// module.exports = addToHistory;
