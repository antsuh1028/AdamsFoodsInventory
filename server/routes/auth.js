const router = require("express").Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const UserModel = require("../models/User");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many login attempts, try again later" },
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await UserModel.findOne({ username: email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    // Support legacy plaintext passwords with auto-migration to bcrypt
    const isLegacyPlaintext = !user.password.startsWith("$2");
    let passwordMatch = false;
    if (isLegacyPlaintext) {
      passwordMatch = user.password === password;
      if (passwordMatch) {
        const hashed = await bcrypt.hash(password, 10);
        await UserModel.updateOne({ _id: user._id }, { password: hashed });
      }
    } else {
      passwordMatch = await bcrypt.compare(password, user.password);
    }

    if (!passwordMatch) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "8h" });
    res.json({ message: "Success", token });
  } catch {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    await UserModel.create({ username: email, password: hashed });
    res.json({ message: "User created successfully" });
  } catch {
    res.status(500).json({ error: "Error creating user" });
  }
});

module.exports = router;
