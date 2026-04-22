/**
 * Remove duplicate inventory + history rows that have mongo_id = NULL.
 * These were inserted by earlier migration runs before mongo_id tracking
 * was added. The canonical rows (inserted by migrate-full-sync) have mongo_id set.
 *
 * ⚠ If any items were added directly via the Postgres app (not from Mongo),
 *   they also have mongo_id = NULL and will be deleted. Confirm before running.
 */
require("dotenv").config();
const { Client } = require("pg");

async function run() {
  const pg = new Client({
    connectionString: (process.env.DB_CONNECTION_STRING || "")
      .replace(/sslmode=[^&\s]+/, "sslmode=verify-full"),
    ssl: { rejectUnauthorized: true },
  });
  await pg.connect();
  console.log("Connected to Postgres");

  const tenantRes = await pg.query(
    `SELECT id FROM tenants WHERE slug = 'adams-foods' LIMIT 1`
  );
  if (!tenantRes.rows.length) throw new Error("Tenant not found");
  const tenantId = tenantRes.rows[0].id;

  // Count before
  const before = await pg.query(
    `SELECT
       COUNT(*) FILTER (WHERE mongo_id IS NULL)     AS null_count,
       COUNT(*) FILTER (WHERE mongo_id IS NOT NULL) AS synced_count,
       COUNT(*)                                      AS total
     FROM inventory WHERE tenant_id = $1`,
    [tenantId]
  );
  const { null_count, synced_count, total } = before.rows[0];
  console.log(`\nInventory before:`);
  console.log(`  Total:              ${total}`);
  console.log(`  With mongo_id:      ${synced_count}  ← canonical (keep)`);
  console.log(`  Without mongo_id:   ${null_count}  ← duplicates (delete)`);

  const hBefore = await pg.query(
    `SELECT
       COUNT(*) FILTER (WHERE mongo_id IS NULL)     AS null_count,
       COUNT(*) FILTER (WHERE mongo_id IS NOT NULL) AS synced_count,
       COUNT(*)                                      AS total
     FROM history WHERE tenant_id = $1`,
    [tenantId]
  );
  const { null_count: hnull, synced_count: hsynced, total: htotal } = hBefore.rows[0];
  console.log(`\nHistory before:`);
  console.log(`  Total:              ${htotal}`);
  console.log(`  With mongo_id:      ${hsynced}  ← canonical (keep)`);
  console.log(`  Without mongo_id:   ${hnull}  ← duplicates (delete)`);

  // Confirm before deleting
  console.log(`\nAbout to delete ${null_count} inventory rows and ${hnull} history rows.`);
  console.log(`Type "yes" to confirm, anything else to abort:`);

  const answer = await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => {
      process.stdin.pause();
      resolve(d.trim());
    });
  });

  if (answer !== "yes") {
    console.log("Aborted — nothing deleted.");
    await pg.end();
    return;
  }

  // Delete NULL mongo_id rows
  const delInv = await pg.query(
    `DELETE FROM inventory WHERE tenant_id = $1 AND mongo_id IS NULL`,
    [tenantId]
  );
  console.log(`\n✓ Deleted ${delInv.rowCount} duplicate inventory rows`);

  const delHist = await pg.query(
    `DELETE FROM history WHERE tenant_id = $1 AND mongo_id IS NULL`,
    [tenantId]
  );
  console.log(`✓ Deleted ${delHist.rowCount} duplicate history rows`);

  // Count after
  const after = await pg.query(
    `SELECT COUNT(*) AS total FROM inventory WHERE tenant_id = $1`,
    [tenantId]
  );
  console.log(`\nInventory now: ${after.rows[0].total} rows`);

  await pg.end();
  console.log("Done.");
}

run().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
