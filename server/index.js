require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { generalLimiter } = require("./middleware/rateLimits");
const { migrate } = require("./db/migrate");
const { TRUST_PROXY } = require("./utils/proxy");

const app = express();
// Rate limits key on req.ip; without this every user is Apache's address.
app.set("trust proxy", TRUST_PROXY);

const allowedOrigins = [process.env.ALLOWED_ORIGIN, "http://localhost:3000"].filter(Boolean);
const corsOptions = { origin: allowedOrigins };

app.use(express.json());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Per signed-in user; the limits themselves live in middleware/rateLimits.js.
app.use(generalLimiter);

// Schema first, routes second, listen last.
//
// Route modules are required INSIDE boot(), after migrate() has resolved. The
// Noblesse and box-weighing schema now lives entirely in db/migrate.js and runs
// in order; a few Adams-side modules still run small IF NOT EXISTS statements
// at require-time, and requiring them only once the ordered migration has
// finished means those can never race it.
//
// If migrate() throws, the process exits non-zero and pm2 restarts it. A
// server that comes up with a missing table is worse than one that does not
// come up — that is the bug this ordering exists to kill.
const boot = async () => {
  await migrate();

  // ── Postgres routes ─────────────────────────────────────────────────────────
  app.use("/", require("./routes/auth.pg"));
  app.use("/", require("./routes/inventory.pg"));
  app.use("/", require("./routes/history.pg"));
  app.use("/", require("./routes/scanner.pg"));
  app.use("/", require("./routes/snapshots.pg"));

  // ── Mongo routes (commented out) ────────────────────────────────────────────
  // const mongoose = require("mongoose");
  // mongoose.connect(process.env.MONGO_DB_URI)
  //   .then(() => console.log("Connected to MongoDB Atlas"))
  //   .catch((err) => console.error("MongoDB connection error", err));
  // app.use("/", require("./routes/auth"));
  // app.use("/", require("./routes/inventory"));
  // app.use("/", require("./routes/history"));
  // app.use("/", require("./routes/scanner"));

  app.use("/", require("./routes/s3.pg"));
  app.use("/", require("./routes/production.pg"));
  app.use("/", require("./routes/lots.pg"));
  app.use("/", require("./routes/shipments.pg"));
  app.use("/", require("./routes/noblesse.pg"));
  app.use("/", require("./routes/boxes.pg"));
  app.use("/", require("./routes/processingReports.pg"));
  app.use("/", require("./routes/reports.pg"));
  app.use("/", require("./routes/itemDescriptions.pg"));
  app.use("/", require("./routes/fpTracker.pg"));

  app.listen(3001, () => console.log("Server running on port 3001 [postgres]"));
};

boot().catch((err) => {
  console.error("[boot] failed:", err.message);
  process.exit(1);
});
