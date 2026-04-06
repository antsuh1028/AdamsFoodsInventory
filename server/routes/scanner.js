const router = require("express").Router();
const { AnalyzeDocumentCommand } = require("@aws-sdk/client-textract");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const heicConvert = require("heic-convert");
const FreezerModel = require("../models/Freezer");
const HistoryModel = require("../models/History");
const verifyToken = require("../middleware/verifyToken");
const { s3Client, textractClient, upload } = require("../utils/aws");

// ----------------- Form Parsing -----------------

function toISODate(str) {
  const parts = str.split("/");
  if (parts.length !== 3) return str;
  const [mm, dd, yy] = parts;
  const year = yy.length === 2 ? "20" + yy : yy;
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function normalizeWeight(raw) {
  let s = raw.trim();
  s = s.replace(/[a-zA-Z%]+$/, "");       // strip trailing letters or % ("28.2a", "30%")
  s = s.replace(/,/, ".");                 // comma decimal: "30,65" → "30.65"
  if (/^\d{4}$/.test(s)) s = s.slice(0, 2) + "." + s.slice(2); // "3035" → "30.35"
  return s;
}

function parseFormData(blocks) {
  const lines = blocks.filter((b) => b.BlockType === "LINE").map((b) => b.Text || "");
  const fullText = lines.join("\n");
  console.log("=== TEXTRACT LINES ===");
  lines.forEach((l, i) => console.log(i, JSON.stringify(l)));
  console.log("=== END LINES ===");

  // Location: "Loc: A1-05" → "A105"
  let location = "";
  const locMatch = fullText.match(/[Ll]oc[:\s]+([A-Za-z][0-9]+-[0-9]+)/i);
  if (locMatch) {
    location = locMatch[1].replace(/-/g, "");
  } else {
    for (const line of lines) {
      const m = line.trim().match(/^([A-Za-z]\d+-\d+)$/);
      if (m) { location = m[1].replace(/-/g, ""); break; }
    }
  }

  // Lot: "# 26061-03", "Item 260 20-05" (spaces from OCR removed)
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
    if (!date_recvd && (/date/i.test(line) || /@/.test(line))) { date_recvd = iso; continue; }
    if (!packdate) { packdate = iso; continue; }
  }
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
    const fallback = fullText.match(/[Cc]ustomer\s+(?![Tt]o\b)([A-Za-z]+)/);
    if (fallback) vendor = fallback[1];
  }

  // Species + description: walk forward from species keyword until hitting weights/footer
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
          if (/assembled|checked/i.test(next)) break;
          if (/^\d{1,3}\s*(?:c\/s|['']s|\/s)$/i.test(next)) break;
          const norm = next.replace(",", ".").replace(/[a-zA-Z]+$/, "");
          if (/^\d{2,3}\.\d{1,2}$/.test(norm) && parseFloat(norm) >= 15 && parseFloat(norm) <= 100) break;
          if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(next)) continue;
          if (/^(price|item|box|pcs|lot)$/i.test(next)) continue;
          descParts.push(next);
        }
        description = descParts.join(" ").trim();
        break;
      }
    }
    if (species) break;
  }

  // Quantity: c/s first, then 's/'/s, then standalone integer in first 20 lines
  let quantity = "";
  for (const line of lines) {
    const m = line.trim().match(/^(\d{1,3})\s*c\/s$/i);
    if (m) { quantity = m[1]; break; }
  }
  if (!quantity) {
    for (const line of lines) {
      const m = line.trim().match(/^(\d{1,3})\s*(?:['']s|\/s)$/i);
      if (m && parseInt(m[1]) <= 200) { quantity = m[1]; break; }
    }
  }
  if (!quantity) {
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const m = lines[i].trim().match(/^(\d{1,3})$/);
      if (m && parseInt(m[1]) >= 1 && parseInt(m[1]) <= 200) { quantity = m[1]; break; }
    }
  }

  // Weights: uniform pattern first, then individual values clustered by median
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
      const m = norm.match(/^(\d{2,3}\.\d{1,2})$/);
      if (m) {
        const val = parseFloat(m[1]);
        if (val >= 15 && val <= 200) candidates.push(val);
      }
    }
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

// ----------------- Routes -----------------

router.post("/extract-form", verifyToken, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });
  try {
    const mime = req.file.mimetype || "";
    const isHeic = mime.includes("heic") || mime.includes("heif");
    const imageBuffer = isHeic
      ? Buffer.from(await heicConvert({ buffer: req.file.buffer, format: "JPEG", quality: 0.9 }))
      : req.file.buffer;

    const response = await textractClient.send(new AnalyzeDocumentCommand({
      Document: { Bytes: imageBuffer },
      FeatureTypes: ["FORMS", "TABLES"],
    }));
    const extracted = parseFormData(response.Blocks);

    let scanImageKey = null;
    try {
      const ext = isHeic ? "jpg" : (req.file.originalname.split(".").pop() || "jpg");
      scanImageKey = `scans/${Date.now()}.${ext}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: scanImageKey,
        Body: imageBuffer,
        ContentType: isHeic ? "image/jpeg" : mime,
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

router.post("/scanner-resolve", verifyToken, async (req, res) => {
  const { action, existingId, inputs } = req.body;
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, scanImageKey, boxes } = inputs || {};
  const parsedBoxes = Array.isArray(boxes) ? boxes.map((b) => ({ weight: String(b.weight ?? b) })) : [];
  const computedWeight = parsedBoxes.length > 0
    ? parsedBoxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2)
    : weight;
  const computedQuantity = parsedBoxes.length > 0 ? String(parsedBoxes.length) : quantity;

  const logEntry = (item, change) => ({
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
      await HistoryModel.create(logEntry(updated, "Scanner Update"));
      return res.json(updated);
    }
    if (action === "override") {
      const existing = await FreezerModel.findById(existingId);
      if (!existing) return res.status(404).json({ error: "Item not found" });
      await HistoryModel.create(logEntry(existing, "Scanner Override - Removed"));
      await FreezerModel.findByIdAndDelete(existingId);
      const locationUpper = (location || existing.location).toUpperCase();
      const newItem = await FreezerModel.create({ location: locationUpper, lot, vendor, brand, species, description, grade, quantity: computedQuantity, weight: computedWeight, packdate, date_recvd, est, price, scanImageKey, boxes: parsedBoxes });
      await HistoryModel.create(logEntry(newItem, "Scanner Override - Added"));
      return res.status(201).json(newItem);
    }
    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
