// Adams Foods barcode scanning: boxes in to a freezer location, and back out.
// The barcode is re-read here, never trusted from the client.

const crypto = require("crypto");
const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const { parseGs1 } = require("../utils/gs1");
const { toPounds, toThousandths, WeightError } = require("../utils/weight");
const { release, fmt, boxesTotal, historyEntry } = require("../utils/afInventory");
const { pacificToday } = require("../utils/lot");

const MAX_BOX_THOUSANDTHS = 2000n * 1000n;

// One scanned label as a stored box, weight in pounds. Refuses anything that is not a weighed box label.
const boxFromBarcode = (raw, username) => {
  const text = String(raw || "").trim();
  if (!text) return { error: { code: "NO_BARCODE", message: "Nothing was scanned." } };
  let parsed;
  try { parsed = parseGs1(text); } catch (err) {
    if (err && err.code === "NO_WEIGHT_AI") {
      return { error: { code: "NO_WEIGHT", message: "That label has no weight on it, so it is not a box label." } };
    }
    return { error: { code: "BAD_BARCODE", message: "That barcode could not be read." } };
  }
  if (!parsed || !parsed.weight) {
    return { error: { code: "NO_WEIGHT", message: "That label has no weight on it, so it is not a box label." } };
  }
  let lb;
  try {
    lb = toPounds(parsed.weight.value, parsed.weight.unit);
    const t = toThousandths(lb.weight);
    if (t <= 0n || t > MAX_BOX_THOUSANDTHS) throw new WeightError("BAD_WEIGHT", "out of range");
  } catch {
    return { error: { code: "BAD_WEIGHT", message: "The weight on that label is not a plausible box weight." } };
  }
  return {
    box: {
      weight: lb.weight,
      scannedWeight: parsed.weight.value,
      scannedUnit: parsed.weight.unit,
      gtin: parsed.gtin || null,
      serial: parsed.serial || null,
      lot: parsed.lot || null,
      itemCode: parsed.itemCode || null,
      customerPart: parsed.customerPart || null,
      packDate: parsed.productionDate || parsed.packagingDate || null,
      raw: text,
      scanId: crypto.randomUUID(),
      scannedAt: new Date().toISOString(),
      scannedBy: username || null,
    },
  };
};

// A packer box is one of a kind: GTIN plus serial. Labels without a serial cannot be told apart.
const findSameBox = (client, tenantId, box) => {
  if (!box.serial) return Promise.resolve(null);
  const probe = box.gtin ? [{ gtin: box.gtin, serial: box.serial }] : [{ serial: box.serial }];
  return client.query(
    `SELECT id, location, lot FROM inventory WHERE tenant_id = $1 AND boxes @> $2::jsonb LIMIT 1`,
    [tenantId, JSON.stringify(probe)]
  ).then((r) => r.rows[0] || null);
};

// Receive: one scanned box onto an inventory row.
router.post("/inventory/:id/scan-box", verifyToken, async (req, res) => {
  const { box, error } = boxFromBarcode(req.body && req.body.rawBarcode, req.username);
  if (error) return res.status(400).json({ code: error.code, error: error.message });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const itemRes = await client.query(
      `SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [req.params.id, req.tenantId]);
    if (!itemRes.rows.length) return res.status(404).json({ code: "NOT_FOUND", error: "That inventory row is gone." });

    const same = await findSameBox(client, req.tenantId, box);
    if (same) {
      return res.status(409).json({
        code: "ALREADY_IN_STOCK",
        error: `That box is already in stock at ${same.location}${same.lot ? `, lot ${same.lot}` : ""}.`,
        where: { id: same.id, location: same.location, lot: same.lot },
      });
    }

    const boxes = Array.isArray(itemRes.rows[0].boxes) ? itemRes.rows[0].boxes : [];
    const next = [...boxes, box];
    const total = boxesTotal(next);
    const upd = await client.query(
      `UPDATE inventory SET boxes = $1::jsonb, weight = $2, quantity = $3
        WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [JSON.stringify(next), total, String(next.length), req.params.id, req.tenantId]
    );
    await historyEntry(client, req.tenantId, upd.rows[0],
      `Box Scanned In (${box.weight} lb) — ${next.length} box(es) total, ${total} lb total`, req.username);
    await client.query("COMMIT");
    res.status(201).json({ item: fmt(upd.rows[0]), box });
  } catch (err) {
    console.error("scan box in:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    await release(client);
  }
});

