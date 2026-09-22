const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { parseGs1 } = require("../utils/gs1");
const { parseTallySheet } = require("../utils/tallySheet");
const { toPounds, kgToLb, sumWeights, trimTrailingZeros } = require("../utils/weight");
const { lotColumns, lookupLot } = require("../utils/lotRegistry");
const { searchTerm, searchClause } = require("../utils/search");
const { weighedAtSql } = require("../utils/weighedAt");
const { pacificToday } = require("../utils/lot");
const { upload } = require("../utils/aws");
const readXlsxFile = require("read-excel-file/node");

// Schema lives in ../db/migrate.js and is applied, in order, before this module is
// ever required.

// ── Rate limiting ────────────────────────────────────────────────────────────
// The global 60/min limiter in index.js keys on IP, so every iPad behind the
// warehouse NAT shares one budget.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: { error: "Too many scan requests, slow down" },
});

// Shared with routes/lots.pg.js so both report the same figure.
const { weightInLb } = require("../utils/sqlWeight");

// Records a removal.
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

// Everything that currently prevents a weighing session being deleted.
const batchBlockers = async (q, batchId, tenantId) => {
  const groups = await q.query(
    `SELECT g.group_id, g.name, g.lot_number
       FROM manifest_group_batches m
       JOIN manifest_groups g ON g.group_id = m.group_id
      WHERE m.batch_id = $1 AND g.tenant_id = $2`,
    [batchId, tenantId]
  );
  const forms = await q.query(
    `SELECT f.id, f.lot_number
       FROM registration_form_batches r
       JOIN noblesse_registration_forms f ON f.id = r.form_id
      WHERE r.batch_id = $1 AND r.tenant_id = $2`,
    [batchId, tenantId]
  );
  const shipments = await q.query(
    `SELECT s.shipment_id, s.destination_name, s.status,
            s.ship_date, s.bill_of_lading
       FROM shipment_batches sb
       JOIN noblesse_shipments s ON s.shipment_id = sb.shipment_id
      WHERE sb.batch_id = $1 AND s.tenant_id = $2`,
    [batchId, tenantId]
  );
  return { groups: groups.rows, forms: forms.rows, shipments: shipments.rows };
};

// ── Validation helpers ───────────────────────────────────────────────────────

