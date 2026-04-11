const router = require("express").Router();
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const PDF = require("../models/PDF");
const FreezerModel = require("../models/Freezer");
const verifyToken = require("../middleware/verifyToken");
const requireRole = require("../middleware/requireRole");
const { s3Client, upload } = require("../utils/aws");

router.post("/upload-pdf", verifyToken, requireRole("admin"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const fileKey = `pdfs/${Date.now()}-${req.file.originalname}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));
    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
    const savedPDF = await PDF.create({ fileName: req.file.originalname, fileKey, fileUrl, uploadDate: new Date().toISOString().split("T")[0] });
    res.status(201).json({ message: "File uploaded successfully", fileUrl, pdf: savedPDF });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message || "Error uploading file" });
  }
});

router.get("/list-pdfs", verifyToken, async (req, res) => {
  try {
    res.json(await PDF.find());
  } catch {
    res.status(500).json({ error: "An error occurred while retrieving the PDFs" });
  }
});

router.get("/list-scans", verifyToken, requireRole("admin"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const skip = (page - 1) * limit;
  try {
    const [items, total] = await Promise.all([
      FreezerModel.find(
        { scanImageKey: { $exists: true, $ne: null, $ne: "" } },
        { scanImageKey: 1, location: 1, lot: 1, species: 1, description: 1, date_recvd: 1, _id: 1 }
      ).sort({ _id: -1 }).skip(skip).limit(limit),
      FreezerModel.countDocuments({ scanImageKey: { $exists: true, $ne: null, $ne: "" } }),
    ]);

    const itemsWithUrls = await Promise.all(items.map(async (item) => {
      const signedUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: item.scanImageKey }),
        { expiresIn: 3600 }
      );
      return { ...item.toObject(), signedUrl };
    }));

    res.json({ items: itemsWithUrls, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve scan images" });
  }
});

router.get("/get-pdf", verifyToken, async (req, res) => {
  const key = req.query.key || "";
  if (!key.startsWith("pdfs/")) return res.status(400).json({ error: "Invalid key" });
  try {
    const { Body, ContentType } = await s3Client.send(new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key }));
    res.setHeader("Content-Type", ContentType);
    Body.pipe(res);
  } catch (error) {
    console.error("get-pdf error:", error);
    res.status(500).json({ error: error.message || "Error fetching PDF" });
  }
});

router.get("/get-scan-image", verifyToken, async (req, res) => {
  const key = req.query.key || "";
  if (!key.startsWith("scans/")) return res.status(400).json({ error: "Invalid key" });
  try {
    const { Body, ContentType } = await s3Client.send(new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key }));
    res.setHeader("Content-Type", ContentType || "image/jpeg");
    Body.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message || "Error fetching image" });
  }
});

router.delete("/delete-pdf/:id", verifyToken, async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) return res.status(404).json({ error: "PDF not found" });
    await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: pdf.fileKey }));
    await PDF.findByIdAndDelete(req.params.id);
    res.json({ message: "PDF deleted successfully" });
  } catch (error) {
    console.error("Delete PDF error:", error);
    res.status(500).json({ error: "Error deleting PDF" });
  }
});

module.exports = router;
