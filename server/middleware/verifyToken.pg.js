const jwt = require("jsonwebtoken");

// Same as verifyToken.js but also extracts tenantId from the JWT payload
const verifyToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(403).json({ message: "No token provided" });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid or expired token" });
    if (!decoded.tenantId) return res.status(401).json({ message: "Token missing tenant — please log in again" });
    req.userId   = decoded.userId;
    req.role     = decoded.role     || "user";
    req.username = decoded.username || "";
    req.tenantId = decoded.tenantId;
    next();
  });
};

module.exports = verifyToken;
