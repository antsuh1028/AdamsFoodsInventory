const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");

// Auto-migrate
pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS old_data JSONB`).catch(() => {});
pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS scan_image_key TEXT`).catch(() => {});

router.post("/addHistory", verifyToken, requireRole("admin", "manager"), async (req, res) => {
  const { change, location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est } = req.body;
  if (!change) return res.status(400).json({ error: "Change type is required" });
  try {
    const result = await pool.query(
      `INSERT INTO history (tenant_id, time, change, changed_by, location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        req.tenantId, new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }), change, req.username || "",
        location || "", lot || "", vendor || "", brand || "", species || "",
        description || "", grade || "", String(quantity || ""), String(weight || ""),
        packdate || "", date_recvd || "", est || "",
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error adding history item" });
  }
});

const CHANGE_FILTER_SQL = {
  added:      `change IN ('Added', 'Scanner Add', 'Restored')`,
  updated:    `(change ILIKE 'Field Updated%' OR change = 'Updated' OR LOWER(change) = 'before update')`,
  removed:    `change ILIKE 'Removed%'`,
  production: `(change ILIKE 'Sent to Processor%' OR change ILIKE 'Returned from Processor%' OR change ILIKE 'Production Order%')`,
  box:        `change ILIKE '%box%'`,
};

router.get("/getHistory", verifyToken, requireRole("admin", "manager"), async (req, res) => {
  const LIMIT = 100;
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const search = req.query.search?.trim() || "";
  const changeFilter = req.query.changeFilter?.trim() || "";

  const SEARCH_COLS = ["location", "lot", "brand", "species", "description", "vendor", "change", "changed_by"];

  let where = "WHERE tenant_id = $1";
  let params = [req.tenantId];

  if (search) {
    const like = `%${search}%`;
    const clause = SEARCH_COLS.map((col, i) => `${col} ILIKE $${i + 2}`).join(" OR ");
    where += ` AND (${clause})`;
    params = [req.tenantId, ...SEARCH_COLS.map(() => like)];
  }

  if (changeFilter && CHANGE_FILTER_SQL[changeFilter]) {
    where += ` AND ${CHANGE_FILTER_SQL[changeFilter]}`;
  }

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  try {
    const [result, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM history ${where} ORDER BY created_at DESC, id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, LIMIT, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM history ${where}`, params),
    ]);
    const total = parseInt(countResult.rows[0].count);
    const getCategory = (change = "") => {
      const c = change.toLowerCase();
      if (c.includes("box")) return "box";
      return "other";
    };
    res.json({
      items: result.rows.map((r) => ({
        ...r,
        _id: r.id,
        changedBy: r.changed_by,
        time: r.time,
        category: getCategory(r.change),
        oldData: r.old_data || null,
      })),
      total,
      offset,
      hasMore: offset + result.rows.length < total,
    });
  } catch (err) {
    res.status(500).json({ error: "Unable to retrieve history" });
  }
});

module.exports = router;
