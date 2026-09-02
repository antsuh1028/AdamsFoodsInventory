const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const { parseGs1 } = require("../utils/gs1");

// ── Migrations (idempotent, applied on boot like the rest of this codebase) ───

pool.query(`
  CREATE TABLE IF NOT EXISTS box_batches (
    batch_id     SERIAL PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    client_uuid  UUID NOT NULL UNIQUE,
    status       TEXT NOT NULL DEFAULT 'open',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at    TIMESTAMPTZ
  )
`).catch((err) => console.error("box_batches migration error:", err.message));

// raw_barcode is nullable only because of the manual-entry fallback: a damaged
// or unbarcoded label has no payload to store. The CHECK keeps the guarantee
// that every *scanned* row carries the barcode it came from.
pool.query(`
  CREATE TABLE IF NOT EXISTS batch_items (
    item_id         SERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    batch_id        INT NOT NULL REFERENCES box_batches(batch_id),
    weight          NUMERIC(8,3) NOT NULL,
    weight_unit     TEXT NOT NULL,
    gtin            TEXT,
    production_date DATE,
    serial          TEXT,
    raw_barcode     TEXT,
    is_manual       BOOLEAN NOT NULL DEFAULT false,
    scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT batch_items_barcode_or_manual
      CHECK (is_manual OR raw_barcode IS NOT NULL)
  )
`).catch((err) => console.error("batch_items migration error:", err.message));

pool.query(`CREATE INDEX IF NOT EXISTS batch_items_batch_id_idx ON batch_items (batch_id)`)
  .catch((err) => console.error("batch_items index migration error:", err.message));

// A scanning session covers exactly one lot, so the lot belongs on the batch.
// Without it a stored batch cannot be reprinted as a weight manifest.
pool.query(`ALTER TABLE box_batches ADD COLUMN IF NOT EXISTS lot_number TEXT`)
  .catch((err) => console.error("box_batches lot_number migration error:", err.message));

// Free duplicate-scan protection: the same serial cannot land in a batch twice.
pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS batch_items_batch_serial_uniq
  ON batch_items (batch_id, serial) WHERE serial IS NOT NULL
