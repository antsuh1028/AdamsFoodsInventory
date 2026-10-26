// Reading weighing sessions: the list, one session, what references it, vendors.

const router = require("express").Router();
const pool = require("../../../utils/pg");
const verifyToken = require("../../../middleware/verifyToken.pg");
const { searchTerm, searchClause } = require("../../../utils/search");
const { weightInLb } = require("../../../utils/sqlWeight");
const { UNREGISTERED_WHERE } = require("../../../utils/reportRange");
const { batchBlockers, batchSearchColumns } = require("../helpers/shared");

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

router.get("/box-batches", verifyToken, async (req, res) => {
  const term = searchTerm(req.query.q);
  // One customer's sessions, matched on ship-to.
  const shipTo = String(req.query.shipTo ?? "").trim();
  // A search reaches back past the page a plain listing shows, so it takes the
  // full cap by default rather than the newest 50.
  const limit = Math.min(Number(req.query.limit) || (term || shipTo ? 200 : 50), 200);

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
  if (shipTo) {
    params.push(shipTo);
    dirFilter += ` AND UPPER(TRIM(b.ship_to)) = UPPER($${params.length})`;
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
              b.direction, b.status, b.created_at, b.closed_at, b.expected_boxes, b.further_processing,
              b.weighed_on::text AS weighed_on, b.driver,
              b.flagged_at, b.flag_reason,
              -- The UUID resolved here so the row can name who raised it.
              (SELECT u.username FROM users u WHERE u.id = b.flagged_by) AS flagged_by,
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
        -- Shared with the daily report, which counts the same thing: two
        -- spellings of it is how a badge and a report come to disagree.
        WHERE b.tenant_id = $1 AND ${UNREGISTERED_WHERE}
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
              further_processing, driver,
              -- lot_id was missing here while useScanSession reads detail.lot_id
              -- when adopting, so EVERY adopted session silently lost its lot —
              -- the number still showed, because lot_number is its own column,
              -- which is what made it invisible.
              lot_id,
              status, created_at, closed_at,
              -- Text, not a Date: pg turns a DATE into midnight server-local,
              -- which a reader in another timezone shows as the day before.
              weighed_on::text AS weighed_on,
              flagged_at, flag_reason,
              (SELECT u.username FROM users u WHERE u.id = box_batches.flagged_by)
                AS flagged_by
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

module.exports = router;
