// Adams Foods lot registration: a lot, its items, and the boxes scanned onto it. Separate from inventory.
// The barcode is re-read here, never trusted from the client.

const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const { boxFromBarcode } = require("../utils/afBox");

const PRICE_RE = /^\d{1,6}(\.\d{1,4})?$/;

const fmtLot = (r) => ({
  id: r.af_lot_id,
  lotNumber: r.lot_number,
  vendor: r.vendor || "",
  createdAt: r.created_at,
  items: r.items ?? undefined,
  boxCount: r.box_count ?? undefined,
  pallets: r.pallets ?? undefined,
  totalLb: r.total_lb ?? undefined,
  value: r.value ?? undefined,
});

const fmtItem = (i) => ({
  id: i.item_id,
  description: i.description,
  pricePerLb: i.price_per_lb,
});

const fmtBox = (b) => ({
  id: b.box_id,
  weight: b.weight,
  scannedWeight: b.scanned_weight,
  scannedUnit: b.scanned_unit,
  gtin: b.gtin,
  serial: b.serial,
  labelLot: b.label_lot,
  itemCode: b.item_code,
  customerPart: b.customer_part,
  packDate: b.pack_date,
  raw: b.raw,
  scannedBy: b.scanned_by,
  scannedAt: b.scanned_at,
  palletNo: b.pallet_no,
  itemId: b.item_id,
});

// A pallet number as given, or null when it is not a whole number from 1 to 999.
const asPallet = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
};

// An item as typed, or an error message.
const readItem = (body) => {
  const description = String(body.description ?? "").trim().toUpperCase();
  const price = String(body.pricePerLb ?? "").trim();
  if (!description) return { error: "Type a description for the item." };
  if (price && !PRICE_RE.test(price)) return { error: "Price per lb must be a number, e.g. 4.25." };
  return { description, price: price || null };
};

const BOX_COLS = `box_id, weight::text AS weight, scanned_weight, scanned_unit, gtin, serial, label_lot,
              item_code, customer_part, pack_date::text AS pack_date, raw, scanned_by, scanned_at, pallet_no, item_id`;
const ITEM_COLS = `item_id, description, price_per_lb::text AS price_per_lb`;

