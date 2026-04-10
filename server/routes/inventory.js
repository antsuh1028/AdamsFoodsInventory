const router = require("express").Router();
const FreezerModel = require("../models/Freezer");
const HistoryModel = require("../models/History");
const verifyToken = require("../middleware/verifyToken");
const requireRole = require("../middleware/requireRole");
const validLocations = require("../utils/locations");

const EDITABLE_FIELDS = ["lot", "vendor", "brand", "species", "description", "grade", "packdate", "date_recvd", "est", "price", "type"];

// Returns true if two descriptions are similar enough to be the same product
const descriptionsSimilar = (a, b) => {
  if (!a || !b) return false;
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const wordsA = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const wordsB = new Set(normalize(b).split(/\s+/).filter(Boolean));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && intersection / union >= 0.5;
};

const parsedBoxesFromInput = (boxes) =>
  Array.isArray(boxes) ? boxes.map((b) => ({ weight: String(b.weight ?? b) })) : [];

const computeFromBoxes = (parsedBoxes, fallbackWeight, fallbackQuantity) => {
  if (parsedBoxes.length === 0) return { weight: fallbackWeight, quantity: fallbackQuantity };
  const weight = parsedBoxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2);
  return { weight, quantity: String(parsedBoxes.length) };
};

const historyEntry = (item, change, extra = {}, username = "") => ({
  time: new Date().toLocaleString(),
  change,
  location: item.location,
  lot: item.lot,
  species: item.species,
  description: item.description,
  changedBy: username,
  ...extra,
});

// ----------------- Add -----------------
router.post("/inventoryAdd", verifyToken, async (req, res) => {
  const { inputs, force } = req.body;
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, type, scanImageKey, boxes } = inputs || {};

  if (!location || location.trim() === "") return res.status(400).json({ error: "Location field cannot be blank." });
  if (!validLocations.includes(location)) return res.status(400).json({ error: "Location Does Not Exist" });

  const locationUpper = location.toUpperCase();

  try {
    if (!force) {
      const occupiedCount = await FreezerModel.countDocuments({ location: locationUpper });
      if (occupiedCount > 0) return res.status(409).json({ error: `${location} already has ${occupiedCount} item(s) stored there.`, code: "LOCATION_OCCUPIED", count: occupiedCount });
    }

    const parsedBoxes = parsedBoxesFromInput(boxes);
    const { weight: computedWeight, quantity: computedQuantity } = computeFromBoxes(parsedBoxes, weight, quantity);

    const createdItem = await FreezerModel.create({ location: locationUpper, lot, vendor, brand, species, description, grade, quantity: computedQuantity, weight: computedWeight, packdate, date_recvd, est, price, type: type || null, scanImageKey, boxes: parsedBoxes });

    const addLabel = req.body.source === "scanner" ? "Scanner Add" : "Added";
    await HistoryModel.create(historyEntry(createdItem, addLabel, {
      vendor: createdItem.vendor, brand: createdItem.brand,
      grade: createdItem.grade, quantity: createdItem.quantity,
      weight: createdItem.weight, packdate: createdItem.packdate,
      date_recvd: createdItem.date_recvd, est: createdItem.est,
    }, req.username));

    res.status(201).json(createdItem);
  } catch {
    res.status(500).json({ error: "An error occurred while adding the item." });
  }
});

// ----------------- Find -----------------
router.post("/inventoryFind", verifyToken, (req, res) => {
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, type } = req.body.inputs || {};

  const ci = (v) => ({ $regex: new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });

  const query = {};
  if (location) query.location = location.toUpperCase();
  if (lot) query.lot = ci(lot);
  if (vendor) query.vendor = ci(vendor);
  if (brand) query.brand = ci(brand);
  if (species) query.species = ci(species);
  if (description) query.description = ci(description);
  if (grade) query.grade = ci(grade);
  if (quantity) query.quantity = quantity;
  if (weight) query.weight = weight;
  if (packdate) query.packdate = packdate;
  if (date_recvd) query.date_recvd = date_recvd;
  if (est) query.est = est;
  if (price) query.price = price;
  if (type) query.type = type;

  FreezerModel.find(query)
    .then((items) => items.length > 0 ? res.json(items) : res.send("INVALID"))
    .catch(() => res.status(500).json({ error: "An error occurred while retrieving the items." }));
});

// ----------------- Update -----------------
router.post("/inventoryUpdate", verifyToken, async (req, res) => {
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, type, currentItem } = req.body.updateInputs || {};

  if (!location) return res.status(400).json({ error: "Location cannot be empty." });
  if (!currentItem?._id) return res.status(400).json({ error: "Item ID is required." });

  const update = { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, type: type || null };

  try {
    const item = await FreezerModel.findByIdAndUpdate(currentItem._id, update, { new: true });
    if (!item) return res.status(404).json({ error: "No Items Found" });
    await HistoryModel.create(historyEntry(item, "Updated", {
      vendor: item.vendor, brand: item.brand, grade: item.grade,
      quantity: item.quantity, weight: item.weight,
      packdate: item.packdate, date_recvd: item.date_recvd, est: item.est,
    }, req.username));
    res.status(200).json(item);
  } catch {
    res.status(500).json({ error: "An error occurred while updating the item." });
  }
});

