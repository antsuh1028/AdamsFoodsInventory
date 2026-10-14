const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { REPORT_ACCEPT_ROLES } = require("../middleware/receptionRoles");
const {
  normaliseItem, sentSql, weighedSql, weighedLbSql, byHandSql, takenSql, returnedSql,
  shapeRow, fpCounts, lockLot, findFpChild, ensureFpLot,
} = require("../utils/fpLot");
const { weightInLb } = require("../utils/sqlWeight");
const { isCalendarDay } = require("../utils/weighedAt");
const { pacificToday } = require("../utils/lot");
const { toThousandths } = require("../utils/weight");
const { searchTerm } = require("../utils/search");
const { lotDescriptionSql } = require("../utils/lotDescription");

// The F.P Tracker: trips to the AF freezer for another run. A trip is a pallet
// the dock weighed out to the freezer, or a row entered by hand for one that
// was not weighed. Both stock the N lot's FP lot. Hand rows are voided, never
// deleted, and never cut below what accepted runs have already taken.

const MAX_ITEM = 120;
const STATUSES = new Set(["out", "back", "all"]);

// The FP lot's figures, as columns on any row that carries `fp`.
const COUNT_COLS = `
  ${weighedSql("fp")} AS weighed, ${byHandSql("fp")} AS by_hand, ${weighedLbSql("fp")} AS weighed_lb,
  ${takenSql("fp")} AS taken, ${returnedSql("fp")} AS returned`;

const fmt = (r) => ({
  // "weighed" (a dock session) or "hand" (a tracker row).
  kind: r.kind,
  key: `${r.kind}-${r.id}`,
  fpId: r.kind === "hand" ? r.id : null,
  batchId: r.kind === "weighed" ? r.id : null,
  lotId: r.lot_id,
  lotNumber: r.lot_number,
  fpLotId: r.fp_lot_id,
  fpLotNumber: r.fp_lot_number,
  item: r.item,
  cases: r.cases,
  // Weighed pounds for a dock trip, the typed raw weight for a hand row.
  weight: r.weight,
  sentOn: r.sent_on,
  createdBy: r.created_by,
  createdAt: r.created_at,
  // The accepted processing report that wrote a hand row, from before trips came from the dock.
  sourceReportId: r.source_report_id ?? null,
  // For the FP lot as a whole: several trips feed one lot, and returns are counted per lot.
  ...shapeRow(r),
});

// One row per trip, both kinds, each with its FP lot's figures.
const TRIPS_SQL = `
  WITH trips AS (
    SELECT 'hand' AS kind, t.fp_id AS id, t.tenant_id, t.lot_id, t.item, t.cases,
           t.raw_weight::text AS weight, t.sent_on::text AS sent_on, t.created_at, t.source_report_id,
           (SELECT u.username FROM users u WHERE u.id = t.created_by) AS created_by
      FROM fp_tracker t WHERE t.voided_at IS NULL
    UNION ALL
    SELECT 'weighed', b.batch_id, b.tenant_id, b.lot_id, COALESCE(b.item_description, ''),
           (SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id = b.batch_id AND bi.voided_at IS NULL)::int,
           (SELECT SUM(${weightInLb("bi")}) FROM batch_items bi
             WHERE bi.batch_id = b.batch_id AND bi.voided_at IS NULL)::text,
           COALESCE(b.weighed_on, (b.created_at AT TIME ZONE 'America/Los_Angeles')::date)::text,
           b.created_at, NULL,
           (SELECT u.username FROM users u WHERE u.id = b.created_by)
      FROM box_batches b WHERE b.direction = 'outgoing' AND b.further_processing AND b.lot_id IS NOT NULL
  )
  SELECT tr.*, l.lot_number, fp.lot_id AS fp_lot_id, fp.lot_number AS fp_lot_number, ${COUNT_COLS}
    FROM trips tr
    JOIN lots l ON l.lot_id = tr.lot_id
    LEFT JOIN lots fp ON fp.parent_lot_id = tr.lot_id AND fp.kind = 'further'`;

// A single hand row, shaped like a trip.
const ROW_SQL = `SELECT * FROM (${TRIPS_SQL}) x WHERE x.kind = 'hand'`;

// A plain day, not in the future, not before 2000. Blank gives `fallback`.
const parseDay = (raw, label, fallback = null) => {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: fallback };
  const s = String(raw).trim();
  if (!isCalendarDay(s)) return { ok: false, error: `${label} must be a date, YYYY-MM-DD.` };
  if (s > pacificToday()) return { ok: false, error: `${label} cannot be in the future.` };
  if (s < "2000-01-01") return { ok: false, error: `${label} is too far back to be right.` };
  return { ok: true, value: s };
};