const UNITS = new Set(["LB", "KG"]);
const DECIMAL_RE = /^\d{1,5}(\.\d{1,3})?$/; // fits NUMERIC(8,3)
const MAX_WEIGHT_THOUSANDTHS = 2000n * 1000n; // 2000 lb/kg per box is already absurd
// Matches the column's CHECK.
const ENTRY_METHODS = new Set(["scanned", "scale", "keyed"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Decimal string -> integer thousandths, so weights compare exactly with no
// float ever entering the path. "76.20" and "76.2" must compare equal.
const toThousandths = (s) => {
  const [whole, frac = ""] = String(s).split(".");
  return BigInt(whole) * 1000n + BigInt((frac + "000").slice(0, 3));
};

// Validates one incoming scan and, when it carries a barcode, re-derives the weight
// from that barcode server-side.
const validateItem = (item) => {
  if (!item || typeof item !== "object") {
    return { ok: false, code: "BAD_ITEM", reason: "Item is not an object" };
  }

  const { weight, weightUnit, rawBarcode, isManual = false } = item;

  // Supplied by the client: the server sees the same payload from scale and keypad.
  const entryMethod = ENTRY_METHODS.has(item.entryMethod) ? item.entryMethod : null;
  const clientItemUuid = UUID_RE.test(String(item.clientItemUuid || ""))
    ? String(item.clientItemUuid) : null;

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

  // A weight the server itself re-derives from a barcode is a measurement by
  // definition.
  if (rawBarcode && item.isEstimated === true) {
    return { ok: false, code: "ESTIMATE_WITH_BARCODE",
      reason: "A weight read from a barcode is not an estimate" };
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
      entryMethod, clientItemUuid,
      isEstimated: item.isEstimated === true,
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
  // weight converted.
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
    productionDate: parsed.productionDate || parsed.packagingDate,
    serial: parsed.serial,
    rawBarcode,
    isManual: false,
    // FORCED, not taken from the client. The provenance of a box the server
    // verified against its own barcode parse is not the client's to assert.
    entryMethod: "scanned",
    isEstimated: false,
    clientItemUuid,
  } };
};

// ── Routes ───────────────────────────────────────────────────────────────────

// Create a batch. Idempotent on client_uuid so a retried POST after a dropped
// response returns the original batch instead of orphaning one.
router.post("/box-batches", verifyToken, scanLimiter, async (req, res) => {
  const { clientUuid, lotNumber, vendor, shipTo, billOfLading, itemDescription,
          brand, estNumber, grade, direction, expectedBoxes, lotId } = req.body || {};
  if (!clientUuid || typeof clientUuid !== "string") {
    return res.status(400).json({ error: "clientUuid is required" });
  }

  // Defaults to incoming, so every existing caller keeps its meaning without being
  // changed.
  const dir = direction == null ? "incoming" : String(direction);
  if (dir !== "incoming" && dir !== "outgoing") {
    return res.status(400).json({ error: "direction must be 'incoming' or 'outgoing'" });
  }

  // Optional, and a PROMPT rather than a limit — reaching it offers to finalise,
  // it never closes the session or refuses box N+1. See db/migrate.js.
  let expected = null;
  if (expectedBoxes != null && expectedBoxes !== "") {
    expected = Number(expectedBoxes);
    if (!Number.isInteger(expected) || expected <= 0) {
      return res.status(400).json({ error: "expectedBoxes must be a positive whole number" });
    }
  }

  try {
    // Incoming opens on the dock and may ISSUE a lot.
    let lot;
    if (dir === "outgoing") {
      // Resolve by ID when the caller has one, which it does whenever the lot came
      // from the picker.
      if (lotId != null) {
        const byId = await pool.query(
          `SELECT lot_id, lot_number FROM lots WHERE lot_id = $1 AND tenant_id = $2`,
          [Number(lotId), req.tenantId]
        );
        lot = byId.rows.length
          ? { lotId: byId.rows[0].lot_id, lotNumber: byId.rows[0].lot_number }
          : null;
      } else {
        lot = await lookupLot(req.tenantId, lotNumber);
      }

      if (!lot || lot.lotId == null) {
        return res.status(400).json({
          code: "NO_SUCH_LOT",
          error: lotNumber || lotId
            ? `That lot is not in the registry. Finished product is weighed against ` +
              `the lot the raw product arrived under.`
            : `Pick the lot these boxes came from before weighing them.`,
        });
      }
    } else {
      lot = await lotColumns(req.tenantId, req.userId, lotNumber);
    }

    // What the product IS was recorded when it arrived.
    let inherited = {};
    if (dir === "outgoing" && lot.lotId != null) {
      const src = await pool.query(
        `SELECT vendor, item_description, brand, est_number, grade
           FROM box_batches
          WHERE tenant_id = $1 AND lot_id = $2 AND direction = 'incoming'
          ORDER BY created_at DESC
          LIMIT 1`,
        [req.tenantId, lot.lotId]
      );
      if (src.rows.length) inherited = src.rows[0];
    }
    const pick = (given, fallbackKey) =>
      (given != null && String(given).trim() !== "")
        ? given
        : (inherited[fallbackKey] || null);

    const inserted = await pool.query(
      `INSERT INTO box_batches
         (tenant_id, client_uuid, lot_number, vendor, ship_to, bill_of_lading,
          item_description, brand, est_number, grade, lot_id, direction, expected_boxes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (client_uuid) DO NOTHING
       RETURNING batch_id, status, created_at, lot_number,
                 vendor, ship_to, bill_of_lading, item_description,
                 brand, est_number, grade, lot_id, direction, expected_boxes`,
      [req.tenantId, clientUuid, lot.lotNumber,
       pick(vendor, "vendor"),
       shipTo || null, billOfLading || null,
       pick(itemDescription, "item_description"),
       pick(brand, "brand"),
       pick(estNumber, "est_number"),
       pick(grade, "grade"),
       lot.lotId, dir, expected]
    );

    if (inserted.rows.length) {
      return res.status(201).json({ ...inserted.rows[0], reused: false });
    }

    // Already existed. Scope the lookup by tenant so a UUID guessed from
    // another tenant cannot be adopted.
    const existing = await pool.query(
      `SELECT batch_id, status, created_at, lot_number,
              vendor, ship_to, bill_of_lading, item_description,
              brand, est_number, grade, lot_id, direction, expected_boxes
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
    // A closed session is admin-only, not sealed.
    if (batch.rows[0].status !== "open" && req.role !== "admin") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "BATCH_CLOSED",
        error: "This session is closed. Only an admin can add a box to it.",
      });
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
            raw_barcode, is_manual, converted_from, entry_method, is_estimated,
            client_item_uuid)
         SELECT $1, $2, w, u, g, d, s, r, m, c, e, x, k
         FROM UNNEST(
           $3::numeric[], $4::text[], $5::text[], $6::date[],
           $7::text[], $8::text[], $9::boolean[], $10::text[],
           $11::text[], $12::boolean[], $13::uuid[]
         ) AS t(w, u, g, d, s, r, m, c, e, x, k)
         ON CONFLICT DO NOTHING
         RETURNING item_id, serial, client_item_uuid`,
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
          rows.map((r) => r.entryMethod || null),
          rows.map((r) => r.isEstimated === true),
          rows.map((r) => r.clientItemUuid || null),
        ]
      );

      const idBySerial = new Map(
        insertedRows.rows.filter((r) => r.serial).map((r) => [r.serial, r.item_id])
      );
      const idByUuid = new Map(
        insertedRows.rows.filter((r) => r.client_item_uuid)
          .map((r) => [r.client_item_uuid, r.item_id])
      );
      const unkeyedIds = insertedRows.rows
        .filter((r) => !r.serial && !r.client_item_uuid).map((r) => r.item_id);

      // A row the insert SKIPPED whose uuid we sent is a resend: the box is already
      // on the batch from a request whose response never got back to the client.
      const unresolved = toInsert.filter(
        (r) => r.row.clientItemUuid && !idByUuid.has(r.row.clientItemUuid)
      );
      if (unresolved.length) {
        const found = await client.query(
          `SELECT item_id, client_item_uuid FROM batch_items
            WHERE batch_id = $1 AND tenant_id = $2 AND client_item_uuid = ANY($3::uuid[])`,
          [batchId, req.tenantId, unresolved.map((r) => r.row.clientItemUuid)]
        );
        for (const row of found.rows) idByUuid.set(row.client_item_uuid, row.item_id);
      }

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
        } else if (r.row.clientItemUuid) {
          // Keyed by the client's own id, so this no longer depends on RETURNING
          // coming back in input order.
          const known = idByUuid.get(r.row.clientItemUuid);
          if (known != null) {
            r.itemId = known;
            r.status = insertedRows.rows.some(
              (x) => x.client_item_uuid === r.row.clientItemUuid
            ) ? "inserted" : "duplicate";
            if (r.status === "duplicate") r.reason = "Already recorded in this batch";
          } else {
            r.status = "inserted";
          }
        } else {
          // An older client that sends no uuid. Falls back to the positional
          // mapping, so a deployed bundle keeps working unchanged.
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
      // Remarks are written at close, when the operator knows what happened.
      const remarks = typeof req.body?.remarks === "string"
        ? req.body.remarks.trim() || null
        : null;
      await pool.query(
        `UPDATE box_batches
            SET status = 'closed', closed_at = now(),
                remarks = COALESCE($3, remarks)
          WHERE batch_id = $1 AND tenant_id = $2`,
        [batchId, req.tenantId, remarks]
      );
    }

    // One total, in pounds: kilogram rows are converted per box on the way out, so
    // a session mixing units still closes with a figure that matches its manifest.
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

// Correcting rows  Two audiences.

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
    // edit leaves it alone.
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

// Take a box off the tally.
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
      RETURNING *, weight::text AS weight, original_weight::text AS original_weight`,
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

// Undo a void.
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
      RETURNING *, weight::text AS weight, original_weight::text AS original_weight`,
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
router.delete("/box-batches/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId)) return res.status(400).json({ error: "Invalid batch id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // The whole row: after the delete the audit entry is the only copy left.
    const batch = await client.query(
      `SELECT * FROM box_batches
        WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Session not found" });
    }

    // Read through the shared definition, so this guard and the endpoint the
    // confirm dialog calls can never disagree about what is blocking.
    const blockers = await batchBlockers(client, batchId, req.tenantId);

    if (blockers.groups.length) {
      await client.query("ROLLBACK");
      const names = blockers.groups
        .map((g) => g.name || g.lot_number || `Manifest ${g.group_id}`)
        .join(", ");
      return res.status(409).json({
        code: "IN_MANIFEST_GROUP",
        error: `This session is part of a merged manifest (${names}). ` +
               `Remove it from that manifest before deleting the session.`,
        groups: blockers.groups,
      });
    }

    // A form points at this session; deleting its boxes would leave it dangling.
    if (blockers.forms.length) {
      await client.query("ROLLBACK");
      const names = blockers.forms.map((f) => f.lot_number || `form ${f.id}`).join(", ");
      return res.status(409).json({
        code: "IN_REGISTRATION_FORM",
        error: `This session is tied to a registration form (${names}). ` +
               `Untie it there before deleting the session.`,
        forms: blockers.forms,
      });
    }

    // The THIRD table that points at a session, and the one this route did not know
    // about.
    if (blockers.shipments.length) {
      await client.query("ROLLBACK");
      const names = blockers.shipments
        .map((s) => `${s.destination_name || `shipment ${s.shipment_id}`} (${s.status})`)
        .join(", ");
      // A draft can simply be deleted or the session untied from it; a SHIPPED load
      // is never edited or deleted, so there the only route is cancelling.
      const anyShipped = blockers.shipments.some((s) => s.status !== "draft");
      return res.status(409).json({
        code: "IN_SHIPMENT",
        error: `This session is on an outgoing shipment (${names}). ` +
               (anyShipped
                 ? `A shipped load cannot be edited — cancel it before deleting the session.`
                 : `Untie it there, or delete the draft, before deleting the session.`),
        shipments: blockers.shipments,
      });
    }

    // Children first: batch_items references box_batches, and there is no ON DELETE
    // CASCADE on that constraint.
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

// Importing a hand-entered tally sheet, for lots whose labels carry no barcode.
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

    // The heading may be corrected in the preview before committing — real sheets
    // carry things like "P12 N26230-01" in the lot cell.
    //
    // Stored in block capitals, like every other heading in this app: the paper
    // forms are filled in caps, and a sheet typed as "ibp" would otherwise sit
    // apart from the same vendor entered anywhere else. Applied here rather than
    // at the INSERT so the preview shows exactly what will be filed.
    const pick = (override, fromSheet) => {
      const v = typeof override === "string" ? override.trim() : "";
      const value = v || fromSheet || null;
      return typeof value === "string" ? value.toUpperCase() : value;
    };

    // Converted only after the sheet has been reconciled against its own checksums
    // in the unit it was written in.
    const isKg = weightUnit === "KG";
    const converted = isKg
      ? parsed.weights.map((w) => trimTrailingZeros(kgToLb(w)))
      : parsed.weights;
    const storedUnit = "LB";

    // A weight the sheet got wrong.
    //
    // The checksums still have to pass first — they prove the sheet adds up to
    // what it claims, which is a different thing from the figure being right.
    // Someone reading the paper can see a transcription error the arithmetic
    // never will, so this is a per-box override ON TOP of a validated sheet,
    // recorded rather than silent: the sheet's figure goes to original_weight
    // exactly as a mid-session correction does.
    //
    // In POUNDS, because the preview being corrected is in pounds — on a KG
    // sheet the operator is looking at converted figures, not what was written.
    let edits = [];
    if (req.body.weightEdits) {
      try {
        edits = JSON.parse(req.body.weightEdits);
        if (!Array.isArray(edits)) throw new Error("not an array");
      } catch {
        return res.status(400).json({ error: "weightEdits must be a JSON array" });
      }
    }

    // Null where the sheet stands, the sheet's figure where it was overridden.
    const sheetFigures = converted.map(() => null);
    for (const e of edits) {
      const i = Number(e && e.index);
      const w = e && typeof e.weight === "string" ? e.weight.trim() : "";
      if (!Number.isInteger(i) || i < 0 || i >= converted.length) {
        return res.status(400).json({ error: `weightEdits: no box at index ${e && e.index}` });
      }
      if (!DECIMAL_RE.test(w)) {
        return res.status(400).json({
          error: `weightEdits: box ${i + 1} must be a decimal with at most 3 places`,
        });
      }
      if (toThousandths(w) > MAX_WEIGHT_THOUSANDTHS) {
        return res.status(400).json({
          code: "IMPLAUSIBLE_WEIGHT",
          error: `weightEdits: box ${i + 1} is outside the plausible range`,
        });
      }
      // Re-editing the same box keeps the SHEET's figure as the original, not
      // the previous edit.
      if (sheetFigures[i] === null) sheetFigures[i] = converted[i];
      converted[i] = trimTrailingZeros(w);
    }

    const editedCount = sheetFigures.filter((v) => v !== null).length;
    // Recomputed once the overrides are in, so the stored total is the total of
    // what is stored rather than what the sheet declared.
    const subtotal = (isKg || editedCount)
      ? trimTrailingZeros(sumWeights(converted))
      : parsed.computed.subtotal;

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
      // So the preview and the response can say the stored total no longer
      // matches the paper, and why.
      edited: editedCount,
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

      // An imported tally is incoming-side, so its lot is created or resolved like
      // any other.
      const lot = await lotColumns(req.tenantId, req.userId, summary.lotNumber, client);
      // Report it as STORED, not as the sheet spelled it, so the operator sees
      // that "N26244-3" was filed as "N26244-03".
      summary.lotNumber = lot.lotNumber;

      const batch = await client.query(
        `INSERT INTO box_batches
           (tenant_id, client_uuid, lot_number, vendor, ship_to, item_description,
            source, status, closed_at, lot_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'imported', 'closed', now(), $7)
         ON CONFLICT (client_uuid) DO NOTHING
         RETURNING batch_id`,
        [req.tenantId, clientUuid, lot.lotNumber, summary.vendor,
         summary.shipTo, summary.itemDescription, lot.lotId]
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
           (tenant_id, batch_id, weight, weight_unit, is_manual, converted_from,
            original_weight, edited_at, edited_by)
         SELECT $1, $2, t.w, $3, true, $6,
                t.o,
                CASE WHEN t.o IS NULL THEN NULL ELSE now() END,
                CASE WHEN t.o IS NULL THEN NULL ELSE $7::uuid END
           FROM UNNEST($4::numeric[], $5::numeric[]) AS t(w, o)`,
        // edited_by is a UUID, like every other writer of this column — the
        // username is an email and the cast is explicit so a CASE arm cannot
        // infer text.
        [req.tenantId, batchId, storedUnit, summary.weights, sheetFigures,
         summary.convertedFrom, req.userId || null]
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

// Reading batches back  Without these the data is write-only: scanned, stored, and
// unreachable from anywhere but psql.

// Batch list with derived counts and totals.
router.get("/vendors", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT vendor, SUM(uses)::int AS uses FROM (
         SELECT vendor, COUNT(*) AS uses FROM box_batches
          WHERE tenant_id = $1 AND vendor IS NOT NULL AND btrim(vendor) <> ''
          GROUP BY vendor
         UNION ALL
         SELECT vendor, COUNT(*) AS uses FROM noblesse_registration_forms
          WHERE tenant_id = $1 AND vendor IS NOT NULL AND btrim(vendor) <> ''
          GROUP BY vendor
       ) v
       GROUP BY vendor
       ORDER BY uses DESC, vendor ASC
       LIMIT 200`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) {
    console.error("list vendors:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// What a session can be searched by. Shared with the merged-manifest search,
// which must match a manifest whenever it matches one of its sessions.
const batchSearchColumns = (a) => [
  "lot_number", "vendor", "item_description", "ship_to", "bill_of_lading",
  "brand", "est_number", "grade", "remarks",
].map((c) => `${a}.${c}`).concat(`${a}.batch_id::text`);

router.get("/box-batches", verifyToken, async (req, res) => {
  const term = searchTerm(req.query.q);
  // A search reaches back past the page a plain listing shows, so it takes the
  // full cap by default rather than the newest 50.
  const limit = Math.min(Number(req.query.limit) || (term ? 200 : 50), 200);

  // Which end of the process to list.
  const raw = req.query.direction;
  const direction = raw == null || raw === "" ? null : String(raw);
  if (direction !== null && direction !== "incoming" && direction !== "outgoing") {
    return res.status(400).json({ error: "direction must be 'incoming' or 'outgoing'" });
  }

  // Built up rather than ($3 IS NULL OR ...), which is not sargable.
  const params = [req.tenantId, limit];
  let dirFilter = "";
  if (direction) {
    params.push(direction);
    dirFilter = ` AND b.direction = $${params.length}`;
  }
  if (term) {
    params.push(term);
    const n = params.length;
    // What the row shows, including where its load is going.
    dirFilter += ` AND (${searchClause(batchSearchColumns("b"), n)} OR EXISTS (
      SELECT 1 FROM shipment_batches sb
        JOIN noblesse_shipments s ON s.shipment_id = sb.shipment_id
       WHERE sb.batch_id = b.batch_id AND sb.tenant_id = $1
         AND s.destination_name ILIKE $${n}))`;
  }

  try {
    // Both aggregates are independent scalar subqueries rather than joins.
    const result = await pool.query(
      `SELECT b.batch_id, b.lot_number, b.lot_id, b.vendor, b.item_description,
              b.ship_to, b.bill_of_lading, b.brand, b.est_number, b.grade, b.source,
              b.direction, b.status, b.created_at, b.closed_at,
              b.weighed_on::text AS weighed_on,
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
              ), '[]'::json) AS totals,
              -- The registration form already holding this session, if any.
              -- A session belongs to exactly ONE form (the tie route refuses a
              -- second claim), so this is at most one row — but it is a scalar
              -- subquery, not a join, for the same fan-out reason as above.
              --
              -- Exposed so the picker can drop sessions that are already spoken
              -- for. Before this it offered them, and choosing one came back
              -- 409 SESSION_ALREADY_TIED — the refusal was correct and the
              -- offer should never have been made.
              (SELECT r.form_id
                 FROM registration_form_batches r
                WHERE r.batch_id = b.batch_id AND r.tenant_id = $1
                LIMIT 1) AS form_id,
              -- The load already carrying this session, if any — the mirror of
              -- form_id above, and the same scalar-subquery-not-a-join reason.
              --
              -- Exposed so the Outgoing tab can say whether a weighed lot is
              -- still waiting for a load. Before this, a session weighed on
              -- Friday afternoon was visible NOWHERE until somebody started a
              -- shipment to tie it to.
              (SELECT json_build_object('shipmentId', s.shipment_id,
                                        'status', s.status,
                                        'destinationName', s.destination_name)
                 FROM shipment_batches sb
                 JOIN noblesse_shipments s ON s.shipment_id = sb.shipment_id
                WHERE sb.batch_id = b.batch_id AND sb.tenant_id = $1
                ORDER BY s.shipment_id DESC
                LIMIT 1) AS shipment
         FROM box_batches b
        WHERE b.tenant_id = $1${dirFilter}
        ORDER BY b.created_at DESC
        LIMIT $2`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("list box batches:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Weighed and closed, but on no registration form — the work that is sitting
// waiting for someone to register it.
router.get("/box-batches/unregistered", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      // Independent scalar subqueries, never a second join onto batch_items —
      // joining it for the count and again for the total cross-products them.
      `SELECT b.batch_id, b.lot_number, b.vendor, b.item_description, b.closed_at,
              (SELECT COUNT(*)::int
                 FROM batch_items i
                WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL) AS box_count,
              COALESCE((SELECT SUM(${weightInLb("i")})::text
                 FROM batch_items i
                WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL), '0') AS total,
              -- Named if it was merged, so the notice does not list sessions
              -- the operator only ever sees as one combined manifest.
              (SELECT g.name FROM manifest_group_batches m
                 JOIN manifest_groups g ON g.group_id = m.group_id
                WHERE m.batch_id = b.batch_id LIMIT 1) AS manifest_name
         FROM box_batches b
        WHERE b.tenant_id = $1
          -- INCOMING ONLY. This notice means "product arrived and nobody has
          -- filed the registration form for it". An outgoing session weighed
          -- finished product LEAVING: there is no form it can ever go on, so it
          -- satisfied "closed, has boxes, not on a form" permanently and nagged
          -- forever with nothing anyone could do about it.
          AND b.direction = 'incoming'
          AND b.status = 'closed'
          AND NOT EXISTS (
                SELECT 1 FROM registration_form_batches r
                 WHERE r.batch_id = b.batch_id AND r.tenant_id = $1)
          -- An empty session is a start pressed by accident, not work waiting
          -- on anyone. Prod has one of these (#26, no lot, no boxes) and it
          -- would have nagged from this notice permanently.
          AND EXISTS (
                SELECT 1 FROM batch_items i
                 WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL)
        ORDER BY b.closed_at DESC NULLS LAST, b.batch_id DESC
        LIMIT 50`,
      [req.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("list unregistered box batches:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Reopen a closed session so more boxes can be SCANNED into it.
router.post("/box-batches/:id/reopen", verifyToken, requireRole("admin"), async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }

  try {
    const batch = await pool.query(
      `SELECT batch_id, lot_number, status FROM box_batches
        WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) return res.status(404).json({ error: "Session not found" });

    // Already open is not a failure — a double tap should land on the same
    // state, the same way close is safe to call twice.
    if (batch.rows[0].status === "open") {
      return res.json({ reopened: false, alreadyOpen: true, batchId });
    }

    // closed_at is cleared because it is no longer true. The fact that it was
    // closed, and by whom it was reopened, survives in the audit row below.
    const updated = await pool.query(
      `UPDATE box_batches SET status = 'open', closed_at = NULL
        WHERE batch_id = $1 AND tenant_id = $2
      RETURNING batch_id, lot_number, status, created_at, closed_at`,
      [batchId, req.tenantId]
    );

    const blockers = await batchBlockers(pool, batchId, req.tenantId);

    logBoxRemoval({
      tenantId: req.tenantId,
      action: "batch_reopened",
      batchId,
      lotNumber: batch.rows[0].lot_number,
      summary: "Reopened for scanning",
      performedBy: req.username,
      // What referenced it at the moment it was reopened, so a later
      // discrepancy between this manifest and a form can be explained.
      details: { referencedBy: blockers },
    });

    res.json({ reopened: true, batch: updated.rows[0], blockers });
  } catch (err) {
    console.error("reopen box batch:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Edit a session's heading after the fact.
const EDITABLE_HEADER = {
  vendor: "vendor",
  itemDescription: "item_description",
  billOfLading: "bill_of_lading",
  shipTo: "ship_to",
  brand: "brand",
  estNumber: "est_number",
  grade: "grade",
  remarks: "remarks",
};

// What the dock may change on a session it weighed out. Everything else on an
// outgoing heading is admin-only — see the PATCH route.
const DOCK_EDITABLE = new Set(["itemDescription", "shipTo"]);

router.patch("/box-batches/:id", verifyToken, async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }

  // Only known fields, and an unknown one is REFUSED rather than ignored:
  // silently dropping a field would let a caller believe it had changed it.
  // The lot comes as a registry id, never as text, so a typo cannot mint a lot.
  const body = req.body || {};
  const unknown = Object.keys(body)
    .filter((k) => !EDITABLE_HEADER[k] && k !== "lotId" && k !== "weighedOn");
  if (unknown.length) {
    return res.status(400).json({
      code: "NOT_EDITABLE",
      error: `Not editable here: ${unknown.join(", ")}.` +
             (unknown.includes("lotNumber")
               ? " Send the lot as lotId, picked from the lot registry."
               : ""),
    });
  }

  const hasLot = Object.prototype.hasOwnProperty.call(body, "lotId");
  // A number or a digit string only — Number([20]) is 20, and an array is not an id.
  const rawLot = body.lotId;
  const lotId = hasLot && (typeof rawLot === "number" || /^\d+$/.test(String(rawLot)))
    && !Array.isArray(rawLot) ? Number(rawLot) : NaN;
  if (hasLot && (!Number.isInteger(lotId) || lotId <= 0)) {
    return res.status(400).json({ code: "BAD_LOT", error: "lotId must be a lot from the registry." });
  }

  // The day the boxes were weighed, for a session entered after the fact.
  // Blank clears it back to "the day the session was opened".
  const hasDate = Object.prototype.hasOwnProperty.call(body, "weighedOn");
  const weighedOn = hasDate && body.weighedOn !== null && body.weighedOn !== ""
    ? body.weighedOn : null;
  if (hasDate && weighedOn !== null) {
    const d = typeof weighedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(weighedOn)
      ? new Date(`${weighedOn}T00:00:00Z`) : null;
    // Round-trips only for a real calendar day, so 2026-02-30 is refused.
    // 2026-13-45 is no Date at all, and toISOString would throw on it.
    const ok = d !== null && !Number.isNaN(d.getTime())
      && d.toISOString().slice(0, 10) === weighedOn;
    if (!ok) {
      return res.status(400).json({ code: "BAD_DATE", error: "weighedOn must be a date, YYYY-MM-DD." });
    }
    if (weighedOn > pacificToday()) {
      return res.status(400).json({ code: "BAD_DATE", error: "The boxes cannot have been weighed in the future." });
    }
    if (weighedOn < "2000-01-01") {
      return res.status(400).json({ code: "BAD_DATE", error: "That date is too far back to be right." });
    }
  }

  const fields = Object.entries(body).filter(([k]) => EDITABLE_HEADER[k]);
  if (!fields.length && !hasLot && !hasDate) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    const batch = await pool.query(
      `SELECT status, direction, lot_id FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) return res.status(404).json({ error: "Session not found" });

    const { status, direction } = batch.rows[0];
    const isAdmin = req.role === "admin";

    // On the way out the heading is the driver's paperwork. The dock says what
    // is in the boxes and where they are going; the rest — who weighed it, the
    // BOL, the grade — is reception's to answer for, so it stays admin-only.
    if (direction === "outgoing" && !isAdmin) {
      const denied = fields.map(([k]) => k).filter((k) => !DOCK_EDITABLE.has(k))
        .concat(hasLot ? ["lotId"] : [], hasDate ? ["weighedOn"] : []);
      if (denied.length) {
        return res.status(403).json({
          code: "ADMIN_ONLY_FIELD",
          error: `Only an admin can change ${denied.join(", ")} on an outgoing `
               + "session. You can edit the item description and where it is going.",
        });
      }
      // Only those two labels are left, and closing locks weights, not labels —
      // so they stay correctable after the session is stopped.
    } else if (status !== "open" && !isAdmin) {
      // Incoming is untouched: a closed tally is admin-only, as it always was.
      return res.status(403).json({
        code: "CLOSED_SESSION",
        error: "This session is closed. Only an admin can edit it.",
      });
    }

    // Blank means "clear it", stored as NULL rather than "" so an empty field
    // prints as empty everywhere instead of as a stray space.
    const sets = [];
    const values = [batchId, req.tenantId];
    for (const [key, raw] of fields) {
      const value = typeof raw === "string" ? raw.trim() || null : null;
      values.push(value);
      sets.push(`${EDITABLE_HEADER[key]} = $${values.length}`);
    }

    if (hasDate) {
      values.push(weighedOn);
      sets.push(`weighed_on = $${values.length}`);
    }

    // Moving a session to another lot moves its boxes into that lot's totals
    // and yield. So it is refused while a form, a load or a merged manifest
    // still counts it — the same holders that block deleting it.
    if (hasLot && lotId !== batch.rows[0].lot_id) {
      const lot = await pool.query(
        `SELECT lot_id, lot_number FROM lots WHERE lot_id = $1 AND tenant_id = $2`,
        [lotId, req.tenantId]
      );
      if (!lot.rows.length) {
        return res.status(400).json({ code: "BAD_LOT", error: "That lot is not in the registry." });
      }
      const { groups, forms, shipments } = await batchBlockers(pool, batchId, req.tenantId);
      const holders = [
        ...forms.map((f) => `registration form ${f.lot_number || f.id}`),
        ...shipments.map((s) => `the load to ${s.destination_name} (${s.status})`),
        ...groups.map((g) => `merged manifest ${g.name || g.lot_number || g.group_id}`),
      ];
      if (holders.length) {
        return res.status(409).json({
          code: "LOT_IN_USE",
          error: `Cannot move this session to another lot while ${holders.join(", ")} `
               + "still counts it. Untie it there first, then change the lot.",
          holders: { forms, shipments, groups },
        });
      }
      // The registry's canonical number, never the caller's text.
      values.push(lot.rows[0].lot_id);
      sets.push(`lot_id = $${values.length}`);
      values.push(lot.rows[0].lot_number);
      sets.push(`lot_number = $${values.length}`);
    }

    if (!sets.length) {
      // Only the lot was sent, and it was already this lot.
      const same = await pool.query(
        `SELECT batch_id, lot_id, lot_number, vendor, ship_to, bill_of_lading,
                item_description, brand, est_number, grade, remarks, status,
                weighed_on::text AS weighed_on
           FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
        [batchId, req.tenantId]
      );
      return res.json(same.rows[0]);
    }

    const updated = await pool.query(
      `UPDATE box_batches SET ${sets.join(", ")}
        WHERE batch_id = $1 AND tenant_id = $2
      RETURNING batch_id, lot_id, lot_number, vendor, ship_to, bill_of_lading,
                item_description, brand, est_number, grade, remarks, status,
                weighed_on::text AS weighed_on`,
      values
    );
    res.json(updated.rows[0]);
  } catch (err) {
    console.error("update batch heading:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// What is currently holding a session, so the confirm dialog can say so BEFORE
// someone presses Delete rather than after it fails.
router.get("/box-batches/:id/references", verifyToken, async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }
  try {
    const blockers = await batchBlockers(pool, batchId, req.tenantId);
    res.json({
      ...blockers,
      deletable: blockers.groups.length === 0
        && blockers.forms.length === 0
        && blockers.shipments.length === 0,
    });
  } catch (err) {
    console.error("batch references:", err);
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
      `SELECT batch_id, lot_number, vendor, ship_to, bill_of_lading, item_description,
              brand, est_number, grade, remarks, source, expected_boxes, direction,
              -- lot_id was missing here while useScanSession reads detail.lot_id
              -- when adopting, so EVERY adopted session silently lost its lot —
              -- the number still showed, because lot_number is its own column,
              -- which is what made it invisible.
              lot_id,
              status, created_at, closed_at,
              -- Text, not a Date: pg turns a DATE into midnight server-local,
              -- which a reader in another timezone shows as the day before.
              weighed_on::text AS weighed_on
         FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) return res.status(404).json({ error: "Batch not found" });

    const items = await pool.query(
      `SELECT item_id, weight::text AS weight, weight_unit, gtin,
              production_date, serial, is_manual, converted_from, scanned_at,
              entry_method, is_estimated,
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
        // Provenance and confidence, so an adopted session and the manifest can
        // tell a scale reading from a nominal batch figure.
        entryMethod: r.entry_method || null,
        isEstimated: r.is_estimated === true,
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

// Merged manifests  Several weighing sessions printed as one tally sheet.

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

    // Every session must belong to this tenant.
    const owned = await client.query(
      `SELECT batch_id, lot_number, vendor, ship_to, bill_of_lading, item_description,
              lot_id, direction
         FROM box_batches WHERE batch_id = ANY($1::int[]) AND tenant_id = $2`,
      [ids, req.tenantId]
    );
    if (owned.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or more sessions were not found" });
    }

    // A merged manifest is ONE printed tally, so its sessions must be the same KIND
    // of thing.
    const dirs = [...new Set(owned.rows.map((b) => b.direction))];
    if (dirs.length > 1) {
      await client.query("ROLLBACK");
      const say = (d) => owned.rows.filter((b) => b.direction === d)
        .map((b) => b.lot_number || `batch ${b.batch_id}`).join(", ");
      return res.status(409).json({
        code: "DIRECTION_MISMATCH",
        error: `These sessions are not all the same direction — ${say("incoming")} ` +
               `weighed product in, ${say("outgoing")} weighed product out. One ` +
               `tally covering both would count the same lot twice.`,
        directions: dirs,
      });
    }

    // One manifest covers ONE lot.
    const lotKey = (b) => (b.lot_id != null ? `id:${b.lot_id}` : `txt:${b.lot_number || ""}`);
    const distinctLots = [...new Set(owned.rows.map(lotKey))];
    if (distinctLots.length > 1) {
      await client.query("ROLLBACK");
      const names = [...new Set(owned.rows.map((b) => b.lot_number || `batch ${b.batch_id}`))];
      return res.status(409).json({
        code: "LOT_MISMATCH",
        error: `These sessions are not all the same lot (${names.join(", ")}). ` +
               `A manifest covers one lot.`,
        lots: names,
      });
    }

    const first = owned.rows.find((b) => b.batch_id === ids[0]) || owned.rows[0];
    const pick = (given, fallback) => {
      const v = typeof given === "string" ? given.trim() : "";
      return v || fallback || null;
    };

    // A merged manifest is downstream — it references the lot its sessions already
    // carry rather than resolving text of its own.
    const group = await client.query(
      `INSERT INTO manifest_groups
         (tenant_id, name, lot_number, vendor, ship_to, bill_of_lading, item_description, created_by,
          lot_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING group_id, name, lot_number, vendor, ship_to, bill_of_lading,
                 item_description, created_at, lot_id`,
      [req.tenantId, pick(name, null), pick(lotNumber, first.lot_number),
       pick(vendor, first.vendor), pick(shipTo, first.ship_to),
       pick(billOfLading, first.bill_of_lading),
       pick(itemDescription, first.item_description), req.userId,
       first.lot_id ?? null]
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
  const term = searchTerm(req.query.q);
  const limit = Math.min(Number(req.query.limit) || (term ? 200 : 50), 200);
  const params = [req.tenantId, limit];
  let where = "";
  if (term) {
    params.push(term);
    const n = params.length;
    // Its own heading, OR any session in it: the list shows a manifest in place
    // of its sessions, so a matching session must bring its manifest with it —
    // otherwise that session would surface on its own, which a merge forbids.
    where = ` AND (${searchClause([
      "g.name", "g.lot_number", "g.vendor", "g.ship_to", "g.bill_of_lading",
      "g.item_description", "g.group_id::text",
    ], n)} OR EXISTS (
      SELECT 1 FROM manifest_group_batches m
        JOIN box_batches mb ON mb.batch_id = m.batch_id
       WHERE m.group_id = g.group_id AND mb.tenant_id = $1
         AND ${searchClause(batchSearchColumns("mb"), n)}))`;
  }
  try {
    const result = await pool.query(
      `SELECT g.group_id, g.name, g.lot_number, g.vendor, g.item_description,
              g.created_at,
              -- Which sessions it covers, so the list can show the group IN
              -- PLACE OF its sessions rather than alongside them.
              COALESCE((SELECT json_agg(m.batch_id ORDER BY m.position)
                 FROM manifest_group_batches m
                WHERE m.group_id = g.group_id), '[]'::json) AS batch_ids,
              -- Sorted by when the product was weighed, not when someone got
              -- round to merging it.
              (SELECT MIN(${weighedAtSql("b")}) FROM manifest_group_batches m
                 JOIN box_batches b ON b.batch_id = m.batch_id
                WHERE m.group_id = g.group_id) AS first_opened,
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
        WHERE g.tenant_id = $1${where}
        ORDER BY g.created_at DESC
        LIMIT $2`,
      params
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
              i.entry_method, i.is_estimated,
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
        // Provenance and confidence, so an adopted session and the manifest can
        // tell a scale reading from a nominal batch figure.
        entryMethod: r.entry_method || null,
        isEstimated: r.is_estimated === true,
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
    // The member list is read first: the CASCADE takes it with the group, and which
    // sessions the manifest covered is the part worth keeping.
    const members = await pool.query(
      `SELECT m.batch_id, m.position, b.lot_number, b.vendor, b.item_description,
              (SELECT COUNT(*)::int FROM batch_items i
                WHERE i.batch_id = m.batch_id AND i.voided_at IS NULL) AS box_count
         FROM manifest_group_batches m
         LEFT JOIN box_batches b ON b.batch_id = m.batch_id
        WHERE m.group_id = $1
        ORDER BY m.position`,
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

// Everything that has been taken off a tally, newest first.
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

// Box weights feeding a registration form  A registration form records what came
// in; box weighing is how that figure is actually measured.

// The live figure for a form: every box across its linked sessions, converted
// and rounded exactly as the tally is, with voided rows excluded.
const boxTotalsForForm = async (formId, tenantId) => {
  const sessions = await pool.query(
    // Everything the form can be filled FROM, not just what it displays.
    `SELECT b.batch_id, b.lot_number, b.lot_id, b.vendor, b.item_description,
            b.bill_of_lading, b.brand, b.est_number, b.grade,
            -- Carried so the panel can LABEL a tie that should never have been
            -- made. New ones are refused now, but any that predate that guard
            -- are already sitting on filed forms, and without this they are
            -- indistinguishable from good ones — so nobody would ever find them.
            b.direction,
            b.status, b.source, b.created_at, b.weighed_on::text AS weighed_on,
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
      `SELECT batch_id, lot_number, direction
         FROM box_batches WHERE batch_id = ANY($1::int[]) AND tenant_id = $2`,
      [ids, req.tenantId]
    );
    if (owned.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or more sessions were not found" });
    }

    // A registration form asserts "these boxes are the measurement of this
    // delivery".
    const outgoing = owned.rows.filter((b) => b.direction === "outgoing");
    if (outgoing.length) {
      await client.query("ROLLBACK");
      const names = outgoing.map((b) => b.lot_number || `batch ${b.batch_id}`).join(", ");
      return res.status(409).json({
        code: "OUTGOING_SESSION",
        error: `${names} weighed finished product going OUT, not an arrival. ` +
               `A registration form records what came in — those boxes belong ` +
               `on the Outgoing tab.`,
        sessions: outgoing.map((b) => ({ batchId: b.batch_id, lotNumber: b.lot_number })),
      });
    }

    // A weighing session belongs to ONE delivery.
    const claimed = await client.query(
      `SELECT r.batch_id, r.form_id, b.lot_number
         FROM registration_form_batches r
         JOIN box_batches b ON b.batch_id = r.batch_id
        WHERE r.batch_id = ANY($1::int[]) AND r.tenant_id = $2 AND r.form_id <> $3`,
      [ids, req.tenantId, formId]
    );
    if (claimed.rows.length) {
      await client.query("ROLLBACK");
      const names = claimed.rows
        .map((c) => `${c.lot_number || `batch ${c.batch_id}`} (form ${c.form_id})`)
        .join(", ");
      return res.status(409).json({
        code: "SESSION_ALREADY_TIED",
        error: `Already tied to another registration form: ${names}. ` +
               `Untie it there first.`,
        sessions: claimed.rows,
      });
    }

    // Re-linking to the SAME form is not an error — it is what a double tap
    // produces, and the link is identical either way.
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
