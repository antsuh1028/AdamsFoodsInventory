// The boxes in a session: adding, correcting, voiding and restoring.

const router = require("express").Router();
const pool = require("../../../utils/pg");
const verifyToken = require("../../../middleware/verifyToken.pg");
const { toPounds } = require("../../../utils/weight");
const { scanLimiter } = require("../../../middleware/rateLimits");
const { UNITS, DECIMAL_RE, MAX_WEIGHT_THOUSANDTHS, toThousandths, validateItem } = require("../helpers/validate");
const { logBoxRemoval } = require("../helpers/shared");

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

module.exports = router;
