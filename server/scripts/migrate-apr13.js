/**
 * Targeted migration: inventory + history items created on 2026-04-13
 * in MongoDB → Postgres.
 *
 * Freezer model has no Mongoose timestamps, so we use the ObjectId
 * embedded timestamp to filter by creation date.
 * History model has timestamps:true so we use createdAt directly.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { Client } = require("pg");

const FreezerModel = require("../models/Freezer");
const HistoryModel = require("../models/History");

const toNum = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

// April 13 UTC window
const DAY_START = new Date("2026-04-13T00:00:00.000Z");
const DAY_END   = new Date("2026-04-14T00:00:00.000Z");

async function run() {
  await mongoose.connect(process.env.MONGO_DB_URI);
  console.log("Connected to MongoDB");

  const pg = new Client({
    connectionString: (process.env.DB_CONNECTION_STRING || "")
      .replace(/sslmode=[^&\s]+/, "sslmode=verify-full"),
    ssl: { rejectUnauthorized: true },
  });
  await pg.connect();
  console.log("Connected to Postgres");

  // Get the Adams Foods tenant ID
  const tenantRes = await pg.query(
    `SELECT id FROM tenants WHERE slug = 'adams-foods' LIMIT 1`
  );
  if (!tenantRes.rows.length) {
    throw new Error("Tenant 'adams-foods' not found in Postgres. Run the full migration first.");
  }
  const tenantId = tenantRes.rows[0].id;
  console.log(`Tenant: ${tenantId}`);

  // ── Inventory ──────────────────────────────────────────────────────────────
  // ObjectId encodes creation time in its first 4 bytes
  const startOid = mongoose.Types.ObjectId.createFromTime(Math.floor(DAY_START / 1000));
  const endOid   = mongoose.Types.ObjectId.createFromTime(Math.floor(DAY_END   / 1000));

  const items = await FreezerModel.find({
    _id: { $gte: startOid, $lt: endOid },
  }).lean();

  console.log(`\nFound ${items.length} inventory items from 2026-04-13`);

  let itemCount = 0;
  let boxCount  = 0;

  for (const item of items) {
    const boxes = Array.isArray(item.boxes) ? item.boxes : [];
    const boxesJson = JSON.stringify(boxes.map((b) => ({ weight: String(b.weight ?? "") })));
    boxCount += boxes.length;

    await pg.query(
      `INSERT INTO inventory
         (tenant_id, location, lot, vendor, brand, species, description, grade,
          quantity, weight, packdate, date_recvd, est, price, scan_image_key, type, boxes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
      [
        tenantId,
        item.location    || null,
        item.lot         || null,
        item.vendor      || null,
        item.brand       || null,
        item.species     || null,
        item.description || null,
        item.grade       || null,
        item.quantity    || null,
        toNum(item.weight),
        item.packdate    || null,
        item.date_recvd  || null,
        item.est         || null,
        toNum(item.price),
        item.scanImageKey || null,
        item.type        || null,
        boxesJson,
      ]
    );
    itemCount++;
    if (itemCount % 50 === 0) console.log(`  ... ${itemCount} inserted`);
  }
  console.log(`✓ Inventory: ${itemCount} items, ${boxCount} boxes migrated`);

  // ── History ────────────────────────────────────────────────────────────────
  const histories = await HistoryModel.find({
    createdAt: { $gte: DAY_START, $lt: DAY_END },
  }).lean();

  console.log(`Found ${histories.length} history entries from 2026-04-13`);

  let histCount = 0;
  for (const h of histories) {
    await pg.query(
      `INSERT INTO history
         (tenant_id, time, change, changed_by, location, lot, vendor, brand,
          species, description, grade, quantity, weight, packdate, date_recvd, est, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        tenantId,
        h.time        || null,
        h.change      || null,
        h.changedBy   || null,
        h.location    || null,
        h.lot         || null,
        h.vendor      || null,
        h.brand       || null,
        h.species     || null,
        h.description || null,
        h.grade       || null,
        h.quantity    || null,
        h.weight      || null,
        h.packdate    || null,
        h.date_recvd  || null,
        h.est         || null,
        h.createdAt   || new Date(),
      ]
    );
    histCount++;
  }
  console.log(`✓ History: ${histCount} entries migrated`);

  await mongoose.disconnect();
  await pg.end();
  console.log("\nDone.");
}

run().catch((err) => {
  console.error("\nFailed:", err.message);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
