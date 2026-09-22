// When a session's boxes were WEIGHED: the date someone set after the fact,
// else when the session was opened. Every "when was this weighed" reads this,
// so the lot's clock, its timeline and the manifest order cannot disagree.
//
// A date alone is placed at noon Pacific: far enough from midnight that no
// timezone a reader formats it in can move it onto a neighbouring day.
// `fallback` is what "when" means for a session with no date set.
const weighedAtSql = (a, fallback = `${a}.created_at`) =>
  `COALESCE((${a}.weighed_on + time '12:00') AT TIME ZONE 'America/Los_Angeles', ${fallback})`;

module.exports = { weighedAtSql };
