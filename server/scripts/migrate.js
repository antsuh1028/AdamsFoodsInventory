require("dotenv").config();
const { Client } = require("pg");

const client = new Client({ connectionString: process.env.DB_CONNECTION_STRING });

async function migrate() {
  await client.connect();
  console.log("Connected to Postgres");

  // Drop existing tables in dependency order
  await client.query(`
    DROP TABLE IF EXISTS boxes, history, inventory, users, tenants CASCADE;
  `);
  console.log("✓ dropped existing tables");

  await client.query(`
    CREATE TABLE tenants (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      slug       TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("✓ tenants");

  await client.query(`
    CREATE TABLE users (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      username    TEXT NOT NULL,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'user',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, username)
    );
  `);
  console.log("✓ users");

  await client.query(`
    CREATE TABLE inventory (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      location       TEXT,
      lot            TEXT,
      vendor         TEXT,
      brand          TEXT,
      species        TEXT,
      description    TEXT,
      grade          TEXT,
      quantity       TEXT,
      weight         NUMERIC(10,2),
      packdate       TEXT,
      date_recvd     TEXT,
      est            TEXT,
      price          NUMERIC(10,2),
      scan_image_key TEXT,
      type           TEXT CHECK (type IN ('raw', 'prc')),
      boxes          JSONB NOT NULL DEFAULT '[]',
      source_id      UUID REFERENCES inventory(id) ON DELETE SET NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("✓ inventory");

  /* boxes table removed — stored as JSONB on inventory row
  await client.query(`
    CREATE TABLE boxes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
      weight       NUMERIC(10,2),
      position     INTEGER
    );
  `);
  */

  await client.query(`
    CREATE TABLE history (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      time        TEXT,
      change      TEXT,
      changed_by  TEXT,
      location    TEXT,
      lot         TEXT,
      vendor      TEXT,
      brand       TEXT,
      species     TEXT,
      description TEXT,
      grade       TEXT,
      quantity    TEXT,
      weight      TEXT,
      packdate    TEXT,
      date_recvd  TEXT,
      est         TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("✓ history");

  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_tenant   ON inventory(tenant_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory(location);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_lot      ON inventory(lot);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_type     ON inventory(type);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_source   ON inventory(source_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_history_tenant     ON history(tenant_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_history_change     ON history(change);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at);`);
  console.log("✓ indexes");

  await client.end();
  console.log("\nMigration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  client.end();
  process.exit(1);
});