// Lots with their items, box count, total and value, newest first.
router.get("/af-lots", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.af_lot_id, l.lot_number, l.vendor, l.created_at,
              (SELECT COALESCE(string_agg(i.description, ', ' ORDER BY i.item_id), '')
                 FROM af_lot_items i WHERE i.af_lot_id = l.af_lot_id) AS items,
              (SELECT COUNT(*)::int FROM af_lot_boxes b WHERE b.af_lot_id = l.af_lot_id) AS box_count,
              (SELECT COUNT(DISTINCT b.pallet_no)::int FROM af_lot_boxes b WHERE b.af_lot_id = l.af_lot_id) AS pallets,
              (SELECT COALESCE(SUM(b.weight), 0)::text FROM af_lot_boxes b WHERE b.af_lot_id = l.af_lot_id) AS total_lb,
              (SELECT SUM(b.weight * i.price_per_lb)::numeric(14,2)::text
                 FROM af_lot_boxes b JOIN af_lot_items i ON i.item_id = b.item_id
                WHERE b.af_lot_id = l.af_lot_id) AS value
         FROM af_lots l
        WHERE l.tenant_id = $1
        ORDER BY l.created_at DESC
        LIMIT 300`,
      [req.tenantId]
    );
    res.json(rows.map(fmtLot));
  } catch (err) {
    console.error("list af lots:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Register a lot with its first item. The number is typed for now.
router.post("/af-lots", verifyToken, async (req, res) => {
  const b = req.body || {};
  const lotNumber = String(b.lotNumber ?? "").trim().toUpperCase();
  if (!lotNumber) return res.status(400).json({ error: "Type a lot number." });
  const item = readItem(b);
  if (item.error) return res.status(400).json({ error: item.error });
  const vendor = String(b.vendor ?? "").trim().toUpperCase() || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lot = await client.query(
      `INSERT INTO af_lots (tenant_id, lot_number, vendor, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING af_lot_id, lot_number, vendor, created_at`,
      [req.tenantId, lotNumber, vendor, req.userId || null]
    );
    const first = await client.query(
      `INSERT INTO af_lot_items (tenant_id, af_lot_id, description, price_per_lb)
       VALUES ($1, $2, $3, $4) RETURNING ${ITEM_COLS}`,
      [req.tenantId, lot.rows[0].af_lot_id, item.description, item.price]
    );
    await client.query("COMMIT");
    res.status(201).json({ ...fmtLot(lot.rows[0]), items: [fmtItem(first.rows[0])], boxCount: 0, totalLb: "0" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return res.status(409).json({ error: `Lot ${lotNumber} is already registered. Open it to add another item.` });
    console.error("create af lot:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// One lot with its items and every box on it, in scan order.
router.get("/af-lots/:id", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid lot id" });
  try {
    const lot = await pool.query(
      `SELECT af_lot_id, lot_number, vendor, created_at
         FROM af_lots WHERE af_lot_id = $1 AND tenant_id = $2`, [id, req.tenantId]);
    if (!lot.rows.length) return res.status(404).json({ error: "Lot not found" });
    const items = await pool.query(
      `SELECT ${ITEM_COLS} FROM af_lot_items WHERE af_lot_id = $1 AND tenant_id = $2 ORDER BY item_id`,
      [id, req.tenantId]);
    const boxes = await pool.query(
      `SELECT ${BOX_COLS}
         FROM af_lot_boxes WHERE af_lot_id = $1 AND tenant_id = $2 ORDER BY pallet_no, box_id`, [id, req.tenantId]);
    res.json({ ...fmtLot(lot.rows[0]), items: items.rows.map(fmtItem), boxes: boxes.rows.map(fmtBox) });
  } catch (err) {
    console.error("read af lot:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Another item on a lot.
router.post("/af-lots/:id/items", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid lot id" });
  const item = readItem(req.body || {});
  if (item.error) return res.status(400).json({ error: item.error });
  try {
    const { rows } = await pool.query(
      `INSERT INTO af_lot_items (tenant_id, af_lot_id, description, price_per_lb)
       SELECT $1, af_lot_id, $3, $4 FROM af_lots WHERE af_lot_id = $2 AND tenant_id = $1
       RETURNING ${ITEM_COLS}`,
      [req.tenantId, id, item.description, item.price]);
    if (!rows.length) return res.status(404).json({ error: "Lot not found" });
    res.status(201).json(fmtItem(rows[0]));
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: `${item.description} is already an item on this lot.` });
    console.error("add af lot item:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Correct an item's description or price.
router.patch("/af-lots/:id/items/:itemId", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(id) || !Number.isInteger(itemId)) return res.status(400).json({ error: "Invalid id" });
  const item = readItem(req.body || {});
  if (item.error) return res.status(400).json({ error: item.error });
  try {
    const { rows } = await pool.query(
      `UPDATE af_lot_items SET description = $1, price_per_lb = $2
        WHERE item_id = $3 AND af_lot_id = $4 AND tenant_id = $5 RETURNING ${ITEM_COLS}`,
      [item.description, item.price, itemId, id, req.tenantId]);
    if (!rows.length) return res.status(404).json({ error: "That item is not on this lot." });
    res.json(fmtItem(rows[0]));
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: `${item.description} is already an item on this lot.` });
    console.error("edit af lot item:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// True when the item belongs to this lot.
const itemOnLot = async (itemId, lotId, tenantId) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM af_lot_items WHERE item_id = $1 AND af_lot_id = $2 AND tenant_id = $3`, [itemId, lotId, tenantId]);
  return rows.length > 0;
};

