// @ts-check
"use strict";

const { weightInLb } = require("./sqlWeight");
const { weighedAtSql, isCalendarDay } = require("./weighedAt");
const { yieldLateralSql } = require("./lotYield");
const { pacificToday } = require("./lot");

// The daily report, as a range.
//
// One report over $1 tenant, $2 from, $3 to — the daily view asks for a single
// day and the monthly view for a month, so neither needs its own SQL. Every
// figure counts on the day the WORK happened (weighed_on, ship_date,
// processing_date), not the day it was typed: entering Monday's tally sheet on
// Thursday belongs to Monday. What that leaves out — work entered inside the
// range but belonging elsewhere — is reported separately by BACKDATED.

const MAX_SPAN_DAYS = 366;
const PACIFIC = "America/Los_Angeles";

/** A timestamptz as the Pacific calendar day it fell on. */
const pacificDay = (/** @type {string} */ expr) =>
  `((${expr}) AT TIME ZONE '${PACIFIC}')::date`;

// The day a session's boxes were WEIGHED. `b` is box_batches.
const weighedDay = pacificDay(weighedAtSql("b"));
const enteredDay = pacificDay("b.created_at");

/**
 * @typedef {{ ok: true, from: string, to: string, clamped: boolean, days: number }} RangeOk
 * @typedef {{ ok: false, error: string }} RangeBad
 */

/**
 * The requested range, or why it is not one.
 *
 * `to` in the future is CLAMPED to today rather than refused, so "this month"
 * asked for on the 3rd is a three-day report instead of a 400.
 *
 * @param {unknown} rawFrom
 * @param {unknown} rawTo omitted means a single day
 * @param {string} [todayPacific]
 * @returns {RangeOk | RangeBad}
 */
const parseRange = (rawFrom, rawTo, todayPacific = pacificToday()) => {
  const from = typeof rawFrom === "string" ? rawFrom.trim() : "";
  const rawEnd = typeof rawTo === "string" ? rawTo.trim() : "";
  const to = rawEnd || from;

  if (!isCalendarDay(from)) return { ok: false, error: "from must be a date, YYYY-MM-DD." };
  if (!isCalendarDay(to)) return { ok: false, error: "to must be a date, YYYY-MM-DD." };
  if (to < from) return { ok: false, error: "That range ends before it starts." };
  if (from < "2000-01-01") return { ok: false, error: "That date is too far back to be right." };
  if (from > todayPacific) return { ok: false, error: "That range has not happened yet." };

  const end = to > todayPacific ? todayPacific : to;
  const days = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  ) + 1;
  if (days > MAX_SPAN_DAYS) {
    return { ok: false, error: `A report covers at most ${MAX_SPAN_DAYS} days.` };
  }
  return { ok: true, from, to: end, clamped: end !== to, days };
};

// ── Section A: the day's movement ───────────────────────────────────────────

// Both directions in one pass. A session with no boxes weighed nothing, so it
// is absent here by design — the exceptions list is what chases those.
const WEIGHING = `
  SELECT b.direction,
         COUNT(DISTINCT b.batch_id)::int AS sessions,
         COUNT(*)::int                   AS boxes,
         COALESCE(SUM(${weightInLb("bi")}), 0)::text AS lb,
         COUNT(DISTINCT COALESCE(b.lot_id::text, b.lot_number))::int AS lots
    FROM batch_items bi
    JOIN box_batches b ON b.batch_id = bi.batch_id
   WHERE b.tenant_id = $1
     AND bi.voided_at IS NULL
     AND ${weighedDay} BETWEEN $2 AND $3
   GROUP BY b.direction`;

// LEFT JOIN so a load that shipped with no lines still counts as a load, and
// COUNT(DISTINCT) so its lines do not multiply it.
const SHIPPED = `
  SELECT COUNT(DISTINCT s.shipment_id)::int     AS loads,
         COALESCE(SUM(si.weight), 0)::text      AS lb,
         COALESCE(SUM(si.qty_cases), 0)::int    AS cases,
         COUNT(DISTINCT si.lot_id)::int         AS lots,
         COUNT(DISTINCT s.destination_name)::int AS destinations
    FROM noblesse_shipments s
    LEFT JOIN noblesse_shipment_items si ON si.shipment_id = s.shipment_id
   WHERE s.tenant_id = $1
     AND s.status = 'shipped'
     AND s.ship_date BETWEEN $2 AND $3`;

