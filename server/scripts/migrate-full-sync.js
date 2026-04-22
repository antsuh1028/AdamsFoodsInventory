/**
 * Full idempotent sync: MongoDB → Postgres
 *
 * Safe to run multiple times — uses mongo_id as a dedup key so already-
 * migrated rows are skipped and only new Mongo items are inserted.
 *
 * Steps:
 *   1. Add mongo_id column to inventory + history (if not already there)
 *   2. Insert every Mongo inventory item — skip if mongo_id already exists
 *   3. Insert every Mongo history entry   — skip if mongo_id already exists
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

async function run() {
  await mongoose.connect(process.env.MONGO_DB_URI);
  console.log("Connected to MongoDB");

  const pg = new Client({
    connectionString: (process.env.DB_CONNECTION_STRING || "")
      .replace(/sslmode=[^&\s]+/, "sslmode=verify-full"),
    ssl: { rejectUnauthorized: true },
  });
  await pg.connect();
  console.log("Connected to Postgres\n");

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenantRes = await pg.query(
    `INSERT INTO tenants (name, slug)
     VALUES ('Adams Foods', 'adams-foods')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const tenantId = tenantRes.rows[0].id;
  console.log(`Tenant: adams-foods (${tenantId})`);

  // ── Add mongo_id columns (idempotent) ────────────────────────────────────
  await pg.query(`
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS mongo_id TEXT;
  `);
  await pg.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_mongo_id
      ON inventory (mongo_id) WHERE mongo_id IS NOT NULL;
  `);
  await pg.query(`
    ALTER TABLE history ADD COLUMN IF NOT EXISTS mongo_id TEXT;
  `);
  await pg.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_history_mongo_id
      ON history (mongo_id) WHERE mongo_id IS NOT NULL;
  `);
  console.log("✓ mongo_id columns ready\n");

  // ── Pre-flight counts ────────────────────────────────────────────────────
  const [mongoInvCount, mongoHistCount] = await Promise.all([
    FreezerModel.countDocuments(),
    HistoryModel.countDocuments(),
  ]);
  const pgInvCount  = parseInt((await pg.query(`SELECT COUNT(*) FROM inventory WHERE tenant_id = $1`, [tenantId])).rows[0].count);
  const pgHistCount = parseInt((await pg.query(`SELECT COUNT(*) FROM history  WHERE tenant_id = $1`, [tenantId])).rows[0].count);

  console.log(`MongoDB  — inventory: ${mongoInvCount}, history: ${mongoHistCount}`);
  console.log(`Postgres — inventory: ${pgInvCount},  history: ${pgHistCount}`);
  console.log(`Missing  — inventory: ~${mongoInvCount - pgInvCount}, history: ~${mongoHistCount - pgHistCount}\n`);

  // ── Users ─────────────────────────────────────────────────────────────────
  const UserModel = require("../models/User");
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
  console.log(`✓ Users: ${userCount} processed (skipped duplicates)`);

  // ── Inventory ─────────────────────────────────────────────────────────────
  const items = await FreezerModel.find().lean();
  let inserted = 0;
  let skipped  = 0;
  let boxCount = 0;

  for (const item of items) {
    const mongoId  = item._id.toString();
    const boxes    = Array.isArray(item.boxes) ? item.boxes : [];
    const boxesJson = JSON.stringify(boxes.map((b) => ({ weight: String(b.weight ?? "") })));
    boxCount += boxes.length;

    const res = await pg.query(
      `INSERT INTO inventory
         (tenant_id, location, lot, vendor, brand, species, description, grade,
          quantity, weight, packdate, date_recvd, est, price, scan_image_key,
          type, boxes, mongo_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
       ON CONFLICT (mongo_id) WHERE mongo_id IS NOT NULL DO NOTHING
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
        mongoId,
      ]
    );

    if (res.rows.length > 0) {
      inserted++;
    } else {
      skipped++;
    }

    if ((inserted + skipped) % 100 === 0) {
      process.stdout.write(`  inventory: ${inserted} inserted, ${skipped} skipped\r`);
    }
  }
  console.log(`\n✓ Inventory: ${inserted} inserted, ${skipped} already existed, ${boxCount} total boxes`);

  // ── History ───────────────────────────────────────────────────────────────
  const histories = await HistoryModel.find().lean();
  let hInserted = 0;
  let hSkipped  = 0;

  for (const h of histories) {
    const mongoId = h._id.toString();

    const res = await pg.query(
      `INSERT INTO history
         (tenant_id, time, change, changed_by, location, lot, vendor, brand,
          species, description, grade, quantity, weight, packdate, date_recvd,
          est, created_at, mongo_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (mongo_id) WHERE mongo_id IS NOT NULL DO NOTHING
       RETURNING id`,
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
        mongoId,
      ]
    );

    if (res.rows.length > 0) hInserted++;
    else hSkipped++;
  }
  console.log(`✓ History: ${hInserted} inserted, ${hSkipped} already existed`);

  // ── Final counts ──────────────────────────────────────────────────────────
  const finalInv  = parseInt((await pg.query(`SELECT COUNT(*) FROM inventory WHERE tenant_id = $1`, [tenantId])).rows[0].count);
  const finalHist = parseInt((await pg.query(`SELECT COUNT(*) FROM history  WHERE tenant_id = $1`, [tenantId])).rows[0].count);
  console.log(`\nFinal Postgres counts — inventory: ${finalInv}, history: ${finalHist}`);

  await mongoose.disconnect();
  await pg.end();
  console.log("Done.");
}

run().catch((err) => {
  console.error("\nFailed:", err.message);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
