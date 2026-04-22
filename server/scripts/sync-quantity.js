/**
 * One-time fix: set quantity = actual boxes array length for all inventory rows.
 */
require("dotenv").config();
const { Client } = require("pg");

async function run() {
  const client = new Client({
    connectionString: (process.env.DB_CONNECTION_STRING || "")
      .replace(/sslmode=[^&\s]+/, "sslmode=verify-full"),
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();

  const result = await client.query(`
    UPDATE inventory
    SET quantity = jsonb_array_length(boxes)::text
    WHERE jsonb_array_length(boxes)::text IS DISTINCT FROM quantity
    RETURNING id
  `);

  console.log(`Updated ${result.rowCount} rows`);
  await client.end();
}

run().catch((err) => { console.error(err.message); process.exit(1); });
