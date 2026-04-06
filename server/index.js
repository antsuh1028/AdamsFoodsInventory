const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const UserModel = require("./models/User");
const FreezerModel = require("./models/Freezer");
const HistoryModel = require("./models/History");
const app = express();

const multer = require("multer");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { TextractClient, AnalyzeDocumentCommand } = require("@aws-sdk/client-textract");
const sharp = require("sharp");
const heicConvert = require("heic-convert");

// console.log("=== SERVER RESTART ===", new Date().toLocaleString());

require("dotenv").config();
const SECRET_KEY = process.env.JWT_SECRET;

app.use(express.json());
app.use(cors());
app.options("*", cors());

// MongoDB connection
const MONGO_DB_URI = process.env.MONGO_DB_URI;

mongoose
  .connect(MONGO_DB_URI)
  .then(() => console.log("Connected to MongoDB Atlas"))
  .catch((err) => console.error("Connection error", err));

const fs = require("fs");
const PDF = require("./models/PDF");

// Global variable to store valid locations
let validLocations = [];

const loadLocations = () => {
  try {
    const data = fs.readFileSync("./locations.txt", "utf8");
    validLocations = data
      .split("\n")
      .map((location) => location.trim())
      .filter(Boolean);
    // console.log("Locations loaded successfully");
  } catch (err) {
    console.error("Error reading locations file:", err);
  }
};

loadLocations();

// ----------------- JWT Middleware -----------------
const verifyToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) {
    return res.status(403).json({ message: "No token provided" });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    req.userId = decoded.userId;
    next();
  });
};

// ----------------- Inventory Routes -----------------

app.post("/inventoryAdd", verifyToken, async (req, res) => {
  const { inputs, force } = req.body;
  const {
    location,
    lot,
    vendor,
    brand,
    species,
    description,
    grade,
    quantity,
    weight,
    packdate,
    date_recvd,
    est,
    price,
    scanImageKey,
    boxes,
  } = inputs || {};

  if (!location || location.trim() === "") {
    return res.status(400).json({ error: "Location field cannot be blank." });
  }

  if (!validLocations.includes(location)) {
    return res.status(400).json({ error: "Location Does Not Exist" });
  }

  const locationUpper = location.toUpperCase();

  try {
    // Hard block: same location + same lot is always a duplicate
    if (lot) {
      const exactDuplicate = await FreezerModel.findOne({ location: locationUpper, lot });
      if (exactDuplicate) {
        return res.status(409).json({
          error: `Lot ${lot} already exists at ${location}.`,
          code: "EXACT_DUPLICATE",
          existingItem: exactDuplicate,
        });
      }
    }

    // Soft block: location is occupied — warn unless the user confirmed (force flag)
    if (!force) {
      const occupiedCount = await FreezerModel.countDocuments({ location: locationUpper });
      if (occupiedCount > 0) {
        return res.status(409).json({
          error: `${location} already has ${occupiedCount} item(s) stored there.`,
          code: "LOCATION_OCCUPIED",
          count: occupiedCount,
        });
      }
    }

    const parsedBoxes = Array.isArray(boxes) ? boxes.map((b) => ({ weight: String(b.weight ?? b) })) : [];
    const computedWeight = parsedBoxes.length > 0
      ? parsedBoxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2)
      : weight;
    const computedQuantity = parsedBoxes.length > 0 ? String(parsedBoxes.length) : quantity;

    const newItem = {
      location: locationUpper,
      lot,
      vendor,
      brand,
      species,
      description,
      grade,
      quantity: computedQuantity,
      weight: computedWeight,
      packdate,
      date_recvd,
      est,
      price,
      scanImageKey,
      boxes: parsedBoxes,
    };

    const createdItem = await FreezerModel.create(newItem);
    res.status(201).json(createdItem);
  } catch {
    res.status(500).json({ error: "An error occurred while adding the item." });
  }
});

