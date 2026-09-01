const { Pool } = require("pg");

// Replace any sslmode in the connection string with verify-full so pg-connection-string
// doesn't emit the "prefer/require/verify-ca treated as verify-full" security warning.
const connectionString = (process.env.DB_CONNECTION_STRING || "")
  .replace(/sslmode=[^&\s]+/, "sslmode=verify-full");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: true },
  // Must stay comfortably ABOVE the client's 60s auto-refresh interval. At the
  // pg default of 10s (or the 30s this was) the pooled connection is always
  // gone before the next poll, so every poll pays a fresh DNS lookup, TCP
  // connect and TLS handshake — and every one of those is a chance to hit a
  // transient ENOTFOUND. Reusing the connection removes that churn entirely,
  // while still retiring it well before Neon suspends on inactivity.
  idleTimeoutMillis: 120_000,
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
