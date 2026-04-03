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

console.log("=== SERVER RESTART ===", new Date().toLocaleString());

require("dotenv").config();
const SECRET_KEY = process.env.JWT_SECRET;

app.use(express.json());
app.use(cors());
app.options("*", cors());

// MongoDB connection
const MONGODB_URI_ANTHONY = process.env.MONGODB_URI_ANTHONY;

mongoose
  .connect(MONGODB_URI_ANTHONY)
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
    console.log("Locations loaded successfully");
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
          error: `Lot ${lot} already exists at ${location}. Use Update to modify it.`,
          code: "EXACT_DUPLICATE",
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

    const newItem = {
      location: locationUpper,
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

    const createdItem = await FreezerModel.create(newItem);
    res.status(201).json(createdItem);
  } catch {
    res.status(500).json({ error: "An error occurred while adding the item." });
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

    const [totalItems, totalWeight, bySpecies, byGrade, byVendor, occupiedLocations] = await Promise.all([
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
    ]);

    res.json({
      totalItems,
      totalWeight: totalWeight[0]?.total ?? 0,
      totalValue: totalWeight[0]?.value ?? 0,
      occupiedLocations: occupiedLocations.length,
      bySpecies,
      byGrade,
      byVendor,
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
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
