const { Pool } = require("pg");

// Replace any sslmode in the connection string with verify-full so pg-connection-string
// doesn't emit the "prefer/require/verify-ca treated as verify-full" security warning.
const connectionString = (process.env.DB_CONNECTION_STRING || "")
  .replace(/sslmode=[^&\s]+/, "sslmode=verify-full");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: true },
});

module.exports = pool;
