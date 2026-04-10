const router = require("express").Router();
const FreezerModel = require("../models/Freezer");
const HistoryModel = require("../models/History");
const verifyToken = require("../middleware/verifyToken");
const validLocations = require("../utils/locations");

const EDITABLE_FIELDS = ["lot", "vendor", "brand", "species", "description", "grade", "packdate", "date_recvd", "est", "price"];

const parsedBoxesFromInput = (boxes) =>
  Array.isArray(boxes) ? boxes.map((b) => ({ weight: String(b.weight ?? b) })) : [];

const computeFromBoxes = (parsedBoxes, fallbackWeight, fallbackQuantity) => {
  if (parsedBoxes.length === 0) return { weight: fallbackWeight, quantity: fallbackQuantity };
  const weight = parsedBoxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2);
  return { weight, quantity: String(parsedBoxes.length) };
};

const historyEntry = (item, change, extra = {}) => ({
  time: new Date().toLocaleString(),
  change,
  location: item.location,
  lot: item.lot,
  species: item.species,
  description: item.description,
  ...extra,
});

// ----------------- Add -----------------
router.post("/inventoryAdd", verifyToken, async (req, res) => {
  const { inputs, force } = req.body;
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, scanImageKey, boxes } = inputs || {};

  if (!location || location.trim() === "") return res.status(400).json({ error: "Location field cannot be blank." });
  if (!validLocations.includes(location)) return res.status(400).json({ error: "Location Does Not Exist" });

  const locationUpper = location.toUpperCase();

  try {
    if (lot) {
      const exactDuplicate = await FreezerModel.findOne({ location: locationUpper, lot });
      if (exactDuplicate) return res.status(409).json({ error: `Lot ${lot} already exists at ${location}.`, code: "EXACT_DUPLICATE", existingItem: exactDuplicate });
    }

    if (!force) {
      const occupiedCount = await FreezerModel.countDocuments({ location: locationUpper });
      if (occupiedCount > 0) return res.status(409).json({ error: `${location} already has ${occupiedCount} item(s) stored there.`, code: "LOCATION_OCCUPIED", count: occupiedCount });
    }

    const parsedBoxes = parsedBoxesFromInput(boxes);
    const { weight: computedWeight, quantity: computedQuantity } = computeFromBoxes(parsedBoxes, weight, quantity);

    const createdItem = await FreezerModel.create({ location: locationUpper, lot, vendor, brand, species, description, grade, quantity: computedQuantity, weight: computedWeight, packdate, date_recvd, est, price, scanImageKey, boxes: parsedBoxes });

    if (req.body.source === "scanner") {
      await HistoryModel.create(historyEntry(createdItem, "Scanner Add", {
        vendor: createdItem.vendor, brand: createdItem.brand,
        grade: createdItem.grade, quantity: createdItem.quantity,
        weight: createdItem.weight, packdate: createdItem.packdate,
        date_recvd: createdItem.date_recvd, est: createdItem.est,
      }));
    }

    res.status(201).json(createdItem);
  } catch {
    res.status(500).json({ error: "An error occurred while adding the item." });
  }
});

// ----------------- Find -----------------
router.post("/inventoryFind", verifyToken, (req, res) => {
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price } = req.body.inputs || {};

  const query = {};
  if (location) query.location = location.toUpperCase();
  if (lot) query.lot = lot;
  if (vendor) query.vendor = vendor;
  if (brand) query.brand = brand;
  if (species) query.species = species;
  if (description) query.description = description;
  if (grade) query.grade = grade;
  if (quantity) query.quantity = quantity;
  if (weight) query.weight = weight;
  if (packdate) query.packdate = packdate;
  if (date_recvd) query.date_recvd = date_recvd;
  if (est) query.est = est;
  if (price) query.price = price;

  FreezerModel.find(query)
    .then((items) => items.length > 0 ? res.json(items) : res.send("INVALID"))
    .catch(() => res.status(500).json({ error: "An error occurred while retrieving the items." }));
});

// ----------------- Update -----------------
router.post("/inventoryUpdate", verifyToken, (req, res) => {
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, currentItem } = req.body.updateInputs || {};

  if (!location) return res.status(400).json({ error: "Location cannot be empty." });
  if (!currentItem?._id) return res.status(400).json({ error: "Item ID is required." });

  const update = { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price };

  FreezerModel.findByIdAndUpdate(currentItem._id, update, { new: true })
    .then((item) => item ? res.status(200).json(item) : res.status(404).json({ error: "No Items Found" }))
    .catch(() => res.status(500).json({ error: "An error occurred while updating the item." }));
});

// ----------------- Remove -----------------
router.post("/inventoryRemove", verifyToken, (req, res) => {
  const currentItem = req.body.currentItem || {};
  if (!currentItem._id) return res.status(400).json({ error: "Item ID is required." });

  FreezerModel.findByIdAndDelete(currentItem._id)
    .then((item) => item
      ? res.status(200).json({ message: "Item Successfully Deleted." })
      : res.status(404).json({ error: "No Items Found" })
    )
    .catch(() => res.status(500).json({ error: "An error occurred while removing the item." }));
});

// ----------------- Move -----------------
router.post("/inventoryMove", verifyToken, async (req, res) => {
  const { itemId, destLocation } = req.body;
  if (!itemId || !destLocation) return res.status(400).json({ error: "itemId and destLocation are required." });
  try {
    const updated = await FreezerModel.findByIdAndUpdate(itemId, { location: destLocation.toUpperCase() }, { new: true });
    if (!updated) return res.status(404).json({ error: "Item not found." });
    res.status(200).json(updated);
  } catch {
    res.status(500).json({ error: "An error occurred while moving the item." });
  }
});

// ----------------- Bulk Remove -----------------
router.post("/inventoryBulkRemove", verifyToken, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No IDs provided." });
  try {
    const result = await FreezerModel.deleteMany({ _id: { $in: ids } });
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
    await HistoryModel.create(historyEntry(item, `Field Updated: ${field} → "${value}"`));
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
    await HistoryModel.create(historyEntry(item, `Box Removed (${removedWeight} lb) — ${boxes.length} box(es) remaining, ${newTotal} lb total`, { category: "box" }));
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
    await HistoryModel.create(historyEntry(item, `Box Added (${weight} lb) — ${boxes.length} box(es) total, ${newTotal} lb total`, { category: "box" }));
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
router.get("/inventoryStats", verifyToken, async (req, res) => {
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
router.get("/inventoryWeeklyThroughput", verifyToken, async (req, res) => {
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
router.get("/inventoryAll", verifyToken, async (req, res) => {
  try {
    res.json(await FreezerModel.find().lean());
  } catch {
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

router.get("/inventoryDistinct", verifyToken, async (req, res) => {
  try {
    const [vendors, brands] = await Promise.all([FreezerModel.distinct("vendor"), FreezerModel.distinct("brand")]);
    res.json({ vendors: vendors.filter(Boolean).sort(), brands: brands.filter(Boolean).sort() });
  } catch {
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

module.exports = router;