app.post("/scanner-resolve", verifyToken, async (req, res) => {
  const { action, existingId, inputs } = req.body;
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, scanImageKey, boxes } = inputs || {};
  const parsedBoxes = Array.isArray(boxes) ? boxes.map((b) => ({ weight: String(b.weight ?? b) })) : [];
  const computedWeight = parsedBoxes.length > 0
    ? parsedBoxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2)
    : weight;
  const computedQuantity = parsedBoxes.length > 0 ? String(parsedBoxes.length) : quantity;
  const logFields = (item, change) => ({
    time: new Date().toLocaleString(), change,
    location: item.location, lot: item.lot, vendor: item.vendor, brand: item.brand,
    species: item.species, description: item.description, grade: item.grade,
    quantity: item.quantity, weight: item.weight, packdate: item.packdate,
    date_recvd: item.date_recvd, est: item.est,
  });
  try {
    if (action === "update") {
      const updated = await FreezerModel.findByIdAndUpdate(
        existingId,
        { $set: { vendor, brand, species, description, grade, quantity: computedQuantity, weight: computedWeight, packdate, date_recvd, est, price, scanImageKey, boxes: parsedBoxes } },
        { new: true }
      );
      if (!updated) return res.status(404).json({ error: "Item not found" });
      await HistoryModel.create(logFields(updated, "Scanner Update"));
      return res.json(updated);
    }
    if (action === "override") {
      const existing = await FreezerModel.findById(existingId);
      if (!existing) return res.status(404).json({ error: "Item not found" });
      await HistoryModel.create(logFields(existing, "Scanner Override - Removed"));
      await FreezerModel.findByIdAndDelete(existingId);
      const locationUpper = (location || existing.location).toUpperCase();
      const newItem = await FreezerModel.create({ location: locationUpper, lot, vendor, brand, species, description, grade, quantity: computedQuantity, weight: computedWeight, packdate, date_recvd, est, price, scanImageKey, boxes: parsedBoxes });
      await HistoryModel.create(logFields(newItem, "Scanner Override - Added"));
      return res.status(201).json(newItem);
    }
    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/inventoryFind", verifyToken, (req, res) => {
  const {
    location,
    lot,
    vendor,
    brand,
    species,
    description,
    grade,
    quantity,
    weight,
    packdate,
    date_recvd,
    est,
    price,
  } = req.body.inputs || {};

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
    .then((items) => {
      if (items.length > 0) {
        res.json(items);
      } else {
        res.send("INVALID");
      }
    })
    .catch(() =>
      res.status(500).json({ error: "An error occurred while retrieving the items." })
    );
});

app.post("/inventoryUpdate", verifyToken, (req, res) => {
  const {
    location,
    lot,
    vendor,
    brand,
    species,
    description,
    grade,
    quantity,
    weight,
    packdate,
    date_recvd,
    est,
    price,
    currentItem,
  } = req.body.updateInputs || {};

  if (!location) {
    return res.status(400).json({
      error: "Location cannot be empty. Specify criteria to update an item.",
    });
  }

  const update = {
    location,
    lot,
    vendor,
    brand,
    species,
    description,
    grade,
    quantity,
    weight,
    packdate,
    date_recvd,
    est,
    price,
  };

  FreezerModel.findOneAndUpdate(currentItem, update, { new: true })
    .then((item) => {
      if (item) {
        res.status(200).json(item);
      } else {
        res.status(404).json({ error: "No Items Found" });
      }
    })
    .catch(() =>
      res.status(500).json({ error: "An error occurred while updating the item." })
    );
});

