require("dotenv").config();
const { Client } = require("pg");

async function run() {
  const client = new Client({
    connectionString: (process.env.DB_CONNECTION_STRING || "")
      .replace(/sslmode=[^&\s]+/, "sslmode=verify-full"),
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();

  const steps = [
    {
      label: 'vendor: "Noblesse Trading" → "NTI"',
      sql: `UPDATE inventory SET vendor = 'NTI'
            WHERE vendor ~* '^Noblesse\\s*Trading'
            RETURNING id, vendor`,
    },
    {
      label: 'vendor: "AdamsFoods" → "AF"',
      sql: `UPDATE inventory
            SET vendor = TRIM(REGEXP_REPLACE(vendor, 'AdamsFoods', 'AF', 'gi'))
            WHERE vendor ~* 'AdamsFoods'
            RETURNING id, vendor`,
    },
    {
      label: 'brand (prc): "AdamsFoods" → "AF"',
      sql: `UPDATE inventory
            SET brand = TRIM(REGEXP_REPLACE(brand, 'AdamsFoods', 'AF', 'gi'))
            WHERE type = 'prc' AND brand ~* 'AdamsFoods'
            RETURNING id, brand`,
    },
    {
      label: 'brand: "Shabuya" → "SHB"',
      sql: `UPDATE inventory
            SET brand = TRIM(REGEXP_REPLACE(brand, 'Shabuya', 'SHB', 'gi'))
            WHERE brand ~* 'Shabuya'
            RETURNING id, brand`,
    },
  ];

  for (const { label, sql } of steps) {
    const result = await client.query(sql);
    console.log(`\n${label}`);
    console.log(`  ${result.rowCount} row(s) updated`);
    result.rows.forEach((r) => {
      const val = r.vendor ?? r.brand;
      console.log(`  ${r.id} → "${val}"`);
    });
  }

  await client.end();
}

run().catch((err) => { console.error(err.message); process.exit(1); });
