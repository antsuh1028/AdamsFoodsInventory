const router = require("express").Router();
const pool   = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");

// Idempotent migrations
pool.query(`
  CREATE TABLE IF NOT EXISTS noblesse_receipts (
    id               SERIAL PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    shipment_date    DATE,
    bol_number       TEXT,
    driver           TEXT,
    linked_order_id  INTEGER,
    lines            JSONB NOT NULL DEFAULT '[]',
    status           TEXT NOT NULL DEFAULT 'received',
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((err) => console.error("noblesse_receipts migration error:", err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS nti_inventory (
    id            SERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    lot           TEXT,
    description   TEXT,
    brand         TEXT,
    species       TEXT,
    est           TEXT,
    pack_date     DATE,
    weight        NUMERIC,
    qty_cases     INTEGER,
    qty_pallets   INTEGER,
    received_date DATE,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((err) => console.error("nti_inventory migration error:", err.message));

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtReceipt = (row) => ({
  id:            row.id,
  shipmentDate:  row.shipment_date,
  bolNumber:     row.bol_number,
  driver:        row.driver,
  linkedOrderId: row.linked_order_id,
  lines:         Array.isArray(row.lines) ? row.lines : [],
  status:        row.status,
  notes:         row.notes,
  createdAt:     row.created_at,
});

const fmtDate = (d) => d instanceof Date ? d.toISOString().slice(0, 10) : (d || null);

const fmtNtiItem = (row) => ({
  id:           row.id,
  lot:          row.lot,
  description:  row.description,
  brand:        row.brand,
  species:      row.species,
  est:          row.est,
  packDate:     fmtDate(row.pack_date),
  weight:       row.weight != null ? Number(row.weight) : null,
  qtyCases:     row.qty_cases,
  qtyPallets:   row.qty_pallets,
  receivedDate: fmtDate(row.received_date),
  notes:        row.notes,
  createdAt:    row.created_at,
});

// ── Receipts ──────────────────────────────────────────────────────────────────

router.get("/noblesse-receipts", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM noblesse_receipts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.tenantId]
    );
    res.json(result.rows.map(fmtReceipt));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/noblesse-receipts", verifyToken, async (req, res) => {
  const { shipmentDate, bolNumber, driver, linkedOrderId, lines, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO noblesse_receipts (tenant_id, shipment_date, bol_number, driver, linked_order_id, lines, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.tenantId,
        shipmentDate  || null,
        bolNumber     || null,
        driver        || null,
        linkedOrderId || null,
        JSON.stringify(lines || []),
        notes         || null,
      ]
    );
    res.json(fmtReceipt(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/noblesse-receipts/:id/status", verifyToken, async (req, res) => {
  const { status } = req.body;
  const VALID = ["received", "processing", "completed"];
  if (!VALID.includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const result = await pool.query(
      `UPDATE noblesse_receipts SET status = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [status, req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(fmtReceipt(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── NTI Inventory ─────────────────────────────────────────────────────────────

router.get("/nti-inventory", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM nti_inventory WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [req.tenantId]
    );
    res.json(result.rows.map(fmtNtiItem));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/nti-inventory", verifyToken, async (req, res) => {
  const { lot, description, brand, species, est, packDate, weight, qtyCases, qtyPallets, receivedDate, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO nti_inventory (tenant_id, lot, description, brand, species, est, pack_date, weight, qty_cases, qty_pallets, received_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.tenantId,
        lot          || null,
        description  || null,
        brand        || null,
        species      || null,
        est          || null,
        packDate     || null,
        weight != null ? Number(weight) : null,
        qtyCases  != null ? Number(qtyCases)  : null,
        qtyPallets != null ? Number(qtyPallets) : null,
        receivedDate || null,
        notes        || null,
      ]
    );
    res.json(fmtNtiItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/nti-inventory/:id", verifyToken, async (req, res) => {
  const { lot, description, brand, species, est, packDate, weight, qtyCases, qtyPallets, receivedDate, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE nti_inventory
       SET lot=$1, description=$2, brand=$3, species=$4, est=$5, pack_date=$6,
           weight=$7, qty_cases=$8, qty_pallets=$9, received_date=$10, notes=$11
       WHERE id=$12 AND tenant_id=$13
       RETURNING *`,
      [
        lot          || null,
        description  || null,
        brand        || null,
        species      || null,
        est          || null,
        packDate     || null,
        weight != null ? Number(weight) : null,
        qtyCases  != null ? Number(qtyCases)  : null,
        qtyPallets != null ? Number(qtyPallets) : null,
        receivedDate || null,
        notes        || null,
        req.params.id,
        req.tenantId,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(fmtNtiItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/nti-inventory/:id", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM nti_inventory WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Production items flat list (for discrepancy check) ────────────────────────
// Returns all items across all pending production orders as a flat array.

router.get("/nti-production-items", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         poi.id, poi.production_order_id AS order_id,
         po.sent_date,
         poi.lot, poi.description, poi.brand, poi.species,
         poi.weight_sent AS weight
       FROM production_order_items poi
       JOIN production_orders po ON po.id = poi.production_order_id
       WHERE po.tenant_id = $1 AND po.status = 'pending'
       ORDER BY po.sent_date DESC, poi.id`,
      [req.tenantId]
    );
    res.json(result.rows.map((r) => ({
      id:          r.id,
      orderId:     r.order_id,
      sentDate:    r.sent_date,
      lot:         r.lot,
      description: r.description,
      brand:       r.brand,
      species:     r.species,
      weight:      r.weight != null ? Number(r.weight) : null,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
