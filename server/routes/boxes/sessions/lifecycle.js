// Weighing sessions: opening, closing, reopening and deleting.

const router = require("express").Router();
const pool = require("../../../utils/pg");
const verifyToken = require("../../../middleware/verifyToken.pg");
const requireRole = require("../../../middleware/requireRole");
const { lotColumns, lookupLot } = require("../../../utils/lotRegistry");
const { ensureFpLotNow } = require("../../../utils/fpLot");
const { correctHeading, parseKeep } = require("../../../utils/nameCorrect");
const { scanLimiter } = require("../../../middleware/rateLimits");
const { weightInLb } = require("../../../utils/sqlWeight");
const { logBoxRemoval, batchBlockers } = require("../helpers/shared");

// Create a batch. Idempotent on client_uuid so a retried POST after a dropped
// response returns the original batch instead of orphaning one.
router.post("/box-batches", verifyToken, scanLimiter, async (req, res) => {
  const { clientUuid, lotNumber, vendor, shipTo, billOfLading, itemDescription,
          brand, estNumber, grade, direction, expectedBoxes, lotId, furtherProcessing } = req.body || {};
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
      // The picker's id, so an outside lot (no N to parse) is still linked.
      lot = await lotColumns(req.tenantId, req.userId, lotNumber, pool, lotId ?? null);
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

    // A freezer pallet stocks the lot's FP lot, so that lot must exist first.
    const toFreezer = dir === "outgoing" && furtherProcessing === true;

    // Clear typos in what was typed take the list's spelling, unless kept as typed.
    let typedItem = itemDescription;
    let typedShipTo = shipTo;
    let corrections = [];
    if (dir === "outgoing") {
      const keep = parseKeep(req.body?.keepAsTyped).concat(toFreezer ? ["shipTo"] : []);
      const fixed = await correctHeading(pool, req.tenantId, { itemDescription, shipTo }, keep);
      ({ itemDescription: typedItem, shipTo: typedShipTo } = fixed.values);
      corrections = fixed.corrections;
    }
    let fpLot = null;
    if (toFreezer) {
      try {
        fpLot = (await ensureFpLotNow(pool, req.tenantId, lot.lotId, req.userId)).lot;
      } catch (err) {
        if (!err.status) throw err;
        return res.status(400).json({ code: err.code, error: err.message });
      }
    }

    const inserted = await pool.query(
      `INSERT INTO box_batches
         (tenant_id, client_uuid, lot_number, vendor, ship_to, bill_of_lading,
          item_description, brand, est_number, grade, lot_id, direction, expected_boxes,
          created_by, further_processing)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (client_uuid) DO NOTHING
       RETURNING batch_id, status, created_at, lot_number,
                 vendor, ship_to, bill_of_lading, item_description,
                 brand, est_number, grade, lot_id, direction, expected_boxes, further_processing`,
      [req.tenantId, clientUuid, lot.lotNumber,
       pick(vendor, "vendor"),
       typedShipTo || null, billOfLading || null,
       pick(typedItem, "item_description"),
       pick(brand, "brand"),
       pick(estNumber, "est_number"),
       pick(grade, "grade"),
       lot.lotId, dir, expected, req.userId || null, toFreezer]
    );

    if (inserted.rows.length) {
      return res.status(201).json({ ...inserted.rows[0], reused: false, corrections,
        ...(fpLot ? { fpLotNumber: fpLot.lot_number } : {}) });
    }

    // Already existed. Scope the lookup by tenant so a UUID guessed from
    // another tenant cannot be adopted.
    const existing = await pool.query(
      `SELECT batch_id, status, created_at, lot_number,
              vendor, ship_to, bill_of_lading, item_description,
              brand, est_number, grade, lot_id, direction, expected_boxes, further_processing
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
            SET status = 'closed', closed_at = now(), closed_by = $4,
                remarks = COALESCE($3, remarks)
          WHERE batch_id = $1 AND tenant_id = $2`,
        [batchId, req.tenantId, remarks, req.userId || null]
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

// Reopen a closed session so more boxes can be SCANNED into it.
//
// Open to everyone, because the case it exists for is an operator closing a
// pallet too early and needing to carry on — and they cannot fix that alone if
// reopening is admin-only.
//
// It stays admin-only ONCE THE SESSION HAS BEEN FILED: on a merged manifest, on
// a registration form, or on a load. Reopening then changes a figure somebody
// has already reported, which is a different act from finishing a pallet, and
// the closed-session edit rule (CLAUDE.md §2) is only worth anything where the
// numbers have left the bench.
router.post("/box-batches/:id/reopen", verifyToken, async (req, res) => {
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

    // Read BEFORE the update, because it decides whether the update happens.
    // Same shared definition the delete guard uses, so the two can never
    // disagree about what counts as filed.
    const blockers = await batchBlockers(pool, batchId, req.tenantId);
    const isAdmin = req.role === "admin";

    if (!isAdmin) {
      const filed = [
        ...blockers.groups.map((g) =>
          `merged manifest ${g.name || g.lot_number || g.group_id}`),
        ...blockers.forms.map((f) =>
          `registration form ${f.lot_number || f.id}`),
        ...blockers.shipments.map((s) =>
          `load to ${s.destination_name} (${s.status})`),
      ];
      if (filed.length) {
        return res.status(409).json({
          code: "ALREADY_FILED",
          error: `This session is already on ${filed.join(", ")}. `
               + `Reopening it would change a figure that has been filed, so an `
               + `admin has to do it.`,
          blockers,
        });
      }
    }

    // closed_at is cleared because it is no longer true. The fact that it was
    // closed, and by whom it was reopened, survives in the audit row below.
    const updated = await pool.query(
      `UPDATE box_batches SET status = 'open', closed_at = NULL, closed_by = NULL
        WHERE batch_id = $1 AND tenant_id = $2
      RETURNING batch_id, lot_number, status, created_at, closed_at`,
      [batchId, req.tenantId]
    );

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

module.exports = router;
