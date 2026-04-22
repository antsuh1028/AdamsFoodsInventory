const router = require("express").Router();
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { s3Client, upload } = require("../utils/aws");
const pool = require("../utils/pg");

// Ensure pdfs table exists (runs once on first request, no-op after)
let tableReady = false;
async function ensurePdfsTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pdfs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
      file_name   TEXT,
      file_key    TEXT,
      file_url    TEXT,
      upload_date TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  tableReady = true;
}

router.post("/upload-pdf", verifyToken, requireRole("admin"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    await ensurePdfsTable();
    const fileKey = `pdfs/${Date.now()}-${req.file.originalname}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));
    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
    const uploadDate = new Date().toISOString().split("T")[0];
    const result = await pool.query(
      `INSERT INTO pdfs (tenant_id, file_name, file_key, file_url, upload_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.tenantId, req.file.originalname, fileKey, fileUrl, uploadDate]
    );
    res.status(201).json({ message: "File uploaded successfully", fileUrl, pdf: result.rows[0] });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message || "Error uploading file" });
  }
});

router.get("/list-pdfs", verifyToken, async (req, res) => {
  try {
    await ensurePdfsTable();
    const result = await pool.query(
      `SELECT * FROM pdfs WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [req.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "An error occurred while retrieving the PDFs" });
  }
});

router.get("/list-scans", verifyToken, requireRole("admin"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  try {
    const [items, countRes] = await Promise.all([
      pool.query(
        `SELECT id, scan_image_key, location, lot, species, description, date_recvd
         FROM inventory
         WHERE tenant_id = $1 AND scan_image_key IS NOT NULL AND scan_image_key != ''
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.tenantId, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM inventory
         WHERE tenant_id = $1 AND scan_image_key IS NOT NULL AND scan_image_key != ''`,
        [req.tenantId]
      ),
    ]);

    const total = parseInt(countRes.rows[0].count);
    const itemsWithUrls = await Promise.all(items.rows.map(async (item) => {
      const signedUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: item.scan_image_key }),
        { expiresIn: 3600 }
      );
      return { ...item, scanImageKey: item.scan_image_key, signedUrl };
    }));

    res.json({ items: itemsWithUrls, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("list-scans error:", err);
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
    await ensurePdfsTable();
    const result = await pool.query(
      `DELETE FROM pdfs WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "PDF not found" });
    await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: result.rows[0].file_key }));
    res.json({ message: "PDF deleted successfully" });
  } catch (error) {
    console.error("Delete PDF error:", error);
    res.status(500).json({ error: "Error deleting PDF" });
  }
});

module.exports = router;
