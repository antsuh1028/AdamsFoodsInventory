// Adams Foods barcode scanning: boxes in to a freezer location, and back out.
// The barcode is re-read here, never trusted from the client.

const crypto = require("crypto");
const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const { parseGs1 } = require("../utils/gs1");
const { toPounds, toThousandths, WeightError } = require("../utils/weight");
const { release, fmt, boxesTotal, historyEntry } = require("../utils/afInventory");

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

module.exports = router;
module.exports.boxFromBarcode = boxFromBarcode;
