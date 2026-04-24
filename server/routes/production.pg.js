const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");

const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

const historyEntry = async (client, tenantId, item, change, username) => {
  await client.query(
    `INSERT INTO history (tenant_id, time, change, changed_by, location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      tenantId, new Date().toLocaleString(), change, username || "",
      item.location || "", item.lot || "", item.vendor || "", item.brand || "",
      item.species || "", item.description || "", item.grade || "",
      item.quantity || "", item.weight != null ? String(item.weight) : "",
      item.packdate || "", item.date_recvd || "", item.est || "",
    ]
  );
};

const boxesWeight = (boxes) =>
  boxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0);

const fmtOrder = (row) => ({
  id:            row.id,
  sentDate:      row.sent_date,
  processorName: row.processor_name,
  status:        row.status,
  returnDate:    row.return_date   || null,
  yield:         row.yield         != null ? String(row.yield) : null,
  createdAt:     row.created_at,
});

const fmtItem = (row) => ({
  id:          row.id,
  orderId:     row.production_order_id,
  inventoryId: row.inventory_id,
  weightSent:  String(row.weight_sent),
  boxesSent:   Array.isArray(row.boxes_sent) ? row.boxes_sent : [],
  location:    row.location    || null,
  lot:         row.lot         || null,
  species:     row.species     || null,
  description: row.description || null,
});

const fmtReturn = (row) => ({
  id:          row.id,
  orderId:     row.production_order_id,
  inventoryId: row.inventory_id,
  createdAt:   row.created_at,
  location:    row.location    || null,
  lot:         row.lot         || null,
  species:     row.species     || null,
  description: row.description || null,
  weight:      row.weight      != null ? String(row.weight) : null,
});

// ── Create Order (Step 2: send to processor) ──────────────────────────────────
// Body: { sentDate, processorName, items: [{ inventoryId, weightSent, boxesSent }] }
router.post("/production-orders", verifyToken, async (req, res) => {
  const { sentDate, processorName, items } = req.body;

  if (!sentDate)      return res.status(400).json({ error: "sentDate is required" });
  if (!processorName) return res.status(400).json({ error: "processorName is required" });
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "items array is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create the order
    const orderRes = await client.query(
      `INSERT INTO production_orders (tenant_id, sent_date, processor_name)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.tenantId, sentDate, processorName]
    );
    const order = orderRes.rows[0];

    // Process each pallet item
    for (const item of items) {
      const { inventoryId, weightSent, boxesSent } = item;
      if (!inventoryId || !weightSent)
        throw new Error("Each item requires inventoryId and weightSent");

      const weightNum = toNum(weightSent);
      if (!weightNum || weightNum <= 0)
        throw new Error(`Invalid weightSent: ${weightSent}`);

      const boxes = Array.isArray(boxesSent) ? boxesSent : [];

      // Verify the inventory item belongs to this tenant and has enough weight
      const invRes = await client.query(
        `SELECT id, weight, boxes FROM inventory WHERE id = $1 AND tenant_id = $2`,
        [inventoryId, req.tenantId]
      );
      if (!invRes.rows.length)
        throw new Error(`Inventory item ${inventoryId} not found`);

      const inv = invRes.rows[0];
      const currentWeight = parseFloat(inv.weight) || 0;
      if (weightNum > currentWeight + 0.01)
        throw new Error(`weightSent (${weightNum}) exceeds available weight (${currentWeight}) for item ${inventoryId}`);

      // Create the order item record
      await client.query(
        `INSERT INTO production_order_items
           (production_order_id, inventory_id, weight_sent, boxes_sent)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [order.id, inventoryId, weightNum, JSON.stringify(boxes)]
      );

      // Remove boxes and weight from inventory
      // Use splice on a mutable copy so duplicate weights are handled correctly
      const currentBoxes = Array.isArray(inv.boxes) ? inv.boxes : [];
      const sentBoxesCopy = [...boxes];
      const remainingBoxes = currentBoxes.filter((b) => {
        const idx = sentBoxesCopy.findIndex((s) => String(s.weight) === String(b.weight));
        if (idx !== -1) { sentBoxesCopy.splice(idx, 1); return false; }
        return true;
      });
      const newWeight = (currentWeight - weightNum).toFixed(2);

      if (remainingBoxes.length === 0) {
        await client.query(
          `DELETE FROM inventory WHERE id = $1`,
          [inventoryId]
        );
        await historyEntry(client, req.tenantId, inv,
          `Removed — all boxes sent to processor: ${processorName}`, req.username
        );
      } else {
        await client.query(
          `UPDATE inventory SET weight = $1, boxes = $2::jsonb, quantity = $3 WHERE id = $4`,
          [newWeight, JSON.stringify(remainingBoxes), String(remainingBoxes.length), inventoryId]
        );
      }

      await historyEntry(client, req.tenantId, {
        ...inv,
        weight: weightNum,
        quantity: String(boxes.length),
      }, `Sent to Processor: ${processorName} — ${boxes.length} box(es), ${weightNum} lb`, req.username);
    }

    await client.query("COMMIT");

    // Return the full order with items
    const itemsRes = await client.query(
      `SELECT * FROM production_order_items WHERE production_order_id = $1`,
      [order.id]
    );

    res.status(201).json({
      order: fmtOrder(order),
      items: itemsRes.rows.map(fmtItem),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("production-orders POST error:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Production history for a single inventory item ────────────────────────────
router.get("/inventory/:id/production", verifyToken, async (req, res) => {
  try {
    const [outRes, inRes] = await Promise.all([
      pool.query(
        `SELECT poi.weight_sent, poi.boxes_sent,
                po.id AS order_id, po.sent_date, po.processor_name, po.status, po.return_date, po.yield
         FROM production_order_items poi
         JOIN production_orders po ON po.id = poi.production_order_id
         WHERE poi.inventory_id = $1 AND po.tenant_id = $2
         ORDER BY po.sent_date DESC`,
        [req.params.id, req.tenantId]
      ),
      pool.query(
        `SELECT po.id AS order_id, po.sent_date, po.processor_name, po.status, po.return_date, po.yield
         FROM production_order_returns por
         JOIN production_orders po ON po.id = por.production_order_id
         WHERE por.inventory_id = $1 AND po.tenant_id = $2
         ORDER BY po.return_date DESC`,
        [req.params.id, req.tenantId]
      ),
    ]);
    res.json({
      outgoing: outRes.rows.map((r) => ({
        orderId:       r.order_id,
        processorName: r.processor_name,
        sentDate:      r.sent_date,
        status:        r.status,
        returnDate:    r.return_date || null,
        yieldPct:      r.yield != null ? String(r.yield) : null,
        weightSent:    String(r.weight_sent),
        boxesSent:     Array.isArray(r.boxes_sent) ? r.boxes_sent : [],
      })),
      incoming: inRes.rows.map((r) => ({
        orderId:       r.order_id,
        processorName: r.processor_name,
        sentDate:      r.sent_date,
        returnDate:    r.return_date || null,
        yieldPct:      r.yield != null ? String(r.yield) : null,
        status:        r.status,
      })),
    });
  } catch (err) {
    console.error("inventory production history error:", err.message);
    res.status(500).json({ error: "Failed to fetch production history" });
  }
});

// ── List Orders ───────────────────────────────────────────────────────────────
// Query: ?status=pending|returned
router.get("/production-orders", verifyToken, async (req, res) => {
  const { status } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM production_orders
       WHERE tenant_id = $1 ${status ? "AND status = $2" : ""}
       ORDER BY created_at DESC`,
      status ? [req.tenantId, status] : [req.tenantId]
    );
    res.json(result.rows.map(fmtOrder));
  } catch (err) {
    console.error("production-orders GET error:", err.message);
    res.status(500).json({ error: "Failed to fetch production orders" });
  }
});