app.post("/inventoryRemove", verifyToken, (req, res) => {
  const {
    location,
    lot,
    vendor,
    brand,
    species,
    description,
    grade,
    quantity,
    weight,
    packdate,
    date_recvd,
    est,
    price,
  } = req.body.currentItem || {};

  const filter = {
    location,
    lot,
    vendor,
    brand,
    species,
    description,
    grade,
    quantity,
    weight,
    packdate,
    date_recvd,
    est,
    price,
  };

  if (!location || location.trim() === "") {
    return res.status(400).json({ error: "Location field cannot be blank." });
  }

  FreezerModel.findOne(filter)
    .then((item) => {
      if (item) {
        return FreezerModel.deleteOne(filter).then(() =>
          res.status(200).json({ message: "Item Successfully Deleted." })
        );
      } else {
        res.status(404).json({ error: "No Items Found" });
      }
    })
    .catch(() =>
      res.status(500).json({ error: "An error occurred while removing the item." })
    );
});

app.post("/inventoryMove", verifyToken, async (req, res) => {
  const { itemId, destLocation } = req.body;
  if (!itemId || !destLocation) {
    return res.status(400).json({ error: "itemId and destLocation are required." });
  }
  try {
    const updated = await FreezerModel.findByIdAndUpdate(
      itemId,
      { location: destLocation.toUpperCase() },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Item not found." });
    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ error: "An error occurred while moving the item." });
  }
});

app.post("/inventoryBulkRemove", verifyToken, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "No IDs provided." });
  }
  try {
    const result = await FreezerModel.deleteMany({ _id: { $in: ids } });
    res.status(200).json({ message: `${result.deletedCount} item(s) removed.`, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: "An error occurred while removing items." });
  }
});

