const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");

// The standard item descriptions a weighing session is picked from.
// Suggested, not enforced: a session may still carry any text. Nothing here is
// ever hard-deleted, so a name that has been used keeps meaning something.

const DIRECTIONS = new Set(["incoming", "outgoing"]);
const MAX_NAME = 120;
const MANAGERS = ["admin", "ntimanager"];

// One spelling per product: trimmed, single-spaced, upper case.
const normaliseName = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const fmt = (r) => ({
  id: r.id, direction: r.direction, name: r.name, active: r.active, uses: r.uses ?? 0,
});

router.get("/item-descriptions", verifyToken, async (req, res) => {
  const { direction } = req.query;
  if (direction != null && !DIRECTIONS.has(direction)) {
    return res.status(400).json({ error: "direction must be 'incoming' or 'outgoing'" });
  }
  const all = req.query.all === "1";
  try {
    // Uses are counted the way names are stored, so "Beef tongue " still counts.
    const result = await pool.query(
      `WITH used AS (
         SELECT direction, UPPER(REGEXP_REPLACE(TRIM(item_description), '\\s+', ' ', 'g')) AS name,
                COUNT(*)::int AS uses
           FROM box_batches
          WHERE tenant_id = $1 AND item_description IS NOT NULL
          GROUP BY 1, 2)
       SELECT d.id, d.direction, d.name, d.active, COALESCE(u.uses, 0) AS uses
         FROM item_descriptions d
         LEFT JOIN used u ON u.direction = d.direction AND u.name = d.name
        WHERE d.tenant_id = $1
          AND ($2::text IS NULL OR d.direction = $2)
          AND ($3 OR d.active)
        ORDER BY d.active DESC, uses DESC, d.name`,
      [req.tenantId, direction ?? null, all]
    );
    res.json(result.rows.map(fmt));
  } catch (err) {
    console.error("list item descriptions:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/item-descriptions", verifyToken, requireRole(...MANAGERS), async (req, res) => {
  const { direction } = req.body || {};
  const name = normaliseName(req.body?.name);
  if (!DIRECTIONS.has(direction)) {
    return res.status(400).json({ error: "direction must be 'incoming' or 'outgoing'" });
  }
  if (!name || name.length > MAX_NAME) {
    return res.status(400).json({ error: `name must be 1 to ${MAX_NAME} characters` });
  }
  try {
    // Adding a retired name brings it back rather than failing on the unique key.
    const result = await pool.query(
      `INSERT INTO item_descriptions (tenant_id, direction, name, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, direction, name) DO UPDATE SET active = true
       RETURNING *, (xmax = 0) AS created`,
      [req.tenantId, direction, name, req.userId || null]
    );
    const row = result.rows[0];
    res.status(row.created ? 201 : 200).json({ ...fmt(row), created: row.created });
  } catch (err) {
    console.error("add item description:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Retire or restore. There is no rename: retire the old name and add the new one.
router.patch("/item-descriptions/:id", verifyToken, requireRole(...MANAGERS), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  if (typeof req.body?.active !== "boolean") {
    return res.status(400).json({ error: "active must be true or false" });
  }
  try {
    const result = await pool.query(
      `UPDATE item_descriptions SET active = $1
        WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [req.body.active, id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(fmt(result.rows[0]));
  } catch (err) {
    console.error("update item description:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
module.exports.normaliseName = normaliseName;
