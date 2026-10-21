// Processing orders: raising, completing in part or whole, and their output.

const router = require("express").Router();
const pool = require("../../utils/pg");
const verifyToken = require("../../middleware/verifyToken.pg");
const { lookupLot } = require("../../utils/lotRegistry");
const { syncProcessedStock } = require("../../utils/processedStock");
const { fmtDate } = require("./helpers/shared");

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
  // `for (const it of (items || []))` treats anything non-iterable as a throw,
  // so a number or an object here answered 500 instead of saying what was wrong.
  if (items != null && !Array.isArray(items)) {
    return res.status(400).json({ error: "items must be an array" });
  }
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

// Editing the output of an already-completed order. Runs in a transaction now,
// because it also has to move the processed stock the order put into inventory —
// changing one without the other would leave the two disagreeing.
router.patch("/noblesse-proc-orders/:id/output", verifyToken, async (req, res) => {
  const { outputWeight, outputCases } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE noblesse_processing_orders
       SET output_weight = $1, output_cases = $2
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [
        outputWeight != null ? Number(outputWeight) : null,
        outputCases  != null ? Number(outputCases)  : null,
        req.params.id, req.tenantId,
      ]
    );
    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }
    const itemsRes = await client.query(
      `SELECT * FROM noblesse_processing_order_items WHERE processing_order_id = $1 ORDER BY id`,
      [req.params.id]
    );

    // Adjusts the row this order already has rather than adding a second one.
    await syncProcessedStock(client, req.tenantId, req.params.id);

    await client.query("COMMIT");
    res.json(fmtProcOrder(result.rows[0], itemsRes.rows));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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

    // The output goes back into stock under the same lot it was cut from.
    // Inside the transaction: if this fails, the completion fails with it
    // rather than leaving an order marked done with nothing to show for it.
    await syncProcessedStock(client, req.tenantId, req.params.id);

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

    // Completing puts the output into stock; reverting to pending takes it back
    // out, because the product is no longer processed. sync works out which.
    await syncProcessedStock(client, req.tenantId, req.params.id);

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

module.exports = router;
