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
  ALTER TABLE noblesse_processing_order_items ADD COLUMN IF NOT EXISTS nti_item_id INTEGER
`).catch((err) => console.error("nti_item_id migration error:", err.message));

pool.query(`
  ALTER TABLE noblesse_processing_order_items ADD COLUMN IF NOT EXISTS cases_in INTEGER
`).catch((err) => console.error("cases_in migration error:", err.message));

pool.query(`
  ALTER TABLE noblesse_processing_orders ADD COLUMN IF NOT EXISTS output_cases INTEGER
`).catch((err) => console.error("output_cases migration error:", err.message));

pool.query(`
  ALTER TABLE nti_inventory ADD COLUMN IF NOT EXISTS grade VARCHAR(50)
`).catch((err) => console.error("nti grade migration error:", err.message));

pool.query(`
  ALTER TABLE noblesse_processing_orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ
`).catch((err) => console.error("completed_at migration error:", err.message));

pool.query(`
  ALTER TABLE noblesse_processing_order_items ADD COLUMN IF NOT EXISTS actual_weight_in NUMERIC
`).catch((err) => console.error("actual_weight_in migration error:", err.message));

pool.query(`
  ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS inventory_pushed BOOLEAN NOT NULL DEFAULT FALSE
`).catch((err) => console.error("inventory_pushed migration error:", err.message));

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

pool.query(`
  ALTER TABLE nti_inventory_history ADD COLUMN IF NOT EXISTS performed_by TEXT
`).catch((err) => console.error("nti_inventory_history performed_by migration error:", err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS noblesse_registration_forms (
    id                       SERIAL PRIMARY KEY,
    tenant_id                UUID NOT NULL REFERENCES tenants(id),
    lot_number               TEXT,
    form_date                DATE,
    date_received            DATE,
    time_received            TEXT,
    vendor_lot               TEXT,
    vendor                   TEXT,
    product_description      TEXT,
    processing_type          TEXT,
    spec                     TEXT,
    brand                    TEXT,
    est_number               TEXT,
    grade                    TEXT,
    due_date                 DATE,
    predicted_yield          NUMERIC,
    manifest_bl_attached     BOOLEAN NOT NULL DEFAULT FALSE,
    process_report_attached  BOOLEAN NOT NULL DEFAULT FALSE,
    original_weight          NUMERIC,
    total_quantity           TEXT,
    processing_date_1        DATE,
    processed_weight_1       NUMERIC,
    processing_date_2        DATE,
    processed_weight_2       NUMERIC,
    actual_yield             NUMERIC,
    temp                     TEXT,
    remarks                  TEXT,
    checked_by               TEXT,
    status                   TEXT NOT NULL DEFAULT 'in_progress',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((err) => console.error("noblesse_registration_forms migration error:", err.message));

pool.query(`
  ALTER TABLE noblesse_registration_forms ADD COLUMN IF NOT EXISTS processing_dates JSONB