`).catch((err) => console.error("batch_items unique index migration error:", err.message));

// ── Rate limiting ────────────────────────────────────────────────────────────
// The global 60/min limiter in index.js keys on IP, so every iPad behind the
// warehouse NAT shares one budget. A scanning session flushes every few seconds
// and would trip it, which collides head-on with the durability requirement.
// These routes are exempted there and get their own, much higher ceiling.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: { error: "Too many scan requests, slow down" },
});

// ── Validation helpers ───────────────────────────────────────────────────────

const UNITS = new Set(["LB", "KG"]);
const DECIMAL_RE = /^\d{1,5}(\.\d{1,3})?$/; // fits NUMERIC(8,3)
const MAX_WEIGHT_THOUSANDTHS = 2000n * 1000n; // 2000 lb/kg per box is already absurd

// Decimal string -> integer thousandths, so weights compare exactly with no
// float ever entering the path. "76.20" and "76.2" must compare equal.
const toThousandths = (s) => {
  const [whole, frac = ""] = String(s).split(".");
  return BigInt(whole) * 1000n + BigInt((frac + "000").slice(0, 3));
};

// Validates one incoming scan and, when it carries a barcode, re-derives the
// weight from that barcode server-side. The client is not trusted: a tampered
// or buggy client weight that disagrees with its own raw_barcode is rejected.
const validateItem = (item) => {
  if (!item || typeof item !== "object") {
    return { ok: false, code: "BAD_ITEM", reason: "Item is not an object" };
  }

  const { weight, weightUnit, rawBarcode, isManual = false } = item;

  if (typeof weight !== "string" || !DECIMAL_RE.test(weight)) {
    return { ok: false, code: "BAD_WEIGHT",
      reason: "weight must be a decimal string with at most 3 decimal places" };
  }
  if (!UNITS.has(weightUnit)) {
    return { ok: false, code: "BAD_UNIT", reason: "weightUnit must be LB or KG" };
  }

  const thousandths = toThousandths(weight);
  if (thousandths <= 0n) {
    return { ok: false, code: "BAD_WEIGHT", reason: "weight must be greater than zero" };
  }
  if (thousandths > MAX_WEIGHT_THOUSANDTHS) {
    return { ok: false, code: "IMPLAUSIBLE_WEIGHT", reason: "weight exceeds plausible range" };
  }

  if (!rawBarcode) {
    if (!isManual) {
      return { ok: false, code: "MISSING_BARCODE",
        reason: "rawBarcode is required unless isManual is true" };
    }
    return { ok: true, row: {
      weight, weightUnit, gtin: null, productionDate: null,
      serial: null, rawBarcode: null, isManual: true,
    } };
  }

  let parsed;
  try {
    parsed = parseGs1(rawBarcode);
  } catch (err) {
    return { ok: false, code: err.code || "PARSE_FAILED",
      reason: `Server could not parse rawBarcode: ${err.message}` };
  }

  if (toThousandths(parsed.weight.value) !== thousandths) {
    return { ok: false, code: "WEIGHT_MISMATCH",
      reason: `Client sent ${weight} but rawBarcode decodes to ${parsed.weight.value}` };
  }
  if (parsed.weight.unit !== weightUnit) {
    return { ok: false, code: "UNIT_MISMATCH",
      reason: `Client sent ${weightUnit} but rawBarcode decodes to ${parsed.weight.unit}` };
  }

  return { ok: true, row: {
    // Everything persisted comes from the server's own parse, not the client.
    weight: parsed.weight.value,
    weightUnit: parsed.weight.unit,
    gtin: parsed.gtin,
    // Suppliers use one or the other: AI 11 (production) or AI 13 (packaging).
    // Both answer "when was this box made", so whichever is present fills the
    // column rather than leaving it null for half the vendors.
    productionDate: parsed.productionDate || parsed.packagingDate,
    serial: parsed.serial,
    rawBarcode,
    isManual: false,
  } };
};

// ── Routes ───────────────────────────────────────────────────────────────────

// Create a batch. Idempotent on client_uuid so a retried POST after a dropped
// response returns the original batch instead of orphaning one.
router.post("/box-batches", verifyToken, scanLimiter, async (req, res) => {
  const { clientUuid, lotNumber } = req.body || {};
  if (!clientUuid || typeof clientUuid !== "string") {
    return res.status(400).json({ error: "clientUuid is required" });
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO box_batches (tenant_id, client_uuid, lot_number)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_uuid) DO NOTHING
       RETURNING batch_id, status, created_at, lot_number`,
      [req.tenantId, clientUuid, lotNumber || null]
    );

    if (inserted.rows.length) {
      return res.status(201).json({ ...inserted.rows[0], reused: false });
    }

    // Already existed. Scope the lookup by tenant so a UUID guessed from
    // another tenant cannot be adopted.
    const existing = await pool.query(
      `SELECT batch_id, status, created_at, lot_number FROM box_batches
       WHERE client_uuid = $1 AND tenant_id = $2`,
      [clientUuid, req.tenantId]
    );
    if (!existing.rows.length) {
      return res.status(409).json({ error: "clientUuid already used" });
    }
    return res.json({ ...existing.rows[0], reused: true });
  } catch (err) {
    console.error("create box batch:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Append scans. Returns a per-item result array so the client knows exactly
// which local records it may clear.
router.post("/box-batches/:id/items", verifyToken, scanLimiter, async (req, res) => {
  const batchId = Number(req.params.id);
  const { items } = req.body || {};

  if (!Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batch = await client.query(
      `SELECT batch_id, status FROM box_batches
       WHERE batch_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Batch not found" });
    }
    if (batch.rows[0].status !== "open") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Batch is closed" });
    }

    // 1. Validate and re-parse every item before touching the table.
    const results = items.map((item, index) => {
      const v = validateItem(item);
      return v.ok
        ? { index, status: "pending", row: v.row }
        : { index, status: "rejected", code: v.code, reason: v.reason };
    });

    // 2. Duplicates already stored in this batch.
    const candidateSerials = results
      .filter((r) => r.status === "pending" && r.row.serial)
      .map((r) => r.row.serial);

    let existingSerials = new Set();
    if (candidateSerials.length) {
      const found = await client.query(
        `SELECT serial FROM batch_items WHERE batch_id = $1 AND serial = ANY($2::text[])`,
        [batchId, candidateSerials]
      );
      existingSerials = new Set(found.rows.map((r) => r.serial));
    }

    // 3. Duplicates *within this request* — the same box scanned twice before a flush.
    const seen = new Set();
    for (const r of results) {
      if (r.status !== "pending" || !r.row.serial) continue;
      if (existingSerials.has(r.row.serial)) {
        r.status = "duplicate";
        r.reason = "Serial already recorded in this batch";
      } else if (seen.has(r.row.serial)) {
        r.status = "duplicate";
        r.reason = "Serial repeated within this request";
      } else {
        seen.add(r.row.serial);
      }
    }

    const toInsert = results.filter((r) => r.status === "pending");

    if (toInsert.length) {
      // UNNEST keeps this to one parameter per column rather than per row, so
      // a large resume-flush cannot approach the 65535 parameter ceiling.
      const rows = toInsert.map((r) => r.row);
      const insertedRows = await client.query(
        `INSERT INTO batch_items
           (tenant_id, batch_id, weight, weight_unit, gtin, production_date, serial, raw_barcode, is_manual)
         SELECT $1, $2, w, u, g, d, s, r, m
         FROM UNNEST(
           $3::numeric[], $4::text[], $5::text[], $6::date[],
           $7::text[], $8::text[], $9::boolean[]
         ) AS t(w, u, g, d, s, r, m)
         ON CONFLICT DO NOTHING
         RETURNING item_id, serial`,
        [
          req.tenantId,
          batchId,
          rows.map((r) => r.weight),
          rows.map((r) => r.weightUnit),
          rows.map((r) => r.gtin),
          rows.map((r) => r.productionDate),
          rows.map((r) => r.serial),
          rows.map((r) => r.rawBarcode),
          rows.map((r) => r.isManual),
        ]
      );

      const idBySerial = new Map(
        insertedRows.rows.filter((r) => r.serial).map((r) => [r.serial, r.item_id])
      );
      const unkeyedIds = insertedRows.rows.filter((r) => !r.serial).map((r) => r.item_id);

      for (const r of toInsert) {
        if (r.row.serial) {
          if (idBySerial.has(r.row.serial)) {
            r.status = "inserted";
            r.itemId = idBySerial.get(r.row.serial);
          } else {
            // Lost a race with a concurrent flush; the unique index held.
            r.status = "duplicate";
            r.reason = "Serial recorded concurrently";
          }
        } else {
          r.status = "inserted";
          if (unkeyedIds.length) r.itemId = unkeyedIds.shift();
        }
      }
    }

    await client.query("COMMIT");

    const clean = results.map(({ row, ...rest }) => rest);
    return res.json({
      batchId,
      accepted: clean.filter((r) => r.status === "inserted").length,
      duplicates: clean.filter((r) => r.status === "duplicate").length,
      rejected: clean.filter((r) => r.status === "rejected").length,
      results: clean,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("append batch items:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Close a batch. Safe to call twice — a retried close returns the same summary.
router.post("/box-batches/:id/close", verifyToken, scanLimiter, async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }

  try {
    const batch = await pool.query(
      `SELECT batch_id, status FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) return res.status(404).json({ error: "Batch not found" });

    const alreadyClosed = batch.rows[0].status === "closed";
    if (!alreadyClosed) {
      await pool.query(
        `UPDATE box_batches SET status = 'closed', closed_at = now()
         WHERE batch_id = $1 AND tenant_id = $2`,
        [batchId, req.tenantId]
      );
    }

    // Totals are grouped by unit. Summing LB and KG into one number would be
    // meaningless, and total_boxes is derived rather than stored so it cannot
    // drift from the real row count.
    const totals = await pool.query(
      `SELECT weight_unit, COUNT(*)::int AS count, SUM(weight)::text AS total
       FROM batch_items WHERE batch_id = $1 AND tenant_id = $2
       GROUP BY weight_unit ORDER BY weight_unit`,
      [batchId, req.tenantId]
    );

    return res.json({
      batchId,
      status: "closed",
      alreadyClosed,
      totalBoxes: totals.rows.reduce((sum, r) => sum + r.count, 0),
      totals: totals.rows.map((r) => ({
        unit: r.weight_unit, count: r.count, total: r.total,
      })),
    });
  } catch (err) {
    console.error("close box batch:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── Reading batches back ─────────────────────────────────────────────────────
// Without these the data is write-only: scanned, stored, and unreachable from
// anywhere but psql.

// Batch list with derived counts and totals. Totals come back as strings so
// NUMERIC never round-trips through a float.
router.get("/box-batches", verifyToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const result = await pool.query(
      `SELECT b.batch_id, b.lot_number, b.status, b.created_at, b.closed_at,
              COUNT(i.item_id)::int AS box_count,
              COALESCE(
                json_agg(json_build_object('unit', t.weight_unit, 'total', t.total))
                  FILTER (WHERE t.weight_unit IS NOT NULL),
                '[]'
              ) AS totals
         FROM box_batches b
         LEFT JOIN batch_items i ON i.batch_id = b.batch_id
         LEFT JOIN LATERAL (
           SELECT weight_unit, SUM(weight)::text AS total
             FROM batch_items
            WHERE batch_id = b.batch_id
            GROUP BY weight_unit
         ) t ON true
        WHERE b.tenant_id = $1
        GROUP BY b.batch_id, b.lot_number, b.status, b.created_at, b.closed_at
        ORDER BY b.created_at DESC
        LIMIT $2`,
      [req.tenantId, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("list box batches:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// One batch and every box on it — what the weight manifest is printed from.
router.get("/box-batches/:id", verifyToken, async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }
  try {
    const batch = await pool.query(
      `SELECT batch_id, lot_number, status, created_at, closed_at
         FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) return res.status(404).json({ error: "Batch not found" });

    const items = await pool.query(
      `SELECT item_id, weight::text AS weight, weight_unit, gtin,
              production_date, serial, is_manual, scanned_at
         FROM batch_items
        WHERE batch_id = $1 AND tenant_id = $2
        ORDER BY item_id`,
      [batchId, req.tenantId]
    );

    res.json({
      ...batch.rows[0],
      items: items.rows.map((r) => ({
        localId: r.item_id,
        weight: r.weight,
        weightUnit: r.weight_unit,
        gtin: r.gtin,
        productionDate: r.production_date
          ? new Date(r.production_date).toISOString().slice(0, 10) : null,
        serial: r.serial,
        isManual: r.is_manual,
        scannedAt: r.scanned_at,
        status: "synced", // it is in the database, so by definition it synced
      })),
    });
  } catch (err) {
    console.error("read box batch:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
module.exports.validateItem = validateItem;
module.exports.toThousandths = toThousandths;
