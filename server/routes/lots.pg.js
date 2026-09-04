const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const { parseLot, formatLot, pacificToday, dayOfYearFromDate } = require("../utils/lot");

// The lot registry.
//
// A lot is issued ONCE, when product arrives at NTI, and only ever referenced
// afterwards — through processing, out to AFDC or a customer, and back in again
// if AFDC returns it. That rule is enforced by the shape of this file rather
// than by a flag a caller could set:
//
//   POST /lots          CREATES. Incoming-side screens call this.
//   POST /lots/resolve  LOOKS UP ONLY. 404s on an unknown lot; never creates.
//
// Downstream code (processing, shipments) calls resolve and nothing else, so a
// typo in a shipment cannot mint a phantom lot. A `create: true` flag on one
// endpoint would have put that control in the client, and a client-side check
// is not a control (CLAUDE.md §8).

const fmtLot = (row) => ({
  lotId: row.lot_id,
  lotNumber: row.lot_number,
  lotDate: row.lot_date instanceof Date
    ? row.lot_date.toISOString().slice(0, 10)
    : row.lot_date,
  seq: row.seq,
  notes: row.notes,
  createdAt: row.created_at,
});

// The sequence is the last two digits of the lot number, so 99 is the ceiling.
// Hitting it means 99 separate lots in one day, which has never happened — but
// silently rolling over to a three-digit sequence would break the fixed width
// that makes alphabetical sorting chronological.
const MAX_SEQ = 99;

const findLot = (tenantId, lotNumber) =>
  pool.query(
    `SELECT * FROM lots WHERE tenant_id = $1 AND lot_number = $2`,
    [tenantId, lotNumber]
  );

// Allocate the next sequence for a day.
//
// Deliberately NOT wrapped in a transaction: read-the-max-then-insert races by
// nature, and the UNIQUE (tenant_id, lot_date, seq) constraint is what actually
// settles it. Two people pressing Start at the same moment both read seq 3; one
// insert wins, the loser catches 23505 and takes 4. Inside a transaction the
// failed insert would poison it and force a rollback per attempt, so each try
// is its own statement.
const issueNextForDate = async (tenantId, lotDate, userId, notes) => {
  const { year, dayOfYear } = dayOfYearFromDate(lotDate);
  const yy = year % 100;

  for (let attempt = 0; attempt < MAX_SEQ; attempt += 1) {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next
         FROM lots WHERE tenant_id = $1 AND lot_date = $2`,
      [tenantId, lotDate]
    );
    const seq = Number(rows[0].next);
    if (seq > MAX_SEQ) {
      const err = new Error(`no sequence left for ${lotDate} — ${MAX_SEQ} lots already issued that day`);
      err.status = 409;
      throw err;
    }

    try {
      const ins = await pool.query(
        `INSERT INTO lots (tenant_id, lot_number, lot_date, seq, created_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, formatLot(yy, dayOfYear, seq), lotDate, seq, userId, notes || null]
      );
      return ins.rows[0];
    } catch (err) {
      if (err.code === "23505") continue;   // someone took this sequence; try the next
      throw err;
    }
  }

  const err = new Error(`could not allocate a sequence for ${lotDate} after ${MAX_SEQ} attempts`);
  err.status = 409;
  throw err;
};

