require("dotenv").config();
const mongoose = require("mongoose");
const { Client } = require("pg");

const FreezerModel = require("../models/Freezer");
const HistoryModel = require("../models/History");
const UserModel    = require("../models/User");

async function verify() {
  await mongoose.connect(process.env.MONGO_DB_URI);
  const pg = new Client({ connectionString: process.env.DB_CONNECTION_STRING });
  await pg.connect();

  const [
    mongoItems, mongoHistory, mongoUsers,
    pgItems, pgHistory, pgUsers, pgBoxes,
  ] = await Promise.all([
    FreezerModel.countDocuments(),
    HistoryModel.countDocuments(),
    UserModel.countDocuments(),
    pg.query("SELECT COUNT(*) FROM inventory"),
    pg.query("SELECT COUNT(*) FROM history"),
    pg.query("SELECT COUNT(*) FROM users"),
    pg.query("SELECT COUNT(*) FROM boxes"),
  ]);

  console.log("\n── Count comparison ─────────────────────────────");
  console.log(`Users     Mongo: ${mongoUsers}  →  PG: ${pgUsers.rows[0].count}`);
  console.log(`Inventory Mongo: ${mongoItems}  →  PG: ${pgItems.rows[0].count}`);
  console.log(`History   Mongo: ${mongoHistory}  →  PG: ${pgHistory.rows[0].count}`);
  console.log(`Boxes     (PG only): ${pgBoxes.rows[0].count}`);

  // Spot-check: sample 3 random items and verify lot numbers exist in PG
  const sample = await FreezerModel.find().limit(3).lean();
  console.log("\n── Spot check (lot numbers) ─────────────────────");
  for (const item of sample) {
    const res = await pg.query("SELECT id, location, lot FROM inventory WHERE lot = $1 LIMIT 1", [item.lot]);
    const found = res.rows[0];
    const match = found && found.location === item.location ? "✓" : "✗ MISMATCH";
    console.log(`${match}  lot=${item.lot}  location=${item.location}  pg_id=${found?.id ?? "NOT FOUND"}`);
  }

  // Check tenant exists
  const tenants = await pg.query("SELECT id, name, slug FROM tenants");
  console.log("\n── Tenants ──────────────────────────────────────");
  for (const t of tenants.rows) console.log(`  ${t.name} (${t.slug}) — ${t.id}`);

  await mongoose.disconnect();
  await pg.end();
}

verify().catch((err) => { console.error(err.message); process.exit(1); });
