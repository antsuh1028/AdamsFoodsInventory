const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");

// Auto-create table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS inventory_snapshots (
    id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0,
    snapshot JSONB NOT NULL
  )
`).catch((err) => console.error("Failed to create inventory_snapshots table:", err.message));

// Save a snapshot
router.post("/inventorySnapshot", verifyToken, async (req, res) => {
  const { snapshot, label } = req.body;
  if (!Array.isArray(snapshot)) return res.status(400).json({ error: "snapshot must be an array" });
  try {
    const result = await pool.query(
      `INSERT INTO inventory_snapshots (tenant_id, created_by, label, item_count, snapshot)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at, created_by, label, item_count`,
      [req.tenantId, req.username || "", label || "", snapshot.length, JSON.stringify(snapshot)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save snapshot" });
  }
});

// List snapshots (no data, just metadata)
router.get("/inventorySnapshots", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, created_at, created_by, label, item_count
       FROM inventory_snapshots WHERE tenant_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to list snapshots" });
  }
});

// Fetch a specific snapshot's data
router.get("/inventorySnapshot/:id", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, created_at, created_by, label, item_count, snapshot
       FROM inventory_snapshots WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Snapshot not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch snapshot" });
  }
});

module.exports = router;
