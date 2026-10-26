// Merged manifests, and one lot's sessions tied together by its registration form.

const router = require("express").Router();
const pool = require("../../utils/pg");
const verifyToken = require("../../middleware/verifyToken.pg");
const requireRole = require("../../middleware/requireRole");
const { searchTerm, searchClause } = require("../../utils/search");
const { weighedAtSql } = require("../../utils/weighedAt");
const { scanLimiter } = require("../../middleware/rateLimits");
const { weightInLb } = require("../../utils/sqlWeight");
const { logBoxRemoval, batchSearchColumns } = require("./helpers/shared");

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

    // Every session must belong to this tenant. Locked so two merges cannot both claim it.
    const owned = await client.query(
      `SELECT batch_id, lot_number, vendor, ship_to, bill_of_lading, item_description,
              lot_id, direction
         FROM box_batches WHERE batch_id = ANY($1::int[]) AND tenant_id = $2
          FOR UPDATE`,
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

    // A session prints on one merged manifest only.
    const taken = await client.query(
      `SELECT m.batch_id, m.group_id
         FROM manifest_group_batches m
         JOIN manifest_groups g ON g.group_id = m.group_id
        WHERE m.batch_id = ANY($1::int[]) AND g.tenant_id = $2
        ORDER BY m.group_id`,
      [ids, req.tenantId]
    );
    if (taken.rows.length) {
      await client.query("ROLLBACK");
      const groupIds = [...new Set(taken.rows.map((r) => r.group_id))];
      return res.status(409).json({
        code: "ALREADY_MERGED",
        error: `${taken.rows.length === 1 ? "A session is" : "Some sessions are"} already on ` +
               `merged manifest ${groupIds.map((g) => `#${g}`).join(", ")}. Remove that manifest first.`,
        groupIds,
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
// A box on a merged manifest, stored or by registration form: one shape for both.
const MANIFEST_ITEM_COLS = `i.item_id, i.weight::text AS weight, i.weight_unit, i.gtin,
              i.production_date, i.serial, i.is_manual, i.converted_from, i.scanned_at,
              i.entry_method, i.is_estimated,
              i.original_weight::text AS original_weight, i.edited_at,
              i.voided_at, i.void_reason,
              b.batch_id, b.lot_number AS batch_lot`;

const fmtManifestItem = (r) => ({
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
});

router.get("/manifest-groups", verifyToken, async (req, res) => {
  const term = searchTerm(req.query.q);
  const limit = Math.min(Number(req.query.limit) || (term ? 200 : 50), 200);
  const params = [req.tenantId, limit];
  let where = "";
  // Which end of the process, and optionally one customer's: a group's sessions share both.
  const direction = ["incoming", "outgoing"].includes(req.query.direction) ? req.query.direction : null;
  const shipTo = String(req.query.shipTo ?? "").trim();
  if (direction || shipTo) {
    const conds = [];
    if (direction) { params.push(direction); conds.push(`sb.direction = $${params.length}`); }
    if (shipTo) { params.push(shipTo); conds.push(`UPPER(TRIM(sb.ship_to)) = UPPER($${params.length})`); }
    where += ` AND EXISTS (
      SELECT 1 FROM manifest_group_batches sm
        JOIN box_batches sb ON sb.batch_id = sm.batch_id
       WHERE sm.group_id = g.group_id AND sb.tenant_id = $1 AND ${conds.join(" AND ")})`;
  }
  if (term) {
    params.push(term);
    const n = params.length;
    // Its own heading, OR any session in it: the list shows a manifest in place
    // of its sessions, so a matching session must bring its manifest with it —
    // otherwise that session would surface on its own, which a merge forbids.
    where += ` AND (${searchClause([
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
      `SELECT ${MANIFEST_ITEM_COLS}
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
      items: items.rows.map(fmtManifestItem),
    });
  } catch (err) {
    console.error("read manifest group:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── One lot across several sessions, merged by its registration form ────────
// Not stored: a form with 2+ tied sessions IS the merge, so untying one on the
// form splits it back out. A session already on a stored manifest stays there.

const FORM_TIED = `
  SELECT rb.form_id, rb.batch_id, rb.position
    FROM registration_form_batches rb
    JOIN box_batches b ON b.batch_id = rb.batch_id AND b.tenant_id = $1
   WHERE rb.tenant_id = $1
     AND NOT EXISTS (SELECT 1 FROM manifest_group_batches m WHERE m.batch_id = rb.batch_id)`;

router.get("/form-manifests", verifyToken, async (req, res) => {
  const term = searchTerm(req.query.q);
  const limit = Math.min(Number(req.query.limit) || (term ? 200 : 50), 200);
  const params = [req.tenantId, limit];
  let where = "";
  if (term) {
    params.push(term);
    const n = params.length;
    // The form's heading, or any of its sessions, like a stored manifest.
    where = ` AND (${searchClause([
      "f.lot_number", "f.vendor", "f.product_description", "f.vendor_lot", "f.id::text",
    ], n)} OR EXISTS (
      SELECT 1 FROM tied t JOIN box_batches mb ON mb.batch_id = t.batch_id
       WHERE t.form_id = f.id AND ${searchClause(batchSearchColumns("mb"), n)}))`;
  }
  try {
    // Independent scalar subqueries, never a second join of batch_items (CLAUDE.md §5).
    const result = await pool.query(
      `WITH tied AS (${FORM_TIED}),
            merged AS (SELECT form_id FROM tied GROUP BY form_id HAVING COUNT(*) > 1)
       SELECT f.id AS form_id, 'form' AS kind, f.lot_number, f.vendor, f.created_at,
              COALESCE(NULLIF(TRIM(f.product_description), ''),
                (SELECT b.item_description FROM tied t JOIN box_batches b ON b.batch_id = t.batch_id
                  WHERE t.form_id = f.id ORDER BY t.position, t.batch_id LIMIT 1)) AS item_description,
              (SELECT json_agg(t.batch_id ORDER BY t.position, t.batch_id)
                 FROM tied t WHERE t.form_id = f.id) AS batch_ids,
              (SELECT MIN(${weighedAtSql("b")}) FROM tied t
                 JOIN box_batches b ON b.batch_id = t.batch_id WHERE t.form_id = f.id) AS first_opened,
              (SELECT COUNT(*)::int FROM tied t WHERE t.form_id = f.id) AS session_count,
              (SELECT COUNT(*)::int FROM batch_items i JOIN tied t ON t.batch_id = i.batch_id
                WHERE t.form_id = f.id AND i.voided_at IS NULL) AS box_count,
              COALESCE((SELECT SUM(${weightInLb("i")})::text FROM batch_items i
                 JOIN tied t ON t.batch_id = i.batch_id
                WHERE t.form_id = f.id AND i.voided_at IS NULL), '0') AS total
         FROM noblesse_registration_forms f
         JOIN merged ON merged.form_id = f.id
        WHERE f.tenant_id = $1${where}
        ORDER BY f.created_at DESC
        LIMIT $2`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("list form manifests:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Every box across the form's sessions, in the form's order, shaped like a stored manifest.
router.get("/form-manifests/:formId", verifyToken, async (req, res) => {
  const formId = Number(req.params.formId);
  if (!Number.isInteger(formId)) return res.status(400).json({ error: "Invalid form id" });
  try {
    const form = await pool.query(
      `SELECT id AS form_id, lot_number, vendor, vendor_lot, product_description, created_at
         FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [formId, req.tenantId]
    );
    if (!form.rows.length) return res.status(404).json({ error: "Registration form not found" });

    const sessions = await pool.query(
      `WITH tied AS (${FORM_TIED})
       SELECT b.batch_id, b.lot_number, b.vendor, b.status, b.source, b.item_description,
              b.bill_of_lading, t.position
         FROM tied t JOIN box_batches b ON b.batch_id = t.batch_id
        WHERE t.form_id = $2
        ORDER BY t.position, t.batch_id`,
      [req.tenantId, formId]
    );

    const items = await pool.query(
      `WITH tied AS (${FORM_TIED})
       SELECT ${MANIFEST_ITEM_COLS}
         FROM batch_items i
         JOIN tied t ON t.batch_id = i.batch_id
         JOIN box_batches b ON b.batch_id = i.batch_id
        WHERE t.form_id = $2 AND i.tenant_id = $1
        ORDER BY t.position, t.batch_id, i.item_id`,
      [req.tenantId, formId]
    );

    const f = form.rows[0];
    const first = sessions.rows[0] || {};
    res.json({
      form_id: f.form_id,
      lot_number: f.lot_number || first.lot_number || null,
      vendor: f.vendor || first.vendor || null,
      item_description: (f.product_description || "").trim() || first.item_description || null,
      bill_of_lading: f.vendor_lot || first.bill_of_lading || null,
      ship_to: null,
      created_at: f.created_at,
      sessions: sessions.rows,
      items: items.rows.map(fmtManifestItem),
    });
  } catch (err) {
    console.error("read form manifest:", err);
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

module.exports = router;
