require("dotenv").config();
const mongoose = require("mongoose");
const { Client } = require("pg");

// ── Mongo models ─────────────────────────────────────────────────────────────
const FreezerModel = require("../models/Freezer");
const HistoryModel = require("../models/History");
const UserModel    = require("../models/User");

// ── Helpers ───────────────────────────────────────────────────────────────────
const toNum = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

const BATCH = 200;

async function insertBatch(pg, query, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    for (const row of slice) await pg.query(query, row);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  // Connect both DBs
  await mongoose.connect(process.env.MONGO_DB_URI);
  console.log("Connected to MongoDB");

  const pg = new Client({ connectionString: process.env.DB_CONNECTION_STRING });
  await pg.connect();
  console.log("Connected to Postgres");

  // ── 1. Create Adams Foods tenant ──────────────────────────────────────────
  const tenantRes = await pg.query(`
    INSERT INTO tenants (name, slug)
    VALUES ('Adams Foods', 'adams-foods')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  const tenantId = tenantRes.rows[0].id;
  console.log(`\n✓ Tenant: Adams Foods (${tenantId})`);

  // ── 2. Users ──────────────────────────────────────────────────────────────
  const users = await UserModel.find().lean();
  let userCount = 0;
  for (const u of users) {
    await pg.query(
      `INSERT INTO users (tenant_id, username, password, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, username) DO NOTHING`,
      [tenantId, u.username, u.password, u.role || "user"]
    );
    userCount++;
  }
  console.log(`✓ Users: ${userCount}`);

  // ── 3. Inventory + Boxes ──────────────────────────────────────────────────
  const items = await FreezerModel.find().lean();
  // Map Mongo _id → Postgres UUID so boxes can reference the right row
  const mongoIdToUUID = {};
  let itemCount = 0;
  let boxCount = 0;

  for (const item of items) {
    const boxes = Array.isArray(item.boxes) ? item.boxes : [];
    const boxesJson = JSON.stringify(boxes.map((b) => ({ weight: String(b.weight ?? "") })));
    boxCount += boxes.length;

    const res = await pg.query(
      `INSERT INTO inventory
         (tenant_id, location, lot, vendor, brand, species, description, grade,
          quantity, weight, packdate, date_recvd, est, price, scan_image_key, type, boxes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
       RETURNING id`,
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
    const pgId = res.rows[0].id;
    mongoIdToUUID[item._id.toString()] = pgId;
    itemCount++;
  }
  console.log(`✓ Inventory: ${itemCount} items, ${boxCount} boxes (JSONB)`);

  // ── 4. History ────────────────────────────────────────────────────────────
  const histories = await HistoryModel.find().lean();
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
  console.log(`✓ History: ${histCount} entries`);

  await mongoose.disconnect();
  await pg.end();
  console.log("\nMigration complete.");
}

run().catch((err) => {
  console.error("\nMigration failed:", err.message);
  mongoose.disconnect();
  process.exit(1);
});
