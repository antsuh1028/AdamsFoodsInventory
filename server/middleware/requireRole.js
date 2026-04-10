// requireRole(..."roles") — use after verifyToken
// Example: router.get("/route", verifyToken, requireRole("admin"), handler)
const requireRole = (...allowed) => (req, res, next) => {
  if (!allowed.includes(req.role)) {
    return res.status(403).json({ error: "Access denied." });
  }
  next();
};

module.exports = requireRole;
