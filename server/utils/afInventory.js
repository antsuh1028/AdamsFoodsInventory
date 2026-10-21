// Shared by the Adams Foods inventory routes: row shape, history, and transaction cleanup.

const { sumWeights, toDisplay } = require("./weight");

// Ends any transaction a handler returned from early, so the pool never hands one on.
const release = async (client) => {
  try { await client.query("ROLLBACK"); } catch { /* nothing was open */ }
  client.release();
};

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

// A row's total in pounds, exact and rounded to cents. Unreadable weights are skipped.
const boxesTotal = (boxes) => {
  const weights = boxes.map((b) => String(b && b.weight != null ? b.weight : "").trim())
    .filter((w) => /^\d{1,7}(\.\d{1,3})?$/.test(w));
  return toDisplay(sumWeights(weights.length ? weights : ["0"]));
};

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

module.exports = { release, fmt, toNum, boxesTotal, historyEntry };
