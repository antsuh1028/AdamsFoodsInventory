// Adams Foods lot registration: a lot, its items, and the boxes scanned onto it. Separate from inventory.
// The barcode is re-read here, never trusted from the client.

const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const { boxFromBarcode } = require("../utils/afBox");
const { pacificToday, dayOfYearFromDate, dateFromDayOfYear, daysInYear } = require("../utils/lot");
const { toPounds, toThousandths } = require("../utils/weight");
const validLocations = require("../utils/locations");
const { seesValue } = require("../utils/afValue");

const PRICE_RE = /^\d{1,6}(\.\d{1,4})?$/;
const MAX_BOX_THOUSANDTHS = 2000n * 1000n;

// "26300" for the Pacific day: AF's lot shape, NTI's without the N.
const dayPrefix = (day) => {
  const { year, dayOfYear } = dayOfYearFromDate(day);
  return `${String(year % 100).padStart(2, "0")}${String(dayOfYear).padStart(3, "0")}`;
};

// Registers a lot under the next number for today. Skips numbers already issued here and any the
// old inventory already carries for today, so paper and system cannot hand out the same one.
const insertNextLot = async (client, tenantId, vendor, userId) => {
  const day = pacificToday();
  const prefix = dayPrefix(day);
  const used = await client.query(
    `SELECT GREATEST(
       (SELECT COALESCE(MAX(seq), 0) FROM af_lots WHERE tenant_id = $1 AND lot_date = $2),
       (SELECT COALESCE(MAX(substring(lot FROM '^' || $3 || '-(\\d{1,2})$')::int), 0)
          FROM inventory WHERE tenant_id = $1 AND lot ~ ('^' || $3 || '-\\d{1,2}$'))) AS top`,
    [tenantId, day, prefix]);
  for (let seq = Number(used.rows[0].top) + 1; seq <= 99; seq += 1) {
    const lotNumber = `${prefix}-${String(seq).padStart(2, "0")}`;
    // Taken by someone registering at the same moment: try the next one.
    const { rows } = await client.query(
      `INSERT INTO af_lots (tenant_id, lot_number, vendor, created_by, lot_date, seq)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING
       RETURNING af_lot_id, lot_number, vendor, created_at`,
      [tenantId, lotNumber, vendor, userId, day, seq]);
    if (rows.length) return rows[0];
  }
  return null;
};

// A lot number typed at registration: AF's shape for a real day, today or earlier.
const TYPED_LOT_RE = /^(\d{2})(\d{3})-(\d{1,2})$/;
const readTypedLot = (text) => {
  const m = TYPED_LOT_RE.exec(String(text).replace(/\s+/g, ""));
  if (!m) return { error: "Lot # must look like 26298-03." };
  const year = 2000 + Number(m[1]);
  const dayOfYear = Number(m[2]);
  const seq = Number(m[3]);
  if (dayOfYear < 1 || dayOfYear > daysInYear(year)) return { error: `${m[2]} is not a day of ${year}.` };
  if (seq < 1) return { error: "The number after the dash starts at 01." };
  const day = dateFromDayOfYear(year, dayOfYear);
  if (day > pacificToday()) return { error: "That lot # is for a day that has not come yet." };
  return { lotNumber: `${m[1]}${m[2]}-${String(seq).padStart(2, "0")}`, day, seq };
};

// Registers a lot under a typed number; null when that number is already registered.
const insertTypedLot = async (client, tenantId, typed, vendor, userId) => {
  const { rows } = await client.query(
    `INSERT INTO af_lots (tenant_id, lot_number, vendor, created_by, lot_date, seq)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING
     RETURNING af_lot_id, lot_number, vendor, created_at`,
    [tenantId, typed.lotNumber, vendor, userId, typed.day, typed.seq]);
  return rows[0] || null;
};

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

// Prices and values left out for roles that do not see them.
const lotFor = (role, lot) => (seesValue(role) ? lot : { ...lot, value: undefined });
const itemFor = (role, item) => (seesValue(role) ? item : { ...item, pricePerLb: undefined });

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
  entryMethod: b.entry_method,
  status: b.status,
  removedAt: b.removed_at,
  removedBy: b.removed_by,
});

