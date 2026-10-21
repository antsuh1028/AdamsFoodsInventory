// Incoming receipts: recording, inspecting and pushing them into NTI stock.

const router = require("express").Router();
const pool = require("../../utils/pg");
const verifyToken = require("../../middleware/verifyToken.pg");
const requireRole = require("../../middleware/requireRole");
const { lotColumns } = require("../../utils/lotRegistry");
const { fmtDate, fmtNtiItem, logNtiHistory } = require("./helpers/shared");

// AdamsFoods distributes and NTI processes, so product arrives here from one of two
// places: back from AdamsFoods for another pass, or fresh from a packer. Without
// recording which, the two are indistinguishable afterwards and a lot's history
// cannot say where it came from.
const SOURCE_TYPES = new Set(["adamsfoods", "vendor"]);

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
        // AdamsFoods is one place, so its name is fixed; a vendor's is whatever was typed.
        source === "adamsfoods" ? (sourceName || "AdamsFoods") : (sourceName || null),
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
       source === "adamsfoods" ? (sourceName || "AdamsFoods") : (sourceName || null)]
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
      // resolved if it already exists. The resolve branch is the AdamsFoods return:
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

module.exports = router;