// One scanned box onto an item of a lot.
router.post("/af-lots/:id/boxes", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid lot id" });
  const { box, error } = boxFromBarcode(req.body && req.body.rawBarcode, req.username);
  if (error) return res.status(400).json({ code: error.code, error: error.message });
  const palletNo = req.body.palletNo == null ? 1 : asPallet(req.body.palletNo);
  if (!palletNo) return res.status(400).json({ error: "Pallet must be a whole number from 1 to 999." });
  const itemId = Number(req.body.itemId);
  if (!Number.isInteger(itemId)) return res.status(400).json({ error: "Pick an item before scanning." });
  try {
    if (!(await itemOnLot(itemId, id, req.tenantId))) return res.status(404).json({ error: "That item is not on this lot." });
    // A box with a serial is one of a kind on its lot.
    if (box.serial) {
      const dup = await pool.query(
        `SELECT 1 FROM af_lot_boxes WHERE af_lot_id = $1 AND tenant_id = $2 AND serial = $3
            AND COALESCE(gtin, '') = COALESCE($4, '')`, [id, req.tenantId, box.serial, box.gtin]);
      if (dup.rows.length) return res.status(409).json({ code: "DUPLICATE", error: "That box is already on this lot." });
    }
    const { rows } = await pool.query(
      `INSERT INTO af_lot_boxes (tenant_id, af_lot_id, weight, scanned_weight, scanned_unit, gtin, serial,
              label_lot, item_code, customer_part, pack_date, raw, scanned_by, pallet_no, item_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${BOX_COLS}`,
      [req.tenantId, id, box.weight, box.scannedWeight, box.scannedUnit, box.gtin, box.serial,
       box.lot, box.itemCode, box.customerPart, box.packDate, box.raw, req.username || null, palletNo, itemId]
    );
    res.status(201).json(fmtBox(rows[0]));
  } catch (err) {
    console.error("scan box onto af lot:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Move a box to another pallet or item of the same lot.
router.patch("/af-lots/:id/boxes/:boxId", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const boxId = Number(req.params.boxId);
  if (!Number.isInteger(id) || !Number.isInteger(boxId)) return res.status(400).json({ error: "Invalid id" });
  const body = req.body || {};
  const palletNo = body.palletNo == null ? null : asPallet(body.palletNo);
  if (body.palletNo != null && !palletNo) return res.status(400).json({ error: "Pallet must be a whole number from 1 to 999." });
  const itemId = body.itemId == null ? null : Number(body.itemId);
  if (itemId === null && palletNo === null) return res.status(400).json({ error: "Nothing to change." });
  try {
    if (itemId !== null && !(Number.isInteger(itemId) && await itemOnLot(itemId, id, req.tenantId))) {
      return res.status(404).json({ error: "That item is not on this lot." });
    }
    const { rows } = await pool.query(
      `UPDATE af_lot_boxes SET pallet_no = COALESCE($1, pallet_no), item_id = COALESCE($2, item_id)
        WHERE box_id = $3 AND af_lot_id = $4 AND tenant_id = $5
       RETURNING ${BOX_COLS}`, [palletNo, itemId, boxId, id, req.tenantId]);
    if (!rows.length) return res.status(404).json({ error: "That box is not on this lot." });
    res.json(fmtBox(rows[0]));
  } catch (err) {
    console.error("move af lot box:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Take a mis-scanned box off its lot.
router.delete("/af-lots/:id/boxes/:boxId", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const boxId = Number(req.params.boxId);
  if (!Number.isInteger(id) || !Number.isInteger(boxId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM af_lot_boxes WHERE box_id = $1 AND af_lot_id = $2 AND tenant_id = $3`,
      [boxId, id, req.tenantId]);
    if (!rowCount) return res.status(404).json({ error: "That box is not on this lot." });
    res.json({ ok: true });
  } catch (err) {
    console.error("remove af lot box:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