const fmtPallet = (p) => ({
  palletNo: p.pallet_no,
  location: p.location,
  locatedBy: p.located_by,
  locatedAt: p.located_at,
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
              item_code, customer_part, pack_date::text AS pack_date, raw, scanned_by, scanned_at, pallet_no, item_id,
              entry_method, status, removed_at, removed_by`;
const ITEM_COLS = `item_id, description, price_per_lb::text AS price_per_lb`;

// Lots with their items, box count, total and value, newest first. Removed boxes do not count.
router.get("/af-lots", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.af_lot_id, l.lot_number, l.vendor, l.created_at,
              (SELECT COALESCE(string_agg(i.description, ', ' ORDER BY i.item_id), '')
                 FROM af_lot_items i WHERE i.af_lot_id = l.af_lot_id) AS items,
              (SELECT COUNT(*)::int FROM af_lot_boxes b
                WHERE b.af_lot_id = l.af_lot_id AND b.removed_at IS NULL) AS box_count,
              (SELECT COUNT(DISTINCT b.pallet_no)::int FROM af_lot_boxes b
                WHERE b.af_lot_id = l.af_lot_id AND b.removed_at IS NULL) AS pallets,
              (SELECT COALESCE(SUM(b.weight), 0)::text FROM af_lot_boxes b
                WHERE b.af_lot_id = l.af_lot_id AND b.removed_at IS NULL) AS total_lb,
              (SELECT SUM(b.weight * i.price_per_lb)::numeric(14,2)::text
                 FROM af_lot_boxes b JOIN af_lot_items i ON i.item_id = b.item_id
                WHERE b.af_lot_id = l.af_lot_id AND b.removed_at IS NULL) AS value
         FROM af_lots l
        WHERE l.tenant_id = $1
        ORDER BY l.created_at DESC
        LIMIT 300`,
      [req.tenantId]
    );
    res.json(rows.map((r) => lotFor(req.role, fmtLot(r))));
  } catch (err) {
    console.error("list af lots:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Register a lot with its first item. AF issues the number unless one is typed.
router.post("/af-lots", verifyToken, async (req, res) => {
  const b = req.body || {};
  const item = readItem(b);
  if (item.error) return res.status(400).json({ error: item.error });
  if (!seesValue(req.role)) item.price = null;
  const typed = String(b.lotNumber ?? "").trim() ? readTypedLot(b.lotNumber) : null;
  if (typed && typed.error) return res.status(400).json({ error: typed.error });
  const vendor = String(b.vendor ?? "").trim().toUpperCase() || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lot = typed
      ? await insertTypedLot(client, req.tenantId, typed, vendor, req.userId || null)
      : await insertNextLot(client, req.tenantId, vendor, req.userId || null);
    if (!lot) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: typed ? `Lot ${typed.lotNumber} is already registered.` : "All 99 lot numbers for today are used.",
      });
    }
    const first = await client.query(
      `INSERT INTO af_lot_items (tenant_id, af_lot_id, description, price_per_lb)
       VALUES ($1, $2, $3, $4) RETURNING ${ITEM_COLS}`,
      [req.tenantId, lot.af_lot_id, item.description, item.price]
    );
    await client.query("COMMIT");
    res.status(201).json({ ...lotFor(req.role, fmtLot(lot)), items: [itemFor(req.role, fmtItem(first.rows[0]))], boxCount: 0, totalLb: "0" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
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
    const pallets = await pool.query(
      `SELECT pallet_no, location, located_by, located_at FROM af_lot_pallets
        WHERE af_lot_id = $1 AND tenant_id = $2 ORDER BY pallet_no`, [id, req.tenantId]);
    res.json({ ...lotFor(req.role, fmtLot(lot.rows[0])), items: items.rows.map((i) => itemFor(req.role, fmtItem(i))), boxes: boxes.rows.map(fmtBox),
      pallets: pallets.rows.map(fmtPallet) });
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
  if (!seesValue(req.role)) item.price = null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO af_lot_items (tenant_id, af_lot_id, description, price_per_lb)
       SELECT $1, af_lot_id, $3, $4 FROM af_lots WHERE af_lot_id = $2 AND tenant_id = $1
       RETURNING ${ITEM_COLS}`,
      [req.tenantId, id, item.description, item.price]);
    if (!rows.length) return res.status(404).json({ error: "Lot not found" });
    res.status(201).json(itemFor(req.role, fmtItem(rows[0])));
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
      `UPDATE af_lot_items SET description = $1, price_per_lb = CASE WHEN $6 THEN $2::numeric ELSE price_per_lb END
        WHERE item_id = $3 AND af_lot_id = $4 AND tenant_id = $5 RETURNING ${ITEM_COLS}`,
      [item.description, item.price, itemId, id, req.tenantId, seesValue(req.role)]);
    if (!rows.length) return res.status(404).json({ error: "That item is not on this lot." });
    res.json(itemFor(req.role, fmtItem(rows[0])));
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

// A weight typed on the keypad, as a box: pounds, exact, within the same range a label may carry.
const typedBox = (weight, unit) => {
  const u = String(unit || "LB").toUpperCase();
  if (u !== "LB" && u !== "KG") return { error: { code: "BAD_UNIT", message: "Unit must be LB or KG." } };
  try {
    const lb = toPounds(String(weight ?? "").trim(), u);
    const t = toThousandths(lb.weight);
    if (t <= 0n || t > MAX_BOX_THOUSANDTHS) throw new Error("range");
    return { box: { weight: lb.weight, scannedWeight: String(weight).trim(), scannedUnit: u } };
  } catch {
    return { error: { code: "BAD_WEIGHT", message: "Type a weight above zero and under 2000 lb." } };
  }
};

// Saves one box, scanned or typed, onto an item and pallet of a lot.
// Returns { status, body }; the tablet's own scans and the scan station both come through here.
const addBox = async ({ tenantId, lotId, itemId, palletNo: rawPallet, entry, username }) => {
  const typed = entry && entry.rawBarcode == null && entry.weight != null;
  const { box, error } = typed
    ? typedBox(entry.weight, entry.unit)
    : boxFromBarcode(entry && entry.rawBarcode, username);
  if (error) return { status: 400, body: { code: error.code, error: error.message } };
  const palletNo = rawPallet == null ? 1 : asPallet(rawPallet);
  if (!palletNo) return { status: 400, body: { error: "Pallet must be a whole number from 1 to 999." } };
  if (!Number.isInteger(itemId)) return { status: 400, body: { error: "Pick an item before scanning." } };
  if (!(await itemOnLot(itemId, lotId, tenantId))) return { status: 404, body: { error: "That item is not on this lot." } };
  // A box with a serial is one of a kind on its lot; scanning a removed one brings it back here.
  if (box.serial) {
    const dup = await pool.query(
      `SELECT box_id, removed_at FROM af_lot_boxes WHERE af_lot_id = $1 AND tenant_id = $2 AND serial = $3
          AND COALESCE(gtin, '') = COALESCE($4, '')`, [lotId, tenantId, box.serial, box.gtin]);
    if (dup.rows.length && !dup.rows[0].removed_at) {
      return { status: 409, body: { code: "DUPLICATE", error: "That box is already on this lot." } };
    }
    if (dup.rows.length) {
      const { rows } = await pool.query(
        `UPDATE af_lot_boxes SET removed_at = NULL, removed_by = NULL, item_id = $1, pallet_no = $2
          WHERE box_id = $3 AND tenant_id = $4 RETURNING ${BOX_COLS}`,
        [itemId, palletNo, dup.rows[0].box_id, tenantId]);
      return { status: 201, body: { ...fmtBox(rows[0]), restored: true } };
    }
  }
  const { rows } = await pool.query(
    `INSERT INTO af_lot_boxes (tenant_id, af_lot_id, weight, scanned_weight, scanned_unit, gtin, serial,
            label_lot, item_code, customer_part, pack_date, raw, scanned_by, pallet_no, item_id, entry_method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING ${BOX_COLS}`,
    [tenantId, lotId, box.weight, box.scannedWeight, box.scannedUnit, box.gtin || null, box.serial || null,
     box.lot || null, box.itemCode || null, box.customerPart || null, box.packDate || null, box.raw || null,
     username || null, palletNo, itemId, typed ? "typed" : "scan"]
  );
  return { status: 201, body: fmtBox(rows[0]) };
};

// One box onto an item of a lot: scanned from its barcode, or typed on the keypad.
router.post("/af-lots/:id/boxes", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid lot id" });
  const b = req.body || {};
  try {
    const out = await addBox({ tenantId: req.tenantId, lotId: id, itemId: Number(b.itemId), palletNo: b.palletNo,
      entry: b, username: req.username });
    res.status(out.status).json(out.body);
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

// Put a pallet away: its location in the freezer, which every box on it takes.
router.put("/af-lots/:id/pallets/:palletNo", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const palletNo = asPallet(req.params.palletNo);
  if (!Number.isInteger(id) || !palletNo) return res.status(400).json({ error: "Invalid lot or pallet" });
  const location = String((req.body && req.body.location) ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!validLocations.has(location)) return res.status(400).json({ error: `${location || "That"} is not a freezer location.` });
  try {
    const { rows } = await pool.query(
      `INSERT INTO af_lot_pallets (tenant_id, af_lot_id, pallet_no, location, located_by)
       SELECT $1, af_lot_id, $3, $4, $5 FROM af_lots WHERE af_lot_id = $2 AND tenant_id = $1
       ON CONFLICT (af_lot_id, pallet_no)
         DO UPDATE SET location = EXCLUDED.location, located_by = EXCLUDED.located_by, located_at = now()
       RETURNING pallet_no, location, located_by, located_at`,
      [req.tenantId, id, palletNo, location, req.username || null]);
    if (!rows.length) return res.status(404).json({ error: "Lot not found" });
    res.json(fmtPallet(rows[0]));
  } catch (err) {
    console.error("put away af pallet:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Take a mis-scanned box off its lot. Kept and marked, so it can be restored.
router.delete("/af-lots/:id/boxes/:boxId", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const boxId = Number(req.params.boxId);
  if (!Number.isInteger(id) || !Number.isInteger(boxId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const { rows } = await pool.query(
      `UPDATE af_lot_boxes SET removed_at = now(), removed_by = $4
        WHERE box_id = $1 AND af_lot_id = $2 AND tenant_id = $3 AND removed_at IS NULL
       RETURNING ${BOX_COLS}`,
      [boxId, id, req.tenantId, req.username || null]);
    if (!rows.length) return res.status(404).json({ error: "That box is not on this lot, or was already removed." });
    res.json(fmtBox(rows[0]));
  } catch (err) {
    console.error("remove af lot box:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Put a removed box back on its lot.
router.post("/af-lots/:id/boxes/:boxId/restore", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const boxId = Number(req.params.boxId);
  if (!Number.isInteger(id) || !Number.isInteger(boxId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const { rows } = await pool.query(
      `UPDATE af_lot_boxes SET removed_at = NULL, removed_by = NULL
        WHERE box_id = $1 AND af_lot_id = $2 AND tenant_id = $3 AND removed_at IS NOT NULL
       RETURNING ${BOX_COLS}`,
      [boxId, id, req.tenantId]);
    if (!rows.length) return res.status(404).json({ error: "That box is not on this lot, or is not removed." });
    res.json(fmtBox(rows[0]));
  } catch (err) {
    console.error("restore af lot box:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── Scan station: a corded base on a computer; the tablet picks the target and watches ──

const fmtStation = (s) => ({
  id: s.station_id,
  name: s.name,
  lotId: s.af_lot_id,
  lotNumber: s.lot_number || null,
  itemId: s.item_id,
  itemDescription: s.item_description || null,
  palletNo: s.pallet_no,
  updatedBy: s.updated_by,
  updatedAt: s.updated_at,
});

const STATION_SELECT = `
  SELECT s.station_id, s.name, s.af_lot_id, s.item_id, s.pallet_no, s.updated_by, s.updated_at,
         l.lot_number, i.description AS item_description
    FROM af_scan_stations s
    LEFT JOIN af_lots l ON l.af_lot_id = s.af_lot_id
    LEFT JOIN af_lot_items i ON i.item_id = s.item_id`;

const readStation = async (id, tenantId) => {
  const { rows } = await pool.query(`${STATION_SELECT} WHERE s.station_id = $1 AND s.tenant_id = $2`, [id, tenantId]);
  return rows[0] ? fmtStation(rows[0]) : null;
};

// Which tablet session holds each station, and when it last checked in. In memory: one server
// process, and a tablet checks in every second, so a restart is forgotten within a second.
const TABLET_GONE_MS = 30_000;
const holders = new Map(); // station id -> { sessionId, by, at }
const liveHolder = (id) => {
  const h = holders.get(id);
  return h && Date.now() - h.at <= TABLET_GONE_MS ? h : null;
};
const withLive = (station) => {
  const h = liveHolder(station.id);
  return { ...station, live: Boolean(h && station.lotId), heldBy: h ? h.by : null };
};
const clearTarget = (id, tenantId) => pool.query(
  `UPDATE af_scan_stations SET af_lot_id = NULL, item_id = NULL, updated_at = now()
    WHERE station_id = $1 AND tenant_id = $2`, [id, tenantId]);

// The stations, making the first one if there are none yet.
router.get("/af-stations", verifyToken, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO af_scan_stations (tenant_id, name) SELECT $1, 'Dock 1'
        WHERE NOT EXISTS (SELECT 1 FROM af_scan_stations WHERE tenant_id = $1)`, [req.tenantId]);
    const { rows } = await pool.query(`${STATION_SELECT} WHERE s.tenant_id = $1 ORDER BY s.station_id`, [req.tenantId]);
    res.json(rows.map((r) => withLive(fmtStation(r))));
  } catch (err) {
    console.error("list scan stations:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Point a station at a lot, item and pallet; set from the tablet, which then holds the station.
router.put("/af-stations/:id/target", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const lotId = Number(b.lotId);
  const itemId = b.itemId == null ? null : Number(b.itemId);
  const palletNo = asPallet(b.palletNo ?? 1);
  const sessionId = String(b.sessionId || "");
  if (!Number.isInteger(id) || !Number.isInteger(lotId) || !palletNo || !sessionId) {
    return res.status(400).json({ error: "Invalid target" });
  }
  try {
    if (itemId !== null && !(Number.isInteger(itemId) && await itemOnLot(itemId, lotId, req.tenantId))) {
      return res.status(404).json({ error: "That item is not on this lot." });
    }
    const { rowCount } = await pool.query(
      `UPDATE af_scan_stations s SET af_lot_id = l.af_lot_id, item_id = $3, pallet_no = $4, updated_by = $5, updated_at = now()
         FROM af_lots l WHERE s.station_id = $1 AND s.tenant_id = $6 AND l.af_lot_id = $2 AND l.tenant_id = $6`,
      [id, lotId, itemId, palletNo, req.username || null, req.tenantId]);
    if (!rowCount) return res.status(404).json({ error: "Station or lot not found" });
    // Taking the station: any other tablet that held it sees it taken on its next check-in.
    holders.set(id, { sessionId, by: req.username || "a tablet", at: Date.now() });
    res.json(withLive(await readStation(id, req.tenantId)));
  } catch (err) {
    console.error("set station target:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// The tablet is done: clear the target so later scans are refused, not saved onto the old lot.
router.post("/af-stations/:id/release", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const sessionId = String((req.body && req.body.sessionId) || "");
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid station" });
  try {
    const h = holders.get(id);
    // Only the holder releases; a tablet that lost the station must not clear the new holder's target.
    if (h && h.sessionId !== sessionId) return res.json({ released: false });
    holders.delete(id);
    await clearTarget(id, req.tenantId);
    res.json({ released: true });
  } catch (err) {
    console.error("release station:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// A scan from the station computer, saved onto whatever the tablet last pointed it at.
router.post("/af-stations/:id/scan", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid station" });
  const raw = req.body && req.body.rawBarcode;
  const notRead = req.body && req.body.notRead;
  try {
    const station = await readStation(id, req.tenantId);
    if (!station) return res.status(404).json({ error: "Station not found" });
    let out;
    // A label the station could not read: logged so the tablet hears about it too.
    if (notRead) out = { status: 422, body: { error: `Not read: ${String(notRead).slice(0, 200)}` } };
    else if (!station.lotId) out = { status: 409, body: { error: "No lot picked on the tablet." } };
    else if (!liveHolder(id)) out = { status: 409, body: { error: "Tablet not connected. Choose Connect to receiving station on the tablet." } };
    else if (!station.itemId) out = { status: 409, body: { error: "No item picked on the tablet yet." } };
    else {
      out = await addBox({ tenantId: req.tenantId, lotId: station.lotId, itemId: station.itemId,
        palletNo: station.palletNo, entry: { rawBarcode: raw }, username: req.username });
    }
    const ok = out.status === 201;
    const ev = await pool.query(
      `INSERT INTO af_scan_events (tenant_id, station_id, af_lot_id, box_id, ok, message, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING event_id, created_at`,
      [req.tenantId, id, station.lotId, ok ? out.body.id : null, ok,
       ok ? (out.body.restored ? "Restored" : null) : out.body.error, raw || null]);
    res.status(out.status).json({ ...out.body, eventId: Number(ev.rows[0].event_id), station: withLive(station) });
  } catch (err) {
    console.error("station scan:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// What a station has received since a given event, with the box each one saved. The tablet polls this.
router.get("/af-stations/:id/feed", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  const since = Number(req.query.since) || 0;
  const sessionId = String(req.query.sessionId || "");
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid station" });
  try {
    const station = await readStation(id, req.tenantId);
    if (!station) return res.status(404).json({ error: "Station not found" });
    // Each check-in from the holding tablet is its heartbeat. After a server restart the first
    // tablet to check in on a targeted station takes it back.
    if (sessionId) {
      const h = holders.get(id);
      if (h && h.sessionId !== sessionId && Date.now() - h.at <= TABLET_GONE_MS) {
        return res.json({ station: withLive(station), taken: true, by: h.by, lastEventId: since, events: [] });
      }
      if (station.lotId) holders.set(id, { sessionId, by: req.username || "a tablet", at: Date.now() });
    }
    // First call: just the latest event id, so the tablet starts from now.
    if (!since) {
      const last = await pool.query(
        `SELECT COALESCE(MAX(event_id), 0) AS id FROM af_scan_events WHERE station_id = $1 AND tenant_id = $2`,
        [id, req.tenantId]);
      return res.json({ station: withLive(station), lastEventId: Number(last.rows[0].id), events: [] });
    }
    const { rows } = await pool.query(
      `SELECT e.event_id, e.af_lot_id, e.ok, e.message, e.created_at, ${BOX_COLS.replace(/(^|,\s*)(\w+)/g, "$1b.$2")}
         FROM af_scan_events e LEFT JOIN af_lot_boxes b ON b.box_id = e.box_id
        WHERE e.station_id = $1 AND e.tenant_id = $2 AND e.event_id > $3
        ORDER BY e.event_id LIMIT 100`, [id, req.tenantId, since]);
    const events = rows.map((r) => ({
      id: Number(r.event_id), lotId: r.af_lot_id, ok: r.ok, message: r.message, at: r.created_at,
      box: r.box_id ? fmtBox(r) : null,
    }));
    res.json({ station: withLive(station), lastEventId: events.length ? events[events.length - 1].id : since, events });
  } catch (err) {
    console.error("station feed:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
