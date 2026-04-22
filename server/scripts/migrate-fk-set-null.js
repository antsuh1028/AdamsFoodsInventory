/**
 * Fix: change production_order_items.inventory_id FK from ON DELETE RESTRICT
 * to ON DELETE SET NULL so inventory items can be deleted when all boxes are sent.
 */
require("dotenv").config();
const { Client } = require("pg");

async function migrate() {
  const client = new Client({
    connectionString: (process.env.DB_CONNECTION_STRING || "")
      .replace(/sslmode=[^&\s]+/, "sslmode=verify-full"),
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();

  await client.query(`
    ALTER TABLE production_order_items
      DROP CONSTRAINT production_order_items_inventory_id_fkey,
      ADD CONSTRAINT production_order_items_inventory_id_fkey
        FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL;
  `);
  console.log("✓ production_order_items.inventory_id → ON DELETE SET NULL");

  await client.end();
}

migrate().catch((err) => { console.error(err.message); process.exit(1); });