// ── Create ───────────────────────────────────────────────────────────────────
// Two shapes:
//   { }                     issue the next sequence for today (Pacific)
//   { date }                issue the next sequence for that day
//   { lotNumber }           adopt a specific number — for a lot that arrives on
//                           paper, or comes back from AFDC and already exists
//
// The third is create-OR-return: a lot coming back for a second pass resolves
// to the record it already has, which is the whole "stored, not re-created"
// rule. It reports which happened so the caller can say so.
router.post("/lots", verifyToken, async (req, res) => {
  const { date, lotNumber, notes } = req.body || {};

  try {
    if (lotNumber != null && String(lotNumber).trim() !== "") {
      const parsed = parseLot(lotNumber);
      if (!parsed.ok) {
        return res.status(400).json({
          error: `"${parsed.raw}" is not a lot number`,
          code: parsed.code, reason: parsed.reason, raw: parsed.raw,
        });
      }

      const existing = await findLot(req.tenantId, parsed.lotNumber);
      if (existing.rows.length) {
        return res.json({ lot: fmtLot(existing.rows[0]), created: false });
      }

      try {
        const ins = await pool.query(
          `INSERT INTO lots (tenant_id, lot_number, lot_date, seq, created_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [req.tenantId, parsed.lotNumber, parsed.lotDate, parsed.seq,
           req.userId, notes || parsed.extra || null]
        );
        return res.status(201).json({ lot: fmtLot(ins.rows[0]), created: true });
      } catch (err) {
        // Someone created the same lot between the lookup and the insert.
        // That is a success for the caller: the lot exists and is theirs.
        if (err.code === "23505") {
          const now = await findLot(req.tenantId, parsed.lotNumber);
          if (now.rows.length) return res.json({ lot: fmtLot(now.rows[0]), created: false });
        }
        throw err;
      }
    }

    const lotDate = date ? String(date).trim() : pacificToday();
    try {
      dayOfYearFromDate(lotDate);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const row = await issueNextForDate(req.tenantId, lotDate, req.userId, notes);
    return res.status(201).json({ lot: fmtLot(row), created: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("issue lot:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── Resolve ──────────────────────────────────────────────────────────────────
// Text in, lot out. Normalises (pads a one-digit sequence, pulls the lot out of
// "P12 N26230-01", trims, upcases) and NEVER creates. Used everywhere a lot is
// typed or imported downstream of Incoming.
router.post("/lots/resolve", verifyToken, async (req, res) => {
  const { text } = req.body || {};
  const parsed = parseLot(text);

  if (!parsed.ok) {
    return res.status(400).json({
      error: `"${parsed.raw}" is not a lot number`,
      code: parsed.code, reason: parsed.reason, raw: parsed.raw,
    });
  }

  try {
    const found = await findLot(req.tenantId, parsed.lotNumber);
    if (!found.rows.length) {
      return res.status(404).json({
        error: `Lot ${parsed.lotNumber} does not exist`,
        code: "NO_SUCH_LOT",
        lotNumber: parsed.lotNumber,
        // Returned so the caller can offer "create it" on an incoming screen
        // without having to re-parse the text itself.
        parsed: { lotNumber: parsed.lotNumber, lotDate: parsed.lotDate, seq: parsed.seq },
      });
    }
    return res.json({
      lot: fmtLot(found.rows[0]),
      // True when the typed text was not already canonical, so the UI can show
      // what it was read as rather than silently swapping it.
      normalised: parsed.changed,
      raw: parsed.raw,
    });
  } catch (err) {
    console.error("resolve lot:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── List ─────────────────────────────────────────────────────────────────────
// Newest first, which is what a picker wants: the lot someone needs is almost
// always one of the last few issued.
router.get("/lots", verifyToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  try {
    const result = await pool.query(
      `SELECT * FROM lots
        WHERE tenant_id = $1
          AND ($2 = '' OR lot_number ILIKE '%' || $2 || '%')
        ORDER BY lot_date DESC, seq DESC
        LIMIT $3`,
      [req.tenantId, q, limit]
    );
    res.json(result.rows.map(fmtLot));
  } catch (err) {
    console.error("list lots:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// NOTE for whoever adds GET /lots/:id (step 8): it must be registered AFTER
// this one, or ":id" captures the literal string "next" and this route becomes
// unreachable.
//
// What the next lot for today would be, without taking it. Lets an incoming
// screen show "next: N26247-03" before the operator commits, the way the lot
// field is prefilled today — except the sequence is real rather than typed.
router.get("/lots/next", verifyToken, async (req, res) => {
  const lotDate = typeof req.query.date === "string" && req.query.date.trim()
    ? req.query.date.trim() : pacificToday();
  try {
    const { year, dayOfYear } = dayOfYearFromDate(lotDate);
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next
         FROM lots WHERE tenant_id = $1 AND lot_date = $2`,
      [req.tenantId, lotDate]
    );
    const seq = Number(rows[0].next);
    res.json({
      lotDate,
      seq,
      // Advisory only. Two people asking at once get the same answer and one of
      // them will be handed a different number when they actually take it.
      lotNumber: seq <= MAX_SEQ ? formatLot(year % 100, dayOfYear, seq) : null,
      exhausted: seq > MAX_SEQ,
    });
  } catch (err) {
    if (/date/.test(err.message)) return res.status(400).json({ error: err.message });
    console.error("next lot:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
