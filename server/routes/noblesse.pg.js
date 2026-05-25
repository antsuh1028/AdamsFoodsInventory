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

pool.query(`
  ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS output_weight NUMERIC
`).catch((err) => console.error("output_weight migration error:", err.message));

pool.query(`
  ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS processing_runs JSONB NOT NULL DEFAULT '[]'
`).catch((err) => console.error("processing_runs migration error:", err.message));

pool.query(`
  ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS inspection JSONB NOT NULL DEFAULT '{}'
`).catch((err) => console.error("inspection migration error:", err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS noblesse_processing_orders (
    id            SERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    order_date    DATE,
    notes         TEXT,
    output_weight NUMERIC,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((err) => console.error("noblesse_processing_orders migration error:", err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS noblesse_processing_order_items (
    id                  SERIAL PRIMARY KEY,
    processing_order_id INTEGER NOT NULL REFERENCES noblesse_processing_orders(id) ON DELETE CASCADE,
    receipt_id          INTEGER,
    lot                 TEXT,
    description         TEXT,
    brand               TEXT,
    species             TEXT,
    grade               TEXT,
    weight_in           NUMERIC,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((err) => console.error("noblesse_processing_order_items migration error:", err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS nti_inventory_history (
    id         SERIAL PRIMARY KEY,
    tenant_id  UUID NOT NULL REFERENCES tenants(id),
    action     TEXT NOT NULL,
    item_id    INTEGER,
    lot        TEXT,
    snapshot   JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((err) => console.error("nti_inventory_history migration error:", err.message));

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtReceipt = (row) => ({
  id:              row.id,
  shipmentDate:    row.shipment_date,
  bolNumber:       row.bol_number,
  driver:          row.driver,
  linkedOrderId:   row.linked_order_id,
  lines:           Array.isArray(row.lines) ? row.lines : [],
  status:          row.status,
  notes:           row.notes,
  outputWeight:    row.output_weight != null ? Number(row.output_weight) : null,
  processingRuns:  Array.isArray(row.processing_runs) ? row.processing_runs : [],
  inspection:      row.inspection || {},
  createdAt:       row.created_at,
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

const logNtiHistory = (tenantId, action, item, extra = {}) =>
  pool.query(
    `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, action, item.id || null, item.lot || null, JSON.stringify({ ...item, ...extra })]
  ).catch((err) => console.error("nti history log error:", err.message));

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

router.patch("/noblesse-receipts/:id/yield", verifyToken, async (req, res) => {
  const { outputWeight } = req.body;
  try {
    const result = await pool.query(
      `UPDATE noblesse_receipts SET output_weight = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [outputWeight != null ? Number(outputWeight) : null, req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(fmtReceipt(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/noblesse-receipts/:id/inspection", verifyToken, async (req, res) => {
  const { inspection } = req.body;
  if (!inspection || typeof inspection !== "object") return res.status(400).json({ error: "inspection must be an object" });
  try {
    const result = await pool.query(
      `UPDATE noblesse_receipts SET inspection = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [JSON.stringify(inspection), req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
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
    const item = fmtNtiItem(result.rows[0]);
    logNtiHistory(req.tenantId, "added", item);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/nti-inventory/:id", verifyToken, async (req, res) => {
  const { lot, description, brand, species, est, packDate, weight, qtyCases, qtyPallets, receivedDate, notes } = req.body;
  try {
    const before = await pool.query(
      `SELECT * FROM nti_inventory WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
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
    const after = fmtNtiItem(result.rows[0]);
    const beforeFmt = before.rows.length ? fmtNtiItem(before.rows[0]) : null;
    logNtiHistory(req.tenantId, "updated", after, { before: beforeFmt });
    res.json(after);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/nti-inventory/:id", verifyToken, async (req, res) => {
  try {
    const snap = await pool.query(
      `SELECT * FROM nti_inventory WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    const result = await pool.query(
      `DELETE FROM nti_inventory WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    if (snap.rows.length) logNtiHistory(req.tenantId, "deleted", fmtNtiItem(snap.rows[0]));
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── NTI Inventory History ─────────────────────────────────────────────────────

router.get("/nti-inventory-history", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, action, item_id, lot, snapshot, created_at
       FROM nti_inventory_history
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.tenantId]
    );
    res.json(result.rows.map((r) => ({
      id:        r.id,
      action:    r.action,
      itemId:    r.item_id,
      lot:       r.lot,
      snapshot:  r.snapshot,
      createdAt: r.created_at,
    })));
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

// ── Processing Orders ─────────────────────────────────────────────────────────

const fmtProcOrder = (row, items = []) => ({
  id:           row.id,
  orderDate:    fmtDate(row.order_date),
  notes:        row.notes,
  outputWeight: row.output_weight != null ? Number(row.output_weight) : null,
  status:       row.status,
  createdAt:    row.created_at,
  items:        items.map((it) => ({
    id:          it.id,
    receiptId:   it.receipt_id,
    lot:         it.lot,
    description: it.description,
    brand:       it.brand,
    species:     it.species,
    grade:       it.grade,
    weightIn:    it.weight_in != null ? Number(it.weight_in) : null,
  })),
});

router.get("/noblesse-proc-orders", verifyToken, async (req, res) => {
  try {
    const ordersRes = await pool.query(
      `SELECT * FROM noblesse_processing_orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.tenantId]
    );
    const ids = ordersRes.rows.map((r) => r.id);
    let itemsByOrder = {};
    if (ids.length > 0) {
      const itemsRes = await pool.query(
        `SELECT * FROM noblesse_processing_order_items WHERE processing_order_id = ANY($1) ORDER BY id`,
        [ids]
      );
      itemsRes.rows.forEach((it) => {
        if (!itemsByOrder[it.processing_order_id]) itemsByOrder[it.processing_order_id] = [];
        itemsByOrder[it.processing_order_id].push(it);
      });
    }
    res.json(ordersRes.rows.map((r) => fmtProcOrder(r, itemsByOrder[r.id] || [])));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/noblesse-proc-orders", verifyToken, async (req, res) => {
  const { orderDate, notes, items } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderRes = await client.query(
      `INSERT INTO noblesse_processing_orders (tenant_id, order_date, notes) VALUES ($1,$2,$3) RETURNING *`,
      [req.tenantId, orderDate || null, notes || null]
    );
    const order = orderRes.rows[0];
    const insertedItems = [];
    for (const it of (items || [])) {
      const itRes = await client.query(
        `INSERT INTO noblesse_processing_order_items
           (processing_order_id, receipt_id, lot, description, brand, species, grade, weight_in)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [order.id, it.receiptId || null, it.lot || null, it.description || null,
         it.brand || null, it.species || null, it.grade || null,
         it.weightIn != null ? Number(it.weightIn) : null]
      );
      insertedItems.push(itRes.rows[0]);
    }

    // Deduct each item's weight from its specific NTI inventory row (lot + description)
    const deductions = [];
    for (const it of insertedItems) {
      if (!it.lot || it.weight_in == null || Number(it.weight_in) <= 0) continue;
      const hasDesc = it.description && it.description.trim().length > 0;
      await client.query(
        hasDesc
          ? `UPDATE nti_inventory SET weight = GREATEST(0, weight - $1)
             WHERE tenant_id = $2 AND lot = $3 AND description = $4`
          : `UPDATE nti_inventory SET weight = GREATEST(0, weight - $1)
             WHERE tenant_id = $2 AND lot = $3`,
        hasDesc
          ? [Number(it.weight_in), req.tenantId, it.lot, it.description]
          : [Number(it.weight_in), req.tenantId, it.lot]
      );
      deductions.push({ lot: it.lot, weightDeducted: Number(it.weight_in) });
    }

    await client.query("COMMIT");

    // Log deductions to history after commit (fire-and-forget)
    for (const { lot, weightDeducted } of deductions) {
      pool.query(
        `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.tenantId, "processed", null, lot,
         JSON.stringify({ weightDeducted, processingOrderId: order.id })]
      ).catch((err) => console.error("nti history log error:", err.message));
    }

    res.json(fmtProcOrder(order, insertedItems));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch("/noblesse-proc-orders/:id/output", verifyToken, async (req, res) => {
  const { outputWeight } = req.body;
  try {
    const result = await pool.query(
      `UPDATE noblesse_processing_orders SET output_weight = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [outputWeight != null ? Number(outputWeight) : null, req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    const itemsRes = await pool.query(
      `SELECT * FROM noblesse_processing_order_items WHERE processing_order_id = $1 ORDER BY id`,
      [req.params.id]
    );
    res.json(fmtProcOrder(result.rows[0], itemsRes.rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/noblesse-proc-orders/:id/status", verifyToken, async (req, res) => {
  const { status } = req.body;
  if (!["pending", "completed"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const result = await pool.query(
      `UPDATE noblesse_processing_orders SET status = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [status, req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    const itemsRes = await pool.query(
      `SELECT * FROM noblesse_processing_order_items WHERE processing_order_id = $1 ORDER BY id`,
      [req.params.id]
    );
    res.json(fmtProcOrder(result.rows[0], itemsRes.rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
