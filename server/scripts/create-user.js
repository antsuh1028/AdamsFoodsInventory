require("dotenv").config();
const { Client } = require("pg");
const bcrypt = require("bcrypt");

// Usage: node scripts/create-user.js <username> <password> [role]
// role defaults to "user". Options: user | manager | admin

async function run() {
  const [,, username, password, role = "user"] = process.argv;

  if (!username || !password) {
    console.error("Usage: node scripts/create-user.js <username> <password> [role]");
    process.exit(1);
  }

  const VALID_ROLES = ["user", "manager", "admin"];
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const client = new Client({
    connectionString: (process.env.DB_CONNECTION_STRING || "")
      .replace(/sslmode=[^&\s]+/, "sslmode=verify-full"),
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();

  // Use the first tenant
  const tenantRes = await client.query(`SELECT id, name FROM tenants LIMIT 1`);
  if (!tenantRes.rows.length) {
    console.error("No tenants found in database.");
    await client.end();
    process.exit(1);
  }
  const tenant = tenantRes.rows[0];

  const hashed = await bcrypt.hash(password, 10);

  const result = await client.query(
    `INSERT INTO users (tenant_id, username, password, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, username) DO NOTHING
     RETURNING id, username, role`,
    [tenant.id, username, hashed, role]
  );

  if (result.rows.length === 0) {
    console.log(`User "${username}" already exists for tenant "${tenant.name}" — no changes made.`);
  } else {
    console.log(`Created user "${result.rows[0].username}" (role: ${result.rows[0].role}) for tenant "${tenant.name}"`);
  }

  await client.end();
}

run().catch((err) => { console.error(err.message); process.exit(1); });
