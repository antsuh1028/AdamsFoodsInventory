// When a session's boxes were WEIGHED: the date someone set after the fact,
// else when the session was opened. Every "when was this weighed" reads this,
// so the lot's clock, its timeline and the manifest order cannot disagree.
//
// A date alone is placed at noon Pacific: far enough from midnight that no
// timezone a reader formats it in can move it onto a neighbouring day.
// `fallback` is what "when" means for a session with no date set.
const { pacificToday } = require("./lot");

const weighedAtSql = (a, fallback = `${a}.created_at`) =>
  `COALESCE((${a}.weighed_on + time '12:00') AT TIME ZONE 'America/Los_Angeles', ${fallback})`;

// A real calendar day, YYYY-MM-DD. Separate from parseWeighedOn because a
// report range needs this test WITHOUT the no-future rule — a month-to-date
// range ends on a day that has not happened yet.
const isCalendarDay = (raw) => {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  // Round-trips only for a real day, so 2026-02-30 is refused. 2026-13-45 is
  // no Date at all, and toISOString would throw on it.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
};

// One definition of an acceptable weighed-on date, for the heading editor and
// the tally import alike. Returns { ok: true, value } — value null meaning "the
// day the session was opened" — or { ok: false, error }.
const parseWeighedOn = (raw) => {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  const s = typeof raw === "string" ? raw.trim() : raw;
  if (!isCalendarDay(s)) {
    return { ok: false, error: "weighedOn must be a date, YYYY-MM-DD." };
  }
  if (s > pacificToday()) {
    return { ok: false, error: "The boxes cannot have been weighed in the future." };
  }
  if (s < "2000-01-01") return { ok: false, error: "That date is too far back to be right." };
  return { ok: true, value: s };
};

// The date printed on a tally sheet, as a plain day. The parser hands back
// "2026-09-15" for a real date cell, but a cell typed as text arrives however
// someone wrote it. Anything unrecognised is null — the sheet still imports.
const parseSheetDay = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // 9/15/2026, 09-15-26 — US order, which is how these sheets are written.
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (!us) return null;
  const [, m, d, y] = us;
  const year = y.length === 2 ? `20${y}` : y;
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(m)}-${pad(d)}`;
};

module.exports = { weighedAtSql, isCalendarDay, parseWeighedOn, parseSheetDay };
