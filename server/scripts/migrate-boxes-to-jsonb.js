require("dotenv").config();
const { Client } = require("pg");

async function migrate() {
  const client = new Client({ connectionString: process.env.DB_CONNECTION_STRING });
  await client.connect();
  console.log("Connected to Postgres");

  // 1. Add JSONB column (idempotent)
  await client.query(`
    ALTER TABLE inventory
    ADD COLUMN IF NOT EXISTS boxes JSONB NOT NULL DEFAULT '[]'
  `);
  console.log("✓ Added boxes JSONB column");

  // 2. Migrate existing rows from boxes table into the column
  const { rowCount } = await client.query(`
    UPDATE inventory i
    SET boxes = sub.boxes_json
    FROM (
      SELECT
        inventory_id,
        jsonb_agg(jsonb_build_object('weight', weight::text) ORDER BY position) AS boxes_json
      FROM boxes
      GROUP BY inventory_id
    ) sub
    WHERE i.id = sub.inventory_id
  `);
  console.log(`✓ Migrated box data into ${rowCount} inventory rows`);

  // 3. Drop the old table
  await client.query(`DROP TABLE IF EXISTS boxes`);
  console.log("✓ Dropped boxes table");

  // 4. Verify
  const check = await client.query(`
    SELECT COUNT(*) as items,
           SUM(jsonb_array_length(boxes)) as total_boxes
    FROM inventory
  `);
  const { items, total_boxes } = check.rows[0];
  console.log(`\n✓ ${items} inventory rows, ${total_boxes} boxes total in JSONB`);

  await client.end();
  console.log("\nMigration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
