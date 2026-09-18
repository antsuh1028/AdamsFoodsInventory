const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { RECEPTION_ROLES } = require("../middleware/receptionRoles");
const { parseLot, formatLot, pacificToday, dayOfYearFromDate } = require("../utils/lot");
// Shared with routes/boxes.pg.js so a lot's totals and a manifest agree.
const { weightInLb, stockWeightInLb } = require("../utils/sqlWeight");
const { weighedSql, boxesSql, formWeightSql, yieldFrom } = require("../utils/lotYield");

// The lot registry.
//
// A lot is issued ONCE, when product arrives at NTI, and only ever referenced
// afterwards — through processing, out to AdamsFoods or a customer, and back in again
// if AdamsFoods returns it. That rule is enforced by the shape of this file rather
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
  // 'internal' (ours, N{YY}{JJJ}-{NN}) or 'external' (a supplier's or
  // customer's own number). An external lot has no date and no sequence
  // because it genuinely has neither — callers group on this rather than
  // inferring it from a null date.
  kind: row.kind || "internal",
  // What the lot IS, for screens that only ever showed a number. Present only
  // where the query joined it in; a lot number alone tells nobody what it is.
  description: row.description ?? null,
  // Whether a registration form already exists for this lot. Present only where
  // the query joined it in; a picker choosing a lot for a NEW form wants the
  // ones nobody has written up yet.
  registered: row.registered ?? null,
  notes: row.notes,
  createdAt: row.created_at,
  // Set by a person, never derived: see the close route.
  status: row.status || "open",
  closedAt: row.closed_at ?? null,
  closedBy: row.closed_by ?? null,
  // The figures AS THEY STOOD at close. A later correction moves the live
  // numbers; these stay put, because somebody has already reported them.
  closedYield: row.closed_yield != null ? Number(row.closed_yield) : null,
  closedInLb: row.closed_in_lb ?? null,
  closedOutLb: row.closed_out_lb ?? null,
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
//                           paper, or comes back from AdamsFoods and already exists
//
// The third is create-OR-return: a lot coming back for a second pass resolves
// to the record it already has, which is the whole "stored, not re-created"
// rule. It reports which happened so the caller can say so.
router.post("/lots", verifyToken, async (req, res) => {
  const { date, lotNumber, notes, external } = req.body || {};

  try {
    // A number that is not ours — a supplier's or a customer's — recorded as a
    // real lot so it can be TRACKED: it gets a lot_id, a history, and joins up
    // like any other. It carries no date and no sequence because it has
    // neither, which is what `kind` marks.
    //
    // Only ever reached when the caller asks for it EXPLICITLY. The default
    // path below still refuses anything unparseable, so a typo cannot become a
    // lot by accident — which was the point of the registry's strictness, and
    // is untouched. `POST /lots/resolve` still never creates.
    if (external === true) {
      const text = String(lotNumber == null ? "" : lotNumber).trim().toUpperCase();
      if (!text) return res.status(400).json({ error: "lotNumber is required" });

      // Ours has a canonical form and an allocated sequence. Letting one in
      // through this door would mint an N-number that the issuer never handed
      // out, and put it in the registry with no date to order it by.
      const parsedCheck = parseLot(text);
      if (parsedCheck.ok) {
        return res.status(400).json({
          code: "IS_OUR_LOT",
          error: `"${parsedCheck.lotNumber}" is one of our lot numbers. ` +
                 `Issue or pick it rather than recording it as an outside number.`,
        });
      }

      const already = await findLot(req.tenantId, text);
      if (already.rows.length) {
        return res.json({ lot: fmtLot(already.rows[0]), created: false });
      }

      try {
        const ins = await pool.query(
          `INSERT INTO lots (tenant_id, lot_number, lot_date, seq, kind, created_by, notes)
           VALUES ($1, $2, NULL, NULL, 'external', $3, $4)
           RETURNING *`,
          [req.tenantId, text, req.userId, notes || null]
        );
        return res.status(201).json({ lot: fmtLot(ins.rows[0]), created: true });
      } catch (err) {
        // Someone recorded the same outside number a moment ago. That is a
        // success for the caller: the lot exists and is theirs.
        if (err.code === "23505") {
          const now = await findLot(req.tenantId, text);
          if (now.rows.length) return res.json({ lot: fmtLot(now.rows[0]), created: false });
        }
        throw err;
      }
    }

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
      // Ours first — newest day, highest sequence. Anything not ours in its
      // own block below, newest first.
      //
      // External lots are deliberately kept OUT of the date/sequence ordering
      // rather than mixed into it. They have no date, and a NULL sorts FIRST
      // under DESC in Postgres, so left in the same ordering they would sit
      // above today's work and push the lot someone actually wants off the top
      // of the list. The client renders the two blocks as separate groups.
      `SELECT l.*, d.description, d.registered
         FROM lots l
         -- The registration form is what says what a lot is; the incoming
         -- weighing session is the fallback for a lot never registered.
         LEFT JOIN LATERAL (
           SELECT COALESCE(
             (SELECT NULLIF(TRIM(f.product_description), '')
                FROM noblesse_registration_forms f
               WHERE f.tenant_id = l.tenant_id
                 AND (f.lot_id = l.lot_id OR f.lot_number = l.lot_number)
                 AND NULLIF(TRIM(f.product_description), '') IS NOT NULL
               ORDER BY f.created_at DESC LIMIT 1),
             (SELECT NULLIF(TRIM(b.item_description), '')
                FROM box_batches b
               WHERE b.tenant_id = l.tenant_id AND b.lot_id = l.lot_id
                 AND b.direction = 'incoming'
                 AND NULLIF(TRIM(b.item_description), '') IS NOT NULL
               ORDER BY b.created_at DESC LIMIT 1)
           ) AS description,
           EXISTS (
             SELECT 1 FROM noblesse_registration_forms f2
              WHERE f2.tenant_id = l.tenant_id
                AND (f2.lot_id = l.lot_id OR f2.lot_number = l.lot_number)
           ) AS registered
         ) d ON TRUE
        WHERE l.tenant_id = $1
          AND ($2 = '' OR l.lot_number ILIKE '%' || $2 || '%')
        ORDER BY (l.kind = 'external'),
                 l.lot_date DESC NULLS LAST,
                 l.seq DESC NULLS LAST,
                 l.created_at DESC
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

// ── One lot, and everything that has happened to it ─────────────────────────
//
// Registered AFTER /lots/next, or ":id" would swallow the literal "next".
//
// Every figure here is DERIVED. A stored status column drifts the first time
// someone edits around it, and the old NTI inventory screen proved the point by
// reconstructing in/out and yield from the orders because the stock row it was
// reading had gone to zero. So the numbers are computed and the label follows
// from them, rather than the other way round.

const lotFigures = async (tenantId, lotId, client = pool) => {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(${stockWeightInLb()}) FROM nti_inventory
                  WHERE lot_id = $1 AND tenant_id = $2 AND stage = 'raw'), 0)::text        AS raw_on_hand,
       COALESCE((SELECT SUM(${stockWeightInLb()}) FROM nti_inventory
                  WHERE lot_id = $1 AND tenant_id = $2 AND stage = 'processed'), 0)::text  AS processed_on_hand,
       COALESCE((SELECT SUM(qty_cases) FROM nti_inventory
                  WHERE lot_id = $1 AND tenant_id = $2 AND stage = 'processed'), 0)::int   AS processed_cases,
       -- Committed to a processing order that has not finished. The weight is
       -- already out of stock, so it is neither on hand nor processed yet.
       COALESCE((SELECT SUM(i.weight_in) FROM noblesse_processing_order_items i
                   JOIN noblesse_processing_orders o ON o.id = i.processing_order_id
                  WHERE i.lot_id = $1 AND o.tenant_id = $2 AND o.status <> 'completed'), 0)::text AS in_processing,
       -- What the boxes actually weighed, split by direction. Summed together
       -- these added an arrival to a departure and reported the total as the
       -- lot's weight, which made every figure below it wrong.
       ${weighedSql("incoming")} AS weighed_in,
       ${boxesSql("incoming")}   AS boxes_in,
       ${weighedSql("outgoing")} AS weighed_out,
       ${boxesSql("outgoing")}   AS boxes_out,
       -- Only used when nothing was weighed in, and the basis says so.
       ${formWeightSql} AS form_weight,
       COALESCE((SELECT COUNT(*) FROM noblesse_processing_orders o
                   JOIN noblesse_processing_order_items i ON i.processing_order_id = o.id
                  WHERE i.lot_id = $1 AND o.tenant_id = $2 AND o.status <> 'completed'), 0)::int AS open_orders,
       COALESCE((SELECT COUNT(*) FROM noblesse_processing_orders o
                   JOIN noblesse_processing_order_items i ON i.processing_order_id = o.id
                  WHERE i.lot_id = $1 AND o.tenant_id = $2 AND o.status = 'completed'), 0)::int AS done_orders,
       -- A draft load still holding this lot means that product has not left,
       -- so the lot cannot be finished and no close is suggested.
       COALESCE((SELECT COUNT(*) FROM noblesse_shipment_items si
                   JOIN noblesse_shipments sh ON sh.shipment_id = si.shipment_id
                  WHERE si.lot_id = $1 AND sh.tenant_id = $2 AND sh.status = 'draft'), 0)::int AS draft_loads,
       -- Last time anything actually moved. GREATEST skips NULLs, so a lot with
       -- only one kind of activity still reports it.
       GREATEST(
         (SELECT MAX(COALESCE(b.closed_at, b.created_at)) FROM box_batches b
           WHERE b.lot_id = $1 AND b.tenant_id = $2),
         (SELECT MAX(sh.shipped_at) FROM noblesse_shipment_items si
            JOIN noblesse_shipments sh ON sh.shipment_id = si.shipment_id
           WHERE si.lot_id = $1 AND sh.tenant_id = $2)
       ) AS last_movement_at`,
    [lotId, tenantId]
  );
  return rows[0];
};

// The label follows from the figures. Partial states are normal — half a lot
// processed, half still raw — so this is a summary, and the numbers beside it
// are the truth.
// How long a lot sits untouched before the app raises the question. It only
// ever asks: the app cannot tell "finished, with a 28% loss" from "more going
// out tomorrow", and only a person can.
const IDLE_DAYS_BEFORE_SUGGESTING = 7;

const closeSuggestion = (lot, f, y) => {
  if ((lot.status || "open") === "closed") return null;
  // Nothing has been weighed out, so there is no yield to freeze.
  if (!y.measured) return null;
  // That load has not left yet.
  if (Number(f.draft_loads) > 0) return null;
  if (!f.last_movement_at) return null;

  const idleDays = Math.floor(
    (Date.now() - new Date(f.last_movement_at).getTime()) / 86400000);
  if (idleDays < IDLE_DAYS_BEFORE_SUGGESTING) return null;

  return { suggested: true, idleDays, inLb: y.inLb, outLb: y.outLb,
    unaccountedLb: y.unaccountedLb, percent: y.percent };
};

const lotStatus = (f) => {
  if (Number(f.processed_on_hand) > 0) return "processed";
  if (Number(f.open_orders) > 0) return "processing";
  if (Number(f.done_orders) > 0) return "processed";
  return "received";
};

router.get("/lots/:id", verifyToken, async (req, res) => {
  const lotId = Number(req.params.id);
  if (!Number.isInteger(lotId)) return res.status(400).json({ error: "Invalid lot id" });

  try {
    const lot = await pool.query(
      `SELECT * FROM lots WHERE lot_id = $1 AND tenant_id = $2`, [lotId, req.tenantId]);
    if (!lot.rows.length) return res.status(404).json({ error: "Lot not found" });

    const f = await lotFigures(req.tenantId, lotId);
    res.json({
      lot: fmtLot(lot.rows[0]),
      status: lotStatus(f),
      closeSuggestion: closeSuggestion(lot.rows[0], f, yieldFrom(f)),
      figures: {
        rawOnHand: f.raw_on_hand,
        processedOnHand: f.processed_on_hand,
        processedCases: f.processed_cases,
        inProcessing: f.in_processing,
        weighedIn: f.weighed_in,
        boxesIn: f.boxes_in,
        weighedOut: f.weighed_out,
        boxesOut: f.boxes_out,
        weightUnit: "LB",
      },
      yield: yieldFrom(f),
    });
  } catch (err) {
    console.error("read lot:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Closing a lot.
//
// A person decides this, prompted by closeSuggestion above and never by the
// app on its own. `weight = 0` cannot stand in for it: shipping deducts weight
// while an accepted processing report deducts only cases, so a lot consumed
// entirely by processing still shows its whole arrival weight — and cancelling
// a load puts weight back, so the signal is reversible anyway.
//
// The yield is FROZEN into the row here. A correction made afterwards moves the
// live figures, and it must not silently rewrite a number somebody has already
// reported.
router.post("/lots/:id/close", verifyToken, requireRole(...RECEPTION_ROLES), async (req, res) => {
  const lotId = Number(req.params.id);
  if (!Number.isInteger(lotId)) return res.status(400).json({ error: "Invalid lot id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Locked for the whole decision, so two people closing at once cannot both
    // compute the figures and write different ones.
    const lot = await client.query(
      `SELECT * FROM lots WHERE lot_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [lotId, req.tenantId]
    );
    if (!lot.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Lot not found" });
    }
    if ((lot.rows[0].status || "open") === "closed") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "ALREADY_CLOSED",
        error: `${lot.rows[0].lot_number} was already closed. Reopen it first to ` +
               `change anything.`,
      });
    }

    const f = await lotFigures(req.tenantId, lotId, client);

    // A draft load still holds this lot, so the product has not left.
    if (Number(f.draft_loads) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "DRAFT_SHIPMENT",
        error: `${lot.rows[0].lot_number} is on ${f.draft_loads} draft load` +
               `${Number(f.draft_loads) === 1 ? "" : "s"} that has not shipped. ` +
               `Ship or delete that load first.`,
        draftLoads: Number(f.draft_loads),
      });
    }

    const y = yieldFrom(f);
    const upd = await client.query(
      `UPDATE lots
          SET status = 'closed', closed_at = now(), closed_by = $3,
              closed_yield = $4, closed_in_lb = $5, closed_out_lb = $6
        WHERE lot_id = $1 AND tenant_id = $2
      RETURNING *`,
      [lotId, req.tenantId, req.username || req.userId || null,
       y.percent, y.inLb, y.outLb]
    );

    await client.query("COMMIT");
    res.json({ lot: fmtLot(upd.rows[0]), yield: y });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("close lot:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Reopening drops the frozen figures rather than keeping them beside live ones:
// two sets of numbers for the same lot is how a report ends up quoting the wrong
// one. Admin only — closing states a result, and undoing that is not routine.
router.post("/lots/:id/reopen", verifyToken, requireRole("admin"), async (req, res) => {
  const lotId = Number(req.params.id);
  if (!Number.isInteger(lotId)) return res.status(400).json({ error: "Invalid lot id" });

  try {
    const upd = await pool.query(
      `UPDATE lots
          SET status = 'open', closed_at = NULL, closed_by = NULL,
              closed_yield = NULL, closed_in_lb = NULL, closed_out_lb = NULL
        WHERE lot_id = $1 AND tenant_id = $2 AND status = 'closed'
      RETURNING *`,
      [lotId, req.tenantId]
    );
    if (!upd.rows.length) {
      // Either it does not exist or it was never closed; both mean there is
      // nothing here to undo.
      const exists = await pool.query(
        `SELECT lot_number FROM lots WHERE lot_id = $1 AND tenant_id = $2`,
        [lotId, req.tenantId]
      );
      if (!exists.rows.length) return res.status(404).json({ error: "Lot not found" });
      return res.status(409).json({
        code: "NOT_CLOSED",
        error: `${exists.rows[0].lot_number} is already open.`,
      });
    }
    res.json({ lot: fmtLot(upd.rows[0]) });
  } catch (err) {
    console.error("reopen lot:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Everything that has happened to a lot, oldest first.
//
// A UNION over the tables that reference it. Before the registry this was five
// text searches and some guessing; the whole point of giving a lot an identity
// is that its history becomes a query.
router.get("/lots/:id/timeline", verifyToken, async (req, res) => {
  const lotId = Number(req.params.id);
  if (!Number.isInteger(lotId)) return res.status(400).json({ error: "Invalid lot id" });

  try {
    const lot = await pool.query(
      `SELECT lot_id FROM lots WHERE lot_id = $1 AND tenant_id = $2`, [lotId, req.tenantId]);
    if (!lot.rows.length) return res.status(404).json({ error: "Lot not found" });

    const { rows } = await pool.query(
      `
      -- Stock arriving, raw or processed. A 'processed' row is NTI's own output
      -- coming back under the same lot, which is why both live in one table.
      SELECT s.created_at AS at,
             CASE WHEN s.stage = 'processed' THEN 'processed' ELSE 'received' END AS kind,
             CASE WHEN s.stage = 'processed'
                  THEN 'Processed output back into stock'
                  ELSE 'Received into stock' END AS label,
             ${stockWeightInLb("s")}::text AS weight,
             s.qty_cases::int AS cases,
             s.notes AS detail,
             s.id AS ref,
             NULL::text AS direction
        FROM nti_inventory s
       WHERE s.lot_id = $1 AND s.tenant_id = $2

      UNION ALL
      -- Weighing sessions.
      SELECT b.created_at, 'weighed',
             (CASE WHEN b.direction = 'outgoing' THEN 'Weighed out' ELSE 'Weighed in' END
              || CASE WHEN b.source = 'imported' THEN ' (tally sheet imported)' ELSE '' END),
             COALESCE((SELECT SUM(${weightInLb("bi")}) FROM batch_items bi
                        WHERE bi.batch_id = b.batch_id AND bi.voided_at IS NULL), 0)::text,
             (SELECT COUNT(*)::int FROM batch_items bi
               WHERE bi.batch_id = b.batch_id AND bi.voided_at IS NULL),
             b.vendor, b.batch_id, b.direction
        FROM box_batches b
       WHERE b.lot_id = $1 AND b.tenant_id = $2

      UNION ALL
      -- The registration form for the lot.
      SELECT f.created_at, 'registered', 'Registered',
             f.original_weight::text, NULL::int,
             COALESCE(f.product_description, f.vendor), f.id, NULL::text
        FROM noblesse_registration_forms f
       WHERE f.lot_id = $1 AND f.tenant_id = $2

      UNION ALL
      -- Processing, raised and finished. completed_at is used when it exists so
      -- the finish lands at the time it happened, not when the order was cut.
      SELECT COALESCE(o.completed_at, o.created_at),
             CASE WHEN o.status = 'completed' THEN 'processing_done' ELSE 'processing' END,
             CASE WHEN o.status = 'completed' THEN 'Processing complete' ELSE 'Sent to processing' END,
             CASE WHEN o.status = 'completed' THEN o.output_weight::text
                  ELSE SUM(i.weight_in)::text END,
             CASE WHEN o.status = 'completed' THEN o.output_cases ELSE NULL END,
             o.notes, o.id, NULL::text
        FROM noblesse_processing_orders o
        JOIN noblesse_processing_order_items i ON i.processing_order_id = o.id
       WHERE i.lot_id = $1 AND o.tenant_id = $2
       GROUP BY o.id, o.completed_at, o.created_at, o.status, o.output_weight, o.output_cases, o.notes

      UNION ALL
      -- Processing as it is actually recorded today. The branch above reads
      -- noblesse_processing_orders, which has no client and no rows, so until
      -- this one existed a lot's processing never appeared at all.
      SELECT COALESCE(r.accepted_at, r.submitted_at),
             CASE r.status WHEN 'accepted' THEN 'processing_done'
                           WHEN 'rejected' THEN 'report_rejected'
                           ELSE 'report_filed' END,
             CASE r.status WHEN 'accepted' THEN 'Processing report accepted'
                           WHEN 'rejected' THEN 'Processing report rejected'
                           ELSE 'Processing report filed' END,
             -- Written on the report but never weighed, so it creates no stock.
             r.output_weight::text,
             COALESCE(r.output_cases, r.input_cases)::int,
             NULLIF(CONCAT_WS(' · ', r.processing_type,
                    NULLIF('Line ' || r.line_no, 'Line '), r.reject_reason), ''),
             r.report_id, NULL::text
        FROM noblesse_processing_reports r
       WHERE r.lot_id = $1 AND r.tenant_id = $2

      UNION ALL
      -- Loads leaving. Nothing here read the shipment tables at all, so a lot
      -- could ship out entirely and its history showed nothing — the biggest
      -- single gap in this query. Aggregated per load: one lot can sit on two
      -- lines of the same shipment, and that is one departure, not two.
      SELECT COALESCE(sh.shipped_at, sh.cancelled_at, sh.created_at),
             CASE sh.status WHEN 'shipped'   THEN 'shipped'
                            WHEN 'cancelled' THEN 'shipment_cancelled'
                            ELSE 'shipment_draft' END,
             CASE sh.status
               WHEN 'shipped'   THEN 'Shipped to ' || COALESCE(sh.destination_name, 'a customer')
               WHEN 'cancelled' THEN 'Load cancelled (' || COALESCE(sh.destination_name, 'a customer') || ')'
               ELSE 'On a draft load for ' || COALESCE(sh.destination_name, 'a customer')
             END,
             ROUND(SUM(si.weight), 2)::text,
             NULLIF(SUM(COALESCE(si.qty_cases, 0)), 0)::int,
             NULLIF(CONCAT_WS(' · ', NULLIF('BOL ' || sh.bill_of_lading, 'BOL '), sh.carrier), ''),
             sh.shipment_id, 'outgoing'
        FROM noblesse_shipment_items si
        JOIN noblesse_shipments sh ON sh.shipment_id = si.shipment_id
       WHERE si.lot_id = $1 AND sh.tenant_id = $2
       GROUP BY sh.shipment_id, sh.shipped_at, sh.cancelled_at, sh.created_at,
                sh.status, sh.destination_name, sh.bill_of_lading, sh.carrier

      ORDER BY at
      `,
      [lotId, req.tenantId]
    );

    res.json(rows.map((r) => ({
      at: r.at,
      kind: r.kind,
      label: r.label,
      weight: r.weight,
      cases: r.cases,
      detail: r.detail,
      ref: r.ref,
      // 'incoming' | 'outgoing' | null. An arrival and a departure rendered
      // identically before this.
      direction: r.direction,
    })));
  } catch (err) {
    console.error("lot timeline:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
