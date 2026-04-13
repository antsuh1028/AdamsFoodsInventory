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
- type: look for "prc" or "raw" anywhere on the sheet (typically top-right corner). Return "prc" or "raw" exactly, or null if not found.
- price: price per lb if shown (e.g. "3.25", "4.50"). Return as a string with 2 decimal places, or empty string if not found.
- isTally: true

Return JSON only. No explanation, no markdown.
`.trim();

function isValidWeight(v) {
  return v >= 15 && v <= 200;
}

// LINE-based extraction: handles decimal weights + 4-digit integer formats
function extractWeightsFromLines(lines) {
  const weights = [];
  let inWeightZone = false;
  for (const line of lines) {
    let normalized = line.trim();
    normalized = normalized.replace(/(\d+),(\d{2})/g, "$1.$2");

    if (!inWeightZone) {
      if (/\b\d{2,3}\.\d{1,2}\b/.test(normalized)) inWeightZone = true;
      else if (/\b\d{4}\b.*\b\d{4}\b/.test(normalized)) inWeightZone = true;
      // Trigger on row of many 2-digit tokens ("72 02 65 82 59 77 ...")
      else if ((normalized.match(/\b\d{2}\b/g) || []).length >= 8) inWeightZone = true;
    }

    if (!inWeightZone) continue;

    // Expand 8+ digit runs into groups of 4
    normalized = normalized.replace(/\d{8,}/g, (match) => {
      const parts = [];
      for (let i = 0; i + 4 <= match.length; i += 4) parts.push(match.slice(i, i + 4));
      return parts.join(" ");
    });

    // 5-7 digit run: extract the leading 4 digits
    normalized = normalized.replace(/\b(\d{4})\d{1,3}\b/g, "$1");

    // Whole line is a single 4-digit number
    if (/^\d{4}$/.test(normalized)) {
      normalized = normalized.slice(0, 2) + "." + normalized.slice(2);
    } else {
      // Space-separated 4-digit tokens → XX.XX
      normalized = normalized.replace(/\b(\d{2})(\d{2})\b/g, (match, a, b) => {
        const w = parseFloat(`${a}.${b}`);
        return isValidWeight(w) ? `${a}.${b}` : match;
      });
      // Adjacent 2-digit pair "XX YY" → XX.YY (for split OCR reads like "72 02")
      normalized = normalized.replace(/\b([1-9]\d)\s+(\d{2})\b/g, (match, a, b) => {
        const w = parseFloat(`${a}.${b}`);
        return isValidWeight(w) ? `${a}.${b}` : match;
      });
    }

    const matches = normalized.match(/\b\d{2,3}\.\d{1,2}\b/g);
    if (matches) {
      for (const m of matches) {
        const val = parseFloat(m);
        if (isValidWeight(val)) weights.push(val);
      }
    }
  }
  return weights;
}

// WORD-level extraction: uses individual Textract WORD blocks sorted by page position.
// More reliable when LINE aggregation merges or splits adjacent handwritten numbers.
function extractWeightsFromWords(blocks) {
  const wordBlocks = blocks
    .filter((b) => b.BlockType === "WORD")
    .sort((a, b) => {
      const topA = a.Geometry?.BoundingBox?.Top ?? 0;
      const topB = b.Geometry?.BoundingBox?.Top ?? 0;
      if (Math.abs(topA - topB) > 0.025) return topA - topB;
      return (a.Geometry?.BoundingBox?.Left ?? 0) - (b.Geometry?.BoundingBox?.Left ?? 0);
    });

  const weights = [];
  let inWeightZone = false;
  let i = 0;

  while (i < wordBlocks.length) {
    const raw = (wordBlocks[i].Text || "").trim();
    const text = raw.replace(/,(\d{2})/, ".$1"); // European comma

    // Trigger weight zone when "Box" or "Pcs" header row is seen
    if (/^(box|boxes|pcs|pieces)$/i.test(text)) {
      inWeightZone = true;
      i++;
      continue;
    }

    if (!inWeightZone) { i++; continue; }

    // Already a decimal weight
    if (/^\d{2,3}\.\d{1,2}$/.test(text)) {
      const v = parseFloat(text);
      if (isValidWeight(v)) weights.push(v);
      i++;
      continue;
    }

    // 4-digit integer → XX.XX
    if (/^\d{4}$/.test(text)) {
      const v = parseFloat(text.slice(0, 2) + "." + text.slice(2));
      if (isValidWeight(v)) weights.push(v);
      i++;
      continue;
    }

    // 5-7 digit: extract leading 4 digits as weight
    if (/^\d{5,7}$/.test(text)) {
      const v = parseFloat(text.slice(0, 2) + "." + text.slice(2, 4));
      if (isValidWeight(v)) weights.push(v);
      i++;
      continue;
    }

    // 8+ digit run: split every 4 digits
    if (/^\d{8,}$/.test(text)) {
      for (let j = 0; j + 4 <= text.length; j += 4) {
        const v = parseFloat(text.slice(j, j + 2) + "." + text.slice(j + 2, j + 4));
        if (isValidWeight(v)) weights.push(v);
      }
      i++;
      continue;
    }

    // 2-digit token: try pairing with the next 2-digit token (split handwriting)
    if (/^\d{2}$/.test(text) && i + 1 < wordBlocks.length) {
      const nextText = (wordBlocks[i + 1].Text || "").trim();
      if (/^\d{2}$/.test(nextText)) {
        const v = parseFloat(text + "." + nextText);
        if (isValidWeight(v)) {
          weights.push(v);
          i += 2;
          continue;
        }
      }
    }

    i++;
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

    // Step 1: Textract extracts raw text blocks
    const textractResponse = await textractClient.send(new DetectDocumentTextCommand({
      Document: { Bytes: imageBuffer },
    }));
    const allBlocks = textractResponse.Blocks;
    const lineTexts = allBlocks
      .filter((b) => b.BlockType === "LINE")
      .map((b) => b.Text || "");

    // Step 2: Extract weights using both LINE and WORD approaches; take the better result
    const lineWeights = extractWeightsFromLines(lineTexts);
    const wordWeights = extractWeightsFromWords(allBlocks);
    const regexWeights = wordWeights.length > lineWeights.length ? wordWeights : lineWeights;

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
  const { location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est, price, type, scanImageKey, boxes } = inputs || {};
  const parsedBoxes = Array.isArray(boxes) ? boxes.map((b) => ({ weight: String(b.weight ?? b) })) : [];
  const computedWeight = parsedBoxes.length > 0
    ? parsedBoxes.map((b) => parseFloat(b.weight)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0).toFixed(2)
    : weight;
  const computedQuantity = parsedBoxes.length > 0 ? String(parsedBoxes.length) : quantity;

  const logEntry = (item, change) => ({
    time: new Date().toLocaleString(), change,
    changedBy: req.username || "",
    location: item.location, lot: item.lot, vendor: item.vendor, brand: item.brand,
    species: item.species, description: item.description, grade: item.grade,
    quantity: item.quantity, weight: item.weight, packdate: item.packdate,
    date_recvd: item.date_recvd, est: item.est,
  });

  try {
    if (action === "update") {
      const updated = await FreezerModel.findByIdAndUpdate(
        existingId,
        { $set: { vendor, brand, species, description, grade, quantity: computedQuantity, weight: computedWeight, packdate, date_recvd, est, price, type: type || null, scanImageKey, boxes: parsedBoxes } },
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
      const newItem = await FreezerModel.create({ location: locationUpper, lot, vendor, brand, species, description, grade, quantity: computedQuantity, weight: computedWeight, packdate, date_recvd, est, price, type: type || null, scanImageKey, boxes: parsedBoxes });
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
The sheet has a column header "PL/CS/BX" on the left and a price column on the far right.

For each line item extract:
- lot: lot number in parentheses like "(26061-03)" → normalize to "XXXXX-XX" format
- quantity: the PL/CS/BX count — this is the large bold integer on the LEFT side of the row (e.g. 14, 7, 25). It is NEVER a decimal. Do NOT use the price (right column, e.g. 3.99, 4.89).
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