// Undo one scanned box, by the id it was given. The row stays even when empty: a session is still open on it.
router.post("/inventory/:id/scan-box/undo", verifyToken, async (req, res) => {
  const scanId = String((req.body && req.body.scanId) || "");
  if (!scanId) return res.status(400).json({ error: "scanId is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const itemRes = await client.query(
      `SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [req.params.id, req.tenantId]);
    if (!itemRes.rows.length) return res.status(404).json({ code: "NOT_FOUND", error: "That inventory row is gone." });
    const boxes = Array.isArray(itemRes.rows[0].boxes) ? itemRes.rows[0].boxes : [];
    const at = boxes.findIndex((b) => b && b.scanId === scanId);
    if (at === -1) return res.status(404).json({ code: "NOT_ON_ROW", error: "That box is no longer on this row." });

    const removed = boxes[at];
    const next = boxes.filter((_, i) => i !== at);
    const total = boxesTotal(next);
    const upd = await client.query(
      `UPDATE inventory SET boxes = $1::jsonb, weight = $2, quantity = $3
        WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [JSON.stringify(next), total, String(next.length), req.params.id, req.tenantId]
    );
    await historyEntry(client, req.tenantId, upd.rows[0],
      `Scanned Box Undone (${removed.weight} lb) — ${next.length} box(es) total, ${total} lb total`, req.username);
    await client.query("COMMIT");
    res.json({ item: fmt(upd.rows[0]) });
  } catch (err) {
    console.error("undo scanned box:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    await release(client);
  }
});

// ── Pulling out ─────────────────────────────────────────────────────────────

const PROCESSOR = "Noblesse Trading";
const MAX_PULL = 1000;

// What identifies a box with no serial: its codes, weight and pack date. Such boxes are interchangeable.
const likeBox = (box) => {
  const probe = { weight: box.weight };
  for (const k of ["gtin", "customerPart", "itemCode", "packDate", "lot"]) if (box[k]) probe[k] = box[k];
  return probe;
};

// Where is this box? Read-only. `exclude` lists scanIds already on the pull list.
router.post("/inventory/scan-lookup", verifyToken, async (req, res) => {
  const { box, error } = boxFromBarcode(req.body && req.body.rawBarcode, req.username);
  if (error) return res.status(400).json({ code: error.code, error: error.message });
  const exclude = new Set(Array.isArray(req.body.exclude) ? req.body.exclude.map(String) : []);

  const probe = box.serial
    ? (box.gtin ? { gtin: box.gtin, serial: box.serial } : { serial: box.serial })
    : likeBox(box);
  try {
    const { rows } = await pool.query(
      `SELECT id, location, lot, vendor, description, boxes FROM inventory
        WHERE tenant_id = $1 AND boxes @> $2::jsonb ORDER BY created_at, id`,
      [req.tenantId, JSON.stringify([probe])]
    );
    for (const r of rows) {
      const hit = (r.boxes || []).find((b) => b && b.scanId && !exclude.has(b.scanId)
        && Object.entries(probe).every(([k, v]) => b[k] === v));
      if (hit) {
        return res.json({
          box: hit,
          row: { id: r.id, location: r.location, lot: r.lot, vendor: r.vendor, description: r.description },
        });
      }
    }
    const already = rows.length > 0;
    res.status(404).json({
      code: already ? "ALREADY_ON_LIST" : "NOT_IN_STOCK",
      error: already
        ? "Every box like this one is already on the list."
        : "That box is not in stock as a scanned box. Boxes entered before scanning have to be removed by hand.",
    });
  } catch (err) {
    console.error("scan lookup:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Take exactly these boxes out, for a customer order or to NTI. All or nothing.
router.post("/inventory/scan-out", verifyToken, async (req, res) => {
  const b = req.body || {};
  const reason = b.reason === "nti" ? "nti" : b.reason === "customer" ? "customer" : null;
  const customer = String(b.customer || "").trim().slice(0, 120);
  if (!reason) return res.status(400).json({ error: "Say whether this is a customer order or going to NTI." });
  if (reason === "customer" && !customer) return res.status(400).json({ error: "Name the customer." });
  const picks = Array.isArray(b.boxes) ? b.boxes : [];
  if (!picks.length) return res.status(400).json({ error: "No boxes to take out." });
  if (picks.length > MAX_PULL) return res.status(400).json({ error: `At most ${MAX_PULL} boxes at a time.` });

  // Grouped by row; each scanId once.
  const byRow = new Map();
  const seen = new Set();
  for (const p of picks) {
    const rowId = String(p && p.rowId || "");
    const scanId = String(p && p.scanId || "");
    if (!rowId || !scanId) return res.status(400).json({ error: "Each box needs its row and scan id." });
    if (seen.has(scanId)) return res.status(400).json({ error: "The same box is on the list twice." });
    seen.add(scanId);
    if (!byRow.has(rowId)) byRow.set(rowId, []);
    byRow.get(rowId).push(scanId);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Locked in one order, so two pull-outs cannot deadlock.
    const ids = [...byRow.keys()].sort();
    const locked = await client.query(
      `SELECT * FROM inventory WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [req.tenantId, ids]
    );
    const rowsById = new Map(locked.rows.map((r) => [String(r.id), r]));
    const gone = [];
    for (const [rowId, scanIds] of byRow) {
      const r = rowsById.get(rowId);
      const have = new Set((r && Array.isArray(r.boxes) ? r.boxes : []).map((x) => x && x.scanId));
      for (const s of scanIds) if (!have.has(s)) gone.push(s);
    }
    if (gone.length) {
      return res.status(409).json({ code: "BOXES_GONE", gone,
        error: `${gone.length} box${gone.length === 1 ? " is" : "es are"} no longer in stock. Remove ${gone.length === 1 ? "it" : "them"} from the list and try again.` });
    }

    let order = null;
    if (reason === "nti") {
      order = (await client.query(
        `INSERT INTO production_orders (tenant_id, sent_date, processor_name) VALUES ($1, $2, $3) RETURNING *`,
        [req.tenantId, pacificToday(), PROCESSOR]
      )).rows[0];
    }

    const summary = [];
    for (const rowId of ids) {
      const r = rowsById.get(rowId);
      const take = new Set(byRow.get(rowId));
      const boxes = Array.isArray(r.boxes) ? r.boxes : [];
      const removed = boxes.filter((x) => take.has(x.scanId));
      const remaining = boxes.filter((x) => !take.has(x.scanId));
      const removedLb = boxesTotal(removed);

      if (order) {
        await client.query(
          `INSERT INTO production_order_items
             (production_order_id, inventory_id, weight_sent, boxes_sent, location, lot, species, description, brand)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
          [order.id, r.id, removedLb, JSON.stringify(removed),
           r.location || null, r.lot || null, r.species || null, r.description || null, r.brand || null]
        );
      }

      const what = order
        ? `Sent to Processor: ${PROCESSOR} — ${removed.length} box(es), ${removedLb} lb (scanned)`
        : `Order Removal — ${removed.length} box(es) (${removedLb} lb) scanned out for ${customer}`;
      if (!remaining.length) {
        await historyEntry(client, req.tenantId, { ...r, weight: removedLb, quantity: String(removed.length) },
          `${what}, item deleted`, req.username);
        await client.query(`DELETE FROM inventory WHERE id = $1 AND tenant_id = $2`, [r.id, req.tenantId]);
      } else {
        const total = boxesTotal(remaining);
        await client.query(
          `UPDATE inventory SET boxes = $1::jsonb, weight = $2, quantity = $3 WHERE id = $4 AND tenant_id = $5`,
          [JSON.stringify(remaining), total, String(remaining.length), r.id, req.tenantId]
        );
        await historyEntry(client, req.tenantId, { ...r, weight: removedLb, quantity: String(removed.length) },
          `${what}, ${remaining.length} box(es) remaining (${total} lb)`, req.username);
      }
      summary.push({ rowId: r.id, location: r.location, lot: r.lot, boxes: removed.length,
        lb: removedLb, deleted: !remaining.length });
    }

    await client.query("COMMIT");
    res.json({ reason, customer: reason === "customer" ? customer : null,
      orderId: order ? order.id : null, rows: summary });
  } catch (err) {
    console.error("scan out:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    await release(client);
  }
});

module.exports = router;
module.exports.boxFromBarcode = boxFromBarcode;