`).catch((err) => console.error("processing_dates JSONB migration error:", err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS noblesse_registration_history (
    id              SERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    form_id         INTEGER NOT NULL REFERENCES noblesse_registration_forms(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    lot_number      TEXT,
    changed_fields  JSONB,
    old_values      JSONB,
    new_values      JSONB,
    performed_by    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((err) => console.error("noblesse_registration_history migration error:", err.message));

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtReceipt = (row) => ({
  id:              row.id,
  shipmentDate:    fmtDate(row.shipment_date),
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
  inventoryPushed: !!row.inventory_pushed,
});

const fmtDate = (d) => d instanceof Date ? d.toISOString().slice(0, 10) : (d || null);

const fmtRegistrationForm = (row) => {
  // Handle processingDates: use JSON column if available, otherwise build from legacy columns
  let processingDates = [];
  if (row.processing_dates && Array.isArray(row.processing_dates)) {
    processingDates = row.processing_dates.map(pd => ({
      date: fmtDate(pd.date),
      weight: pd.weight != null ? Number(pd.weight) : null
    }));
  } else {
    // Fallback to legacy columns for existing data
    if (row.processing_date_1 || row.processed_weight_1) {
      processingDates.push({
        date: fmtDate(row.processing_date_1),
        weight: row.processed_weight_1 != null ? Number(row.processed_weight_1) : null
      });
    }
    if (row.processing_date_2 || row.processed_weight_2) {
      processingDates.push({
        date: fmtDate(row.processing_date_2),
        weight: row.processed_weight_2 != null ? Number(row.processed_weight_2) : null
      });
    }
  }

  return {
    id:                     row.id,
    lotNumber:              row.lot_number,
    formDate:               fmtDate(row.form_date),
    dateReceived:           fmtDate(row.date_received),
    timeReceived:           row.time_received,
    vendorLot:              row.vendor_lot,
    vendor:                 row.vendor,
    productDescription:     row.product_description,
    processingType:         row.processing_type,
    spec:                   row.spec,
    brand:                  row.brand,
    estNumber:              row.est_number,
    grade:                  row.grade,
    dueDate:                fmtDate(row.due_date),
    predictedYield:         row.predicted_yield      != null ? Number(row.predicted_yield)      : null,
    manifestBlAttached:     !!row.manifest_bl_attached,
    processReportAttached:  !!row.process_report_attached,
    originalWeight:         row.original_weight      != null ? Number(row.original_weight)      : null,
    totalQuantity:          row.total_quantity,
    processingDates:        processingDates,
    actualYield:            row.actual_yield         != null ? Number(row.actual_yield)         : null,
    temp:                   row.temp,
    remarks:                row.remarks,
    checkedBy:              row.checked_by,
    status:                 row.status,
    createdAt:              row.created_at,
    updatedAt:              row.updated_at,
  };
};

const fmtNtiItem = (row) => ({
  id:           row.id,
  lot:          row.lot,
  description:  row.description,
  brand:        row.brand,
  grade:        row.grade,
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

const logNtiHistory = (tenantId, action, item, extra = {}, performedBy = null) => {
  if ((item.lot || "").toUpperCase() === "TEST") return Promise.resolve();
  return pool.query(
    `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, action, item.id || null, item.lot || null, JSON.stringify({ ...item, ...extra }), performedBy]
  ).catch((err) => console.error("nti history log error:", err.message));
};

