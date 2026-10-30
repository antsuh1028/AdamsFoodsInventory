const router = require("express").Router();
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const heicConvert = require("heic-convert");
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { s3Client, upload } = require("../utils/aws");

// Problem reports: NTI staff write in, admin answers. Staff see only their own account's.

const MAX_BODY = 4000;
const isAdmin = (req) => req.role === "admin";
const clean = (v, max) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

// Admin sees every ticket; anyone else only the ones their account opened.
const visible = (req, alias = "t") => (isAdmin(req)
  ? { sql: `${alias}.tenant_id = $1`, params: [req.tenantId] }
  : { sql: `${alias}.tenant_id = $1 AND ${alias}.created_by = $2`, params: [req.tenantId, req.username] });

// Unread for whoever is asking: new staff messages for admin, new replies for staff.
const unreadSql = (req, alias = "t") => (isAdmin(req)
  ? `${alias}.last_staff_at > COALESCE(${alias}.admin_seen_at, 'epoch')`
  : `${alias}.last_admin_at > COALESCE(${alias}.author_seen_at, 'epoch')`);

const storeImage = async (req, ticketId) => {
  if (!req.file) return null;
  const mime = req.file.mimetype || "";
  if (!mime.startsWith("image/")) throw Object.assign(new Error("Only a photo or screenshot can be attached"), { status: 400 });
  const isHeic = mime.includes("heic") || mime.includes("heif");
  const body = isHeic
    ? Buffer.from(await heicConvert({ buffer: req.file.buffer, format: "JPEG", quality: 0.85 }))
    : req.file.buffer;
  const ext = isHeic ? "jpg" : (mime.split("/")[1] || "jpg").replace(/[^a-z0-9]/g, "");
  const key = `support/${req.tenantId}/${ticketId}/${Date.now()}.${ext}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME, Key: key, Body: body, ContentType: isHeic ? "image/jpeg" : mime,
  }));
  return key;
};

const signed = (key) => (key
  ? getSignedUrl(s3Client, new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key }), { expiresIn: 3600 })
  : null);

const shapeTicket = (r) => ({
  ticketId: r.ticket_id,
  createdBy: r.created_by,
  reporterName: r.reporter_name,
  screen: r.screen,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  unread: Boolean(r.unread),
  firstMessage: r.first_message ?? null,
  messageCount: r.message_count ?? null,
});

router.get("/support-tickets", verifyToken, async (req, res) => {
  const v = visible(req);
  const status = ["open", "fixed"].includes(req.query.status) ? req.query.status : null;
  const params = [...v.params];
  let where = v.sql;
  if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
  try {
    const { rows } = await pool.query(
      `SELECT t.*, ${unreadSql(req)} AS unread,
              (SELECT m.body FROM support_messages m WHERE m.ticket_id = t.ticket_id
                ORDER BY m.message_id LIMIT 1) AS first_message,
              (SELECT COUNT(*)::int FROM support_messages m WHERE m.ticket_id = t.ticket_id) AS message_count
         FROM support_tickets t
        WHERE ${where}
        ORDER BY (t.status = 'open') DESC, t.updated_at DESC
        LIMIT 200`, params);
    res.json(rows.map(shapeTicket));
  } catch (err) {
    console.error("list support tickets:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/support-tickets/unread", verifyToken, async (req, res) => {
  const v = visible(req);
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM support_tickets t WHERE ${v.sql} AND ${unreadSql(req)}`, v.params);
    res.json({ count: rows[0].n });
  } catch (err) {
    console.error("support unread:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/support-tickets", verifyToken, upload.single("image"), async (req, res) => {
  const body = clean(req.body?.body, MAX_BODY);
  if (!body && !req.file) return res.status(400).json({ error: "Write what happened or attach a photo" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(
      `INSERT INTO support_tickets (tenant_id, created_by, created_role, reporter_name, screen, last_staff_at, author_seen_at)
       VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING ticket_id`,
      [req.tenantId, req.username, req.role, clean(req.body?.name, 80), clean(req.body?.screen, 120)]);
    const ticketId = t.rows[0].ticket_id;
    const key = await storeImage(req, ticketId);
    await client.query(
      `INSERT INTO support_messages (ticket_id, author, from_admin, body, image_key) VALUES ($1, $2, $3, $4, $5)`,
      [ticketId, clean(req.body?.name, 80) || req.username, isAdmin(req), body, key]);
    await client.query("COMMIT");
    res.status(201).json({ ticketId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("create support ticket:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Opening a thread marks it read for whoever opened it.
router.get("/support-tickets/:id", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid ticket id" });
  const v = visible(req);
  try {
    const t = await pool.query(
      `UPDATE support_tickets t SET ${isAdmin(req) ? "admin_seen_at" : "author_seen_at"} = now()
        WHERE t.ticket_id = $${v.params.length + 1} AND ${v.sql} RETURNING t.*`, [...v.params, id]);
    if (!t.rows.length) return res.status(404).json({ error: "Report not found" });
    const m = await pool.query(
      `SELECT message_id, author, from_admin, body, image_key, created_at
         FROM support_messages WHERE ticket_id = $1 ORDER BY message_id`, [id]);
    const messages = await Promise.all(m.rows.map(async (r) => ({
      messageId: r.message_id,
      author: r.author,
      fromAdmin: r.from_admin,
      body: r.body,
      imageUrl: await signed(r.image_key),
      createdAt: r.created_at,
    })));
    res.json({ ...shapeTicket(t.rows[0]), messages });
  } catch (err) {
    console.error("read support ticket:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// A reply from staff reopens a fixed ticket; one from admin leaves the status alone.
router.post("/support-tickets/:id/messages", verifyToken, upload.single("image"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid ticket id" });
  const body = clean(req.body?.body, MAX_BODY);
  if (!body && !req.file) return res.status(400).json({ error: "Write a message or attach a photo" });
  const v = visible(req);
  const admin = isAdmin(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(
      `SELECT t.ticket_id FROM support_tickets t
        WHERE t.ticket_id = $${v.params.length + 1} AND ${v.sql} FOR UPDATE`, [...v.params, id]);
    if (!t.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Report not found" }); }
    const key = await storeImage(req, id);
    await client.query(
      `INSERT INTO support_messages (ticket_id, author, from_admin, body, image_key) VALUES ($1, $2, $3, $4, $5)`,
      [id, admin ? req.username : (clean(req.body?.name, 80) || req.username), admin, body, key]);
    await client.query(admin
      ? `UPDATE support_tickets SET last_admin_at = now(), admin_seen_at = now(), updated_at = now() WHERE ticket_id = $1`
      : `UPDATE support_tickets SET last_staff_at = now(), author_seen_at = now(), updated_at = now(), status = 'open' WHERE ticket_id = $1`,
      [id]);
    await client.query("COMMIT");
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("reply support ticket:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

router.patch("/support-tickets/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid ticket id" });
  if (!["open", "fixed"].includes(status)) return res.status(400).json({ error: "Status must be open or fixed" });
  try {
    const { rowCount } = await pool.query(
      `UPDATE support_tickets SET status = $1, updated_at = now(), last_admin_at = now()
        WHERE ticket_id = $2 AND tenant_id = $3`, [status, id, req.tenantId]);
    if (!rowCount) return res.status(404).json({ error: "Report not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("support ticket status:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
