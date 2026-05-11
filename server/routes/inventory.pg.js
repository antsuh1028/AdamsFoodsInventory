const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const validLocations = require("../utils/locations");

const EDITABLE_FIELDS = ["lot", "vendor", "brand", "species", "description", "grade", "packdate", "date_recvd", "est", "price", "type"];

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (row) => ({
  _id:          row.id,
  location:     row.location      || "",
  lot:          row.lot           || "",
  vendor:       row.vendor        || "",
  brand:        row.brand         || "",
  species:      row.species       || "",
  description:  row.description   || "",
  grade:        row.grade         || "",
  quantity:     row.quantity      || "",
  weight:       row.weight        != null ? String(row.weight) : "",
  packdate:     row.packdate      || "",
  date_recvd:   row.date_recvd    || "",
  est:          row.est           || "",
  price:        row.price         != null ? String(row.price) : "",
  scanImageKey: row.scan_image_key || null,
  type:         row.type          || null,
  source_id:    row.source_id     || null,
  boxes:        Array.isArray(row.boxes) ? row.boxes : [],
});

const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

const boxesWeight = (boxes) =>
  boxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2);

const historyEntry = async (client, tenantId, item, change, username, oldData = null) => {
  await client.query(
    `INSERT INTO history (tenant_id, time, change, changed_by, location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, old_data, scan_image_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      tenantId, new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }), change, username || "",
      item.location || "", item.lot || "", item.vendor || "", item.brand || "",
      item.species || "", item.description || "", item.grade || "",
      item.quantity || "", item.weight != null ? String(item.weight) : "",
      item.packdate || "", item.date_recvd || "", item.est || "",
      oldData ? JSON.stringify(oldData) : null,
      item.scan_image_key || null,
    ]
  );
};

// ── Add ───────────────────────────────────────────────────────────────────────
router.post("/inventoryAdd", verifyToken, async (req, res) => {
  const { inputs, force } = req.body;
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, type, scanImageKey, boxes, source_id } = inputs || {};

  if (!location || !location.trim()) return res.status(400).json({ error: "Location field cannot be blank." });
  const locationUpper = location.toUpperCase();
  if (!validLocations.includes(locationUpper)) return res.status(400).json({ error: "Location Does Not Exist" });
  const parsedBoxes = Array.isArray(boxes) ? boxes.map((b) => ({ weight: String(b.weight ?? b) })) : [];
  const computedWeight = parsedBoxes.length > 0 ? boxesWeight(parsedBoxes) : weight;
  const computedQty    = parsedBoxes.length > 0 ? String(parsedBoxes.length) : quantity;

  const client = await pool.connect();
  try {
    if (!force) {
      const occ = await client.query(
        `SELECT COUNT(*) FROM inventory WHERE tenant_id = $1 AND location = $2`,
        [req.tenantId, locationUpper]
      );
      const count = parseInt(occ.rows[0].count);
      if (count > 0) return res.status(409).json({ error: `${location} already has ${count} item(s) stored there.`, code: "LOCATION_OCCUPIED", count });
    }

    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO inventory
         (tenant_id, location, lot, vendor, brand, species, description, grade,
          quantity, weight, packdate, date_recvd, est, price, scan_image_key, type, boxes, source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [req.tenantId, locationUpper, lot||null, vendor||null, brand||null, species||null,
       description||null, grade||null, computedQty||null, toNum(computedWeight),
       packdate||null, date_recvd||null, est||null, toNum(price), scanImageKey||null,
       type||null, JSON.stringify(parsedBoxes), source_id||null]
    );
    const item = ins.rows[0];
    const addLabel = req.body.source === "scanner" ? "Scanner Add" : "Added";
    await historyEntry(client, req.tenantId, item, addLabel, req.username);
    await client.query("COMMIT");

    res.status(201).json(fmt(item));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("inventoryAdd error:", err);
    res.status(500).json({ error: "An error occurred while adding the item." });
  } finally {
    client.release();
  }
});

// ── Find ──────────────────────────────────────────────────────────────────────
router.post("/inventoryFind", verifyToken, async (req, res) => {
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, type } = req.body.inputs || {};

  const conditions = ["tenant_id = $1"];
  const params = [req.tenantId];
  let idx = 2;

  const tokenMatch = (col, val) => {
    const tokens = val.trim().split(/\s+/).filter(Boolean);
    for (const t of tokens) { conditions.push(`${col} ILIKE $${idx++}`); params.push(`%${t}%`); }
  };
  const ilike = (col, val) => { conditions.push(`${col} ILIKE $${idx++}`); params.push(`%${val.trim()}%`); };

  if (location)    { conditions.push(`location ILIKE $${idx++}`); params.push(location.toUpperCase() + "%"); }
  if (lot)         ilike("lot", lot);
  if (vendor)      tokenMatch("vendor", vendor);
  if (brand)       tokenMatch("brand", brand);
  if (species)     tokenMatch("species", species);
  if (description) tokenMatch("description", description);
  if (grade)       ilike("grade", grade);
  if (quantity)    { conditions.push(`quantity = $${idx++}`); params.push(quantity); }
  if (weight)      { conditions.push(`weight = $${idx++}`); params.push(toNum(weight)); }
  if (packdate)    { conditions.push(`packdate = $${idx++}`); params.push(packdate); }
  if (date_recvd)  { conditions.push(`date_recvd = $${idx++}`); params.push(date_recvd); }
  if (est)         ilike("est", est);
  if (price)       { conditions.push(`price = $${idx++}`); params.push(toNum(price)); }
  if (type)        { conditions.push(`LOWER(type) = LOWER($${idx++})`); params.push(type); }

  try {
    const result = await pool.query(
      `SELECT * FROM inventory WHERE ${conditions.join(" AND ")}`,
      params
    );
    if (result.rows.length === 0) return res.send("INVALID");
    res.json(result.rows.map(fmt));
  } catch (err) {
    res.status(500).json({ error: "An error occurred while retrieving the items." });
  }
});

// ── Update ────────────────────────────────────────────────────────────────────
router.post("/inventoryUpdate", verifyToken, async (req, res) => {
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, type, currentItem } = req.body.updateInputs || {};
  if (!location) return res.status(400).json({ error: "Location cannot be empty." });
  if (!currentItem?._id) return res.status(400).json({ error: "Item ID is required." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      `SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2`,
      [currentItem._id, req.tenantId]
    );
    if (before.rows.length === 0) return res.status(404).json({ error: "No Items Found" });
    const oldRow = before.rows[0];
    const upd = await client.query(
      `UPDATE inventory SET location=$1,lot=$2,vendor=$3,brand=$4,species=$5,description=$6,grade=$7,
       quantity=$8,weight=$9,packdate=$10,date_recvd=$11,est=$12,price=$13,type=$14
       WHERE id=$15 AND tenant_id=$16 RETURNING *`,
      [location, lot||null, vendor||null, brand||null, species||null, description||null, grade||null,
       quantity||null, toNum(weight), packdate||null, date_recvd||null, est||null, toNum(price), type||null,
       currentItem._id, req.tenantId]
    );
    if (upd.rows.length === 0) return res.status(404).json({ error: "No Items Found" });
    const oldData = {
      location: oldRow.location, lot: oldRow.lot, vendor: oldRow.vendor, brand: oldRow.brand,
      species: oldRow.species, description: oldRow.description, grade: oldRow.grade,
      quantity: oldRow.quantity, weight: oldRow.weight != null ? String(oldRow.weight) : "",
      packdate: oldRow.packdate, date_recvd: oldRow.date_recvd, est: oldRow.est,
    };
    await historyEntry(client, req.tenantId, upd.rows[0], "Updated", req.username, oldData);
    await client.query("COMMIT");
    res.status(200).json(fmt(upd.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "An error occurred while updating the item." });
  } finally {
    client.release();
  }
});

// ── Remove ────────────────────────────────────────────────────────────────────
router.post("/inventoryRemove", verifyToken, async (req, res) => {
  const currentItem = req.body.currentItem || {};
  if (!currentItem._id) return res.status(400).json({ error: "Item ID is required." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const del = await client.query(
      `DELETE FROM inventory WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [currentItem._id, req.tenantId]
    );
    if (del.rows.length === 0) return res.status(404).json({ error: "No Items Found" });
    await historyEntry(client, req.tenantId, del.rows[0], "Removed", req.username);
    await client.query("COMMIT");
    res.status(200).json({ message: "Item Successfully Deleted." });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "An error occurred while removing the item." });
  } finally {
    client.release();
  }
});