const parseCases = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 100000 ? n : null;
};

// Decimal string, up to three places, or blank. Never a float.
const parseWeight = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === "") return { ok: true, value: null };
  try {
    toThousandths(String(raw).trim());
    return { ok: true, value: String(raw).trim() };
  } catch {
    return { ok: false, error: "Raw weight must be a number with at most three decimals." };
  }
};

const parseItem = (raw) => {
  const item = normaliseItem(raw);
  return item && item.length <= MAX_ITEM ? item : null;
};

// Refused when the FP lot would hold fewer cases than accepted runs have taken.
const overdrawn = async (client, tenantId, parentLotId) => {
  const fp = await findFpChild(client, tenantId, parentLotId);
  if (!fp) return null;
  const c = await fpCounts(client, tenantId, fp.lot_id);
  if (c.sent < c.returned) {
    return {
      code: "ALREADY_RETURNED",
      error: `${c.returned} cases of ${fp.lot_number} are already counted back from the freezer, `
        + "more than that would leave sent. Void a return first.",
    };
  }
  if (c.waiting >= 0) return null;
  return {
    code: "ALREADY_TAKEN",
    error: `Accepted runs have already taken ${c.taken} cases from ${fp.lot_number}, more than that would leave. `
      + `Un-accept those runs first, or keep at least ${-c.waiting} more cases here.`,
  };
};

const loadRow = (id, tenantId) =>
  pool.query(`${ROW_SQL} AND x.id = $1 AND x.tenant_id = $2`, [id, tenantId]);

