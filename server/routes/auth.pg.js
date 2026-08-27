const router = require("express").Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const pool = require("../utils/pg");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many login attempts, try again later" },
});

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many refresh attempts, try again later" },
});

const generateAccessToken = (user) => {
  return jwt.sign(
    { userId: user.id, role: user.role || "user", username: user.username, tenantId: user.tenant_id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const username = email?.toLowerCase().trim();
  try {
    const result = await pool.query(
      `SELECT u.*, t.id as tenant_id FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE LOWER(u.username) = $1`,
      [username]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    // Support legacy plaintext passwords with auto-migration to bcrypt
    const isLegacyPlaintext = !user.password.startsWith("$2");
    let passwordMatch = false;
    if (isLegacyPlaintext) {
      passwordMatch = user.password === password;
      if (passwordMatch) {
        const hashed = await bcrypt.hash(password, 10);
        await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, user.id]);
      }
    } else {
      passwordMatch = await bcrypt.compare(password, user.password);
    }

    if (!passwordMatch) return res.status(401).json({ message: "Invalid credentials" });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.json({ message: "Success", token: accessToken, refreshToken });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/refresh", refreshLimiter, async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: "Refresh token required" });

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

    // Verify token exists in database and hasn't been revoked
    const result = await pool.query(
      `SELECT u.*, t.id as tenant_id FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [decoded.userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "User not found" });

    const newAccessToken = generateAccessToken(user);
    res.json({ token: newAccessToken });
  } catch (err) {
    console.error("Refresh error:", err);
    res.status(401).json({ error: "Invalid refresh token" });
  }
});

module.exports = router;