// Accepted only: a submitted report has not moved anything yet.
const PROCESSED = `
  SELECT COUNT(*)::int                            AS reports,
         COALESCE(SUM(input_cases), 0)::int       AS cases_in,
         COALESCE(SUM(output_cases), 0)::int      AS cases_out,
         COALESCE(SUM(output_weight), 0)::text    AS output_lb,
         COALESCE(SUM(inedible_weight), 0)::text  AS inedible_lb,
         COUNT(DISTINCT lot_id)::int              AS lots
    FROM noblesse_processing_reports
   WHERE tenant_id = $1
     AND status = 'accepted'
     AND processing_date BETWEEN $2 AND $3`;

// lot_date is the day the NUMBER encodes, which is the day the lot was issued.
const LOTS_ISSUED = `
  SELECT COUNT(*)::int AS lots
    FROM lots
   WHERE tenant_id = $1 AND kind = 'internal' AND lot_date BETWEEN $2 AND $3`;

// `open` is how many of the forms received in the range are still unfinished —
// NOT how many were finished in it. Nothing records when a form was completed.
const FORMS = `
  SELECT COUNT(*)::int AS forms,
         COUNT(*) FILTER (WHERE status <> 'completed')::int AS open
    FROM noblesse_registration_forms
   WHERE tenant_id = $1 AND date_received BETWEEN $2 AND $3`;

// Entered inside the range, counted on a day outside it. Without this, late
// entry is invisible: it is absent from the day it was typed and it silently
// changed a report someone already read.
const BACKDATED = `
  SELECT COUNT(*)::int AS sessions,
         COALESCE(ARRAY_AGG(DISTINCT day ORDER BY day DESC), ARRAY[]::date[])::text[] AS days
    FROM (
      SELECT ${weighedDay} AS day
        FROM box_batches b
       WHERE b.tenant_id = $1
         AND ${enteredDay} BETWEEN $2 AND $3
         AND ${weighedDay} NOT BETWEEN $2 AND $3
    ) x`;

// Every lot the range touched, with what happened to it and where its yield
// stands. Scalar subqueries per measure rather than a second join, so the
// per-lot figures cannot fan out against each other (CLAUDE.md §5).
const LOTS_TOUCHED = `
  WITH box AS (
    SELECT COALESCE(b.lot_id,
             (SELECT l.lot_id FROM lots l
               WHERE l.tenant_id = b.tenant_id AND l.lot_number = b.lot_number)) AS lot_id,
           b.direction,
           COUNT(*)::int AS boxes,
           COALESCE(SUM(${weightInLb("bi")}), 0) AS lb
      FROM batch_items bi
      JOIN box_batches b ON b.batch_id = bi.batch_id
     WHERE b.tenant_id = $1
       AND bi.voided_at IS NULL
       AND ${weighedDay} BETWEEN $2 AND $3
     GROUP BY 1, 2
  ),
  ship AS (
    SELECT si.lot_id,
           COUNT(DISTINCT s.shipment_id)::int AS loads,
           COALESCE(SUM(si.weight), 0) AS lb
      FROM noblesse_shipment_items si
      JOIN noblesse_shipments s ON s.shipment_id = si.shipment_id
     WHERE s.tenant_id = $1 AND s.status = 'shipped'
       AND s.ship_date BETWEEN $2 AND $3
     GROUP BY 1
  ),
  proc AS (
    SELECT lot_id,
           COUNT(*)::int AS reports,
           COALESCE(SUM(input_cases), 0)::int  AS cases_in,
           COALESCE(SUM(output_cases), 0)::int AS cases_out
      FROM noblesse_processing_reports
     WHERE tenant_id = $1 AND status = 'accepted'
       AND processing_date BETWEEN $2 AND $3
     GROUP BY 1
  ),
  touched AS (
    SELECT lot_id FROM box WHERE lot_id IS NOT NULL
    UNION SELECT lot_id FROM ship
    UNION SELECT lot_id FROM proc
  )
  SELECT t.*, y.weighed_in, y.weighed_out, y.boxes_in, y.boxes_out
    FROM (
      SELECT l.lot_id, l.lot_number, l.tenant_id, l.status,
             COALESCE((SELECT boxes FROM box WHERE box.lot_id = l.lot_id
                        AND box.direction = 'incoming'), 0) AS day_boxes_in,
             COALESCE((SELECT lb FROM box WHERE box.lot_id = l.lot_id
                        AND box.direction = 'incoming'), 0)::text AS day_lb_in,
             COALESCE((SELECT boxes FROM box WHERE box.lot_id = l.lot_id
                        AND box.direction = 'outgoing'), 0) AS day_boxes_out,
             COALESCE((SELECT lb FROM box WHERE box.lot_id = l.lot_id
                        AND box.direction = 'outgoing'), 0)::text AS day_lb_out,
             COALESCE((SELECT loads FROM ship WHERE ship.lot_id = l.lot_id), 0) AS day_loads,
             COALESCE((SELECT lb FROM ship WHERE ship.lot_id = l.lot_id), 0)::text AS day_shipped_lb,
             COALESCE((SELECT reports FROM proc WHERE proc.lot_id = l.lot_id), 0) AS day_reports,
             COALESCE((SELECT cases_in FROM proc WHERE proc.lot_id = l.lot_id), 0) AS day_cases_in,
             COALESCE((SELECT cases_out FROM proc WHERE proc.lot_id = l.lot_id), 0) AS day_cases_out,
             -- The typed Original Weight, for a lot that was never weighed in.
             (SELECT COALESCE(MAX(f.original_weight), 0)::text
                FROM noblesse_registration_forms f
               WHERE f.tenant_id = l.tenant_id
                 AND (f.lot_id = l.lot_id OR f.lot_number = l.lot_number)) AS form_weight
        FROM lots l
        JOIN touched ON touched.lot_id = l.lot_id
    ) t
    ${yieldLateralSql("t")}
   ORDER BY t.lot_number`;

