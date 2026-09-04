const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { parseGs1 } = require("../utils/gs1");
const { parseTallySheet } = require("../utils/tallySheet");
const { toPounds, kgToLb, sumWeights, trimTrailingZeros } = require("../utils/weight");
const { upload } = require("../utils/aws");
const readXlsxFile = require("read-excel-file/node");

// Schema lives in ../db/migrate.js and is applied, in order, before this
// module is ever required. The sequential migrate() that used to sit here was
// the first fix for the fire-and-forget race (CLAUDE.md §8); it has moved so
// that noblesse tables and box tables — and now the lot registry that both
// reference — are created by one ordered run instead of two.

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

// Every weight is reported in pounds, converted per box at read time.
//
// Rows written before the KG conversion shipped are still stored in kilograms —
// production ran that way for a while — so a total that trusted weight_unit
// would report a kilogram figure beside a manifest printed in pounds.
//
// ROUND per row, THEN SUM. Never SUM then convert: each box rounds
// independently, so the two orders disagree by a thousandth or so and the
// printed column would not add up to its own subtotal, which is exactly what
// someone reconciling a shipment checks. NUMERIC arithmetic here is exact
// decimal and ROUND is half-away-from-zero, matching utils/weight.js.
const weightInLb = (t = "") => {
  const col = t ? `${t}.` : "";
  // ROUND twice on purpose: to thousandths first, matching what the client's
  // converter produces, then to the two decimals actually shown. Collapsing
  // these into one step can land a cent away at a rounding boundary, and the
  // screen would disagree with the paper.
  return `ROUND(ROUND(CASE WHEN ${col}weight_unit = 'KG' THEN ${col}weight / 0.45359237 ELSE ${col}weight END, 3), 2)`;
};

