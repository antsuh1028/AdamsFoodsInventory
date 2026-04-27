require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const pool = require("../utils/pg");

// N302 — 55 boxes × 20 lbs each
const LOCATION = "N302";
const BOX_COUNT = 55;
const BOX_WEIGHT = 20;

async function run() {
  const boxes = Array.from({ length: BOX_COUNT }, () => ({ weight: String(BOX_WEIGHT) }));
  const totalWeight = (BOX_COUNT * BOX_WEIGHT).toFixed(2);

  const check = await pool.query(
    `SELECT id, location, quantity, weight, boxes FROM inventory WHERE location = $1`,
    [LOCATION]
  );

  if (check.rows.length === 0) {
    console.error(`No item found at location ${LOCATION}`);
    process.exit(1);
  }

  if (check.rows.length > 1) {
    console.error(`Multiple items at ${LOCATION} — aborting. IDs: ${check.rows.map(r => r.id).join(", ")}`);
    process.exit(1);
  }

  const item = check.rows[0];
  console.log("Found item:", item.id);
  console.log("  Current quantity:", item.quantity, "  weight:", item.weight);
  console.log("  Current boxes:", item.boxes ? JSON.stringify(item.boxes).slice(0, 80) : "null");
  console.log(`  Will write: ${BOX_COUNT} boxes × ${BOX_WEIGHT} lb = ${totalWeight} lb total`);

  const existing = Array.isArray(item.boxes) ? item.boxes : [];
  if (existing.length > 0) {
    console.warn(`  WARNING: item already has ${existing.length} box record(s). Overwriting.`);
  }

  await pool.query(
    `UPDATE inventory SET boxes = $1::jsonb, quantity = $2, weight = $3 WHERE id = $4`,
    [JSON.stringify(boxes), String(BOX_COUNT), totalWeight, item.id]
  );

  console.log("Done. Boxes written successfully.");
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
