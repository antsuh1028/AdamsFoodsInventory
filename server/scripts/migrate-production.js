/**
 * DDL migration: production workflow tables
 * Run after the base schema (migrate.js) is already applied.
 *
 * Adds:
 *   - production_orders
 *   - production_order_items
 *   - production_order_returns
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
  console.log("Connected to Postgres");

  // ── production_orders ──────────────────────────────────────────────────────
  // One row per trip to the processor.
  await client.query(`
    CREATE TABLE IF NOT EXISTS production_orders (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      sent_date      TEXT        NOT NULL,
      processor_name TEXT        NOT NULL,
      status         TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'returned')),
      -- Step 3 fields — filled in when finished goods come back
      return_date    TEXT,
      -- yield = finished_weight / total raw sent, stored for quick querying
      yield          NUMERIC(5,2),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("✓ production_orders");

  // ── production_order_items ────────────────────────────────────────────────
  // One row per pallet pulled from inventory for this order.
  // boxes_sent mirrors the JSONB boxes array removed from inventory.
  await client.query(`
    CREATE TABLE IF NOT EXISTS production_order_items (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      production_order_id UUID        NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
      inventory_id        UUID        REFERENCES inventory(id) ON DELETE SET NULL,  -- nullable: set null when inventory deleted
      weight_sent         NUMERIC(10,2) NOT NULL,
      boxes_sent          JSONB       NOT NULL DEFAULT '[]',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("✓ production_order_items");

  // ── production_order_returns ──────────────────────────────────────────────
  // One row per finished-good pallet scanned back in.
  // Each row points to the new inventory item created on return.
  // inventory.source_id on that item points back to the original raw inventory item.
  await client.query(`
    CREATE TABLE IF NOT EXISTS production_order_returns (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      production_order_id UUID        NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
      inventory_id        UUID        REFERENCES inventory(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("✓ production_order_returns");

  // ── indexes ───────────────────────────────────────────────────────────────
  await client.query(`CREATE INDEX IF NOT EXISTS idx_prod_orders_tenant    ON production_orders(tenant_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_prod_orders_status    ON production_orders(status);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_prod_items_order      ON production_order_items(production_order_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_prod_items_inventory  ON production_order_items(inventory_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_prod_returns_order    ON production_order_returns(production_order_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_prod_returns_inventory ON production_order_returns(inventory_id);`);
  console.log("✓ indexes");

  await client.end();
  console.log("\nProduction migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
