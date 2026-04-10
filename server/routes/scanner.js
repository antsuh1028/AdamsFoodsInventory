const router = require("express").Router();
const OpenAI = require("openai");
const { DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const heicConvert = require("heic-convert");
const FreezerModel = require("../models/Freezer");
const HistoryModel = require("../models/History");
const verifyToken = require("../middleware/verifyToken");
const { s3Client, textractClient, upload } = require("../utils/aws");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EXTRACTION_PROMPT = `
You are parsing OCR text extracted from an Adams Foods handwritten tally sheet.
The text was extracted line by line by AWS Textract. Return JSON only.

LAYOUT:
- "Customer" line → vendor name
- Large location code like "A1-05" or "B2-02" (may be prefixed with "loc:") → location
- "Date" field → date received
- Item/lot number like "26061-03" or "260 20-05" (normalize spaces away) → lot
- Second date in the item area → packdate
- "Box / Pcs" value like "52", "42s", "36's" → quantity (digits only)
- Product description line → description + species

FIELDS (do NOT extract individualWeights — that is handled separately):
- location: strip dashes (e.g. "A1-05" → "A105", "B2-02" → "B202")
- lot: normalize to "XXXXX-XX" (e.g. "260 20-05" → "26020-05")
- date_recvd: ISO format YYYY-MM-DD
- packdate: ISO format YYYY-MM-DD, empty string if not found
- vendor: customer name
- species: one of [Lamb, Beef, Pork, Chicken, Veal, Wagyu, Bison, Fish, Tuna, Salmon]
- description: full product description
- quantity: digits only as a string
- uniformWeight: if the sheet shows "N x W.WW" (e.g. "36 x 50.00"), return W.WW as a number. Otherwise return null.
- uniformCount: if uniformWeight is set, return N as a number. Otherwise return null.
- isTally: true

Return JSON only. No explanation, no markdown.
`.trim();

function extractWeightsFromLines(lines) {
  const weights = [];
  let inWeightZone = false;
  for (const line of lines) {
    let normalized = line.trim();
    normalized = normalized.replace(/(\d+),(\d{2})/g, "$1.$2");
    // Once a real decimal weight is seen, we're in the weight zone
    if (!inWeightZone && /\b\d{2,3}\.\d{1,2}\b/.test(normalized)) inWeightZone = true;
    // Only convert standalone 4-digit integers inside the weight zone (avoids lot numbers, phone numbers in header)
    if (inWeightZone && /^\d{4}$/.test(normalized)) {
      normalized = normalized.slice(0, 2) + "." + normalized.slice(2);
    }
    const matches = normalized.match(/\d{2,3}\.\d{1,2}/g);
    if (matches) {
      for (const m of matches) {
        const val = parseFloat(m);
        if (val >= 15 && val <= 200) weights.push(val);
      }
    }
  }
  return weights;
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

    // Step 1: Textract extracts raw text lines (character-accurate OCR)
    const textractResponse = await textractClient.send(new DetectDocumentTextCommand({
      Document: { Bytes: imageBuffer },
    }));
    const lineTexts = textractResponse.Blocks
      .filter((b) => b.BlockType === "LINE")
      .map((b) => b.Text || "");

    // Step 2: Regex extracts all weights deterministically from the raw lines
    const regexWeights = extractWeightsFromLines(lineTexts);

    // Step 3: GPT-4o parses header fields only (location, lot, dates, vendor, description, quantity)
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\nOCR TEXT:\n${lineTexts.join("\n")}`,
      }],
      response_format: { type: "json_object" },
    });

    const extracted = JSON.parse(gptResponse.choices[0].message.content);

    // Resolve individualWeights: uniform format takes priority, then regex extraction
    let individualWeights;
    if (extracted.uniformWeight && extracted.uniformCount) {
      const w = parseFloat(extracted.uniformWeight);
      const n = parseInt(extracted.uniformCount);
      individualWeights = Array(n).fill(w);
    } else {
      individualWeights = regexWeights;
    }
    extracted.individualWeights = individualWeights;
    delete extracted.uniformWeight;
    delete extracted.uniformCount;

    extracted.weight = individualWeights.length > 0
      ? individualWeights.reduce((s, w) => s + w, 0).toFixed(2)
      : "";

    if (!extracted.quantity && individualWeights.length > 0) {
      extracted.quantity = String(individualWeights.length);
    }

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
    console.error("Extraction error:", error);
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
    console.error("scanner-resolve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Order Sheet OCR ─────────────────────────────────────────────────────────

const ORDER_PROMPT = `
You are parsing an Adams Foods outgoing order sheet (customer pick/ship document).
The sheet lists multiple line items. For each item extract:
- lot: lot number in parentheses like "(26061-03)" → normalize to "XXXXX-XX" format
- quantity: the PL/CS/BX count (the large bold number on the left of each row)
- description: the product name/description text

Return JSON only: { "items": [ { "lot": "...", "quantity": "...", "description": "..." }, ... ] }
Only include items that have a lot number. No explanation, no markdown.
`.trim();

router.post("/extract-order", verifyToken, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });
  try {
    const mime = req.file.mimetype || "";
    const isHeic = mime.includes("heic") || mime.includes("heif");
    const imageBuffer = isHeic
      ? Buffer.from(await heicConvert({ buffer: req.file.buffer, format: "JPEG", quality: 0.9 }))
      : req.file.buffer;

    const textractResponse = await textractClient.send(new DetectDocumentTextCommand({
      Document: { Bytes: imageBuffer },
    }));
    const lineTexts = textractResponse.Blocks
      .filter((b) => b.BlockType === "LINE")
      .map((b) => b.Text || "");

    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: `${ORDER_PROMPT}\n\nOCR TEXT:\n${lineTexts.join("\n")}` }],
      response_format: { type: "json_object" },
    });

    const { items } = JSON.parse(gptResponse.choices[0].message.content);
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(422).json({ error: "No line items found in the image." });
    }

    // Look up each lot in inventory
    const lots = items.map((i) => i.lot).filter(Boolean);
    const matches = await FreezerModel.find({ lot: { $in: lots } }).lean();
    const byLot = {};
    for (const m of matches) {
      if (!byLot[m.lot]) byLot[m.lot] = [];
      byLot[m.lot].push(m);
    }

    const result = items.map((item) => ({
      ...item,
      matches: byLot[item.lot] || [],
    }));

    res.json({ items: result });
  } catch (err) {
    console.error("Order extraction error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