// ── Section B: what needs attention ─────────────────────────────────────────

// How long something sits before it is worth naming. One constant each.
const STALE_DRAFT_DAYS = 3;
const IDLE_LOT_DAYS = 7;
const ATTENTION_LIMIT = 300;

const TODAY = pacificDay("now()");

/** Whole days between a date expression and today, Pacific. */
const ageDays = (/** @type {string} */ day) => `(${TODAY} - (${day}))::int`;

// "Product arrived and nobody filed the registration form for it."
//
// INCOMING ONLY, and never an empty session — an outgoing session has no form
// it could ever go on, and a session with no boxes is a start pressed by
// accident. Both nagged forever before those two clauses. Shared with the
// notice on the tab row (routes/boxes.pg.js) so a badge and the report cannot
// count different things. Expects $1 = tenant and the alias `b`.
const UNREGISTERED_WHERE = `
          b.direction = 'incoming'
      AND b.status = 'closed'
      AND NOT EXISTS (
            SELECT 1 FROM registration_form_batches r
             WHERE r.batch_id = b.batch_id AND r.tenant_id = $1)
      AND EXISTS (
            SELECT 1 FROM batch_items i
             WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL)`;

// Boxes on a session, as a fragment reusable inside a jsonb object.
const boxCount = (/** @type {string} */ alias) =>
  `(SELECT COUNT(*)::int FROM batch_items i
     WHERE i.batch_id = ${alias}.batch_id AND i.voided_at IS NULL)`;
const boxLb = (/** @type {string} */ alias) =>
  `COALESCE((SELECT SUM(${weightInLb("i")})::text FROM batch_items i
              WHERE i.batch_id = ${alias}.batch_id AND i.voided_at IS NULL), '0')`;

// The last day anything happened to a lot, across all three ways it can move.
const lastMovement = `GREATEST(
    COALESCE((SELECT MAX(${weighedDay}) FROM box_batches b
               WHERE b.tenant_id = l.tenant_id AND b.lot_id = l.lot_id), DATE '2000-01-01'),
    COALESCE((SELECT MAX(s.ship_date) FROM noblesse_shipment_items si
                JOIN noblesse_shipments s ON s.shipment_id = si.shipment_id
               WHERE s.tenant_id = l.tenant_id AND si.lot_id = l.lot_id
                 AND s.status = 'shipped'), DATE '2000-01-01'),
    COALESCE((SELECT MAX(r.processing_date) FROM noblesse_processing_reports r
               WHERE r.tenant_id = l.tenant_id AND r.lot_id = l.lot_id
                 AND r.status = 'accepted'), DATE '2000-01-01'))`;

