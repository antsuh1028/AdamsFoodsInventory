require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

const allowedOrigins = [process.env.ALLOWED_ORIGIN, "http://localhost:3000"].filter(Boolean);
const corsOptions = { origin: allowedOrigins };

app.use(express.json());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// General rate limiter for all endpoints except login/refresh (60 requests per minute).
// Box-scanning routes are exempt and carry their own, much higher limiter: this
// one keys on IP, so every iPad behind the warehouse NAT would share a single
// 60/min budget and a scanning session flushing every few seconds would trip it.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  skip: (req) =>
    req.path === "/login" ||
    req.path === "/refresh" ||
    req.path.startsWith("/box-batches") ||
    req.path.startsWith("/manifest-groups"),
  message: { error: "Too many requests, please try again later" },
});

app.use(generalLimiter);

// ── Postgres routes ───────────────────────────────────────────────────────────
app.use("/", require("./routes/auth.pg"));
app.use("/", require("./routes/inventory.pg"));
app.use("/", require("./routes/history.pg"));
app.use("/", require("./routes/scanner.pg"));
app.use("/", require("./routes/snapshots.pg"));

// ── Mongo routes (commented out) ──────────────────────────────────────────────
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
app.use("/", require("./routes/noblesse.pg"));
app.use("/", require("./routes/boxes.pg"));

app.listen(3001, () => console.log("Server running on port 3001 [postgres]"));