const logRegistrationFormHistory = (tenantId, formId, action, lotNumber, changedFields = null, oldValues = null, newValues = null, performedBy = null) => {
  return pool.query(
    `INSERT INTO noblesse_registration_history (tenant_id, form_id, action, lot_number, changed_fields, old_values, new_values, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tenantId, formId, action, lotNumber, changedFields ? JSON.stringify(changedFields) : null,
     oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, performedBy]
  ).catch((err) => console.error("registration form history log error:", err.message));
};

const getChangedFields = (oldData, newData) => {
  const changed = {};
  const changedFields = [];
  Object.keys(newData).forEach(key => {
    const oldVal = oldData[key];
    const newVal = newData[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changed[key] = { from: oldVal, to: newVal };
      changedFields.push(key);
    }
  });
  return { changedFields, changed };
};

const safeJsonParse = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error("JSON parse error:", err.message, "value:", value);
    return null;
  }
};

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

router.patch("/noblesse-receipts/:id", verifyToken, async (req, res) => {
  const { shipmentDate, bolNumber, driver, lines } = req.body;
  try {
    const result = await pool.query(
      `UPDATE noblesse_receipts
       SET shipment_date = $1, bol_number = $2, driver = $3, lines = $4
       WHERE id = $5 AND tenant_id = $6 RETURNING *`,
      [shipmentDate || null, bolNumber || null, driver || null,
       JSON.stringify(lines || []), req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(fmtReceipt(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/noblesse-receipts/:id", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM noblesse_receipts WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/noblesse-receipts/:id/push-to-inventory", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const receiptRes = await client.query(
      `SELECT * FROM noblesse_receipts WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!receiptRes.rows.length) return res.status(404).json({ error: "Not found" });
    const receipt = receiptRes.rows[0];
    if (receipt.inventory_pushed) return res.status(409).json({ error: "Already pushed to inventory" });

    const lines = Array.isArray(receipt.lines) ? receipt.lines : [];
    const validLines = lines.filter((l) => l.lot || l.description || l.brand);
    if (validLines.length === 0) return res.status(400).json({ error: "No valid lines to add" });

    await client.query("BEGIN");

    const insertedItems = [];
    for (const line of validLines) {
      const itemRes = await client.query(
        `INSERT INTO nti_inventory
           (tenant_id, lot, description, brand, grade, species, est, pack_date, weight, qty_cases, received_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          req.tenantId,
          line.lot         || null,
          line.description || null,
          line.brand       || null,
          line.grade       || null,
          line.species     || null,
          line.estNo       || null,
          line.packDate    || null,
          line.weight      ? Number(line.weight) : null,
          line.qty         ? Number(line.qty)    : null,
          fmtDate(receipt.shipment_date),
        ]
      );
      insertedItems.push(itemRes.rows[0]);
    }

    const updatedReceipt = await client.query(
      `UPDATE noblesse_receipts SET inventory_pushed = TRUE WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.tenantId]
    );

    await client.query("COMMIT");

    for (const item of insertedItems) {
      logNtiHistory(req.tenantId, "received", fmtNtiItem(item), { sourceReceiptId: Number(req.params.id) }, req.username);
    }

    res.json({
      receipt: fmtReceipt(updatedReceipt.rows[0]),
      items:   insertedItems.map(fmtNtiItem),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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
  const { lot, description, brand, grade, species, est, packDate, weight, qtyCases, qtyPallets, receivedDate, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO nti_inventory (tenant_id, lot, description, brand, grade, species, est, pack_date, weight, qty_cases, qty_pallets, received_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        req.tenantId,
        lot          || null,
        description  || null,
        brand        || null,
        grade        || null,
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
    logNtiHistory(req.tenantId, "added", item, {}, req.username);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/nti-inventory/:id", verifyToken, async (req, res) => {
  const { lot, description, brand, grade, species, est, packDate, weight, qtyCases, qtyPallets, receivedDate, notes } = req.body;
  try {
    const before = await pool.query(
      `SELECT * FROM nti_inventory WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    const result = await pool.query(
      `UPDATE nti_inventory
       SET lot=$1, description=$2, brand=$3, grade=$4, species=$5, est=$6, pack_date=$7,
           weight=$8, qty_cases=$9, qty_pallets=$10, received_date=$11, notes=$12
       WHERE id=$13 AND tenant_id=$14
       RETURNING *`,
      [
        lot          || null,
        description  || null,
        brand        || null,
        grade        || null,
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
    logNtiHistory(req.tenantId, "updated", after, { before: beforeFmt }, req.username);
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
    // Wrap separately so a formatting/log error can't cause a 500 after a successful delete
    try {
      if (snap.rows.length) logNtiHistory(req.tenantId, "deleted", fmtNtiItem(snap.rows[0]), {}, req.username);
    } catch (e) {
      console.error("history log error (delete):", e.message);
    }
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
      `SELECT id, action, item_id, lot, snapshot, performed_by, created_at
       FROM nti_inventory_history
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.tenantId]
    );
    res.json(result.rows.map((r) => ({
      id:          r.id,
      action:      r.action,
      itemId:      r.item_id,
      lot:         r.lot,
      snapshot:    r.snapshot,
      performedBy: r.performed_by,
      createdAt:   r.created_at,
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
  outputWeight: row.output_weight  != null ? Number(row.output_weight)  : null,
  outputCases:  row.output_cases   != null ? Number(row.output_cases)   : null,
  status:       row.status,
  createdAt:    row.created_at,
  completedAt:  row.completed_at   || null,
  items:        items.map((it) => ({
    id:            it.id,
    receiptId:     it.receipt_id,
    ntiItemId:     it.nti_item_id || null,
    lot:           it.lot,
    description:   it.description,
    brand:         it.brand,
    species:       it.species,
    grade:         it.grade,
    weightIn:      it.weight_in        != null ? Number(it.weight_in)        : null,
    casesIn:       it.cases_in         != null ? Number(it.cases_in)         : null,
    actualWeightIn: it.actual_weight_in != null ? Number(it.actual_weight_in) : null,
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
      `INSERT INTO noblesse_processing_orders (tenant_id, order_date, notes, created_at) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.tenantId, orderDate || null, notes || null, new Date()]
    );
    const order = orderRes.rows[0];
    const insertedItems = [];
    for (const it of (items || [])) {
      const itRes = await client.query(
        `INSERT INTO noblesse_processing_order_items
           (processing_order_id, receipt_id, nti_item_id, lot, description, brand, species, grade, weight_in, cases_in)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [order.id, it.receiptId || null, it.ntiItemId || null,
         it.lot || null, it.description || null,
         it.brand || null, it.species || null, it.grade || null,
         it.weightIn != null ? Number(it.weightIn) : null,
         it.casesIn  != null ? Number(it.casesIn)  : null]
      );
      insertedItems.push(itRes.rows[0]);
    }

    // Deduct each item's weight from its exact NTI inventory row by ID
    const deductions = [];
    for (const it of insertedItems) {
      if (!it.nti_item_id || it.weight_in == null || Number(it.weight_in) <= 0) continue;
      await client.query(
        `UPDATE nti_inventory SET weight = GREATEST(0, weight - $1)
         WHERE id = $2 AND tenant_id = $3`,
        [Number(it.weight_in), it.nti_item_id, req.tenantId]
      );
      deductions.push({ lot: it.lot, weightDeducted: Number(it.weight_in) });
    }

    await client.query("COMMIT");

    // Log deductions to history after commit (fire-and-forget)
    for (const { lot, weightDeducted } of deductions) {
      pool.query(
        `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot, performed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.tenantId, "processed", null, lot,
         JSON.stringify({ weightDeducted, processingOrderId: order.id }), req.username]
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

router.delete("/noblesse-proc-orders/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Restore inventory weight for any items that were deducted
    const itemsRes = await client.query(
      `SELECT * FROM noblesse_processing_order_items WHERE processing_order_id = $1`,
      [req.params.id]
    );
    for (const item of itemsRes.rows) {
      if (item.nti_item_id && item.weight_in != null) {
        const restored = item.actual_weight_in != null
          ? Number(item.weight_in) - Number(item.actual_weight_in) // only unprocessed portion remains committed
          : Number(item.weight_in);
        if (restored > 0) {
          await client.query(
            `UPDATE nti_inventory SET weight = weight + $1 WHERE id = $2 AND tenant_id = $3`,
            [restored, item.nti_item_id, req.tenantId]
          );
        }
      }
    }

    const result = await client.query(
      `DELETE FROM noblesse_processing_orders WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.tenantId]
    );
    if (!result.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Not found" }); }

    await client.query("COMMIT");
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch("/noblesse-proc-orders/:id/notes", verifyToken, async (req, res) => {
  const { notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE noblesse_processing_orders SET notes = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [notes || null, req.params.id, req.tenantId]
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

router.patch("/noblesse-proc-orders/:id/output", verifyToken, async (req, res) => {
  const { outputWeight, outputCases } = req.body;
  try {
    const result = await pool.query(
      `UPDATE noblesse_processing_orders
       SET output_weight = $1, output_cases = $2
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [
        outputWeight != null ? Number(outputWeight) : null,
        outputCases  != null ? Number(outputCases)  : null,
        req.params.id, req.tenantId,
      ]
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

// Partial completion — records how much was actually processed.
// The unprocessed remainder becomes a new pending order; inventory stays deducted.
router.patch("/noblesse-proc-orders/:id/partial-complete", verifyToken, async (req, res) => {
  const { items: itemUpdates, outputWeight, outputCases } = req.body; // items: [{ id, actualWeightIn }]
  if (!Array.isArray(itemUpdates) || itemUpdates.length === 0)
    return res.status(400).json({ error: "items array required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const remainders = []; // items with leftover weight → new pending order

    for (const upd of itemUpdates) {
      const itemRes = await client.query(
        `SELECT * FROM noblesse_processing_order_items WHERE id = $1 AND processing_order_id = $2`,
        [upd.id, req.params.id]
      );
      if (!itemRes.rows.length) continue;
      const item = itemRes.rows[0];

      const planned   = Number(item.weight_in) || 0;
      const actual    = Math.max(0, Math.min(planned, Number(upd.actualWeightIn) || 0));
      const remainder = planned - actual;

      await client.query(
        `UPDATE noblesse_processing_order_items SET actual_weight_in = $1 WHERE id = $2`,
        [actual, item.id]
      );

      if (remainder > 0) {
        remainders.push({ ...item, weight_in: remainder });
      }
    }

    // Mark original order completed
    const orderRes = await client.query(
      `UPDATE noblesse_processing_orders
       SET status = 'completed', completed_at = NOW(),
           output_weight = COALESCE($3, output_weight),
           output_cases  = COALESCE($4, output_cases)
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.tenantId,
       outputWeight != null ? Number(outputWeight) : null,
       outputCases  != null ? Number(outputCases)  : null]
    );
    if (!orderRes.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Not found" }); }

    const updatedItems = await client.query(
      `SELECT * FROM noblesse_processing_order_items WHERE processing_order_id = $1 ORDER BY id`,
      [req.params.id]
    );

    // Spin up a new pending order for any remainder (inventory already committed — no re-deduction)
    let newOrder = null;
    if (remainders.length > 0) {
      const orig = orderRes.rows[0];
      const newOrderRes = await client.query(
        `INSERT INTO noblesse_processing_orders (tenant_id, order_date, notes, created_at)
         VALUES ($1, $2, $3, NOW()) RETURNING *`,
        [req.tenantId, orig.order_date,
         `Remainder from PO #${req.params.id}${orig.notes ? ` — ${orig.notes}` : ""}`]
      );
      const newOrderRow = newOrderRes.rows[0];
      const newItems = [];
      for (const rem of remainders) {
        const newItemRes = await client.query(
          `INSERT INTO noblesse_processing_order_items
             (processing_order_id, receipt_id, nti_item_id, lot, description, brand, species, grade, weight_in, cases_in)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [newOrderRow.id, rem.receipt_id, rem.nti_item_id,
           rem.lot, rem.description, rem.brand, rem.species, rem.grade,
           rem.weight_in, rem.cases_in || null]
        );
        newItems.push(newItemRes.rows[0]);
      }
      newOrder = fmtProcOrder(newOrderRow, newItems);
    }

    await client.query("COMMIT");

    res.json({
      order:    fmtProcOrder(orderRes.rows[0], updatedItems.rows),
      newOrder,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch("/noblesse-proc-orders/:id/status", verifyToken, async (req, res) => {
  const { status } = req.body;
  if (!["pending", "completed"].includes(status)) return res.status(400).json({ error: "Invalid status" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Reverting to pending: clear actual_weight_in. Inventory stays as-is —
    // remainder was spun into a new pending order, not returned to inventory.
    if (status === "pending") {
      await client.query(
        `UPDATE noblesse_processing_order_items SET actual_weight_in = NULL WHERE processing_order_id = $1`,
        [req.params.id]
      );
    }

    const result = await client.query(
      `UPDATE noblesse_processing_orders
       SET status = $1,
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [status, req.params.id, req.tenantId]
    );
    if (!result.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Not found" }); }

    const itemsRes = await client.query(
      `SELECT * FROM noblesse_processing_order_items WHERE processing_order_id = $1 ORDER BY id`,
      [req.params.id]
    );
    await client.query("COMMIT");
    res.json(fmtProcOrder(result.rows[0], itemsRes.rows));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Registration Forms ──────────────────────────────────────────────────────

const regFormValues = (body) => {
  // Handle processingDates: convert array to JSON for storage
  const processingDatesJSON = body.processingDates && Array.isArray(body.processingDates)
    ? JSON.stringify(body.processingDates.filter(pd => pd.date || pd.weight))
    : null;

  return [
    body.lotNumber           || null,
    body.formDate            || null,
    body.dateReceived        || null,
    body.timeReceived        || null,
    body.vendorLot           || null,
    body.vendor              || null,
    body.productDescription  || null,
    body.processingType      || null,
    body.spec                || null,
    body.brand               || null,
    body.estNumber           || null,
    body.grade               || null,
    body.dueDate             || null,
    body.predictedYield      != null && body.predictedYield !== "" ? Number(body.predictedYield) : null,
    !!body.manifestBlAttached,
    !!body.processReportAttached,
    body.originalWeight      != null && body.originalWeight !== "" ? Number(body.originalWeight) : null,
    body.totalQuantity       || null,
    processingDatesJSON,
    body.actualYield         != null && body.actualYield !== "" ? Number(body.actualYield) : null,
    body.temp                || null,
    body.remarks             || null,
    body.checkedBy           || null,
  ];
};

router.get("/noblesse-registration-forms", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM noblesse_registration_forms WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.tenantId]
    );
    res.json(result.rows.map(fmtRegistrationForm));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/noblesse-registration-forms/all/history", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM noblesse_registration_history WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [req.tenantId]
    );
    const history = result.rows.map(row => ({
      id: row.id,
      formId: row.form_id,
      action: row.action,
      lotNumber: row.lot_number,
      changedFields: safeJsonParse(row.changed_fields),
      oldValues: safeJsonParse(row.old_values),
      newValues: safeJsonParse(row.new_values),
      performedBy: row.performed_by,
      createdAt: row.created_at,
    }));
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/noblesse-registration-forms/:id", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(fmtRegistrationForm(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/noblesse-registration-forms", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `INSERT INTO noblesse_registration_forms
         (tenant_id, lot_number, form_date, date_received, time_received, vendor_lot, vendor,
          product_description, processing_type, spec, brand, est_number, grade,
          due_date, predicted_yield, manifest_bl_attached, process_report_attached,
          original_weight, total_quantity, processing_dates, actual_yield, temp, remarks, checked_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [req.tenantId, ...regFormValues(req.body)]
    );
    const form = result.rows[0];

    // Log creation
    logRegistrationFormHistory(req.tenantId, form.id, "created", form.lot_number, null, null, fmtRegistrationForm(form), req.username);

    res.json(fmtRegistrationForm(form));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/noblesse-registration-forms/:id", verifyToken, async (req, res) => {
  try {
    // Fetch old data first for history
    const oldRes = await pool.query(
      `SELECT * FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!oldRes.rows.length) return res.status(404).json({ error: "Not found" });
    const oldData = fmtRegistrationForm(oldRes.rows[0]);

    const status = req.body.status && ["in_progress", "completed"].includes(req.body.status) ? req.body.status : null;
    const result = await pool.query(
      `UPDATE noblesse_registration_forms
       SET lot_number = $1, form_date = $2, date_received = $3, time_received = $4, vendor_lot = $5, vendor = $6,
           product_description = $7, processing_type = $8, spec = $9, brand = $10, est_number = $11, grade = $12,
           due_date = $13, predicted_yield = $14, manifest_bl_attached = $15, process_report_attached = $16,
           original_weight = $17, total_quantity = $18, processing_dates = $19, actual_yield = $20, temp = $21, remarks = $22,
           checked_by = $23, status = $24, updated_at = NOW()
       WHERE id = $25 AND tenant_id = $26
       RETURNING *`,
      [...regFormValues(req.body), status, req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });

    const newForm = fmtRegistrationForm(result.rows[0]);
    const { changedFields } = getChangedFields(oldData, newForm);

    // Log update if there were changes
    if (changedFields.length > 0) {
      logRegistrationFormHistory(req.tenantId, req.params.id, "updated", newForm.lotNumber, changedFields, oldData, newForm, req.username);
    }

    res.json(newForm);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/noblesse-registration-forms/:id/status", verifyToken, async (req, res) => {
  const { status } = req.body;
  const VALID = ["in_progress", "completed"];
  if (!VALID.includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const oldRes = await pool.query(
      `SELECT * FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!oldRes.rows.length) return res.status(404).json({ error: "Not found" });
    const oldForm = fmtRegistrationForm(oldRes.rows[0]);

    const result = await pool.query(
      `UPDATE noblesse_registration_forms SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [status, req.params.id, req.tenantId]
    );

    const newForm = fmtRegistrationForm(result.rows[0]);

    // Log status change
    if (oldForm.status !== newForm.status) {
      logRegistrationFormHistory(req.tenantId, req.params.id, "status_changed", newForm.lotNumber,
        ["status"], { status: oldForm.status }, { status: newForm.status }, req.username);
    }

    res.json(newForm);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/noblesse-registration-forms/:id", verifyToken, async (req, res) => {
  if (req.role !== "admin") return res.status(403).json({ error: "Admin only" });
  try {
    const formRes = await pool.query(
      `SELECT lot_number FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!formRes.rows.length) return res.status(404).json({ error: "Not found" });

    const result = await pool.query(
      `DELETE FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.tenantId]
    );

    // Log deletion
    logRegistrationFormHistory(req.tenantId, req.params.id, "deleted", formRes.rows[0].lot_number, null, null, null, req.username);

    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/noblesse-registration-forms/:id/history", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM noblesse_registration_history WHERE form_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
      [req.params.id, req.tenantId]
    );
    const history = result.rows.map(row => ({
      id: row.id,
      action: row.action,
      lotNumber: row.lot_number,
      changedFields: safeJsonParse(row.changed_fields),
      oldValues: safeJsonParse(row.old_values),
      newValues: safeJsonParse(row.new_values),
      performedBy: row.performed_by,
      createdAt: row.created_at,
    }));
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
