// What a role is allowed to reach at all, by path.
//
// requireRole gates one route at a time, which works when a role is defined by
// the few extra things it may do. "outgoing" is the opposite: it is defined by
// the one tab it may use, so listing it route by route means every route added
// later is open to it by default until somebody remembers otherwise.
//
// So this is an ALLOW-list, checked in one place and failing closed. Hiding the
// other tabs in the client is presentation; this is the control (CLAUDE.md §8).
//
// A role absent from SCOPES is unscoped here and keeps whatever requireRole
// gates it already passes — this narrows, it never widens.

// [pattern, methods] — methods null means every method.
const OUTGOING = [
  // The tab itself: loads, their lines, their tied sessions, shipping.
  [/^\/shipments(\/|$)/, null],
  // Weighing boxes into a load, and reading back the sessions.
  [/^\/box-batches(\/|$)/, null],
  // Lots are read, never issued here — a lot is minted at Incoming and only
  // referenced afterwards, so POST /lots stays out of reach.
  [/^\/lots\/[^/]+\/close$/, ["POST"]],
  [/^\/lots\/resolve$/, ["POST"]],
  [/^\/lots(\/|$)/, ["GET"]],
];

const SCOPES = { outgoing: OUTGOING };

const roleScope = (req, res, next) => {
  const allowed = SCOPES[req.role];
  if (!allowed) return next();

  // originalUrl rather than req.path: every router here mounts at "/", but a
  // path relative to a mount point would silently match the wrong rule if one
  // ever did not.
  const path = String(req.originalUrl || "").split("?")[0];
  const method = String(req.method || "").toUpperCase();

  const ok = allowed.some(([pattern, methods]) =>
    pattern.test(path) && (!methods || methods.includes(method)));

  if (!ok) return res.status(403).json({ error: "Access denied." });
  next();
};

module.exports = roleScope;
module.exports.SCOPES = SCOPES;
