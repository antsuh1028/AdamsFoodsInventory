const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { stockWeightInLb } = require("../utils/sqlWeight");

// Outgoing. Product leaving NTI, either back to AdamsFoods for distribution or
// straight to a customer.
//
// A shipment DEDUCTS STOCK WHEN IT SHIPS, the way a processing order deducts
// when it is created — same GREATEST(0, ...) floor, same history log, same
// restore on the way back.
//
// Lifecycle is draft -> shipped -> cancelled, and it only runs forwards. A
// shipped load is never edited in place and never deleted: cancelling restores
// the stock and keeps the record, which is the only version of "undo" that
// leaves an audit trail. Cancelling is admin-only for the same reason deleting
// a weighing session is.
//
// Outgoing is DOWNSTREAM, so it references lots and never creates them. There
// is no path in this file that writes to `lots`.

const DESTINATIONS = new Set(["adamsfoods", "customer"]);
const DECIMAL_RE = /^\d{1,7}(\.\d{1,3})?$/;

const fmtItem = (r) => ({
  itemId: r.item_id,
  lotId: r.lot_id,
  lotNumber: r.lot_number,
  ntiItemId: r.nti_item_id,
  weight: r.weight,
  qtyCases: r.qty_cases,
  description: r.description,
  stage: r.stage,
});

const fmtShipment = (r, items = []) => ({
  shipmentId: r.shipment_id,
  shipDate: r.ship_date instanceof Date ? r.ship_date.toISOString().slice(0, 10) : r.ship_date,
  destinationType: r.destination_type,
  destinationName: r.destination_name,
  shipTo: r.ship_to,
  billOfLading: r.bill_of_lading,
  carrier: r.carrier,
  driver: r.driver,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
  shippedAt: r.shipped_at,
  cancelledAt: r.cancelled_at,
  items: items.map(fmtItem),
  // Summed from the lines rather than stored, so it cannot fall out of step
  // with them.
  totalWeight: items
    .reduce((sum, i) => sum + Math.round(Number(i.weight) * 1000), 0) / 1000,
  totalCases: items.reduce((sum, i) => sum + (Number(i.qty_cases) || 0), 0),
});

const itemsFor = (shipmentId, tenantId, client = pool) =>
  client.query(
    `SELECT si.*, l.lot_number, s.stage
       FROM noblesse_shipment_items si
       JOIN lots l ON l.lot_id = si.lot_id
       LEFT JOIN nti_inventory s ON s.id = si.nti_item_id
      WHERE si.shipment_id = $1 AND si.tenant_id = $2
      ORDER BY si.item_id`,
    [shipmentId, tenantId]
  );

const loadShipment = async (shipmentId, tenantId, client = pool) => {
  const head = await client.query(
    `SELECT * FROM noblesse_shipments WHERE shipment_id = $1 AND tenant_id = $2`,
    [shipmentId, tenantId]
  );
  if (!head.rows.length) return null;
  const items = await itemsFor(shipmentId, tenantId, client);
  return { row: head.rows[0], items: items.rows };
};

const normaliseDestination = (type, name) => {
  const t = typeof type === "string" ? type.trim().toLowerCase() : null;
  if (!t || !DESTINATIONS.has(t)) return null;
  // AdamsFoods is one place, so its name is fixed; a customer's is whatever was
  // typed. Free text with typeahead, the way vendors already work — a master
  // customers table before there is data to master would be premature.
  return { type: t, name: t === "adamsfoods" ? "AdamsFoods" : (name || "").trim() };
};

// ── Read ─────────────────────────────────────────────────────────────────────