// Everything waiting on somebody, as one uniform list.
//
// `scope` separates the two kinds mixed in here: 'standing' is true right now
// regardless of the range, 'range' happened inside it. A page that showed them
// as one undifferentiated list would imply the range caused all of it.
const ATTENTION = `
  SELECT * FROM (
    SELECT 'unregistered'::text AS kind, b.batch_id AS ref_id,
           b.lot_number AS label,
           jsonb_build_object('boxes', ${boxCount("b")}, 'lb', ${boxLb("b")}) AS detail,
           ${pacificDay("b.closed_at")}::text AS since,
           ${ageDays(pacificDay("b.closed_at"))} AS age_days,
           NULL::text AS who, 'standing'::text AS scope
      FROM box_batches b
     WHERE b.tenant_id = $1 AND ${UNREGISTERED_WHERE}

    UNION ALL
    -- Somebody at the bench said this session is wrong. It still counts in
    -- every total until an admin acts, which is why it needs saying here.
    SELECT 'flagged', b.batch_id, b.lot_number,
           jsonb_build_object('boxes', ${boxCount("b")}, 'lb', ${boxLb("b")},
                              'reason', b.flag_reason, 'direction', b.direction),
           ${pacificDay("b.flagged_at")}::text,
           ${ageDays(pacificDay("b.flagged_at"))},
           (SELECT u.username FROM users u WHERE u.id = b.flagged_by), 'standing'
      FROM box_batches b
     WHERE b.tenant_id = $1 AND b.flagged_at IS NOT NULL

    UNION ALL
    -- Submitted off the floor, nobody at reception has accepted it. Nothing
    -- has moved yet: an accepted report is what deducts cases.
    -- outputLb is what the floor wrote down, and is null until they do. It is
    -- NOT stock: an accepted report moves cases, never pounds.
    SELECT 'report_waiting', r.report_id, l.lot_number,
           jsonb_build_object('casesIn', r.input_cases, 'type', r.processing_type,
                              'outputLb', r.output_weight::text,
                              'inedibleLb', r.inedible_weight::text),
           ${pacificDay("r.submitted_at")}::text,
           ${ageDays(pacificDay("r.submitted_at"))},
           r.submitted_by, 'standing'
      FROM noblesse_processing_reports r
      JOIN lots l ON l.lot_id = r.lot_id
     WHERE r.tenant_id = $1 AND r.status = 'submitted'

    UNION ALL
    -- Still open after the day it was weighed: somebody walked away from it.
    SELECT 'session_open', b.batch_id, b.lot_number,
           jsonb_build_object('boxes', ${boxCount("b")}, 'lb', ${boxLb("b")},
                              'direction', b.direction),
           ${weighedDay}::text, ${ageDays(weighedDay)},
           NULL, 'standing'
      FROM box_batches b
     WHERE b.tenant_id = $1 AND b.status = 'open'
       AND ${weighedDay} < ${TODAY}

    UNION ALL
    -- A draft nobody shipped. It has deducted no stock and is holding lots.
    SELECT 'draft_stale', s.shipment_id, s.destination_name,
           jsonb_build_object(
             'lines', (SELECT COUNT(*)::int FROM noblesse_shipment_items si
                        WHERE si.shipment_id = s.shipment_id),
             -- What it is holding. No stock has moved yet; shipping is what
             -- deducts, so this is the weight at stake if it never ships.
             'lb', COALESCE((SELECT SUM(si.weight)::text FROM noblesse_shipment_items si
                              WHERE si.shipment_id = s.shipment_id), '0'),
             'shipDate', s.ship_date::text),
           ${pacificDay("s.created_at")}::text,
           ${ageDays(pacificDay("s.created_at"))},
           NULL, 'standing'
      FROM noblesse_shipments s
     WHERE s.tenant_id = $1 AND s.status = 'draft'
       AND ${ageDays(pacificDay("s.created_at"))} >= ${STALE_DRAFT_DAYS}

    UNION ALL
    -- Weighed in, something weighed out, then nothing for a week. A close-out
    -- candidate — offered to a person, never closed on a computed signal.
    SELECT 'lot_idle', l.lot_id, l.lot_number,
           jsonb_build_object('inLb', y.weighed_in, 'outLb', y.weighed_out,
                              'boxesIn', y.boxes_in, 'boxesOut', y.boxes_out),
           m.last_move::text, ${ageDays("m.last_move")},
           NULL, 'standing'
      FROM lots l
      ${yieldLateralSql("l")}
      CROSS JOIN LATERAL (SELECT ${lastMovement} AS last_move) m
     WHERE l.tenant_id = $1 AND l.status = 'open'
       AND y.weighed_in::numeric > 0 AND y.boxes_out > 0
       AND ${ageDays("m.last_move")} >= ${IDLE_LOT_DAYS}

    UNION ALL
    -- Past its due date and not finished.
    -- originalWeight is the form's own typed figure, which is what the lot was
    -- registered as arriving. Null on a form nobody has filled that far.
    SELECT 'form_overdue', f.id, f.lot_number,
           jsonb_build_object('vendor', f.vendor, 'dueDate', f.due_date::text,
                              'originalWeight', f.original_weight::text),
           f.due_date::text, ${ageDays("f.due_date")},
           f.checked_by, 'standing'
      FROM noblesse_registration_forms f
     WHERE f.tenant_id = $1 AND f.status <> 'completed'
       AND f.due_date IS NOT NULL AND f.due_date < ${TODAY}

    UNION ALL
    -- Shipped without anyone weighing the lot on the way out, so its yield can
    -- never be computed. Bound to the range: every load ever would be noise.
    SELECT 'shipped_unweighed', s.shipment_id, l.lot_number,
           jsonb_build_object('destination', s.destination_name, 'lb', si.weight::text),
           s.ship_date::text, ${ageDays("s.ship_date")},
           NULL, 'range'
      FROM noblesse_shipment_items si
      JOIN noblesse_shipments s ON s.shipment_id = si.shipment_id
      JOIN lots l ON l.lot_id = si.lot_id
     WHERE s.tenant_id = $1 AND s.status = 'shipped'
       AND s.ship_date BETWEEN $2 AND $3
       AND NOT EXISTS (
             SELECT 1 FROM box_batches b
               JOIN batch_items bi ON bi.batch_id = b.batch_id
              WHERE b.tenant_id = s.tenant_id AND b.lot_id = si.lot_id
                AND b.direction = 'outgoing' AND bi.voided_at IS NULL)

    UNION ALL
    -- Corrections are normal; a run of them on one session is not. Grouped by
    -- session so one bad pallet is one row.
    -- The pounds that left the total when these were voided. Rounded per box
    -- and then summed, like every other weight here.
    SELECT 'voided', b.batch_id, b.lot_number,
           jsonb_build_object('boxes', COUNT(*)::int,
                              'lb', COALESCE(SUM(${weightInLb("bi")}), 0)::text),
           MAX(${pacificDay("bi.voided_at")})::text,
           ${ageDays(`MAX(${pacificDay("bi.voided_at")})`)},
           MAX(u.username), 'range'
      FROM batch_items bi
      JOIN box_batches b ON b.batch_id = bi.batch_id
      LEFT JOIN users u ON u.id = bi.voided_by
     WHERE b.tenant_id = $1 AND bi.voided_at IS NOT NULL
       AND ${pacificDay("bi.voided_at")} BETWEEN $2 AND $3
     GROUP BY b.batch_id, b.lot_number
  ) a
   ORDER BY age_days DESC NULLS LAST, kind
   LIMIT ${ATTENTION_LIMIT}`;

module.exports = {
  MAX_SPAN_DAYS,
  STALE_DRAFT_DAYS,
  IDLE_LOT_DAYS,
  ATTENTION_LIMIT,
  UNREGISTERED_WHERE,
  parseRange,
  pacificDay,
  ATTENTION,
  WEIGHING,
  SHIPPED,
  PROCESSED,
  LOTS_ISSUED,
  FORMS,
  BACKDATED,
  LOTS_TOUCHED,
};
