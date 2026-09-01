const { Pool } = require("pg");

// Replace any sslmode in the connection string with verify-full so pg-connection-string
// doesn't emit the "prefer/require/verify-ca treated as verify-full" security warning.
const connectionString = (process.env.DB_CONNECTION_STRING || "")
  .replace(/sslmode=[^&\s]+/, "sslmode=verify-full");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: true },
  // Neon drops idle connections when it scales down, so retire ours first —
  // reconnecting on the next query is cheap, being handed a dead socket is not.
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  max: 10,
});

// Without this the process dies. pg-pool emits "error" on the POOL (not on a
// query) when an idle client's connection is dropped underneath it, and an
// EventEmitter with no "error" listener throws — so a routine Neon idle
// timeout takes the whole server down with an unhandled 'error' event.
//
// pg-pool has already discarded the broken client by the time this runs; the
// next query simply gets a fresh one. There is nothing to do but log it.
pool.on("error", (err) => {
  console.error("Postgres idle client error (connection dropped, pool recovered):", err.message);
});

module.exports = pool;
