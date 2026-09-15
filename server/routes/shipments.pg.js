const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { weightInLb, stockWeightInLb } = require("../utils/sqlWeight");

// Outgoing.

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

const fmtShipment = (r, items = [], sessions = []) => ({
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
  sessions: sessions.map((b) => ({
    batchId: b.batch_id,
    // The id, not just the text — it is what matches a session to a line.
    lotId: b.lot_id,
    lotNumber: b.lot_number,
    vendor: b.vendor,
    status: b.status,
    source: b.source,
    createdAt: b.created_at,
    boxCount: b.box_count,
    total: b.total,
  })),
  // What the boxes actually weighed, against what the lines claim.
  weighedTotal: sessions
    .reduce((sum, b) => sum + Math.round(Number(b.total) * 1000), 0) / 1000,
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

// Weighing sessions tied to a load.
const sessionsFor = (shipmentId, tenantId, client = pool) =>
  client.query(
    `SELECT b.batch_id, b.lot_id, b.lot_number, b.vendor, b.status, b.source, b.created_at,
            (SELECT COUNT(*)::int FROM batch_items i
              WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL) AS box_count,
            COALESCE((SELECT SUM(${weightInLb("i")})::text FROM batch_items i
              WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL), '0') AS total
       FROM shipment_batches sb
       JOIN box_batches b ON b.batch_id = sb.batch_id
      WHERE sb.shipment_id = $1 AND sb.tenant_id = $2
      ORDER BY sb.position, b.batch_id`,
    [shipmentId, tenantId]
  );

const loadShipment = async (shipmentId, tenantId, client = pool) => {
  const head = await client.query(
    `SELECT * FROM noblesse_shipments WHERE shipment_id = $1 AND tenant_id = $2`,
    [shipmentId, tenantId]
  );
  if (!head.rows.length) return null;
  const items = await itemsFor(shipmentId, tenantId, client);
  const sessions = await sessionsFor(shipmentId, tenantId, client);
  return { row: head.rows[0], items: items.rows, sessions: sessions.rows };
};

const normaliseDestination = (type, name) => {
  const t = typeof type === "string" ? type.trim().toLowerCase() : null;
  if (!t || !DESTINATIONS.has(t)) return null;
  // AdamsFoods is one place, so its name is fixed; a customer's is whatever was
  // typed.
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

// Registered BEFORE /shipments/:id: ":id" matches the literal string "available"
// and would make this unreachable.
router.get("/shipments/available", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id AS nti_item_id, s.lot_id, l.lot_number, s.lot, s.stage,
              s.description, s.brand, s.species, s.grade,
              ${stockWeightInLb("s")}::text AS on_hand,
              s.qty_cases,
              -- Shippable, but its lot is not in the registry, so nothing
              -- downstream can attribute it. The screen says so rather than
              -- dropping it: an inner join here made a real stock row vanish
              -- with no explanation.
              (s.lot_id IS NULL) AS unlinked,
              -- What was typed at the outgoing bench for this lot, for stock
              -- rows carrying no description of their own. The bench sees the
              -- boxes, so it is the better answer where the two differ.
              (SELECT NULLIF(TRIM(b.item_description), '')
                 FROM box_batches b
                WHERE b.tenant_id = s.tenant_id AND b.lot_id = s.lot_id
                  AND b.direction = 'outgoing'
                  AND NULLIF(TRIM(b.item_description), '') IS NOT NULL
                ORDER BY b.created_at DESC LIMIT 1) AS weighed_description,
              -- Flagged, not filtered: a lot mid-processing can still be
              -- shipped, but the screen should say so.
              EXISTS (SELECT 1 FROM noblesse_processing_order_items pi
                        JOIN noblesse_processing_orders po ON po.id = pi.processing_order_id
                       WHERE pi.lot_id = s.lot_id AND po.tenant_id = s.tenant_id
                         AND po.status <> 'completed') AS in_processing
         FROM nti_inventory s
         LEFT JOIN lots l ON l.lot_id = s.lot_id
        WHERE s.tenant_id = $1 AND s.weight > 0
        ORDER BY (s.stage = 'processed') DESC,
                 COALESCE(l.lot_number, s.lot) DESC`,
      [req.tenantId]
    );
    res.json(result.rows.map((r) => ({
      ntiItemId: r.nti_item_id,
      lotId: r.lot_id,
      lotNumber: r.lot_number || r.lot,
      unlinked: r.unlinked,
      stage: r.stage,
      description: r.description,
      // Only set when it differs from the row's own; the screen shows one or
      // the other, never both.
      weighedDescription: r.weighed_description,
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
    res.json(fmtShipment(found.row, found.items, found.sessions));
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
    const sessions = await sessionsFor(id, req.tenantId);
    res.json(fmtShipment(upd.rows[0], items.rows, sessions.rows));
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
    res.status(201).json(fmtShipment(found.row, found.items, found.sessions));
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
    res.json(fmtShipment(found.row, found.items, found.sessions));
  } catch (err) {
    console.error("remove shipment item:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Weighing sessions on a load. The paper tally already carries Ship To and a BOL.

router.post("/shipments/:id/box-batches", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid shipment id" });

  const { batchIds } = req.body || {};
  if (!Array.isArray(batchIds) || batchIds.length === 0) {
    return res.status(400).json({ error: "batchIds must be a non-empty array" });
  }
  if (!batchIds.every((b) => Number.isInteger(b))) {
    return res.status(400).json({ error: "batchIds must all be integers" });
  }
  const ids = [...new Set(batchIds)];

  try {
    const gate = await draftOnly(id, req.tenantId);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    // Counted rather than trusted, so a session id from another tenant cannot
    // be attached to this load.
    const owned = await pool.query(
      `SELECT batch_id, lot_number, direction
         FROM box_batches WHERE batch_id = ANY($1::int[]) AND tenant_id = $2`,
      [ids, req.tenantId]
    );
    if (owned.rows.length !== ids.length) {
      return res.status(404).json({ error: "One or more sessions were not found" });
    }

    // The mirror of the registration form's guard in boxes.pg.js.
    const incoming = owned.rows.filter((b) => b.direction === "incoming");
    if (incoming.length) {
      const names = incoming.map((b) => b.lot_number || `batch ${b.batch_id}`).join(", ");
      return res.status(409).json({
        code: "INCOMING_SESSION",
        error: `${names} weighed product ARRIVING, not leaving. A load carries ` +
               `the finished boxes weighed off the bench — weigh them with ` +
               `"Weigh finished boxes" on the Outgoing tab.`,
        sessions: incoming.map((b) => ({ batchId: b.batch_id, lotNumber: b.lot_number })),
      });
    }

    // A weighing session belongs to ONE load. Counting the same boxes on two
    // would inflate the lot's outgoing weight, which is the yield numerator, and
    // nothing downstream could tell which load was right. The mirror of
    // SESSION_ALREADY_TIED on the registration-form side.
    const claimed = await pool.query(
      `SELECT sb.batch_id, sb.shipment_id, b.lot_number, s.destination_name, s.status
         FROM shipment_batches sb
         JOIN box_batches b ON b.batch_id = sb.batch_id
         JOIN noblesse_shipments s ON s.shipment_id = sb.shipment_id
        WHERE sb.batch_id = ANY($1::int[]) AND sb.tenant_id = $2 AND sb.shipment_id <> $3`,
      [ids, req.tenantId, id]
    );
    if (claimed.rows.length) {
      const names = claimed.rows
        .map((c) => `${c.lot_number || `batch ${c.batch_id}`} (load #${c.shipment_id} ${c.destination_name})`)
        .join(", ");
      return res.status(409).json({
        code: "SESSION_ALREADY_TIED",
        error: `Already on another load: ${names}. Untie it there first.`,
        sessions: claimed.rows.map((c) => ({
          batchId: c.batch_id, shipmentId: c.shipment_id, status: c.status,
        })),
      });
    }

    // Tying the same session twice to the SAME load is a double tap, not an error.
    await pool.query(
      `INSERT INTO shipment_batches (shipment_id, batch_id, tenant_id, position)
       SELECT $1, b, $2, p FROM UNNEST($3::int[], $4::int[]) AS t(b, p)
       ON CONFLICT (shipment_id, batch_id) DO NOTHING`,
      [id, req.tenantId, ids, ids.map((_, i) => i)]
    );

    const found = await loadShipment(id, req.tenantId);
    res.status(201).json(fmtShipment(found.row, found.items, found.sessions));
  } catch (err) {
    console.error("tie shipment batches:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/shipments/:id/box-batches/:batchId", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const batchId = Number(req.params.batchId);
  if (!Number.isInteger(id) || !Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const gate = await draftOnly(id, req.tenantId);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    // Only the link goes; the session and its boxes are untouched.
    await pool.query(
      `DELETE FROM shipment_batches
        WHERE shipment_id = $1 AND batch_id = $2 AND tenant_id = $3`,
      [id, batchId, req.tenantId]
    );
    const found = await loadShipment(id, req.tenantId);
    res.json(fmtShipment(found.row, found.items, found.sessions));
  } catch (err) {
    console.error("untie shipment batch:", err);
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

    // Deducted inside the transaction with the row locked, so two shippers cannot race.
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

    const movedNothing = [];
    for (const item of items.rows) {
      if (!item.nti_item_id) {
        movedNothing.push({ lotNumber: item.lot_number, weight: String(item.weight) });
        continue;
      }
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
    res.json({
      ...fmtShipment(found.row, found.items, found.sessions),
      // Lines that had no stock row behind them, so the load left without any
      // inventory moving for them.
      movedNothing,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("ship shipment:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Cancel  The only undo.

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
    res.json(fmtShipment(cancelled.rows[0], found.items, found.sessions));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("cancel shipment:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Delete an outgoing load outright.
router.delete("/shipments/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid shipment id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Locked for the same reason ship and cancel lock: two admins pressing at
    // once must not both restore the same weight.
    const head = await client.query(
      `SELECT * FROM noblesse_shipments WHERE shipment_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, req.tenantId]
    );
    if (!head.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Shipment not found" });
    }
    const shipment = head.rows[0];

    // Read before the delete: the rows cascade away with the shipment, and this
    // is the only chance to capture them for the audit entry.
    const items = await client.query(
      `SELECT si.*, l.lot_number FROM noblesse_shipment_items si
         JOIN lots l ON l.lot_id = si.lot_id
        WHERE si.shipment_id = $1 AND si.tenant_id = $2`,
      [id, req.tenantId]
    );

    const restoresStock = shipment.status === "shipped";
    if (restoresStock) {
      for (const item of items.rows) {
        if (!item.nti_item_id) continue;
        await client.query(
          `UPDATE nti_inventory SET weight = weight + $1 WHERE id = $2 AND tenant_id = $3`,
          [Number(item.weight), item.nti_item_id, req.tenantId]
        );
      }
    }

    // Lines and weighing-session links cascade on shipment_id.
    await client.query(
      `DELETE FROM noblesse_shipments WHERE shipment_id = $1 AND tenant_id = $2`,
      [id, req.tenantId]
    );

    await client.query("COMMIT");

    console.warn(
      `shipment delete: #${id} (${shipment.status}, ${shipment.destination_name}) ` +
      `with ${items.rowCount} line(s) by user ${req.userId}` +
      (restoresStock ? " — stock restored" : "")
    );

    // Logged after COMMIT and never allowed to fail the request, matching cancel.
    if (restoresStock) {
      for (const item of items.rows) {
        pool.query(
          `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot, performed_by)
           VALUES ($1, 'unshipped', $2, $3, $4, $5)`,
          [req.tenantId, item.nti_item_id ?? null, item.lot_number,
           JSON.stringify({ shipmentId: id, weight: item.weight, restored: true,
                            reason: "shipment deleted" }),
           req.username]
        ).catch((err) => console.error("nti history log error:", err.message));
      }
    }

    // The load itself, in full. After this the snapshot is the only copy that
    // exists anywhere, so it carries the head AND every line.
    pool.query(
      `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot, performed_by)
       VALUES ($1, 'shipment_deleted', NULL, NULL, $2, $3)`,
      [req.tenantId,
       JSON.stringify({ shipment, items: items.rows, stockRestored: restoresStock }),
       req.username]
    ).catch((err) => console.error("nti history log error:", err.message));

    res.json({
      deleted: true,
      shipmentId: id,
      status: shipment.status,
      itemsDeleted: items.rowCount,
      stockRestored: restoresStock,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("delete shipment:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

module.exports = router;
