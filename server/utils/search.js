// One search box on every Noblesse tab: a case-insensitive "contains" across
// the columns a row shows, run in the database so it reaches rows past a
// list's page cap rather than only the ones already on screen.

// Long enough for any lot, product or customer; short enough that a pasted
// essay cannot turn into a scan with a pathological pattern.
const MAX_QUERY = 100;

// The bound ILIKE pattern, or null when there is nothing to search for — so a
// blank box lists exactly as it did before search existed. LIKE's own
// wildcards are escaped, so a typed % or _ is looked for rather than matching
// everything.
const searchTerm = (raw) => {
  if (raw == null || typeof raw === "object") return null;
  const s = String(raw).trim().slice(0, MAX_QUERY);
  if (!s) return null;
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
};

// "(a ILIKE $n OR b ILIKE $n …)" against ONE bound parameter. Column names are
// written by the route, never taken from the request.
const searchClause = (columns, index) =>
  `(${columns.map((c) => `${c} ILIKE $${index}`).join(" OR ")})`;

module.exports = { searchTerm, searchClause, MAX_QUERY };