// Patch a single field on an inventory item
const EDITABLE_FIELDS = ["lot", "vendor", "brand", "species", "description", "grade", "packdate", "date_recvd", "est", "price"];
app.patch("/inventory/:id/field", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { field, value } = req.body;
  if (!field || !EDITABLE_FIELDS.includes(field)) return res.status(400).json({ error: "Invalid field" });
  try {
    const item = await FreezerModel.findByIdAndUpdate(id, { $set: { [field]: value } }, { new: true });
    if (!item) return res.status(404).json({ error: "Item not found" });
    await HistoryModel.create({
      time: new Date().toLocaleString(),
      change: `Field Updated: ${field} → "${value}"`,
      location: item.location, lot: item.lot, species: item.species, description: item.description,
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a single box from a pallet by index
app.patch("/inventory/:id/box/remove", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { index } = req.body;
  if (index === undefined || index === null) return res.status(400).json({ error: "index is required" });
  try {
    const item = await FreezerModel.findById(id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const boxes = Array.isArray(item.boxes) ? [...item.boxes] : [];
    if (index < 0 || index >= boxes.length) return res.status(400).json({ error: "Invalid index" });
    const removedWeight = boxes[index].weight;
    boxes.splice(index, 1);
    const newTotal = boxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2);
    item.boxes = boxes;
    item.markModified('boxes');
    item.weight = String(newTotal);
    item.quantity = String(boxes.length);
    await item.save();
    await HistoryModel.create({
      time: new Date().toLocaleString(), change: `Box Removed (${removedWeight} lb) — ${boxes.length} box(es) remaining, ${newTotal} lb total`,
      location: item.location, lot: item.lot, species: item.species, description: item.description,
      category: "box",
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a single box to a pallet
app.patch("/inventory/:id/box/add", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { weight } = req.body;
  if (!weight) return res.status(400).json({ error: "weight is required" });
  try {
    const item = await FreezerModel.findById(id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const boxes = Array.isArray(item.boxes) ? [...item.boxes] : [];
    boxes.push({ weight: String(weight) });
    const newTotal = boxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2);
    item.boxes = boxes;
    item.markModified('boxes');
    item.weight = String(newTotal);
    item.quantity = String(boxes.length);
    await item.save();
    await HistoryModel.create({
      time: new Date().toLocaleString(), change: `Box Added (${weight} lb) — ${boxes.length} box(es) total, ${newTotal} lb total`,
      location: item.location, lot: item.lot, species: item.species, description: item.description,
      category: "box",
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/verifyLocation", verifyToken, (req, res) => {
  const location = req.body.location;
  if (!validLocations.includes(location)) {
    return res.send("INVALID");
  }
  return res.send("OK");
});

app.get("/inventoryStats", verifyToken, async (req, res) => {
  try {
    const safeDouble = (field) => ({
      $convert: { input: { $ifNull: [field, "0"] }, to: "double", onError: 0, onNull: 0 }
    });
    const safeWeight = safeDouble("$weight");
    const safePrice = safeDouble("$price");
    const safeValue = { $multiply: [safeWeight, safePrice] };

    const [totalItems, totalWeight, bySpecies, byGrade, byVendor, occupiedLocations, oldestPallets] = await Promise.all([
      FreezerModel.countDocuments(),
      FreezerModel.aggregate([{ $group: { _id: null, total: { $sum: safeWeight }, value: { $sum: safeValue } } }]),
      FreezerModel.aggregate([
        { $group: { _id: "$species", count: { $sum: 1 }, weight: { $sum: safeWeight }, value: { $sum: safeValue } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { count: -1 } },
      ]),
      FreezerModel.aggregate([
        { $group: { _id: "$grade", count: { $sum: 1 }, weight: { $sum: safeWeight }, value: { $sum: safeValue } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { count: -1 } },
      ]),
      FreezerModel.aggregate([
        { $group: { _id: "$vendor", count: { $sum: 1 }, weight: { $sum: safeWeight }, value: { $sum: safeValue } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { count: -1 } },
      ]),
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
      bySpecies,
      byGrade,
      byVendor,
      oldestPallets,
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

app.get("/inventoryWeeklyThroughput", verifyToken, async (req, res) => {
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
      const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
      const count = await HistoryModel.countDocuments({
        change: /^Added/i,
        createdAt: { $gte: weekStart, $lt: weekEnd },
      });
      result.push({ week: label, added: count });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/inventoryAll", verifyToken, async (req, res) => {
  try {
    const items = await FreezerModel.find().lean();
    return res.json(items);
  } catch {
    return res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

app.get("/inventoryDistinct", verifyToken, async (req, res) => {
  try {
    const [vendors, brands] = await Promise.all([
      FreezerModel.distinct("vendor"),
      FreezerModel.distinct("brand"),
    ]);
    res.json({
      vendors: vendors.filter(Boolean).sort(),
      brands: brands.filter(Boolean).sort(),
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

// ----------------- History Routes -----------------

app.post("/addHistory", verifyToken, (req, res) => {
  const newHistory = {
    time: new Date().toLocaleString(),
    change: req.body.change || "",
    location: req.body.location || "",
    lot: req.body.lot || "",
    vendor: req.body.vendor || "",
    brand: req.body.brand || "",
    species: req.body.species || "",
    description: req.body.description || "",
    grade: req.body.grade || "",
    quantity: String(req.body.quantity || ""),
    weight: String(req.body.weight || ""),
    packdate: req.body.packdate || "",
    date_recvd: req.body.date_recvd || "",
    est: req.body.est || "",
  };

  if (!newHistory.change) {
    return res.status(400).json({ error: "Change type is required" });
  }

  HistoryModel.create(newHistory)
    .then((item) => res.status(201).json(item))
    .catch(() =>
      res.status(500).json({ error: "Error adding history item" })
    );
});

app.get("/getHistory", verifyToken, (req, res) => {
  HistoryModel.find()
    .sort({ _id: -1 })
    .limit(50)
    .then((items) => res.json(items))
    .catch(() =>
      res.status(500).json({ error: "Unable to retrieve history" })
    );
});

// ----------------- S3 Routes -------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

app.post("/upload-pdf", verifyToken, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const fileKey = `pdfs/${Date.now()}-${req.file.originalname}`;

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    });

    await s3Client.send(command);

    const s3url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

    const savedPDF = await PDF.create({
      fileName: req.file.originalname,
      fileKey,
      fileUrl: s3url,
      uploadDate: new Date().toISOString().split("T")[0],
    });

    return res.status(201).json({
      message: "File uploaded successfully",
      fileUrl: s3url,
      pdf: savedPDF,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: error.message || "Error uploading file" });
  }
});

app.get("/list-scans", verifyToken, async (req, res) => {
  try {
    const items = await FreezerModel.find(
      { scanImageKey: { $exists: true, $ne: null, $ne: "" } },
      { scanImageKey: 1, location: 1, lot: 1, species: 1, description: 1, date_recvd: 1, _id: 1 }
    ).sort({ _id: -1 });
    return res.json(items);
  } catch {
    return res.status(500).json({ error: "Failed to retrieve scan images" });
  }
});

app.get("/list-pdfs", verifyToken, async (req, res) => {
  try {
    const items = await PDF.find();
    return res.json(items);
  } catch {
    return res.status(500).json({ error: "An error occurred while retrieving the PDFs" });
  }
});

app.get("/get-pdf", verifyToken, async (req, res) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: req.query.key,
    });

    const { Body, ContentType } = await s3Client.send(command);
    res.setHeader("Content-Type", ContentType);
    Body.pipe(res);
  } catch (error) {
    console.error("get-pdf error:", error);
    res.status(500).json({ error: error.message || "Error fetching PDF" });
  }
});

app.get("/get-scan-image", verifyToken, async (req, res) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: req.query.key,
    });
    const { Body, ContentType } = await s3Client.send(command);
    res.setHeader("Content-Type", ContentType || "image/jpeg");
    Body.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message || "Error fetching image" });
  }
});

app.delete("/delete-pdf/:id", verifyToken, async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) return res.status(404).json({ error: "PDF not found" });

    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: pdf.fileKey,
    }));

    await PDF.findByIdAndDelete(req.params.id);
    return res.json({ message: "PDF deleted successfully" });
  } catch (error) {
    console.error("Delete PDF error:", error);
    return res.status(500).json({ error: "Error deleting PDF" });
  }
});

// ----------------- Form Extraction Route -----------------

const textractClient = new TextractClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

function parseFormData(blocks) {
  const lines = blocks
    .filter((b) => b.BlockType === "LINE")
    .map((b) => b.Text || "");
  const fullText = lines.join("\n");
  console.log("=== TEXTRACT LINES ===");
  lines.forEach((l, i) => console.log(i, JSON.stringify(l)));
  console.log("=== END LINES ===");

  const toISODate = (str) => {
    const parts = str.split("/");
    if (parts.length !== 3) return str;
    const [mm, dd, yy] = parts;
    const year = yy.length === 2 ? "20" + yy : yy;
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  };

  // Location: "Loc: A1-05" → "A105"
  let location = "";
  const locMatch = fullText.match(/[Ll]oc[:\s]+([A-Za-z][0-9]+-[0-9]+)/i);
  if (locMatch) {
    location = locMatch[1].replace(/-/g, "");
  } else {
    for (const line of lines) {
      const standalone = line.trim().match(/^([A-Za-z]\d+-\d+)$/);
      if (standalone) { location = standalone[1].replace(/-/g, ""); break; }
    }
  }

  // Lot: "# 26061-03", "Item 260 20-05" (spaces OCR artifact removed)
  let lot = "";
  const lotMatch = fullText.replace(/ /g, "").match(/(?:[Ii]tem|[Ll]ot\s*)?#?\s*(\d{4,6}[-/]\d{2,3})/);
  if (lotMatch) lot = lotMatch[1].replace("/", "-");

  // Dates: single or double digit month/day (4/3/26 or 04/03/26)
  const dateRegex = /(\d{1,2}\/\d{1,2}\/\d{2,4})/g;
  let date_recvd = "";
  let packdate = "";
  for (const line of lines) {
    const dm = line.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (!dm) continue;
    const iso = toISODate(dm[1]);
    // Line containing "Date" label or email = receive date
    if (!date_recvd && (/date/i.test(line) || /@/.test(line))) { date_recvd = iso; continue; }
    if (!packdate) { packdate = iso; continue; }
  }
  // Fallback: first two dates in order
  if (!date_recvd || !packdate) {
    const allDates = [...fullText.matchAll(dateRegex)].map((m) => toISODate(m[1]));
    if (!date_recvd) date_recvd = allDates[0] || "";
    if (!packdate) packdate = allDates[1] || "";
  }

  // Vendor: "Ship Customer To Shabuya" → "Shabuya"
  let vendor = "";
  const vendorMatch = fullText.match(/[Cc]ustomer\s+[Tt]o\s+([A-Za-z0-9\s&/.-]+?)(?:\n|$)/);
  if (vendorMatch) {
    vendor = vendorMatch[1].trim();
  } else {
    const vendorFallback = fullText.match(/[Cc]ustomer\s+(?![Tt]o\b)([A-Za-z]+)/);
    if (vendorFallback) vendor = vendorFallback[1];
  }

  // Species + description: combine lines from species keyword until hitting a number line
  const speciesKeywords = ["Lamb", "Beef", "Pork", "Chicken", "Veal", "Wagyu", "Bison", "Fish", "Tuna", "Salmon"];
  let species = "";
  let description = "";
  for (let i = 0; i < lines.length; i++) {
    for (const kw of speciesKeywords) {
      if (lines[i].toLowerCase().includes(kw.toLowerCase())) {
        species = kw;
        const descParts = [lines[i]];
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j].trim();
          if (!next) break;
          // Stop at footer lines
          if (/assembled|checked/i.test(next)) break;
          // Stop at quantity lines like "42c/s"
          if (/^\d{1,3}\s*(?:c\/s|['']s|\/s)$/i.test(next)) break;
          // Stop at actual weight values (decimal numbers in weight range)
          const norm = next.replace(",", ".").replace(/[a-zA-Z]+$/, "");
          if (/^\d{2,3}\.\d{1,2}$/.test(norm) && parseFloat(norm) >= 15 && parseFloat(norm) <= 100) break;
          // Skip date lines and header words but don't stop — description may continue after
          if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(next)) continue;
          if (/^(price|item|box|pcs|lot)$/i.test(next)) continue;
          descParts.push(next);
        }
        description = descParts.join(" ").trim();
        break;
      }
    }
    if (species) break;
  }

  // Quantity: prefer "c/s", then "'s"/"/s", then standalone integer near top of form
  let quantity = "";
  // Pass 1: strict c/s match
  for (const line of lines) {
    const qm = line.trim().match(/^(\d{1,3})\s*c\/s$/i);
    if (qm) { quantity = qm[1]; break; }
  }
  // Pass 2: "'s" or "/s" match capped at 200
  if (!quantity) {
    for (const line of lines) {
      const qm = line.trim().match(/^(\d{1,3})\s*(?:['']s|\/s)$/i);
      if (qm && parseInt(qm[1]) <= 200) { quantity = qm[1]; break; }
    }
  }
  // Pass 3: standalone integer in first 20 lines (Box/Pcs column value)
  if (!quantity) {
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const qm = lines[i].trim().match(/^(\d{1,3})$/);
      if (qm && parseInt(qm[1]) >= 1 && parseInt(qm[1]) <= 200) { quantity = qm[1]; break; }
    }
  }

  // Weights: normalize OCR artifacts then filter to the main cluster
  const normalizeWeight = (raw) => {
    let s = raw.trim();
    s = s.replace(/[a-zA-Z%]+$/, "");        // strip trailing letters or % ("28.2a", "30%")
    s = s.replace(/,/, ".");                  // comma decimal: "30,65" → "30.65"
    if (/^\d{4}$/.test(s)) s = s.slice(0, 2) + "." + s.slice(2); // "3035" → "30.35"
    return s;
  };

  let weights = [];
  const uniformMatch = fullText.match(/(\d{1,3})\s*[xX×]\s*(\d{2,3}\.?\d{0,2})/);
  if (uniformMatch) {
    const count = parseInt(uniformMatch[1]);
    const each = parseFloat(uniformMatch[2]);
    if (count > 0 && each >= 15 && each <= 200) {
      weights = Array(count).fill(each);
      if (!quantity) quantity = String(count);
    }
  }

  if (weights.length === 0) {
    const candidates = [];
    for (const line of lines) {
      const norm = normalizeWeight(line);
      const wm = norm.match(/^(\d{2,3}\.\d{1,2})$/);
      if (wm) {
        const val = parseFloat(wm[1]);
        if (val >= 15 && val <= 200) candidates.push(val);
      }
    }
    // Filter to the main cluster: keep values within 10 lbs of the median
    if (candidates.length > 0) {
      const sorted = [...candidates].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      weights = candidates.filter((v) => Math.abs(v - median) <= 10);
    }
  }

  if (!quantity && weights.length > 0) quantity = String(weights.length);

  const totalWeight = weights.length > 0 ? weights.reduce((s, w) => s + w, 0).toFixed(2) : "";
  const isTally = lines.some((l) => /adams\s*foods/i.test(l));

  return { location, lot, date_recvd, packdate, vendor, species, description, quantity, weight: totalWeight, individualWeights: weights, isTally };
}

app.post("/extract-form", verifyToken, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });
  try {
    const mime = req.file.mimetype || "";
    // console.log("File mime:", mime, "Size:", req.file.size, "bytes");
    let imageBuffer;
    if (mime.includes("heic") || mime.includes("heif")) {
      imageBuffer = Buffer.from(await heicConvert({ buffer: req.file.buffer, format: "JPEG", quality: 0.9 }));
    } else {
      imageBuffer = req.file.buffer;
    }
    const command = new AnalyzeDocumentCommand({
      Document: { Bytes: imageBuffer },
      FeatureTypes: ["FORMS", "TABLES"],
    });
    const response = await textractClient.send(command);
    const extracted = parseFormData(response.Blocks);

    // Upload image to S3 under scans/ prefix
    let scanImageKey = null;
    try {
      const ext = mime.includes("heic") || mime.includes("heif") ? "jpg" : (req.file.originalname.split(".").pop() || "jpg");
      scanImageKey = `scans/${Date.now()}.${ext}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: scanImageKey,
        Body: imageBuffer,
        ContentType: mime.includes("heic") || mime.includes("heif") ? "image/jpeg" : req.file.mimetype,
      }));
    } catch (uploadErr) {
      console.error("Scan image upload failed (non-fatal):", uploadErr.message);
    }

    res.json({ ...extracted, scanImageKey });
  } catch (error) {
    console.error("Textract error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------- User Routes -----------------

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await UserModel.findOne({ username: email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Support legacy plaintext passwords with auto-migration to bcrypt
    const isLegacyPlaintext = !user.password.startsWith("$2");
    let passwordMatch = false;

    if (isLegacyPlaintext) {
      passwordMatch = user.password === password;
      if (passwordMatch) {
        // Migrate to hashed password transparently
        const hashed = await bcrypt.hash(password, 10);
        await UserModel.updateOne({ _id: user._id }, { password: hashed });
      }
    } else {
      passwordMatch = await bcrypt.compare(password, user.password);
    }

    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user._id }, SECRET_KEY, {
      expiresIn: "8h",
    });
    res.json({ message: "Success", token });
  } catch {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  try {
    const hashed = await bcrypt.hash(password, 10);
    const user = await UserModel.create({ username: email, password: hashed });
    res.json({ message: "User created successfully" });
  } catch {
    res.status(500).json({ error: "Error creating user" });
  }
});

// ----------------- Server -----------------
app.listen(3001, () => {
  console.log("Server is running on port 3001");
});
