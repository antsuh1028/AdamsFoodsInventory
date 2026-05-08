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

    const token = jwt.sign(
      { userId: user.id, role: user.role || "user", username: user.username, tenantId: user.tenant_id },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({ message: "Success", token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