// ----------------- Remove -----------------
router.post("/inventoryRemove", verifyToken, async (req, res) => {
  const currentItem = req.body.currentItem || {};
  if (!currentItem._id) return res.status(400).json({ error: "Item ID is required." });

  try {
    const item = await FreezerModel.findByIdAndDelete(currentItem._id);
    if (!item) return res.status(404).json({ error: "No Items Found" });
    await HistoryModel.create(historyEntry(item, "Removed", {
      vendor: item.vendor, brand: item.brand, grade: item.grade,
      quantity: item.quantity, weight: item.weight,
      packdate: item.packdate, date_recvd: item.date_recvd, est: item.est,
    }, req.username));
    res.status(200).json({ message: "Item Successfully Deleted." });
  } catch {
    res.status(500).json({ error: "An error occurred while removing the item." });
  }
});

// ----------------- Move -----------------
router.post("/inventoryMove", verifyToken, async (req, res) => {
  const { itemId, destLocation } = req.body;
  if (!itemId || !destLocation) return res.status(400).json({ error: "itemId and destLocation are required." });
  try {
    const before = await FreezerModel.findById(itemId);
    if (!before) return res.status(404).json({ error: "Item not found." });
    const fromLocation = before.location;
    const updated = await FreezerModel.findByIdAndUpdate(itemId, { location: destLocation.toUpperCase() }, { new: true });
    await HistoryModel.create(historyEntry(updated, `Moved: ${fromLocation} → ${updated.location}`, {}, req.username));
    res.status(200).json(updated);
  } catch {
    res.status(500).json({ error: "An error occurred while moving the item." });
  }
});