// ── Get Single Order with items + returns ────────────────────────────────────
router.get("/production-orders/:id", verifyToken, async (req, res) => {
  try {
    const [orderRes, itemsRes, returnsRes] = await Promise.all([
      pool.query(
        `SELECT * FROM production_orders WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, req.tenantId]
      ),
      pool.query(
        `SELECT poi.*, i.location, i.lot, i.species, i.description
         FROM production_order_items poi
         LEFT JOIN inventory i ON i.id = poi.inventory_id
         WHERE poi.production_order_id = $1`,
        [req.params.id]
      ),
      pool.query(
        `SELECT por.*, i.location, i.lot, i.species, i.description, i.weight, i.boxes
         FROM production_order_returns por
         LEFT JOIN inventory i ON i.id = por.inventory_id
         WHERE por.production_order_id = $1`,
        [req.params.id]
      ),
    ]);

    if (!orderRes.rows.length)
      return res.status(404).json({ error: "Order not found" });

    res.json({
      order:   fmtOrder(orderRes.rows[0]),
      items:   itemsRes.rows.map(fmtItem),
      returns: returnsRes.rows.map(fmtReturn),
    });
  } catch (err) {
    console.error("production-orders/:id GET error:", err.message);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// ── Add Return Pallet (Step 3: finished good comes back) ─────────────────────
// Body: { location, lot, species, description, grade, brand, packdate, date_recvd, est, price, boxes }
router.post("/production-orders/:id/returns", verifyToken, async (req, res) => {
  const { location, lot, species, description, grade, brand, packdate, date_recvd, est, price, boxes } = req.body;

  if (!location) return res.status(400).json({ error: "location is required" });
  if (!lot)      return res.status(400).json({ error: "lot is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verify order exists and belongs to this tenant
    const orderRes = await client.query(
      `SELECT * FROM production_orders WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!orderRes.rows.length)
      throw new Error("Order not found");

    const order = orderRes.rows[0];

    const parsedBoxes = Array.isArray(boxes) ? boxes.map((b) => ({ weight: String(b.weight ?? b) })) : [];
    const weight = parsedBoxes.length > 0 ? boxesWeight(parsedBoxes).toFixed(2) : toNum(req.body.weight);
    const quantity = String(parsedBoxes.length || "");

    // Find the original raw inventory item via the order items to set source_id
    const sourceRes = await client.query(
      `SELECT inventory_id FROM production_order_items
       WHERE production_order_id = $1 LIMIT 1`,
      [order.id]
    );
    const sourceId = sourceRes.rows[0]?.inventory_id || null;

    // Create the new finished good inventory item
    const invRes = await client.query(
      `INSERT INTO inventory
         (tenant_id, location, lot, vendor, brand, species, description, grade,
          quantity, weight, packdate, date_recvd, est, price, type, boxes, source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'prc',$15::jsonb,$16)
       RETURNING *`,
      [
        req.tenantId, location, lot,
        orderRes.rows[0].processor_name,  // vendor = processor name on finished good
        brand || null,
        species || null, description || null, grade || null,
        quantity, weight,
        packdate || null, date_recvd || null, est || null,
        toNum(price),
        JSON.stringify(parsedBoxes),
        sourceId,
      ]
    );
    const newItem = invRes.rows[0];

    // Create the return record
    await client.query(
      `INSERT INTO production_order_returns (production_order_id, inventory_id)
       VALUES ($1, $2)`,
      [order.id, newItem.id]
    );

    await historyEntry(client, req.tenantId, newItem,
      `Returned from Processor: ${order.processor_name} — ${parsedBoxes.length} box(es), ${weight} lb`,
      req.username
    );

    await client.query("COMMIT");
    res.status(201).json({ inventoryId: newItem.id, location: newItem.location });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("production-orders returns POST error:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Close Order ───────────────────────────────────────────────────────────────
// Calculates yield and marks status = 'returned'
router.patch("/production-orders/:id/close", verifyToken, async (req, res) => {
  const { returnDate } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderRes = await client.query(
      `SELECT * FROM production_orders WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!orderRes.rows.length) throw new Error("Order not found");
    if (orderRes.rows[0].status === "returned") throw new Error("Order already closed");

    // Total raw weight sent
    const sentRes = await client.query(
      `SELECT COALESCE(SUM(weight_sent), 0) AS total FROM production_order_items
       WHERE production_order_id = $1`,
      [req.params.id]
    );
    const totalSent = parseFloat(sentRes.rows[0].total);

    // Total finished weight returned
    const returnedRes = await client.query(
      `SELECT COALESCE(SUM(i.weight), 0) AS total
       FROM production_order_returns por
       JOIN inventory i ON i.id = por.inventory_id
       WHERE por.production_order_id = $1`,
      [req.params.id]
    );
    const totalReturned = parseFloat(returnedRes.rows[0].total);

    const yieldPct = totalSent > 0
      ? ((totalReturned / totalSent) * 100).toFixed(2)
      : null;

    const updated = await client.query(
      `UPDATE production_orders
       SET status = 'returned', return_date = $1, yield = $2
       WHERE id = $3 RETURNING *`,
      [returnDate || new Date().toISOString().split("T")[0], yieldPct, req.params.id]
    );

    const order = orderRes.rows[0];
    await historyEntry(client, req.tenantId, {
      location: "", lot: "", vendor: order.processor_name, species: "", description: "",
      weight: totalReturned, quantity: "",
    }, `Production Order Closed — ${order.processor_name}, sent ${totalSent} lb, returned ${totalReturned} lb, yield ${yieldPct}%`, req.username);

    await client.query("COMMIT");
    res.json({
      order: fmtOrder(updated.rows[0]),
      totalSent,
      totalReturned,
      yieldPct,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("production-orders close error:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Delete Order ──────────────────────────────────────────────────────────────
// Deletes the order, its items, its return records, and the finished good
// inventory items created on return. Only allowed on pending orders.
router.delete("/production-orders/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderRes = await client.query(
      `SELECT * FROM production_orders WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!orderRes.rows.length) throw new Error("Order not found");

    // Get finished good inventory IDs from returns before deleting
    const returnsRes = await client.query(
      `SELECT inventory_id FROM production_order_returns WHERE production_order_id = $1`,
      [req.params.id]
    );
    const returnedInventoryIds = returnsRes.rows.map((r) => r.inventory_id);

    // Delete return records first (FK constraint)
    await client.query(
      `DELETE FROM production_order_returns WHERE production_order_id = $1`,
      [req.params.id]
    );

    // Delete the finished good inventory items
    if (returnedInventoryIds.length > 0) {
      await client.query(
        `DELETE FROM inventory WHERE id = ANY($1::uuid[])`,
        [returnedInventoryIds]
      );
    }

    // Delete order items (FK constraint)
    await client.query(
      `DELETE FROM production_order_items WHERE production_order_id = $1`,
      [req.params.id]
    );

    // Delete the order itself
    await client.query(
      `DELETE FROM production_orders WHERE id = $1`,
      [req.params.id]
    );

    await client.query("COMMIT");
    res.json({ message: "Order deleted", returnedItemsRemoved: returnedInventoryIds.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("production-orders DELETE error:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