router.get("/fp-tracker", verifyToken, async (req, res) => {
  const status = STATUSES.has(req.query.status) ? req.query.status : "all";
  const term = searchTerm(req.query.q);
  const params = [req.tenantId];
  let where = "WHERE tr.tenant_id = $1";
  // Per lot: anything sent and not yet counted back is still in the freezer.
  if (status === "out") where += ` AND ${sentSql("fp")} > ${returnedSql("fp")}`;
  if (status === "back") where += ` AND ${sentSql("fp")} <= ${returnedSql("fp")}`;
  if (term) {
    params.push(term);
    where += ` AND (l.lot_number ILIKE $${params.length} OR fp.lot_number ILIKE $${params.length}`
      + ` OR tr.item ILIKE $${params.length})`;
  }
  try {
    const result = await pool.query(
      `${TRIPS_SQL} ${where} ORDER BY tr.sent_on DESC, tr.created_at DESC LIMIT 300`, params);
    res.json(result.rows.map(fmt));
  } catch (err) {
    console.error("list fp tracker:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Every FP lot with its count: the processing report's stock for them.
router.get("/fp-lots", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT fp.lot_id, fp.lot_number, p.lot_id AS parent_lot_id, p.lot_number AS parent_lot_number,
              ${lotDescriptionSql("p")} AS description, ${COUNT_COLS}
         FROM lots fp JOIN lots p ON p.lot_id = fp.parent_lot_id
        WHERE fp.tenant_id = $1 AND fp.kind = 'further'
        ORDER BY fp.lot_date DESC NULLS LAST, fp.lot_number DESC`,
      [req.tenantId]);
    res.json(rows.map((r) => ({
      lotId: r.lot_id,
      lotNumber: r.lot_number,
      parentLotId: r.parent_lot_id,
      parentLotNumber: r.parent_lot_number,
      description: r.description ?? null,
      ...shapeRow(r),
    })));
  } catch (err) {
    console.error("list fp lots:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/fp-tracker", verifyToken, requireRole(...REPORT_ACCEPT_ROLES), async (req, res) => {
  const b = req.body || {};
  const lotId = Number(b.lotId);
  const item = parseItem(b.item);
  const cases = parseCases(b.cases);
  const weight = parseWeight(b.rawWeight);
  const sent = parseDay(b.sentOn, "Date sent out", pacificToday());
  if (!Number.isInteger(lotId)) return res.status(400).json({ error: "Pick a lot." });
  if (!item) return res.status(400).json({ error: `Item must be 1 to ${MAX_ITEM} characters.` });
  if (!cases) return res.status(400).json({ error: "Cases must be a whole number above zero." });
  if (!weight.ok) return res.status(400).json({ error: weight.error });
  if (!sent.ok) return res.status(400).json({ error: sent.error });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The parent lock makes the first row's FP lot one lot, not two.
    await lockLot(client, req.tenantId, lotId);
    // The same trip typed in after the dock weighed it would be counted twice.
    if (b.confirmNotWeighed !== true) {
      const same = await client.query(
        `SELECT COUNT(*)::int AS n FROM box_batches b
          WHERE b.tenant_id = $1 AND b.lot_id = $2 AND b.direction = 'outgoing' AND b.further_processing
            AND COALESCE(b.weighed_on, (b.created_at AT TIME ZONE 'America/Los_Angeles')::date) = $3::date`,
        [req.tenantId, lotId, sent.value]);
      if (same.rows[0].n > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ code: "WEIGHED_SAME_DAY",
          error: `The dock already weighed ${same.rows[0].n === 1 ? "a pallet" : `${same.rows[0].n} pallets`} `
            + "of this lot to the freezer that day, and those already count as sent. "
            + "Only add this if it is a different trip." });
      }
    }
    const fp = await ensureFpLot(client, req.tenantId, lotId, req.userId);
    const ins = await client.query(
      `INSERT INTO fp_tracker (tenant_id, lot_id, item, cases, raw_weight, sent_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING fp_id`,
      [req.tenantId, lotId, item, cases, weight.value, sent.value, req.userId || null]
    );
    await client.query("COMMIT");
    const row = await loadRow(ins.rows[0].fp_id, req.tenantId);
    res.status(201).json({ ...fmt(row.rows[0]), fpLotCreated: fp.created });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.status) return res.status(err.status).json({ code: err.code, error: err.message });
    console.error("add fp tracker row:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Correct a row or mark it returned. Lot is not editable: void and re-enter.
router.patch("/fp-tracker/:id", verifyToken, requireRole(...REPORT_ACCEPT_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Dates as text: a DATE read as a JS Date can come back as the day before (CLAUDE.md section 8).
    const cur = (await client.query(
      `SELECT fp_id, lot_id, item, cases, raw_weight::text AS raw_weight,
              sent_on::text AS sent_on, returned_on::text AS returned_on
         FROM fp_tracker WHERE fp_id = $1 AND tenant_id = $2 AND voided_at IS NULL FOR UPDATE`,
      [id, req.tenantId])).rows[0];
    if (!cur) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Not found" }); }

    const next = {
      item: cur.item, cases: cur.cases, raw_weight: cur.raw_weight,
      sent_on: cur.sent_on, returned_on: cur.returned_on,
    };
    const fail = async (error) => { await client.query("ROLLBACK"); return res.status(400).json({ error }); };
    if (b.item !== undefined) { const v = parseItem(b.item); if (!v) return fail(`Item must be 1 to ${MAX_ITEM} characters.`); next.item = v; }
    if (b.cases !== undefined) { const v = parseCases(b.cases); if (!v) return fail("Cases must be a whole number above zero."); next.cases = v; }
    if (b.rawWeight !== undefined) { const v = parseWeight(b.rawWeight); if (!v.ok) return fail(v.error); next.raw_weight = v.value; }
    if (b.sentOn !== undefined) { const v = parseDay(b.sentOn, "Date sent out"); if (!v.ok || !v.value) return fail(v.error || "Date sent out is required."); next.sent_on = v.value; }
    if (b.returnedOn !== undefined) { const v = parseDay(b.returnedOn, "Date returned"); if (!v.ok) return fail(v.error); next.returned_on = v.value; }
    if (next.returned_on && next.returned_on < next.sent_on) return fail("It cannot come back before it was sent out.");

    await lockLot(client, req.tenantId, cur.lot_id);
    await client.query(
      `UPDATE fp_tracker SET item = $1, cases = $2, raw_weight = $3, sent_on = $4, returned_on = $5
        WHERE fp_id = $6 AND tenant_id = $7`,
      [next.item, next.cases, next.raw_weight, next.sent_on, next.returned_on, id, req.tenantId]
    );
    const short = await overdrawn(client, req.tenantId, cur.lot_id);
    if (short) { await client.query("ROLLBACK"); return res.status(409).json(short); }

    await client.query("COMMIT");
    res.json(fmt((await loadRow(id, req.tenantId)).rows[0]));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("update fp tracker row:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

router.post("/fp-tracker/:id/void", verifyToken, requireRole(...REPORT_ACCEPT_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query(
      `SELECT fp_id, lot_id FROM fp_tracker WHERE fp_id = $1 AND tenant_id = $2 AND voided_at IS NULL FOR UPDATE`,
      [id, req.tenantId])).rows[0];
    if (!cur) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Not found" }); }
    await lockLot(client, req.tenantId, cur.lot_id);
    await client.query(
      `UPDATE fp_tracker SET voided_at = now(), voided_by = $1 WHERE fp_id = $2 AND tenant_id = $3`,
      [req.userId || null, id, req.tenantId]
    );
    const short = await overdrawn(client, req.tenantId, cur.lot_id);
    if (short) { await client.query("ROLLBACK"); return res.status(409).json(short); }
    await client.query("COMMIT");
    res.json({ voided: true, fpId: id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("void fp tracker row:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// ── Returns from the freezer ────────────────────────────────────────────────
// Counted at the incoming dock, not weighed. Partial returns are several rows.

// The incoming dock counts them; the outgoing dock is fenced out by roleScope anyway.
const RETURN_ROLES = ["admin", "reception", "ntimanager", "noblesse"];

const fmtReturn = (r) => ({
  returnId: r.return_id,
  lotId: r.lot_id,
  lotNumber: r.lot_number,
  cases: r.cases,
  returnedOn: r.returned_on,
  notes: r.notes,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

router.get("/fp-returns", verifyToken, async (req, res) => {
  const params = [req.tenantId];
  let where = "WHERE x.tenant_id = $1 AND x.voided_at IS NULL";
  if (req.query.lotId) { params.push(Number(req.query.lotId)); where += ` AND x.lot_id = $${params.length}`; }
  try {
    const { rows } = await pool.query(
      `SELECT x.return_id, x.lot_id, l.lot_number, x.cases, x.returned_on::text AS returned_on, x.notes,
              x.created_at, (SELECT u.username FROM users u WHERE u.id = x.created_by) AS created_by
         FROM fp_returns x JOIN lots l ON l.lot_id = x.lot_id
        ${where} ORDER BY x.returned_on DESC, x.return_id DESC LIMIT 300`, params);
    res.json(rows.map(fmtReturn));
  } catch (err) {
    console.error("list fp returns:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/fp-returns", verifyToken, requireRole(...RETURN_ROLES), async (req, res) => {
  const b = req.body || {};
  const lotId = Number(b.lotId);
  const cases = parseCases(b.cases);
  const day = parseDay(b.returnedOn, "Date back", pacificToday());
  if (!Number.isInteger(lotId)) return res.status(400).json({ error: "Pick the lot that came back." });
  if (!cases) return res.status(400).json({ error: "Cases must be a whole number above zero." });
  if (!day.ok) return res.status(400).json({ error: day.error });
  const notes = String(b.notes ?? "").trim().slice(0, 500) || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The same lock the tracker and accept take, so the counts below cannot move under us.
    await lockLot(client, req.tenantId, lotId);
    const fp = await findFpChild(client, req.tenantId, lotId);
    if (!fp) {
      await client.query("ROLLBACK");
      return res.status(409).json({ code: "NOTHING_SENT",
        error: "Nothing from this lot has been sent to the AF freezer, so nothing can come back." });
    }
    const c = await fpCounts(client, req.tenantId, fp.lot_id);
    if (c.returned + cases > c.sent) {
      await client.query("ROLLBACK");
      return res.status(409).json({ code: "MORE_THAN_SENT",
        error: `Only ${c.inFreezer} cases of ${fp.lot_number} are still in the freezer `
          + `(${c.sent} sent, ${c.returned} already back).`,
        inFreezer: c.inFreezer });
    }
    const ins = await client.query(
      `INSERT INTO fp_returns (tenant_id, lot_id, cases, returned_on, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING return_id`,
      [req.tenantId, lotId, cases, day.value, notes, req.userId || null]);
    await client.query("COMMIT");
    res.status(201).json({ returnId: ins.rows[0].return_id, fpLotNumber: fp.lot_number,
      ...(await fpCounts(pool, req.tenantId, fp.lot_id)) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("record fp return:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// A return recorded by mistake. Voided, never deleted; runs past it are only warned about.
router.post("/fp-returns/:id/void", verifyToken, requireRole(...RETURN_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const upd = await pool.query(
      `UPDATE fp_returns SET voided_at = now(), voided_by = $1
        WHERE return_id = $2 AND tenant_id = $3 AND voided_at IS NULL RETURNING return_id`,
      [req.userId || null, id, req.tenantId]);
    if (!upd.rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ voided: true, returnId: id });
  } catch (err) {
    console.error("void fp return:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
