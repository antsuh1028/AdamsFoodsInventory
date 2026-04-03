const mongoose = require("mongoose");

const PDFSchema = new mongoose.Schema({
  fileName: String,
  fileKey: String, // S3 key
  fileUrl: String, // S3 URL
  uploadDate: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("PDF", PDFSchema);
