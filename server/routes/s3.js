const router = require("express").Router();
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { s3Client, upload } = require("../utils/aws");

// Auto-create pdfs table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS pdfs (
    id        SERIAL PRIMARY KEY,
    tenant_id TEXT,
    file_name TEXT,
    file_key  TEXT,
    file_url  TEXT,
    upload_date TIMESTAMPTZ DEFAULT NOW(),
    created_at  TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {});

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
    const result = await pool.query(
      `INSERT INTO pdfs (tenant_id, file_name, file_key, file_url) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.tenantId || null, req.file.originalname, fileKey, fileUrl]
    );
    res.status(201).json({ message: "File uploaded successfully", fileUrl, pdf: result.rows[0] });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message || "Error uploading file" });
  }
});

router.get("/list-pdfs", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pdfs WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY created_at DESC`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "An error occurred while retrieving the PDFs" });
  }
});

router.get("/list-scans", verifyToken, requireRole("admin", "manager"), async (req, res) => {
  const limit = 500;

  try {
    const [itemsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT id, location, lot, species, description, date_recvd, scan_image_key
         FROM inventory
         WHERE tenant_id = $1 AND scan_image_key IS NOT NULL AND scan_image_key != ''
         ORDER BY id DESC LIMIT $2`,
        [req.tenantId, limit]
      ),
      pool.query(
        `SELECT COUNT(*) FROM inventory WHERE tenant_id = $1 AND scan_image_key IS NOT NULL AND scan_image_key != ''`,
        [req.tenantId]
      ),
    ]);

    const total = parseInt(countRes.rows[0].count);

    const itemsWithUrls = await Promise.all(itemsRes.rows.map(async (item) => {
      const signedUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: item.scan_image_key }),
        { expiresIn: 3600 }
      );
      return { ...item, scanImageKey: item.scan_image_key, signedUrl };
    }));

    res.json({ items: itemsWithUrls, total });
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
    const { rows } = await pool.query(`SELECT * FROM pdfs WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "PDF not found" });
    await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: rows[0].file_key }));
    await pool.query(`DELETE FROM pdfs WHERE id = $1`, [req.params.id]);
    res.json({ message: "PDF deleted successfully" });
  } catch (error) {
    console.error("Delete PDF error:", error);
    res.status(500).json({ error: "Error deleting PDF" });
  }
});

module.exports = router;
