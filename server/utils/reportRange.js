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

module.exports = {
  MAX_SPAN_DAYS,
  parseRange,
  pacificDay,
  WEIGHING,
  SHIPPED,
  PROCESSED,
  LOTS_ISSUED,
  FORMS,
  BACKDATED,
  LOTS_TOUCHED,
};
