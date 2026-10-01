const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { REPORT_ACCEPT_ROLES } = require("../middleware/receptionRoles");
const { normaliseItem, itemsForLot, waitingFor, lockLot } = require("../utils/fpWaiting");
const { isCalendarDay } = require("../utils/weighedAt");
const { pacificToday } = require("../utils/lot");
const { toThousandths } = require("../utils/weight");
const { searchTerm } = require("../utils/search");

// The F.P Tracker: product sent to the AF freezer that comes back for another
// run. Reception's Excel sheet, column for column. Rows are voided, never
// deleted, and never cut below what runs have already taken from them.

const MAX_ITEM = 120;
const STATUSES = new Set(["out", "back", "all"]);

const fmt = (r) => ({
  fpId: r.fp_id,
  lotId: r.lot_id,
  lotNumber: r.lot_number,
  item: r.item,
  cases: r.cases,
  rawWeight: r.raw_weight,
  sentOn: r.sent_on,
  returnedOn: r.returned_on,
  createdBy: r.created_by,
  createdAt: r.created_at,
  // For the lot and item as a whole: several rows can feed one item.
  sent: r.sent,
  drawn: r.drawn,
  waiting: r.sent - r.drawn,
});

const ROW_SQL = `
  SELECT t.fp_id, t.lot_id, l.lot_number, t.item, t.cases, t.raw_weight::text AS raw_weight,
         t.sent_on::text AS sent_on, t.returned_on::text AS returned_on, t.created_at,
         (SELECT u.username FROM users u WHERE u.id = t.created_by) AS created_by,
         (SELECT COALESCE(SUM(t2.cases), 0) FROM fp_tracker t2
           WHERE t2.tenant_id = t.tenant_id AND t2.lot_id = t.lot_id AND t2.item = t.item
             AND t2.voided_at IS NULL)::int AS sent,
         (SELECT COALESCE(SUM(r.input_cases), 0) FROM noblesse_processing_reports r
           WHERE r.tenant_id = t.tenant_id AND r.lot_id = t.lot_id AND r.source_fp_item = t.item
             AND r.status = 'accepted')::int AS drawn
    FROM fp_tracker t JOIN lots l ON l.lot_id = t.lot_id`;

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

// Refused when the tracker would show fewer cases than runs have already taken.
const overdrawn = async (client, tenantId, lotId, item) => {
  const waiting = await waitingFor(client, tenantId, lotId, item);
  if (waiting >= 0) return null;
  return {
    code: "ALREADY_DRAWN",
    error: `Runs have already taken more ${item} from this lot than that would leave. `
      + `Un-accept those runs first, or keep at least ${-waiting} more cases here.`,
  };
};

router.get("/fp-tracker", verifyToken, async (req, res) => {
  const status = STATUSES.has(req.query.status) ? req.query.status : "all";
  const term = searchTerm(req.query.q);
  const params = [req.tenantId];
  let where = "WHERE t.tenant_id = $1 AND t.voided_at IS NULL";
  if (status === "out") where += " AND t.returned_on IS NULL";
  if (status === "back") where += " AND t.returned_on IS NOT NULL";
  if (term) {
    params.push(term);
    where += ` AND (l.lot_number ILIKE $${params.length} OR t.item ILIKE $${params.length})`;
  }
  try {
    const result = await pool.query(
      `${ROW_SQL} ${where} ORDER BY t.sent_on DESC, t.fp_id DESC LIMIT 300`, params);
    res.json(result.rows.map(fmt));
  } catch (err) {
    console.error("list fp tracker:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// What one lot has in the tracker, per item: the "takes from" choices.
router.get("/fp-tracker/lot/:lotId", verifyToken, async (req, res) => {
  const lotId = Number(req.params.lotId);
  if (!Number.isInteger(lotId)) return res.status(400).json({ error: "Invalid lot id" });
  try {
    res.json(await itemsForLot(pool, req.tenantId, lotId));
  } catch (err) {
    console.error("fp tracker for lot:", err);
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
  try {
    const lot = await pool.query("SELECT 1 FROM lots WHERE lot_id = $1 AND tenant_id = $2", [lotId, req.tenantId]);
    if (!lot.rows.length) return res.status(400).json({ code: "NO_SUCH_LOT", error: "That lot is not in the registry." });
    const ins = await pool.query(
      `INSERT INTO fp_tracker (tenant_id, lot_id, item, cases, raw_weight, sent_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING fp_id`,
      [req.tenantId, lotId, item, cases, weight.value, sent.value, req.userId || null]
    );
    const row = await pool.query(`${ROW_SQL} WHERE t.fp_id = $1 AND t.tenant_id = $2`,
      [ins.rows[0].fp_id, req.tenantId]);
    res.status(201).json(fmt(row.rows[0]));
  } catch (err) {
    console.error("add fp tracker row:", err);
    res.status(500).json({ error: "Internal Server Error" });
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
    // Only the item it used to be can now be short.
    const short = await overdrawn(client, req.tenantId, cur.lot_id, cur.item);
    if (short) { await client.query("ROLLBACK"); return res.status(409).json(short); }

    await client.query("COMMIT");
    const row = await pool.query(`${ROW_SQL} WHERE t.fp_id = $1 AND t.tenant_id = $2`, [id, req.tenantId]);
    res.json(fmt(row.rows[0]));
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
      `SELECT fp_id, lot_id, item FROM fp_tracker WHERE fp_id = $1 AND tenant_id = $2 AND voided_at IS NULL FOR UPDATE`,
      [id, req.tenantId])).rows[0];
    if (!cur) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Not found" }); }
    await lockLot(client, req.tenantId, cur.lot_id);
    await client.query(
      `UPDATE fp_tracker SET voided_at = now(), voided_by = $1 WHERE fp_id = $2 AND tenant_id = $3`,
      [req.userId || null, id, req.tenantId]
    );
    const short = await overdrawn(client, req.tenantId, cur.lot_id, cur.item);
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

module.exports = router;
