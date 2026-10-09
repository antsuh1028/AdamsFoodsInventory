"use strict";

const { pacificToday, PACIFIC_TZ } = require("./lot");

// Runs left on the line past the 2:00 PM cutoff are finished for the manager.
// One with cases goes to reception like Confirm run; one with none cannot be
// sent, so it keeps its place on the line with the finish stamped and a flag.
// Each run is finished once: auto_finished_at stops it being touched again.

const CUTOFF = "14:00";
const EVERY_MS = 5 * 60 * 1000;

const CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** "HH:MM" on the Pacific wall clock, from the parts so no locale layout leaks in. */
const pacificClock = (now = new Date()) => {
  const parts = CLOCK.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("hour")}:${get("minute")}`;
};

// Due: from an earlier day, or today once past the cutoff for a run that began before it.
// A run that started after 2:00 is left alone that day. $1 today, $2 the clock now, $3 cutoff.
const DUE = `
  status = 'in_progress' AND auto_finished_at IS NULL
  AND (
    COALESCE(processing_date, (submitted_at AT TIME ZONE '${PACIFIC_TZ}')::date) < $1::date
    OR (COALESCE(processing_date, (submitted_at AT TIME ZONE '${PACIFIC_TZ}')::date) = $1::date
        AND $2 >= $3 AND (start_time IS NULL OR start_time < $3))
  )`;

// The finish time: what the manager typed, else the cutoff, else the start if it began later.
const END = `COALESCE(end_time, CASE WHEN start_time > $3 THEN start_time ELSE $3 END)`;

/** Finishes every due run. Returns { sent, flagged }: report ids moved to reception, and left for cases. */
const autoFinishRuns = async (db, now = new Date()) => {
  const params = [pacificToday(now), pacificClock(now), CUTOFF];
  const sent = await db.query(
    `UPDATE noblesse_processing_reports
        SET status = 'submitted', end_time = ${END}, auto_finished_at = now()
      WHERE ${DUE} AND input_cases > 0
      RETURNING report_id`, params);
  const flagged = await db.query(
    `UPDATE noblesse_processing_reports
        SET end_time = ${END}, auto_finished_at = now()
      WHERE ${DUE} AND COALESCE(input_cases, 0) = 0
      RETURNING report_id`, params);
  return { sent: sent.rows.map((r) => r.report_id), flagged: flagged.rows.map((r) => r.report_id) };
};

/** Runs it now and every few minutes. A failure is logged and tried again next time. */
const startAutoFinish = (db) => {
  const tick = async () => {
    try {
      const { sent, flagged } = await autoFinishRuns(db);
      if (sent.length || flagged.length) {
        console.log(`[auto-finish] sent to reception: ${sent.join(", ") || "none"}; needs cases: ${flagged.join(", ") || "none"}`);
      }
    } catch (err) {
      console.error("[auto-finish] failed:", err.message);
    }
  };
  tick();
  return setInterval(tick, EVERY_MS);
};

module.exports = { autoFinishRuns, startAutoFinish, pacificClock, CUTOFF };