// ----------------- Order Partial Remove -----------------
// Removes N boxes from each item. Deletes the item entirely if no boxes remain.
router.post("/inventoryOrderRemove", verifyToken, async (req, res) => {
  const { removals } = req.body; // [{ id, quantityToRemove }]
  if (!Array.isArray(removals) || removals.length === 0) return res.status(400).json({ error: "No removals provided." });
  try {
    const results = [];
    for (const { id, quantityToRemove } of removals) {
      const item = await FreezerModel.findById(id);
      if (!item) { results.push({ id, status: "not_found" }); continue; }

      const boxes = Array.isArray(item.boxes) ? [...item.boxes] : [];
      const n = Math.min(parseInt(quantityToRemove) || 1, boxes.length);
      const removedBoxes = boxes.splice(0, n);
      const removedWeight = removedBoxes.map((b) => parseFloat(b.weight) || 0).reduce((s, w) => s + w, 0).toFixed(2);

      if (boxes.length === 0) {
        await HistoryModel.create(historyEntry(item, `Order Removal — all ${n} box(es) (${removedWeight} lb) removed, item deleted`, {}, req.username));
        await FreezerModel.findByIdAndDelete(id);
        results.push({ id, status: "deleted" });
      } else {
        const newTotal = boxes.map((b) => parseFloat(b.weight) || 0).reduce((s, w) => s + w, 0).toFixed(2);
        item.boxes = boxes;
        item.markModified("boxes");
        item.weight = String(newTotal);
        item.quantity = String(boxes.length);
        await item.save();
        await HistoryModel.create(historyEntry(item, `Order Removal — ${n} box(es) (${removedWeight} lb) removed, ${boxes.length} remaining (${newTotal} lb)`, {}, req.username));
        results.push({ id, status: "updated", remaining: boxes.length });
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- Bulk Remove -----------------
router.post("/inventoryBulkRemove", verifyToken, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No IDs provided." });
  try {
    const items = await FreezerModel.find({ _id: { $in: ids } }).lean();
    const result = await FreezerModel.deleteMany({ _id: { $in: ids } });
    await HistoryModel.insertMany(items.map((item) => historyEntry(item, "Bulk Removed", {
      vendor: item.vendor, brand: item.brand, grade: item.grade,
      quantity: item.quantity, weight: item.weight,
      packdate: item.packdate, date_recvd: item.date_recvd, est: item.est,
    }, req.username)));
    res.status(200).json({ message: `${result.deletedCount} item(s) removed.`, deletedCount: result.deletedCount });
  } catch {
    res.status(500).json({ error: "An error occurred while removing items." });
  }
});

// ----------------- Patch Field -----------------
router.patch("/inventory/:id/field", verifyToken, async (req, res) => {
  const { field, value } = req.body;
  if (!field || !EDITABLE_FIELDS.includes(field)) return res.status(400).json({ error: "Invalid field" });
  try {
    const item = await FreezerModel.findByIdAndUpdate(req.params.id, { $set: { [field]: value } }, { new: true });
    if (!item) return res.status(404).json({ error: "Item not found" });
    await HistoryModel.create(historyEntry(item, `Field Updated: ${field} → "${value}"`, {}, req.username));
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- Box Remove -----------------
router.patch("/inventory/:id/box/remove", verifyToken, async (req, res) => {
  const { index } = req.body;
  if (index === undefined || index === null) return res.status(400).json({ error: "index is required" });
  try {
    const item = await FreezerModel.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const boxes = Array.isArray(item.boxes) ? [...item.boxes] : [];
    if (index < 0 || index >= boxes.length) return res.status(400).json({ error: "Invalid index" });
    const removedWeight = boxes[index].weight;
    boxes.splice(index, 1);
    const newTotal = boxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2);
    item.boxes = boxes;
    item.markModified("boxes");
    item.weight = String(newTotal);
    item.quantity = String(boxes.length);
    await item.save();
    await HistoryModel.create(historyEntry(item, `Box Removed (${removedWeight} lb) — ${boxes.length} box(es) remaining, ${newTotal} lb total`, { category: "box" }, req.username));
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- Box Add -----------------
router.patch("/inventory/:id/box/add", verifyToken, async (req, res) => {
  const { weight } = req.body;
  if (!weight) return res.status(400).json({ error: "weight is required" });
  try {
    const item = await FreezerModel.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const boxes = Array.isArray(item.boxes) ? [...item.boxes] : [];
    boxes.push({ weight: String(weight) });
    const newTotal = boxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2);
    item.boxes = boxes;
    item.markModified("boxes");
    item.weight = String(newTotal);
    item.quantity = String(boxes.length);
    await item.save();
    await HistoryModel.create(historyEntry(item, `Box Added (${weight} lb) — ${boxes.length} box(es) total, ${newTotal} lb total`, { category: "box" }, req.username));
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- Verify Location -----------------
router.post("/verifyLocation", verifyToken, (req, res) => {
  const { location } = req.body;
  res.send(validLocations.includes(location) ? "OK" : "INVALID");
});

// ----------------- Stats -----------------
router.get("/inventoryStats", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const safeDouble = (field) => ({ $convert: { input: { $ifNull: [field, "0"] }, to: "double", onError: 0, onNull: 0 } });
    const safeWeight = safeDouble("$weight");
    const safePrice = safeDouble("$price");
    const safeValue = { $multiply: [safeWeight, safePrice] };

    const groupByField = (field) => [
      { $group: { _id: `$${field}`, count: { $sum: 1 }, weight: { $sum: safeWeight }, value: { $sum: safeValue } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1 } },
    ];

    const [totalItems, totalWeight, bySpecies, byGrade, byVendor, occupiedLocations, oldestPallets] = await Promise.all([
      FreezerModel.countDocuments(),
      FreezerModel.aggregate([{ $group: { _id: null, total: { $sum: safeWeight }, value: { $sum: safeValue } } }]),
      FreezerModel.aggregate(groupByField("species")),
      FreezerModel.aggregate(groupByField("grade")),
      FreezerModel.aggregate(groupByField("vendor")),
      FreezerModel.distinct("location"),
      FreezerModel.find(
        { $or: [{ packdate: { $exists: true, $ne: "" } }, { date_recvd: { $exists: true, $ne: "" } }] },
        { location: 1, lot: 1, description: 1, species: 1, packdate: 1, date_recvd: 1, weight: 1 }
      ).lean().then((items) =>
        items
          .map((i) => ({ ...i, _dateStr: i.packdate || i.date_recvd }))
          .filter((i) => !isNaN(new Date(i._dateStr)))
          .sort((a, b) => new Date(a._dateStr) - new Date(b._dateStr))
          .slice(0, 5)
      ),
    ]);

    res.json({
      totalItems,
      totalWeight: totalWeight[0]?.total ?? 0,
      totalValue: totalWeight[0]?.value ?? 0,
      occupiedLocations: occupiedLocations.length,
      totalLocations: validLocations.length,
      bySpecies, byGrade, byVendor, oldestPallets,
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ----------------- Weekly Throughput -----------------
router.get("/inventoryWeeklyThroughput", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const weeks = 8;
    const now = new Date();
    const result = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - i * 7 - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const count = await HistoryModel.countDocuments({ change: /^Added/i, createdAt: { $gte: weekStart, $lt: weekEnd } });
      result.push({ week: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`, added: count });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- All / Distinct -----------------
router.get("/inventoryAll", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    res.json(await FreezerModel.find().lean());
  } catch {
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

router.get("/inventoryDistinct", verifyToken, async (req, res) => {
  const dedupeCI = (arr) => {
    const seen = new Map();
    for (const v of arr) {
      if (!v) continue;
      const key = v.toLowerCase().trim();
      if (!seen.has(key)) seen.set(key, v);
    }
    return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  };
  try {
    const [vendors, brands] = await Promise.all([FreezerModel.distinct("vendor"), FreezerModel.distinct("brand")]);
    res.json({ vendors: dedupeCI(vendors), brands: dedupeCI(brands) });
  } catch {
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

module.exports = router;
