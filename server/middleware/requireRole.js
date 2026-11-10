// requireRole(..."roles") — use after verifyToken
// Example: router.get("/route", verifyToken, requireRole("admin"), handler)
const { MASTER } = require("./roles");

// Master is above every role, so it passes every gate.
const requireRole = (...allowed) => (req, res, next) => {
  if (req.role !== MASTER && !allowed.includes(req.role)) {
    return res.status(403).json({ error: "Access denied." });
  }
  next();
};

module.exports = requireRole;
