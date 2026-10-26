// NTI stock, its history, and the production items list.

const router = require("express").Router();
const pool = require("../../utils/pg");
const verifyToken = require("../../middleware/verifyToken.pg");
const { manualCasesSql } = require("../../utils/formManualCases");
const { fmtNtiItem, logNtiHistory } = require("./helpers/shared");

router.get("/nti-inventory", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.*, ${manualCasesSql("n")} AS form_manual_cases
         FROM nti_inventory n WHERE n.tenant_id = $1 ORDER BY n.created_at DESC`,
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

module.exports = router;
