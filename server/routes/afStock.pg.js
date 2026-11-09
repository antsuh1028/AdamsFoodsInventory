// Adams Foods stock: what is here and where, read off the boxes. Old inventory rows ride along, marked old.

const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const { fmt } = require("../utils/afInventory");
const { seesValue } = require("../utils/afValue");


// Boxes still here, one row per lot, item and pallet. Items join one to one, so nothing fans out.
const NEW_GROUPS = `
  SELECT b.af_lot_id, b.item_id, b.pallet_no, COUNT(*)::int AS boxes, SUM(b.weight)::text AS lb,
         COALESCE(array_agg(DISTINCT b.item_code) FILTER (WHERE b.item_code IS NOT NULL), '{}') AS codes,
         COALESCE(array_agg(DISTINCT b.pack_date::text) FILTER (WHERE b.pack_date IS NOT NULL), '{}') AS pack_dates,
         (SUM(b.weight) * i.price_per_lb)::numeric(14,2)::text AS value
    FROM af_lot_boxes b
    LEFT JOIN af_lot_items i ON i.item_id = b.item_id
   WHERE b.tenant_id = $1 AND b.removed_at IS NULL AND b.status = 'in_stock'
   GROUP BY b.af_lot_id, b.item_id, b.pallet_no, i.price_per_lb`;

// New stock as lots, each with its items and pallets; locations from put-away.
const readNewStock = async (tenantId, withValue) => {
  const groups = (await pool.query(NEW_GROUPS, [tenantId])).rows;
  const lotIds = [...new Set(groups.map((g) => g.af_lot_id))];
  if (!lotIds.length) return [];
  const [lots, items, pallets] = await Promise.all([
    pool.query(
      `SELECT af_lot_id, lot_number, vendor,
              COALESCE(lot_date, (created_at AT TIME ZONE 'America/Los_Angeles')::date)::text AS received
         FROM af_lots WHERE tenant_id = $1 AND af_lot_id = ANY($2)`, [tenantId, lotIds]),
    pool.query(
      `SELECT item_id, description FROM af_lot_items WHERE tenant_id = $1 AND af_lot_id = ANY($2)`, [tenantId, lotIds]),
    pool.query(
      `SELECT af_lot_id, pallet_no, location FROM af_lot_pallets WHERE tenant_id = $1 AND af_lot_id = ANY($2)`,
      [tenantId, lotIds]),
  ]);
  const itemName = Object.fromEntries(items.rows.map((i) => [i.item_id, i.description]));
  const where = Object.fromEntries(pallets.rows.map((p) => [`${p.af_lot_id}:${p.pallet_no}`, p.location]));
  return lots.rows.map((l) => ({
    id: l.af_lot_id,
    lotNumber: l.lot_number,
    vendor: l.vendor || "",
    received: l.received,
    lines: groups.filter((g) => g.af_lot_id === l.af_lot_id).map((g) => ({
      itemId: g.item_id,
      item: itemName[g.item_id] || "No item",
      palletNo: g.pallet_no,
      location: where[`${l.af_lot_id}:${g.pallet_no}`] || null,
      boxes: g.boxes,
      lb: g.lb,
      codes: g.codes,
      packDates: g.pack_dates,
      ...(withValue ? { value: g.value } : {}),
    })),
  })).sort((a, b) => b.lotNumber.localeCompare(a.lotNumber));
};

// Old inventory rows without their box lists, which run to hundreds of KB; one row is fetched in full on demand.
const readOldStock = async (tenantId, withValue) => {
  const { rows } = await pool.query(
    `SELECT *, COALESCE(jsonb_array_length(boxes), 0) AS box_count FROM inventory WHERE tenant_id = $1`, [tenantId]);
  return rows.map((r) => {
    const { boxes, price, ...row } = fmt(r);
    return { ...row, boxCount: r.box_count, ...(withValue ? { price } : {}) };
  });
};

// Everything in stock: new lots rolled up, and the old rows.
router.get("/af-stock", verifyToken, async (req, res) => {
  const withValue = seesValue(req.role);
  try {
    const [lots, old] = await Promise.all([readNewStock(req.tenantId, withValue), readOldStock(req.tenantId, withValue)]);
    res.json({ lots, old, withValue });
  } catch (err) {
    console.error("read af stock:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// New pallets by location, for the freezer map. Pallets not yet put away are left out.
router.get("/af-stock/locations", verifyToken, async (req, res) => {
  try {
    const lots = await readNewStock(req.tenantId, false);
    const byLocation = {};
    for (const lot of lots) {
      for (const line of lot.lines) {
        if (!line.location) continue;
        (byLocation[line.location] = byLocation[line.location] || []).push({
          lotId: lot.id, lotNumber: lot.lotNumber, vendor: lot.vendor, received: lot.received,
          palletNo: line.palletNo, item: line.item, boxes: line.boxes, lb: line.lb,
        });
      }
    }
    res.json(byLocation);
  } catch (err) {
    console.error("read af stock locations:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