router.get("/shipments", verifyToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const result = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM noblesse_shipment_items i
                WHERE i.shipment_id = s.shipment_id) AS line_count,
              COALESCE((SELECT SUM(i.weight)::text FROM noblesse_shipment_items i
                WHERE i.shipment_id = s.shipment_id), '0') AS total_weight,
              COALESCE((SELECT SUM(i.qty_cases)::int FROM noblesse_shipment_items i
                WHERE i.shipment_id = s.shipment_id), 0) AS total_cases
         FROM noblesse_shipments s
        WHERE s.tenant_id = $1
        ORDER BY s.ship_date DESC, s.shipment_id DESC
        LIMIT $2`,
      [req.tenantId, limit]
    );
    res.json(result.rows.map((r) => ({
      ...fmtShipment(r),
      lineCount: r.line_count,
      totalWeight: r.total_weight,
      totalCases: r.total_cases,
    })));
  } catch (err) {
    console.error("list shipments:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Registered BEFORE /shipments/:id: ":id" matches the literal string
// "available" and would make this unreachable.
// What is available to ship, per lot and per stage.
//
// Processed stock is listed first because that is normally what leaves; raw is
// shippable too — sometimes product passes straight through — but it is marked
// so nobody ships unprocessed material without noticing.
router.get("/shipments/available", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id AS nti_item_id, s.lot_id, l.lot_number, s.stage,
              s.description, s.brand, s.species, s.grade,
              ${stockWeightInLb("s")}::text AS on_hand,
              s.qty_cases,
              -- Flagged, not filtered: a lot mid-processing can still be
              -- shipped, but the screen should say so.
              EXISTS (SELECT 1 FROM noblesse_processing_order_items pi
                        JOIN noblesse_processing_orders po ON po.id = pi.processing_order_id
                       WHERE pi.lot_id = s.lot_id AND po.tenant_id = s.tenant_id
                         AND po.status <> 'completed') AS in_processing
         FROM nti_inventory s
         JOIN lots l ON l.lot_id = s.lot_id
        WHERE s.tenant_id = $1 AND s.weight > 0
        ORDER BY (s.stage = 'processed') DESC, l.lot_number DESC`,
      [req.tenantId]
    );
    res.json(result.rows.map((r) => ({
      ntiItemId: r.nti_item_id,
      lotId: r.lot_id,
      lotNumber: r.lot_number,
      stage: r.stage,
      description: r.description,
      brand: r.brand,
      species: r.species,
      grade: r.grade,
      onHand: r.on_hand,
      qtyCases: r.qty_cases,
      inProcessing: r.in_processing,
    })));
  } catch (err) {
    console.error("list available stock:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/shipments/:id", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid shipment id" });
  try {
    const found = await loadShipment(id, req.tenantId);
    if (!found) return res.status(404).json({ error: "Shipment not found" });
    res.json(fmtShipment(found.row, found.items));
  } catch (err) {
    console.error("read shipment:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── Create and edit a draft ──────────────────────────────────────────────────

router.post("/shipments", verifyToken, async (req, res) => {
  const { shipDate, destinationType, destinationName, shipTo, billOfLading,
          carrier, driver, notes } = req.body || {};

  const dest = normaliseDestination(destinationType, destinationName);
  if (!dest) {
    return res.status(400).json({
      error: `destinationType must be one of: ${[...DESTINATIONS].join(", ")}`,
    });
  }
  if (!dest.name) return res.status(400).json({ error: "A customer name is required" });
  if (!shipDate) return res.status(400).json({ error: "shipDate is required" });

  try {
    const ins = await pool.query(
      `INSERT INTO noblesse_shipments
         (tenant_id, ship_date, destination_type, destination_name, ship_to,
          bill_of_lading, carrier, driver, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.tenantId, shipDate, dest.type, dest.name, shipTo || null,
       billOfLading || null, carrier || null, driver || null, notes || null, req.userId]
    );
    res.status(201).json(fmtShipment(ins.rows[0], []));
  } catch (err) {
    console.error("create shipment:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Only a draft can be edited. A shipped load has already moved stock and been
// papered; changing it in place would leave the two disagreeing with no record.
const draftOnly = async (id, tenantId, client = pool) => {
  const found = await client.query(
    `SELECT status FROM noblesse_shipments WHERE shipment_id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  if (!found.rows.length) return { ok: false, status: 404, error: "Shipment not found" };
  if (found.rows[0].status !== "draft") {
    return { ok: false, status: 409,
      error: `This shipment is ${found.rows[0].status} and can no longer be changed` };
  }
  return { ok: true };
};

router.patch("/shipments/:id", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid shipment id" });

  const { shipDate, destinationType, destinationName, shipTo, billOfLading,
          carrier, driver, notes } = req.body || {};

  let dest = null;
  if (destinationType != null) {
    dest = normaliseDestination(destinationType, destinationName);
    if (!dest) {
      return res.status(400).json({
        error: `destinationType must be one of: ${[...DESTINATIONS].join(", ")}`,
      });
    }
  }

  try {
    const gate = await draftOnly(id, req.tenantId);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    // COALESCE throughout: a client that does not send a field must not blank it.
    const upd = await pool.query(
      `UPDATE noblesse_shipments
          SET ship_date        = COALESCE($1, ship_date),
              destination_type = COALESCE($2, destination_type),
              destination_name = COALESCE($3, destination_name),
              ship_to          = COALESCE($4, ship_to),
              bill_of_lading   = COALESCE($5, bill_of_lading),
              carrier          = COALESCE($6, carrier),
              driver           = COALESCE($7, driver),
              notes            = COALESCE($8, notes)
        WHERE shipment_id = $9 AND tenant_id = $10
      RETURNING *`,
      [shipDate || null, dest ? dest.type : null, dest ? dest.name : null,
       shipTo || null, billOfLading || null, carrier || null, driver || null,
       notes || null, id, req.tenantId]
    );
    const items = await itemsFor(id, req.tenantId);
    res.json(fmtShipment(upd.rows[0], items.rows));
  } catch (err) {
    console.error("update shipment:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── Lines ────────────────────────────────────────────────────────────────────

router.post("/shipments/:id/items", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid shipment id" });

  const { lotId, ntiItemId, weight, qtyCases, description } = req.body || {};

  if (!Number.isInteger(lotId)) return res.status(400).json({ error: "lotId is required" });
  if (typeof weight !== "string" || !DECIMAL_RE.test(weight)) {
    return res.status(400).json({ error: "weight must be a decimal string with at most 3 decimal places" });
  }
  if (!(Number(weight) > 0)) return res.status(400).json({ error: "weight must be greater than zero" });

  try {
    const gate = await draftOnly(id, req.tenantId);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    // Outgoing references lots, never creates them. An id that is not this
    // tenant's own lot is refused rather than adopted.
    const lot = await pool.query(
      `SELECT lot_id FROM lots WHERE lot_id = $1 AND tenant_id = $2`, [lotId, req.tenantId]);
    if (!lot.rows.length) return res.status(404).json({ error: "Lot not found" });

    if (ntiItemId != null) {
      const stock = await pool.query(
        `SELECT id FROM nti_inventory WHERE id = $1 AND tenant_id = $2`, [ntiItemId, req.tenantId]);
      if (!stock.rows.length) return res.status(404).json({ error: "Stock row not found" });
    }

    await pool.query(
      `INSERT INTO noblesse_shipment_items
         (shipment_id, tenant_id, lot_id, nti_item_id, weight, qty_cases, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.tenantId, lotId, ntiItemId ?? null, weight,
       qtyCases != null ? Number(qtyCases) : null, description || null]
    );

    const found = await loadShipment(id, req.tenantId);
    res.status(201).json(fmtShipment(found.row, found.items));
  } catch (err) {
    console.error("add shipment item:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/shipments/:id/items/:itemId", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(id) || !Number.isInteger(itemId)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const gate = await draftOnly(id, req.tenantId);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    await pool.query(
      `DELETE FROM noblesse_shipment_items
        WHERE item_id = $1 AND shipment_id = $2 AND tenant_id = $3`,
      [itemId, id, req.tenantId]
    );
    const found = await loadShipment(id, req.tenantId);
    res.json(fmtShipment(found.row, found.items));
  } catch (err) {
    console.error("remove shipment item:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── Ship ─────────────────────────────────────────────────────────────────────
// The point of no return: stock moves here.

router.post("/shipments/:id/ship", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid shipment id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const head = await client.query(
      `SELECT * FROM noblesse_shipments WHERE shipment_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, req.tenantId]
    );
    if (!head.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Shipment not found" });
    }
    if (head.rows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `This shipment is already ${head.rows[0].status}` });
    }

    const items = await client.query(
      `SELECT si.*, l.lot_number FROM noblesse_shipment_items si
         JOIN lots l ON l.lot_id = si.lot_id
        WHERE si.shipment_id = $1 AND si.tenant_id = $2`,
      [id, req.tenantId]
    );
    if (!items.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Nothing to ship — add at least one lot" });
    }

    // Stock is checked and deducted inside the transaction, with the row locked,
    // so two people shipping the same stock at once cannot both succeed and
    // drive it negative. GREATEST would silently floor at zero; the explicit
    // check refuses instead, because shipping more than exists is a mistake
    // someone needs told about rather than quietly absorbed.
    const short = [];
    for (const item of items.rows) {
      if (!item.nti_item_id) continue;   // no stock row behind it; nothing to move
      const stock = await client.query(
        `SELECT id, weight FROM nti_inventory WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [item.nti_item_id, req.tenantId]
      );
      const onHand = stock.rows.length ? Number(stock.rows[0].weight) : 0;
      if (Number(item.weight) > onHand + 1e-9) {
        short.push({
          lotNumber: item.lot_number,
          requested: String(item.weight),
          onHand: String(onHand),
        });
      }
    }
    if (short.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "INSUFFICIENT_STOCK",
        error: "More was requested than is on hand",
        shortfalls: short,
      });
    }

    for (const item of items.rows) {
      if (!item.nti_item_id) continue;
      await client.query(
        `UPDATE nti_inventory SET weight = GREATEST(0, weight - $1)
          WHERE id = $2 AND tenant_id = $3`,
        [Number(item.weight), item.nti_item_id, req.tenantId]
      );
    }

    const shipped = await client.query(
      `UPDATE noblesse_shipments
          SET status = 'shipped', shipped_at = now()
        WHERE shipment_id = $1 AND tenant_id = $2
      RETURNING *`,
      [id, req.tenantId]
    );

    await client.query("COMMIT");

    // Logged after the commit, fire-and-forget: a history write must never be
    // what fails a shipment that has already moved stock.
    for (const item of items.rows) {
      pool.query(
        `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot, performed_by)
         VALUES ($1, 'shipped', $2, $3, $4, $5)`,
        [req.tenantId, item.nti_item_id ?? null, item.lot_number,
         JSON.stringify({ shipmentId: id, weight: item.weight, qtyCases: item.qty_cases,
                          destination: shipped.rows[0].destination_name }),
         req.username]
      ).catch((err) => console.error("nti history log error:", err.message));
    }

    const found = await loadShipment(id, req.tenantId);
    res.json(fmtShipment(found.row, found.items));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("ship shipment:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// ── Cancel ───────────────────────────────────────────────────────────────────
// The only undo. Restores the stock and keeps the record, so what happened
// stays visible — which is why a shipped load is never deleted.

router.post("/shipments/:id/cancel", verifyToken, requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid shipment id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const head = await client.query(
      `SELECT * FROM noblesse_shipments WHERE shipment_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, req.tenantId]
    );
    if (!head.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Shipment not found" });
    }
    if (head.rows[0].status !== "shipped") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: `Only a shipped load can be cancelled — this one is ${head.rows[0].status}`,
      });
    }

    const items = await client.query(
      `SELECT si.*, l.lot_number FROM noblesse_shipment_items si
         JOIN lots l ON l.lot_id = si.lot_id
        WHERE si.shipment_id = $1 AND si.tenant_id = $2`,
      [id, req.tenantId]
    );

    for (const item of items.rows) {
      if (!item.nti_item_id) continue;
      await client.query(
        `UPDATE nti_inventory SET weight = weight + $1 WHERE id = $2 AND tenant_id = $3`,
        [Number(item.weight), item.nti_item_id, req.tenantId]
      );
    }

    const cancelled = await client.query(
      `UPDATE noblesse_shipments
          SET status = 'cancelled', cancelled_at = now()
        WHERE shipment_id = $1 AND tenant_id = $2
      RETURNING *`,
      [id, req.tenantId]
    );

    await client.query("COMMIT");

    for (const item of items.rows) {
      pool.query(
        `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot, performed_by)
         VALUES ($1, 'unshipped', $2, $3, $4, $5)`,
        [req.tenantId, item.nti_item_id ?? null, item.lot_number,
         JSON.stringify({ shipmentId: id, weight: item.weight, restored: true }),
         req.username]
      ).catch((err) => console.error("nti history log error:", err.message));
    }

    const found = await loadShipment(id, req.tenantId);
    res.json(fmtShipment(cancelled.rows[0], found.items));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("cancel shipment:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// A draft never moved stock, so deleting one destroys nothing. Anything shipped
// is cancelled, not deleted.
router.delete("/shipments/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid shipment id" });
  try {
    const gone = await pool.query(
      `DELETE FROM noblesse_shipments
        WHERE shipment_id = $1 AND tenant_id = $2 AND status = 'draft'
      RETURNING shipment_id`,
      [id, req.tenantId]
    );
    if (!gone.rows.length) {
      return res.status(409).json({
        error: "Only a draft can be deleted — cancel a shipped load instead",
      });
    }
    res.json({ deleted: true, shipmentId: id });
  } catch (err) {
    console.error("delete shipment:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