// Records a removal. Never throws into the request path: failing to write the
// audit row must not fail the operation the operator actually asked for — but
// it is logged loudly, because a silently missing audit trail is worse than a
// noisy one.
const logBoxRemoval = ({
  tenantId, action, batchId = null, itemId = null,
  lotNumber = null, summary = null, reason = null, details = null, performedBy = null,
}) => pool.query(
  `INSERT INTO box_removal_history
     (tenant_id, action, batch_id, item_id, lot_number, summary, reason, details, performed_by)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
  [tenantId, action, batchId, itemId, lotNumber, summary, reason,
   details ? JSON.stringify(details) : null, performedBy]
).catch((err) => console.error("box removal history log error:", err.message));

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
    const asLb = toPounds(weight, weightUnit);
    if (toThousandths(asLb.weight) > MAX_WEIGHT_THOUSANDTHS) {
      return { ok: false, code: "IMPLAUSIBLE_WEIGHT", reason: "weight exceeds plausible range" };
    }
    return { ok: true, row: {
      weight: asLb.weight, weightUnit: asLb.weightUnit, convertedFrom: asLb.convertedFrom,
      gtin: null, productionDate: null,
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

  // Only now, with the barcode verified against what the client claimed, is the
  // weight converted. Doing it on the client instead would send pounds against a
  // kilogram payload and the UNIT_MISMATCH check above would reject the scan —
  // the verification has to happen in the unit the label is actually printed in.
  //
  // Everything below comes from the server's own parse, not from the client.
  const asLb = toPounds(parsed.weight.value, parsed.weight.unit);
  if (toThousandths(asLb.weight) > MAX_WEIGHT_THOUSANDTHS) {
    return { ok: false, code: "IMPLAUSIBLE_WEIGHT",
      reason: `Converts to ${asLb.weight} LB, outside the plausible range` };
  }

  return { ok: true, row: {
    // Stored in pounds. The original kilogram figure is not lost — raw_barcode
    // holds the payload it was read from and re-parses to it exactly.
    weight: asLb.weight,
    weightUnit: asLb.weightUnit,
    convertedFrom: asLb.convertedFrom,
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
  const { clientUuid, lotNumber, vendor, shipTo, billOfLading, itemDescription } = req.body || {};
  if (!clientUuid || typeof clientUuid !== "string") {
    return res.status(400).json({ error: "clientUuid is required" });
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO box_batches
         (tenant_id, client_uuid, lot_number, vendor, ship_to, bill_of_lading, item_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (client_uuid) DO NOTHING
       RETURNING batch_id, status, created_at, lot_number,
                 vendor, ship_to, bill_of_lading, item_description`,
      [req.tenantId, clientUuid, lotNumber || null, vendor || null,
       shipTo || null, billOfLading || null, itemDescription || null]
    );

    if (inserted.rows.length) {
      return res.status(201).json({ ...inserted.rows[0], reused: false });
    }

    // Already existed. Scope the lookup by tenant so a UUID guessed from
    // another tenant cannot be adopted.
    const existing = await pool.query(
      `SELECT batch_id, status, created_at, lot_number,
              vendor, ship_to, bill_of_lading, item_description
         FROM box_batches
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
           (tenant_id, batch_id, weight, weight_unit, gtin, production_date, serial,
            raw_barcode, is_manual, converted_from)
         SELECT $1, $2, w, u, g, d, s, r, m, c
         FROM UNNEST(
           $3::numeric[], $4::text[], $5::text[], $6::date[],
           $7::text[], $8::text[], $9::boolean[], $10::text[]
         ) AS t(w, u, g, d, s, r, m, c)
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
          rows.map((r) => r.convertedFrom || null),
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
      `SELECT batch_id, status, lot_number FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
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

    // One total, in pounds: kilogram rows are converted per box on the way out,
    // so a session mixing units still closes with a figure that matches its
    // manifest. total_boxes is derived rather than stored so it cannot drift
    // from the real row count. HAVING keeps an empty batch returning no totals
    // row rather than one reading null.
    const totals = await pool.query(
      `SELECT 'LB' AS weight_unit, COUNT(*)::int AS count, SUM(${weightInLb()})::text AS total
       FROM batch_items WHERE batch_id = $1 AND tenant_id = $2 AND voided_at IS NULL
       HAVING COUNT(*) > 0`,
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

// ── Correcting rows ──────────────────────────────────────────────────────────
// Two audiences. An operator fixes their own session as they go — a box weighed
// twice, a damaged label read wrong — while the batch is still open. An admin
// fixes a batch that was closed days ago, which is a different act and is gated
// accordingly. The gate is here on the server: a disabled button is a courtesy,
// not a control.

const rowGate = async (batchId, req) => {
  const batch = await pool.query(
    `SELECT batch_id, status, lot_number FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
    [batchId, req.tenantId]
  );
  if (!batch.rows.length) return { ok: false, status: 404, error: "Batch not found" };
  if (batch.rows[0].status !== "open" && req.role !== "admin") {
    return { ok: false, status: 403,
      error: "This session is closed — only an admin can change it" };
  }
  return { ok: true, batch: batch.rows[0] };
};

const rowIds = (req) => ({
  batchId: Number(req.params.id),
  itemId: Number(req.params.itemId),
});

// Correct a weight. The row keeps what the barcode originally said, so a
// manifest can still show which figures a person changed and to what.
router.patch("/box-batches/:id/items/:itemId", verifyToken, scanLimiter, async (req, res) => {
  const { batchId, itemId } = rowIds(req);
  if (!Number.isInteger(batchId) || !Number.isInteger(itemId)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const { weight, weightUnit = "LB" } = req.body || {};
  if (typeof weight !== "string" || !DECIMAL_RE.test(weight)) {
    return res.status(400).json({ error: "weight must be a decimal string with at most 3 decimal places" });
  }
  if (!UNITS.has(String(weightUnit).toUpperCase())) {
    return res.status(400).json({ error: "weightUnit must be LB or KG" });
  }

  let asLb;
  try {
    asLb = toPounds(weight, weightUnit);
  } catch (err) {
    return res.status(400).json({ error: err.message, code: err.code || "BAD_WEIGHT" });
  }
  const thousandths = toThousandths(asLb.weight);
  if (thousandths <= 0n) {
    return res.status(400).json({ error: "weight must be greater than zero" });
  }
  if (thousandths > MAX_WEIGHT_THOUSANDTHS) {
    return res.status(400).json({ code: "IMPLAUSIBLE_WEIGHT", error: "weight exceeds plausible range" });
  }

  try {
    const gate = await rowGate(batchId, req);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    // COALESCE means the FIRST edit captures what the label said and every later
    // edit leaves it alone. Without it, a second correction would overwrite the
    // original with the first correction and the audit trail would be a lie.
    const updated = await pool.query(
      `UPDATE batch_items
          SET original_weight = COALESCE(original_weight, weight),
              weight          = $1,
              converted_from  = $2,
              edited_at       = now(),
              edited_by       = $3
        WHERE item_id = $4 AND batch_id = $5 AND tenant_id = $6
      RETURNING item_id, weight::text AS weight, original_weight::text AS original_weight,
                weight_unit, converted_from, edited_at`,
      [asLb.weight, asLb.convertedFrom, req.userId, itemId, batchId, req.tenantId]
    );
    if (!updated.rows.length) return res.status(404).json({ error: "Row not found" });

    return res.json({ ...updated.rows[0], editedBy: req.username || req.userId });
  } catch (err) {
    console.error("edit batch item:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Take a box off the tally. Soft, deliberately: that a box was scanned and then
// removed is a fact about the shipment, and a hard DELETE would erase the only
// record it ever happened. Voided rows are excluded from every count, total and
// printed manifest, but stay visible to whoever is reconciling.
router.delete("/box-batches/:id/items/:itemId", verifyToken, scanLimiter, async (req, res) => {
  const { batchId, itemId } = rowIds(req);
  if (!Number.isInteger(batchId) || !Number.isInteger(itemId)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : null;

  try {
    const gate = await rowGate(batchId, req);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    // Voiding twice is not an error — a retried request after a dropped response
    // must not report failure for work that already succeeded.
    const voided = await pool.query(
      `UPDATE batch_items
          SET voided_at = COALESCE(voided_at, now()),
              voided_by = COALESCE(voided_by, $1),
              void_reason = COALESCE(void_reason, $2)
        WHERE item_id = $3 AND batch_id = $4 AND tenant_id = $5
      RETURNING item_id, voided_at, void_reason,
                weight::text AS weight, weight_unit, serial, is_manual`,
      [req.userId, reason, itemId, batchId, req.tenantId]
    );
    if (!voided.rows.length) return res.status(404).json({ error: "Row not found" });

    const row = voided.rows[0];
    logBoxRemoval({
      tenantId: req.tenantId, action: "item_voided",
      batchId, itemId, lotNumber: gate.batch.lot_number,
      summary: `Box of ${row.weight} ${row.weight_unit} taken off the tally`,
      reason: row.void_reason, details: row, performedBy: req.username || req.userId,
    });

    return res.json({ ...row, voided: true });
  } catch (err) {
    console.error("void batch item:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Undo a void. Without this a mis-click would be permanent, and voiding is the
// only way to take a single box off a tally — deleting one outright is not
// offered, because a voided row still says what happened.
router.post("/box-batches/:id/items/:itemId/restore", verifyToken, scanLimiter, async (req, res) => {
  const { batchId, itemId } = rowIds(req);
  if (!Number.isInteger(batchId) || !Number.isInteger(itemId)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  try {
    const gate = await rowGate(batchId, req);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const restored = await pool.query(
      `UPDATE batch_items
          SET voided_at = NULL, voided_by = NULL, void_reason = NULL
        WHERE item_id = $1 AND batch_id = $2 AND tenant_id = $3
      RETURNING item_id, weight::text AS weight, weight_unit, serial`,
      [itemId, batchId, req.tenantId]
    );
    if (!restored.rows.length) return res.status(404).json({ error: "Row not found" });

    // Logged as well as the void: a trail that shows only removals, and not the
    // ones that were undone, overstates what actually left the tally.
    logBoxRemoval({
      tenantId: req.tenantId, action: "item_restored",
      batchId, itemId, lotNumber: gate.batch.lot_number,
      summary: `Box of ${restored.rows[0].weight} ${restored.rows[0].weight_unit} put back on the tally`,
      details: restored.rows[0], performedBy: req.username || req.userId,
    });

    return res.json({ itemId: restored.rows[0].item_id, voided: false });
  } catch (err) {
    console.error("restore batch item:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Delete an entire weighing session and every box in it.
//
// The row-level erase above is for one bad box; this is for a session that
// should not exist at all — a start pressed by accident, a test run, a lot
// weighed under the wrong number. Admin only, and it takes the boxes with it,
// so it is confirmed in the UI against the lot and the box count.
//
// It REFUSES when the session is part of a merged manifest. A group stores
// references, so deleting a session out from under one would silently shrink a
// manifest somebody has already printed and filed — the exact fork-the-truth
// problem merged manifests exist to avoid. Remove it from the group first; the
// error names the groups so that is actionable rather than a dead end.
router.delete("/box-batches/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId)) return res.status(400).json({ error: "Invalid batch id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batch = await client.query(
      `SELECT batch_id, lot_number, status FROM box_batches
        WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Session not found" });
    }

    const inGroups = await client.query(
      `SELECT g.group_id, g.name, g.lot_number
         FROM manifest_group_batches m
         JOIN manifest_groups g ON g.group_id = m.group_id
        WHERE m.batch_id = $1 AND g.tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (inGroups.rows.length) {
      await client.query("ROLLBACK");
      const names = inGroups.rows
        .map((g) => g.name || g.lot_number || `Manifest ${g.group_id}`)
        .join(", ");
      return res.status(409).json({
        code: "IN_MANIFEST_GROUP",
        error: `This session is part of a merged manifest (${names}). ` +
               `Remove it from that manifest before deleting the session.`,
        groups: inGroups.rows,
      });
    }

    // Same reasoning as the manifest-group check: a registration form pointing
    // at this session records what came in, and deleting the boxes out from
    // under it would leave its weight unaccounted for.
    const inForms = await client.query(
      `SELECT f.id, f.lot_number
         FROM registration_form_batches r
         JOIN noblesse_registration_forms f ON f.id = r.form_id
        WHERE r.batch_id = $1 AND r.tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (inForms.rows.length) {
      await client.query("ROLLBACK");
      const names = inForms.rows.map((f) => f.lot_number || `form ${f.id}`).join(", ");
      return res.status(409).json({
        code: "IN_REGISTRATION_FORM",
        error: `This session is tied to a registration form (${names}). ` +
               `Untie it there before deleting the session.`,
        forms: inForms.rows,
      });
    }

    // Children first: batch_items references box_batches, and there is no
    // ON DELETE CASCADE on that constraint. Every box comes back with the
    // delete so the audit entry carries the session in full — after this there
    // is no other copy of these weights anywhere.
    const items = await client.query(
      `DELETE FROM batch_items WHERE batch_id = $1 AND tenant_id = $2
       RETURNING *, weight::text AS weight`,
      [batchId, req.tenantId]
    );
    await client.query(
      `DELETE FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );

    await client.query("COMMIT");

    console.warn(
      `box_batches delete: batch ${batchId} (lot ${batch.rows[0].lot_number || "none"}) ` +
      `with ${items.rowCount} boxes by user ${req.userId}`
    );

    logBoxRemoval({
      tenantId: req.tenantId, action: "batch_deleted",
      batchId, lotNumber: batch.rows[0].lot_number,
      summary: `Whole session deleted — ${items.rowCount} box` +
               `${items.rowCount === 1 ? "" : "es"}`,
      details: { batch: batch.rows[0], items: items.rows },
      performedBy: req.username || req.userId,
    });

    return res.json({ deleted: true, batchId, boxesDeleted: items.rowCount });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("delete box batch:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// ── Importing a hand-entered tally sheet ─────────────────────────────────────
// The path for lots whose labels carry no barcode: the weights are written
// into the Excel form on an iPad and the file is uploaded here.
//
// Send dryRun=true first to show the operator what was read; without it the
// batch is written. Both go through the same parser, so the preview cannot
// disagree with what gets stored.
router.post("/box-batches/import", verifyToken, scanLimiter, upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const dryRun = String(req.body.dryRun) === "true";
    const clientUuid = req.body.clientUuid;
    if (!dryRun && !clientUuid) {
      return res.status(400).json({ error: "clientUuid is required to commit an import" });
    }

    let parsed;
    try {
      const rows = await readXlsxFile(req.file.buffer);
      parsed = parseTallySheet(rows);
    } catch (err) {
      // A parse or checksum failure is the operator's problem to fix in the
      // spreadsheet, so it comes back as a 400 with the specific reason.
      return res.status(400).json({
        error: err.message,
        code: err.code || "PARSE_FAILED",
        details: err.details || null,
      });
    }

    // The unit is not on the sheet. Canada and Mexico ship in kilograms, so
    // this cannot be assumed — the operator picks it and it is recorded.
    const weightUnit = String(req.body.weightUnit || "LB").toUpperCase();
    if (!UNITS.has(weightUnit)) {
      return res.status(400).json({ error: "weightUnit must be LB or KG" });
    }

    const overLimit = parsed.weights.filter((w) => toThousandths(w) > MAX_WEIGHT_THOUSANDTHS);
    if (overLimit.length) {
      return res.status(400).json({
        code: "IMPLAUSIBLE_WEIGHT",
        error: `Sheet contains ${overLimit.length} weight(s) outside the plausible range`,
        details: { weights: overLimit.slice(0, 5) },
      });
    }

    // The heading may be corrected in the preview before committing — real
    // sheets carry things like "P12 N26230-01" in the lot cell. The WEIGHTS are
    // deliberately not overridable: they passed the sheet's own checksums, and
    // letting them be hand-edited afterwards would quietly void that guarantee.
    const pick = (override, fromSheet) => {
      const v = typeof override === "string" ? override.trim() : "";
      return v || fromSheet || null;
    };

    // Converted only after the sheet has been reconciled against its own
    // checksums in the unit it was written in. Each box converts individually
    // and the total is the sum of those converted figures, so the printed
    // column adds up to the printed total — summing in kilograms and converting
    // once gives a total that disagrees with the column by a few hundredths.
    // Trailing zeros are trimmed so a converted sheet reads the way the paper
    // one does. An LB sheet passes through untouched — there is nothing to
    // convert, and reformatting figures the operator is about to compare
    // against the page in their hand helps nobody.
    const isKg = weightUnit === "KG";
    const converted = isKg
      ? parsed.weights.map((w) => trimTrailingZeros(kgToLb(w)))
      : parsed.weights;
    const subtotal = isKg ? trimTrailingZeros(sumWeights(converted)) : parsed.computed.subtotal;
    const storedUnit = "LB";

    const summary = {
      lotNumber: pick(req.body.lotNumber, parsed.lotNumber),
      vendor: pick(req.body.vendor, parsed.vendor),
      shipTo: pick(req.body.shipTo, parsed.shipTo),
      itemDescription: pick(req.body.itemDescription, parsed.itemDescription),
      date: parsed.date,
      weightUnit: storedUnit,
      convertedFrom: weightUnit === "KG" ? "KG" : null,
      boxes: parsed.computed.boxes,
      subtotal,
      declared: parsed.declared,
      weights: converted,
      // What the sheet itself said, so the preview can show the operator the
      // figures they will recognise from the paper.
      asWritten: weightUnit === "KG"
        ? { unit: "KG", subtotal: parsed.computed.subtotal, weights: parsed.weights }
        : null,
    };

    if (dryRun) return res.json({ preview: true, ...summary });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const batch = await client.query(
        `INSERT INTO box_batches
           (tenant_id, client_uuid, lot_number, vendor, ship_to, item_description,
            source, status, closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'imported', 'closed', now())
         ON CONFLICT (client_uuid) DO NOTHING
         RETURNING batch_id`,
        [req.tenantId, clientUuid, summary.lotNumber, summary.vendor,
         summary.shipTo, summary.itemDescription]
      );

      // A retried upload finds its own batch rather than importing twice.
      if (!batch.rows.length) {
        await client.query("ROLLBACK");
        const existing = await pool.query(
          `SELECT batch_id FROM box_batches WHERE client_uuid = $1 AND tenant_id = $2`,
          [clientUuid, req.tenantId]
        );
        if (!existing.rows.length) return res.status(409).json({ error: "clientUuid already used" });
        return res.json({ ...summary, batchId: existing.rows[0].batch_id, reused: true });
      }

      const batchId = batch.rows[0].batch_id;

      // is_manual is true because none of these came from a barcode; the
      // batch's source column is what marks the whole lot as imported.
      await client.query(
        `INSERT INTO batch_items
           (tenant_id, batch_id, weight, weight_unit, is_manual, converted_from)
         SELECT $1, $2, w, $3, true, $5
           FROM UNNEST($4::numeric[]) AS w`,
        [req.tenantId, batchId, storedUnit, summary.weights, summary.convertedFrom]
      );

      await client.query("COMMIT");
      return res.status(201).json({ ...summary, batchId, reused: false });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("import tally:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    } finally {
      client.release();
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
    // Both aggregates are independent scalar subqueries rather than joins.
    // Joining batch_items for the count AND again for the per-unit totals
    // multiplies the two together: 17 boxes x 1 unit produced 17 copies of the
    // same total, and with two units it would also have doubled box_count.
    // A scalar subquery returns exactly one value and cannot fan out.
    const result = await pool.query(
      `SELECT b.batch_id, b.lot_number, b.vendor, b.item_description, b.source,
              b.status, b.created_at, b.closed_at,
              (SELECT COUNT(*)::int
                 FROM batch_items i
                WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL) AS box_count,
              COALESCE((
                SELECT json_agg(json_build_object('unit', g.weight_unit, 'total', g.total)
                                ORDER BY g.weight_unit)
                  FROM (
                    SELECT 'LB' AS weight_unit, SUM(${weightInLb()})::text AS total
                      FROM batch_items
                     WHERE batch_id = b.batch_id AND voided_at IS NULL
                    HAVING COUNT(*) > 0
                  ) g
              ), '[]'::json) AS totals
         FROM box_batches b
        WHERE b.tenant_id = $1
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
      `SELECT batch_id, lot_number, vendor, ship_to, bill_of_lading, item_description, source,
              status, created_at, closed_at
         FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) return res.status(404).json({ error: "Batch not found" });

    const items = await pool.query(
      `SELECT item_id, weight::text AS weight, weight_unit, gtin,
              production_date, serial, is_manual, converted_from, scanned_at,
              original_weight::text AS original_weight, edited_at, edited_by,
              voided_at, voided_by, void_reason
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
        convertedFrom: r.converted_from,
        scannedAt: r.scanned_at,
        // The audit trail travels with the row: a reviewer needs to see that a
        // figure was changed, and from what, without running a query.
        originalWeight: r.original_weight,
        editedAt: r.edited_at,
        voidedAt: r.voided_at,
        voidReason: r.void_reason,
        // A voided box is still shown — it is excluded from totals and from the
        // printed manifest, but hiding it would defeat the point of a soft void.
        status: r.voided_at ? "voided" : "synced",
      })),
    });
  } catch (err) {
    console.error("read box batch:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── Merged manifests ─────────────────────────────────────────────────────────
// Several weighing sessions printed as one tally sheet. The group holds
// references, never copies: a weight corrected in a session afterwards shows up
// on the next reprint of the manifest rather than leaving the two disagreeing.

// Create a group. The heading defaults to the first session's, since in practice
// these are sessions covering one lot.
router.post("/manifest-groups", verifyToken, scanLimiter, async (req, res) => {
  const { batchIds, name, lotNumber, vendor, shipTo, billOfLading, itemDescription } = req.body || {};

  if (!Array.isArray(batchIds) || batchIds.length === 0) {
    return res.status(400).json({ error: "batchIds must be a non-empty array" });
  }
  if (!batchIds.every((id) => Number.isInteger(id))) {
    return res.status(400).json({ error: "batchIds must all be integers" });
  }
  // De-duplicated before insert: the same session listed twice would otherwise
  // trip the primary key and roll back the whole group.
  const ids = [...new Set(batchIds)];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Every session must belong to this tenant. Checked by counting rather than
    // trusting the request, so a batch id from another tenant cannot be folded
    // into a manifest.
    const owned = await client.query(
      `SELECT batch_id, lot_number, vendor, ship_to, bill_of_lading, item_description
         FROM box_batches WHERE batch_id = ANY($1::int[]) AND tenant_id = $2`,
      [ids, req.tenantId]
    );
    if (owned.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or more sessions were not found" });
    }

    const first = owned.rows.find((b) => b.batch_id === ids[0]) || owned.rows[0];
    const pick = (given, fallback) => {
      const v = typeof given === "string" ? given.trim() : "";
      return v || fallback || null;
    };

    const group = await client.query(
      `INSERT INTO manifest_groups
         (tenant_id, name, lot_number, vendor, ship_to, bill_of_lading, item_description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING group_id, name, lot_number, vendor, ship_to, bill_of_lading,
                 item_description, created_at`,
      [req.tenantId, pick(name, null), pick(lotNumber, first.lot_number),
       pick(vendor, first.vendor), pick(shipTo, first.ship_to),
       pick(billOfLading, first.bill_of_lading),
       pick(itemDescription, first.item_description), req.userId]
    );
    const groupId = group.rows[0].group_id;

    // Position preserves the order the operator picked, which is the order the
    // boxes are written down the printed form.
    await client.query(
      `INSERT INTO manifest_group_batches (group_id, batch_id, position)
       SELECT $1, b, p FROM UNNEST($2::int[], $3::int[]) AS t(b, p)`,
      [groupId, ids, ids.map((_, i) => i)]
    );

    await client.query("COMMIT");
    return res.status(201).json({ ...group.rows[0], batchIds: ids });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("create manifest group:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// List groups, with the same derived counts the session list carries so the two
// read alike. Voided boxes are excluded here exactly as they are everywhere.
router.get("/manifest-groups", verifyToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const result = await pool.query(
      `SELECT g.group_id, g.name, g.lot_number, g.vendor, g.item_description,
              g.created_at,
              (SELECT COUNT(*)::int FROM manifest_group_batches m
                WHERE m.group_id = g.group_id) AS session_count,
              (SELECT COUNT(*)::int
                 FROM batch_items i
                 JOIN manifest_group_batches m ON m.batch_id = i.batch_id
                WHERE m.group_id = g.group_id AND i.voided_at IS NULL) AS box_count,
              COALESCE((
                SELECT SUM(${weightInLb("i")})::text
                  FROM batch_items i
                  JOIN manifest_group_batches m ON m.batch_id = i.batch_id
                 WHERE m.group_id = g.group_id AND i.voided_at IS NULL
              ), '0') AS total
         FROM manifest_groups g
        WHERE g.tenant_id = $1
        ORDER BY g.created_at DESC
        LIMIT $2`,
      [req.tenantId, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("list manifest groups:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// One group with every box across its sessions, in session order then scan
// order — the sequence they are written down the printed form.
router.get("/manifest-groups/:id", verifyToken, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId)) return res.status(400).json({ error: "Invalid group id" });

  try {
    const group = await pool.query(
      `SELECT group_id, name, lot_number, vendor, ship_to, bill_of_lading,
              item_description, created_at
         FROM manifest_groups WHERE group_id = $1 AND tenant_id = $2`,
      [groupId, req.tenantId]
    );
    if (!group.rows.length) return res.status(404).json({ error: "Manifest not found" });

    const items = await pool.query(
      `SELECT i.item_id, i.weight::text AS weight, i.weight_unit, i.gtin,
              i.production_date, i.serial, i.is_manual, i.converted_from, i.scanned_at,
              i.original_weight::text AS original_weight, i.edited_at,
              i.voided_at, i.void_reason,
              b.batch_id, b.lot_number AS batch_lot
         FROM batch_items i
         JOIN manifest_group_batches m ON m.batch_id = i.batch_id
         JOIN box_batches b ON b.batch_id = i.batch_id
        WHERE m.group_id = $1 AND i.tenant_id = $2
        ORDER BY m.position, i.item_id`,
      [groupId, req.tenantId]
    );

    const sessions = await pool.query(
      `SELECT b.batch_id, b.lot_number, b.vendor, b.status, b.source, m.position
         FROM manifest_group_batches m
         JOIN box_batches b ON b.batch_id = m.batch_id
        WHERE m.group_id = $1 AND b.tenant_id = $2
        ORDER BY m.position`,
      [groupId, req.tenantId]
    );

    res.json({
      ...group.rows[0],
      sessions: sessions.rows,
      items: items.rows.map((r) => ({
        localId: r.item_id,
        weight: r.weight,
        weightUnit: r.weight_unit,
        gtin: r.gtin,
        productionDate: r.production_date
          ? new Date(r.production_date).toISOString().slice(0, 10) : null,
        serial: r.serial,
        isManual: r.is_manual,
        convertedFrom: r.converted_from,
        scannedAt: r.scanned_at,
        originalWeight: r.original_weight,
        editedAt: r.edited_at,
        voidedAt: r.voided_at,
        voidReason: r.void_reason,
        batchId: r.batch_id,
        batchLot: r.batch_lot,
        status: r.voided_at ? "voided" : "synced",
      })),
    });
  } catch (err) {
    console.error("read manifest group:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Unmake a group. The sessions and their boxes are untouched — only the
// grouping goes, which is why this one is a hard delete.
router.delete("/manifest-groups/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId)) return res.status(400).json({ error: "Invalid group id" });
  try {
    // The member list is read first: the CASCADE takes it with the group, and
    // which sessions the manifest covered is the part worth keeping.
    const members = await pool.query(
      `SELECT batch_id, position FROM manifest_group_batches WHERE group_id = $1`,
      [groupId]
    );
    const gone = await pool.query(
      `DELETE FROM manifest_groups WHERE group_id = $1 AND tenant_id = $2 RETURNING *`,
      [groupId, req.tenantId]
    );
    if (!gone.rows.length) return res.status(404).json({ error: "Manifest not found" });

    logBoxRemoval({
      tenantId: req.tenantId, action: "manifest_group_deleted",
      lotNumber: gone.rows[0].lot_number,
      summary: `Merged manifest removed — covered ${members.rows.length} session` +
               `${members.rows.length === 1 ? "" : "s"}`,
      details: { group: gone.rows[0], batches: members.rows },
      performedBy: req.username || req.userId,
    });

    res.json({ deleted: true, groupId });
  } catch (err) {
    console.error("delete manifest group:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Everything that has been taken off a tally, newest first. Voids and restores
// are included alongside the permanent deletions: a trail showing only removals
// and not the ones that were undone overstates what actually left.
router.get("/box-removals", verifyToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const batchId = req.query.batchId ? Number(req.query.batchId) : null;
  if (req.query.batchId && !Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }

  try {
    const result = await pool.query(
      `SELECT id, action, batch_id, item_id, lot_number, summary, reason,
              details, performed_by, created_at
         FROM box_removal_history
        WHERE tenant_id = $1
          AND ($2::int IS NULL OR batch_id = $2)
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [req.tenantId, batchId, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("list box removals:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── Box weights feeding a registration form ──────────────────────────────────
// A registration form records what came in; box weighing is how that figure is
// actually measured. These endpoints tie the two together so nobody reads a
// total off a manifest and retypes it into a form.
//
// They live here rather than in noblesse.pg.js because the arithmetic does —
// weightInLb, the voided-row exclusion and the per-box rounding all have to
// match what the manifest prints, and duplicating that elsewhere is how the two
// drift apart.

// The live figure for a form: every box across its linked sessions, converted
// and rounded exactly as the tally is, with voided rows excluded.
const boxTotalsForForm = async (formId, tenantId) => {
  const sessions = await pool.query(
    `SELECT b.batch_id, b.lot_number, b.vendor, b.status, b.source, b.created_at,
            (SELECT COUNT(*)::int FROM batch_items i
              WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL) AS box_count,
            COALESCE((SELECT SUM(${weightInLb("i")})::text FROM batch_items i
              WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL), '0') AS total
       FROM registration_form_batches r
       JOIN box_batches b ON b.batch_id = r.batch_id
      WHERE r.form_id = $1 AND r.tenant_id = $2
      ORDER BY r.position, b.batch_id`,
    [formId, tenantId]
  );

  const totals = await pool.query(
    `SELECT COUNT(*)::int AS box_count,
            COALESCE(SUM(${weightInLb("i")})::text, '0') AS total
       FROM batch_items i
       JOIN registration_form_batches r ON r.batch_id = i.batch_id
      WHERE r.form_id = $1 AND r.tenant_id = $2 AND i.voided_at IS NULL`,
    [formId, tenantId]
  );

  return {
    sessions: sessions.rows,
    boxCount: totals.rows[0] ? totals.rows[0].box_count : 0,
    totalWeight: totals.rows[0] ? totals.rows[0].total : "0",
    weightUnit: "LB",
  };
};

router.get("/noblesse-registration-forms/:id/box-batches", verifyToken, async (req, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) return res.status(400).json({ error: "Invalid form id" });
  try {
    res.json(await boxTotalsForForm(formId, req.tenantId));
  } catch (err) {
    console.error("read form box batches:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Tie one or more weighing sessions to a form.
router.post("/noblesse-registration-forms/:id/box-batches", verifyToken, async (req, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) return res.status(400).json({ error: "Invalid form id" });

  const { batchIds } = req.body || {};
  if (!Array.isArray(batchIds) || batchIds.length === 0) {
    return res.status(400).json({ error: "batchIds must be a non-empty array" });
  }
  if (!batchIds.every((id) => Number.isInteger(id))) {
    return res.status(400).json({ error: "batchIds must all be integers" });
  }
  const ids = [...new Set(batchIds)];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const form = await client.query(
      `SELECT id FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [formId, req.tenantId]
    );
    if (!form.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Registration form not found" });
    }

    // Counted rather than trusted, so a session id from another tenant cannot
    // be attached to this form.
    const owned = await client.query(
      `SELECT batch_id FROM box_batches WHERE batch_id = ANY($1::int[]) AND tenant_id = $2`,
      [ids, req.tenantId]
    );
    if (owned.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or more sessions were not found" });
    }

    // Re-linking an already-linked session is not an error — it is what a
    // double tap produces, and the link is the same either way.
    await client.query(
      `INSERT INTO registration_form_batches (form_id, batch_id, tenant_id, position)
       SELECT $1, b, $2, p FROM UNNEST($3::int[], $4::int[]) AS t(b, p)
       ON CONFLICT (form_id, batch_id) DO NOTHING`,
      [formId, req.tenantId, ids, ids.map((_, i) => i)]
    );

    await client.query("COMMIT");
    return res.status(201).json(await boxTotalsForForm(formId, req.tenantId));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("link form box batches:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Untie one session. The session and its boxes are untouched — only the link
// goes, which is why this one is a plain delete.
router.delete("/noblesse-registration-forms/:id/box-batches/:batchId",
  verifyToken, async (req, res) => {
    const formId = Number(req.params.id);
    const batchId = Number(req.params.batchId);
    if (!Number.isInteger(formId) || !Number.isInteger(batchId)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      await pool.query(
        `DELETE FROM registration_form_batches
          WHERE form_id = $1 AND batch_id = $2 AND tenant_id = $3`,
        [formId, batchId, req.tenantId]
      );
      res.json(await boxTotalsForForm(formId, req.tenantId));
    } catch (err) {
      console.error("unlink form box batch:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

module.exports = router;
module.exports.validateItem = validateItem;
module.exports.toThousandths = toThousandths;
