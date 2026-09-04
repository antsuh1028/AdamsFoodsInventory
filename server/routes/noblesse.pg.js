const router = require("express").Router();
const pool   = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { lotColumns, lookupLot } = require("../utils/lotRegistry");

// Schema lives in ../db/migrate.js and is applied, in order, before this
// module is ever required. Nothing here fires DDL at load any more — that
// was the fire-and-forget race documented in CLAUDE.md §8.

// AFDC distributes and NTI processes, so product arrives here from one of two
// places: back from AFDC for another pass, or fresh from a packer. Without
// recording which, the two are indistinguishable afterwards and a lot's history
// cannot say where it came from.
const SOURCE_TYPES = new Set(["afdc", "vendor"]);

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtReceipt = (row) => ({
  id:              row.id,
  shipmentDate:    fmtDate(row.shipment_date),
  bolNumber:       row.bol_number,
  driver:          row.driver,
  linkedOrderId:   row.linked_order_id,
  sourceType:      row.source_type,
  sourceName:      row.source_name,
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
      weight: pd.weight != null ? Number(pd.weight) : null,
      // Cases processed. Rows written before this existed have no `cases` key,
      // so it reads as null rather than 0 — nobody entered zero, it was never
      // asked for.
      cases: pd.cases != null && pd.cases !== "" ? Number(pd.cases) : null
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
    // So the lot picker shows what is already selected when a form is reopened.
    lotId:                  row.lot_id ?? null,
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
  const { shipmentDate, bolNumber, driver, linkedOrderId, lines, notes,
          sourceType, sourceName } = req.body;

  // Nullable rather than required: receipts predate the question, and rejecting
  // one that omits it would break a screen that works today.
  const source = typeof sourceType === "string" ? sourceType.trim().toLowerCase() : null;
  if (source && !SOURCE_TYPES.has(source)) {
    return res.status(400).json({ error: `sourceType must be one of: ${[...SOURCE_TYPES].join(", ")}` });
  }

  try {
    const result = await pool.query(
      `INSERT INTO noblesse_receipts (tenant_id, shipment_date, bol_number, driver, linked_order_id, lines, notes,
                                      source_type, source_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.tenantId,
        shipmentDate  || null,
        bolNumber     || null,
        driver        || null,
        linkedOrderId || null,
        JSON.stringify(lines || []),
        notes         || null,
        source        || null,
        // AFDC is one place, so its name is fixed; a vendor's is whatever was typed.
        source === "afdc" ? (sourceName || "AFDC") : (sourceName || null),
      ]
    );
    res.json(fmtReceipt(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/noblesse-receipts/:id", verifyToken, async (req, res) => {
  const { shipmentDate, bolNumber, driver, lines, sourceType, sourceName } = req.body;

  // Editable, because existing receipts have no source and someone has to be
  // able to fill it in. COALESCE below leaves it alone when it is not sent, so
  // a client that does not know about the field cannot blank it.
  const source = typeof sourceType === "string" ? sourceType.trim().toLowerCase() : null;
  if (source && !SOURCE_TYPES.has(source)) {
    return res.status(400).json({ error: `sourceType must be one of: ${[...SOURCE_TYPES].join(", ")}` });
  }

  try {
    const result = await pool.query(
      `UPDATE noblesse_receipts
       SET shipment_date = $1, bol_number = $2, driver = $3, lines = $4,
           source_type = COALESCE($7, source_type),
           source_name = COALESCE($8, source_name)
       WHERE id = $5 AND tenant_id = $6 RETURNING *`,
      [shipmentDate || null, bolNumber || null, driver || null,
       JSON.stringify(lines || []), req.params.id, req.tenantId,
       source || null,
       source === "afdc" ? (sourceName || "AFDC") : (sourceName || null)]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(fmtReceipt(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/noblesse-receipts/:id", verifyToken, requireRole("admin"), async (req, res) => {
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
      // Receiving is the incoming side, so each line's lot is created if new and
      // resolved if it already exists. The resolve branch is the AFDC return:
      // the same number comes back and the new stock attaches to the lot's
      // existing history instead of starting a second one.
      //
      // Runs on the transaction client, so a failed push leaves no orphan lots.
      const lot = await lotColumns(req.tenantId, req.userId, line.lot, client);

      const itemRes = await client.query(
        `INSERT INTO nti_inventory
           (tenant_id, lot, description, brand, grade, species, est, pack_date, weight, qty_cases, received_date,
            lot_id, stage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'raw')
         RETURNING *`,
        [
          req.tenantId,
          lot.lotNumber    || null,
          line.description || null,
          line.brand       || null,
          line.grade       || null,
          line.species     || null,
          line.estNo       || null,
          line.packDate    || null,
          line.weight      ? Number(line.weight) : null,
          line.qty         ? Number(line.qty)    : null,
          fmtDate(receipt.shipment_date),
          lot.lotId,
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
      // Processing is DOWNSTREAM, so it references a lot and never creates one.
      //
      // The lot is taken from the stock row this item draws on rather than
      // re-matched from text: the item already points at that row by id, and a
      // direct reference cannot drift the way two strings can. lookupLot is
      // only the fallback for an item with no stock row behind it, and it
      // returns null rather than inventing a lot.
      let lotId = null;
      if (it.ntiItemId) {
        const stock = await client.query(
          `SELECT lot_id FROM nti_inventory WHERE id = $1 AND tenant_id = $2`,
          [it.ntiItemId, req.tenantId]
        );
        lotId = stock.rows.length ? stock.rows[0].lot_id : null;
      }
      if (!lotId) {
        const found = await lookupLot(req.tenantId, it.lot, client);
        lotId = found ? found.lotId : null;
      }

      const itRes = await client.query(
        `INSERT INTO noblesse_processing_order_items
           (processing_order_id, receipt_id, nti_item_id, lot, description, brand, species, grade, weight_in, cases_in,
            lot_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [order.id, it.receiptId || null, it.ntiItemId || null,
         it.lot || null, it.description || null,
         it.brand || null, it.species || null, it.grade || null,
         it.weightIn != null ? Number(it.weightIn) : null,
         it.casesIn  != null ? Number(it.casesIn)  : null,
         lotId]
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
        // The remainder is the SAME lot, carried across from the item it came
        // from — not re-resolved. This is the "stored, not re-created" rule
        // applied to a split: half a lot processed now, half later, one lot.
        const newItemRes = await client.query(
          `INSERT INTO noblesse_processing_order_items
             (processing_order_id, receipt_id, nti_item_id, lot, description, brand, species, grade, weight_in, cases_in,
              lot_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [newOrderRow.id, rem.receipt_id, rem.nti_item_id,
           rem.lot, rem.description, rem.brand, rem.species, rem.grade,
           rem.weight_in, rem.cases_in || null, rem.lot_id ?? null]
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

// `lot` comes from lotColumns(): the canonical lot_number plus its lot_id, or
// the caller's original text with a null id when it is not a lot number. The
// registration form is an incoming-side record, so it may create a lot.
const regFormValues = (body, lot) => {
  // Handle processingDates: convert array to JSON for storage
  const processingDatesJSON = body.processingDates && Array.isArray(body.processingDates)
    ? JSON.stringify(body.processingDates.filter(pd => pd.date || pd.weight || pd.cases))
    : null;

  return [
    lot.lotNumber            || null,
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
    const lot = await lotColumns(req.tenantId, req.userId, req.body.lotNumber);
    const result = await pool.query(
      `INSERT INTO noblesse_registration_forms
         (tenant_id, lot_number, form_date, date_received, time_received, vendor_lot, vendor,
          product_description, processing_type, spec, brand, est_number, grade,
          due_date, predicted_yield, manifest_bl_attached, process_report_attached,
          original_weight, total_quantity, processing_dates, actual_yield, temp, remarks, checked_by,
          lot_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [req.tenantId, ...regFormValues(req.body, lot), lot.lotId]
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
    const lot = await lotColumns(req.tenantId, req.userId, req.body.lotNumber);
    const result = await pool.query(
      `UPDATE noblesse_registration_forms
       SET lot_number = $1, form_date = $2, date_received = $3, time_received = $4, vendor_lot = $5, vendor = $6,
           product_description = $7, processing_type = $8, spec = $9, brand = $10, est_number = $11, grade = $12,
           due_date = $13, predicted_yield = $14, manifest_bl_attached = $15, process_report_attached = $16,
           original_weight = $17, total_quantity = $18, processing_dates = $19, actual_yield = $20, temp = $21, remarks = $22,
           checked_by = $23, status = $24, lot_id = $25, updated_at = NOW()
       WHERE id = $26 AND tenant_id = $27
       RETURNING *`,
      [...regFormValues(req.body, lot), status, lot.lotId, req.params.id, req.tenantId]
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

router.delete("/noblesse-registration-forms/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    // Read the whole row, not just the lot number: once the delete runs this is
    // the only copy of the form that will ever exist, so the history entry has
    // to carry it or the record is gone for good.
    const formRes = await pool.query(
      `SELECT * FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!formRes.rows.length) return res.status(404).json({ error: "Not found" });
    const deletedForm = fmtRegistrationForm(formRes.rows[0]);

    // Clear any links to weighing sessions first. That table deliberately has
    // no foreign key to this one (see the migration in boxes.pg.js), so nothing
    // cleans up after it — leaving rows here would attach this form's id to
    // whatever form later reuses it.
    await pool.query(
      `DELETE FROM registration_form_batches WHERE form_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    ).catch((err) => console.error("clear form box links:", err.message));

    const result = await pool.query(
      `DELETE FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.tenantId]
    );

    // Logged as oldValues — this is what the form was before it ceased to exist.
    logRegistrationFormHistory(req.tenantId, req.params.id, "deleted", deletedForm.lotNumber,
      null, deletedForm, null, req.username);

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