// ── Move ──────────────────────────────────────────────────────────────────────
router.post("/inventoryMove", verifyToken, async (req, res) => {
  const { itemId, destLocation } = req.body;
  if (!itemId || !destLocation) return res.status(400).json({ error: "itemId and destLocation are required." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(`SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2`, [itemId, req.tenantId]);
    if (before.rows.length === 0) return res.status(404).json({ error: "Item not found." });
    const fromLoc = before.rows[0].location;
    const dest = destLocation.toUpperCase();
    const upd = await client.query(
      `UPDATE inventory SET location = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [dest, itemId, req.tenantId]
    );
    await historyEntry(client, req.tenantId, upd.rows[0], `Moved: ${fromLoc} → ${dest}`, req.username);
    await client.query("COMMIT");
    res.status(200).json(fmt(upd.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "An error occurred while moving the item." });
  } finally {
    client.release();
  }
});

// ── Order Partial Remove ──────────────────────────────────────────────────────
router.post("/inventoryOrderRemove", verifyToken, async (req, res) => {
  const { removals } = req.body;
  if (!Array.isArray(removals) || removals.length === 0) return res.status(400).json({ error: "No removals provided." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const { id, quantityToRemove } of removals) {
      const itemRes = await client.query(`SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2`, [id, req.tenantId]);
      if (itemRes.rows.length === 0) { results.push({ id, status: "not_found" }); continue; }
      const item = itemRes.rows[0];
      const boxes = Array.isArray(item.boxes) ? item.boxes : [];
      const n = Math.min(parseInt(quantityToRemove) || 1, boxes.length);
      const removed   = boxes.slice(0, n);
      const remaining = boxes.slice(n);
      const removedWeight = boxesWeight(removed);

      if (remaining.length === 0) {
        await historyEntry(client, req.tenantId, item, `Order Removal — all ${n} box(es) (${removedWeight} lb) removed, item deleted`, req.username);
        await client.query(`DELETE FROM inventory WHERE id = $1`, [id]);
        results.push({ id, status: "deleted" });
      } else {
        const newTotal = boxesWeight(remaining);
        await client.query(
          `UPDATE inventory SET boxes = $1::jsonb, weight = $2, quantity = $3 WHERE id = $4`,
          [JSON.stringify(remaining), toNum(newTotal), String(remaining.length), id]
        );
        await historyEntry(client, req.tenantId, { ...item, weight: newTotal, quantity: String(remaining.length) },
          `Order Removal — ${n} box(es) (${removedWeight} lb) removed, ${remaining.length} remaining (${newTotal} lb)`, req.username);
        results.push({ id, status: "updated", remaining: remaining.length });
      }
    }
    await client.query("COMMIT");
    res.json({ results });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Bulk Remove ───────────────────────────────────────────────────────────────
router.post("/inventoryBulkRemove", verifyToken, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No IDs provided." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const items = await client.query(
      `SELECT * FROM inventory WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [ids, req.tenantId]
    );
    for (const item of items.rows) await historyEntry(client, req.tenantId, item, "Bulk Removed", req.username);
    const del = await client.query(`DELETE FROM inventory WHERE id = ANY($1::uuid[]) AND tenant_id = $2`, [ids, req.tenantId]);
    await client.query("COMMIT");
    res.status(200).json({ message: `${del.rowCount} item(s) removed.`, deletedCount: del.rowCount });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("inventoryBulkRemove error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Patch Field ───────────────────────────────────────────────────────────────
router.patch("/inventory/:id/field", verifyToken, async (req, res) => {
  const { field, value } = req.body;
  if (!field || !EDITABLE_FIELDS.includes(field)) return res.status(400).json({ error: "Invalid field" });
  const col = field === "scanImageKey" ? "scan_image_key" : field;
  const NUMERIC_FIELDS = ["price"];
  const dbValue = NUMERIC_FIELDS.includes(field) ? toNum(value) : (value === "" ? null : value);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      `SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (before.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    const oldVal = before.rows[0][col] ?? "";
    const upd = await client.query(
      `UPDATE inventory SET ${col} = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [dbValue, req.params.id, req.tenantId]
    );
    if (upd.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    await historyEntry(client, req.tenantId, upd.rows[0], `Field Updated: ${field}: "${oldVal}" → "${dbValue ?? ""}"`, req.username);
    await client.query("COMMIT");
    res.json(fmt(upd.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Box Remove ────────────────────────────────────────────────────────────────
router.patch("/inventory/:id/box/remove", verifyToken, async (req, res) => {
  const { index } = req.body;
  if (index === undefined || index === null) return res.status(400).json({ error: "index is required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const itemRes = await client.query(`SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]);
    if (itemRes.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    const boxes = Array.isArray(itemRes.rows[0].boxes) ? itemRes.rows[0].boxes : [];
    if (index < 0 || index >= boxes.length) return res.status(400).json({ error: "Invalid index" });
    const removedWeight = boxes[index].weight;
    const remaining = boxes.filter((_, i) => i !== index);
    const newTotal = boxesWeight(remaining);

    if (remaining.length === 0) {
      await historyEntry(client, req.tenantId, itemRes.rows[0],
        `Box Removed (${removedWeight} lb) — last box, item deleted`, req.username);
      await client.query(`DELETE FROM inventory WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]);
      await client.query("COMMIT");
      return res.json({ deleted: true });
    }

    const upd = await client.query(
      `UPDATE inventory SET boxes = $1::jsonb, weight = $2, quantity = $3 WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [JSON.stringify(remaining), toNum(newTotal), String(remaining.length), req.params.id, req.tenantId]
    );
    await historyEntry(client, req.tenantId, upd.rows[0],
      `Box Removed (${removedWeight} lb) — ${remaining.length} box(es) remaining, ${newTotal} lb total`, req.username);
    await client.query("COMMIT");
    res.json(fmt(upd.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Box Add ───────────────────────────────────────────────────────────────────
router.patch("/inventory/:id/box/add", verifyToken, async (req, res) => {
  const { weight } = req.body;
  if (!weight) return res.status(400).json({ error: "weight is required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const itemRes = await client.query(`SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]);
    if (itemRes.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    const boxes = Array.isArray(itemRes.rows[0].boxes) ? itemRes.rows[0].boxes : [];
    const newBoxes = [...boxes, { weight: String(weight) }];
    const newTotal = boxesWeight(newBoxes);
    const upd = await client.query(
      `UPDATE inventory SET boxes = $1::jsonb, weight = $2, quantity = $3 WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [JSON.stringify(newBoxes), toNum(newTotal), String(newBoxes.length), req.params.id, req.tenantId]
    );
    await historyEntry(client, req.tenantId, upd.rows[0],
      `Box Added (${weight} lb) — ${newBoxes.length} box(es) total, ${newTotal} lb total`, req.username);
    await client.query("COMMIT");
    res.json(fmt(upd.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Box Bulk Add ──────────────────────────────────────────────────────────────
router.patch("/inventory/:id/box/bulk-add", verifyToken, async (req, res) => {
  const { count, weight } = req.body;
  const n = parseInt(count);
  const w = parseFloat(weight);
  if (!n || n <= 0 || isNaN(n)) return res.status(400).json({ error: "count must be a positive integer" });
  if (!w || w <= 0 || isNaN(w)) return res.status(400).json({ error: "weight must be a positive number" });
  if (n > 500) return res.status(400).json({ error: "count cannot exceed 500" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const itemRes = await client.query(`SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]);
    if (itemRes.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    const existing = Array.isArray(itemRes.rows[0].boxes) ? itemRes.rows[0].boxes : [];
    const newBoxes = [...existing, ...Array.from({ length: n }, () => ({ weight: String(w) }))];
    const newTotal = boxesWeight(newBoxes);
    const upd = await client.query(
      `UPDATE inventory SET boxes = $1::jsonb, weight = $2, quantity = $3 WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [JSON.stringify(newBoxes), toNum(newTotal), String(newBoxes.length), req.params.id, req.tenantId]
    );
    await historyEntry(client, req.tenantId, upd.rows[0],
      `Bulk Added ${n} box(es) @ ${w} lb each — ${newBoxes.length} box(es) total, ${newTotal} lb total`, req.username);
    await client.query("COMMIT");
    res.json(fmt(upd.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Restore ───────────────────────────────────────────────────────────────────
router.post("/inventoryRestore", verifyToken, requireRole("admin", "manager"), async (req, res) => {
  const { historyItem, force } = req.body;
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est } = historyItem || {};

  if (!location) return res.status(400).json({ error: "No location in history record" });
  const locationUpper = location.toUpperCase();
  if (!validLocations.includes(locationUpper)) return res.status(400).json({ error: "Location no longer exists" });

  const client = await pool.connect();
  try {
    if (!force) {
      const occ = await client.query(
        `SELECT COUNT(*) FROM inventory WHERE tenant_id = $1 AND location = $2`,
        [req.tenantId, locationUpper]
      );
      const count = parseInt(occ.rows[0].count);
      if (count > 0) return res.status(409).json({ error: `${locationUpper} is currently occupied by ${count} item(s).`, code: "LOCATION_OCCUPIED", count });
    }

    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO inventory
         (tenant_id, location, lot, vendor, brand, species, description, grade,
          quantity, weight, packdate, date_recvd, est, boxes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.tenantId, locationUpper, lot||null, vendor||null, brand||null, species||null,
       description||null, grade||null, quantity||null, toNum(weight),
       packdate||null, date_recvd||null, est||null, JSON.stringify([])]
    );
    await historyEntry(client, req.tenantId, ins.rows[0], "Restored", req.username);
    await client.query("COMMIT");
    res.status(201).json(fmt(ins.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("inventoryRestore error:", err);
    res.status(500).json({ error: "Failed to restore item" });
  } finally {
    client.release();
  }
});

// ── Verify Location ───────────────────────────────────────────────────────────
router.post("/verifyLocation", verifyToken, (req, res) => {
  const { location } = req.body;
  res.send(validLocations.includes(location) ? "OK" : "INVALID");
});

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get("/inventoryStats", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const tid = req.tenantId;
    const [totalRes, breakdownRes, locRes, oldestRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) as total_items, SUM(weight) as total_weight, SUM(weight * COALESCE(price, 0)) as total_value
         FROM inventory WHERE tenant_id = $1`, [tid]
      ),
      pool.query(
        `SELECT 'species' as dim, species as _id, COUNT(*) as count, SUM(weight) as weight, SUM(weight * COALESCE(price,0)) as value FROM inventory WHERE tenant_id=$1 AND species IS NOT NULL GROUP BY species
         UNION ALL
         SELECT 'grade', grade, COUNT(*), SUM(weight), SUM(weight * COALESCE(price,0)) FROM inventory WHERE tenant_id=$1 AND grade IS NOT NULL GROUP BY grade
         UNION ALL
         SELECT 'vendor', vendor, COUNT(*), SUM(weight), SUM(weight * COALESCE(price,0)) FROM inventory WHERE tenant_id=$1 AND vendor IS NOT NULL GROUP BY vendor`,
        [tid]
      ),
      pool.query(`SELECT COUNT(DISTINCT location) as occupied FROM inventory WHERE tenant_id = $1`, [tid]),
      pool.query(
        `SELECT id, location, lot, description, species, packdate, date_recvd, weight,
           COALESCE(NULLIF(packdate,''), NULLIF(date_recvd,'')) as date_str
         FROM inventory WHERE tenant_id = $1
           AND (NULLIF(packdate,'') IS NOT NULL OR NULLIF(date_recvd,'') IS NOT NULL)
         ORDER BY date_str ASC LIMIT 5`,
        [tid]
      ),
    ]);

    const group = (dim) => breakdownRes.rows
      .filter((r) => r.dim === dim)
      .map((r) => ({ _id: r._id, count: parseInt(r.count), weight: parseFloat(r.weight) || 0, value: parseFloat(r.value) || 0 }))
      .sort((a, b) => b.count - a.count);

    res.json({
      totalItems:        parseInt(totalRes.rows[0].total_items),
      totalWeight:       parseFloat(totalRes.rows[0].total_weight) || 0,
      totalValue:        parseFloat(totalRes.rows[0].total_value)  || 0,
      occupiedLocations: parseInt(locRes.rows[0].occupied),
      totalLocations:    validLocations.length,
      bySpecies:         group("species"),
      byGrade:           group("grade"),
      byVendor:          group("vendor"),
      oldestPallets:     oldestRes.rows.map((r) => ({ ...r, _id: r.id, _dateStr: r.date_str })),
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ── Weekly Throughput ─────────────────────────────────────────────────────────
router.get("/inventoryWeeklyThroughput", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         DATE_TRUNC('week', created_at) AS week_start,
         SUM(CASE WHEN LOWER(change) = 'added'       THEN 1 ELSE 0 END) AS added,
         SUM(CASE WHEN LOWER(change) = 'scanner add' THEN 1 ELSE 0 END) AS scanner
       FROM history
       WHERE tenant_id = $1
         AND LOWER(change) IN ('added', 'scanner add')
         AND created_at >= NOW() - INTERVAL '8 weeks'
       GROUP BY week_start
       ORDER BY week_start`,
      [req.tenantId]
    );

    const now = new Date();
    // DATE_TRUNC('week', created_at) returns UTC midnight on Monday (ISO 8601).
    // Build buckets in UTC too so toISOString().slice(0,10) keys match on any server timezone.
    const dayOfWeekUTC = (now.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const buckets = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(now.getUTCDate() - i * 7 - dayOfWeekUTC);
      d.setUTCHours(0, 0, 0, 0);
      buckets.push({ key: d.toISOString().slice(0, 10), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` });
    }

    const byWeek = {};
    for (const r of result.rows) {
      // week_start is a UTC TIMESTAMPTZ — slice ISO string for YYYY-MM-DD key
      byWeek[new Date(r.week_start).toISOString().slice(0, 10)] = {
        added:   parseInt(r.added),
        scanner: parseInt(r.scanner),
      };
    }

    res.json(buckets.map((b) => ({
      week:    b.label,
      added:   byWeek[b.key]?.added   ?? 0,
      scanner: byWeek[b.key]?.scanner ?? 0,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── All / Distinct ────────────────────────────────────────────────────────────
router.get("/inventoryAll", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM inventory WHERE tenant_id = $1 ORDER BY location`,
      [req.tenantId]
    );
    res.json(result.rows.map(fmt));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

router.get("/inventoryDistinct", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT vendor, brand FROM inventory WHERE tenant_id = $1 AND (vendor IS NOT NULL OR brand IS NOT NULL)`,
      [req.tenantId] 
    );
    const dedupeCI = (arr) => {
      const seen = new Map();
      for (const v of arr) {
        if (!v) continue;
        const key = v.toLowerCase().trim();
        if (!seen.has(key)) seen.set(key, v);
      }
      return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    };
    res.json({
      vendors: dedupeCI(result.rows.map((r) => r.vendor).filter(Boolean)),
      brands:  dedupeCI(result.rows.map((r) => r.brand).filter(Boolean)),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

// ── Production inventory search (partial match, boxes only) ───────────────────
router.get("/inventorySearch", verifyToken, async (req, res) => {
  const q    = (req.query.q    || "").trim();
  const type = (req.query.type || "").trim();
  if (!q) return res.json([]);
  try {
    const params = [req.tenantId, `%${q}%`];
    const typeClause = type ? `AND (LOWER(type) = LOWER($${params.push(type)}) OR type IS NULL)` : "";
    const sql = `SELECT id, location, lot, species, description, type, weight, boxes,
            COALESCE(jsonb_array_length(boxes), 0) AS box_count
       FROM inventory
       WHERE tenant_id = $1
         AND (weight IS NOT NULL AND weight > 0)
         ${typeClause}
         AND (
           location    ILIKE $2 OR
           lot         ILIKE $2 OR
           species     ILIKE $2 OR
           description ILIKE $2
         )
       ORDER BY location
       LIMIT 50`;
    const result = await pool.query(sql, params);
    res.json(result.rows.map(fmt));
  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
