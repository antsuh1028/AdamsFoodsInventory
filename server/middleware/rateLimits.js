const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = rateLimit;

// Every limit in one place. A whole building shares one address, so anything a
// signed-in person does is counted against that person, not the building.

const ipKey = (req) => `ip:${ipKeyGenerator(req.ip)}`;

// The signed-in user if the token verifies; a forged one gets no fresh budget.
const userOrIp = (req) => {
  const token = req.headers.authorization;
  if (token) {
    try {
      const { userId } = jwt.verify(token, process.env.JWT_SECRET);
      if (userId) return `user:${userId}`;
    } catch { /* expired or forged: fall back to the address */ }
  }
  return ipKey(req);
};

// About five a second, sustained: far past a person, well short of a loop.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: userOrIp,
  skip: (req) =>
    req.path === "/login" ||
    req.path === "/refresh" ||
    req.path.startsWith("/box-batches") ||
    req.path.startsWith("/manifest-groups"),
  message: { error: "Too many requests, please try again later" },
});

// A scanning session flushes every few seconds; it gets its own, higher budget.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  keyGenerator: userOrIp,
  message: { error: "Too many scan requests, slow down" },
});

// Failed attempts only, per account per address, so one typo cannot lock out a colleague.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKey(req)}:${String(req.body?.email || "").toLowerCase().trim()}`,
  message: { error: "Too many login attempts, try again later" },
});

// The ceiling on guessing across many accounts from one address.
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
  keyGenerator: ipKey,
  message: { error: "Too many login attempts, try again later" },
});

// An expired access token is why refresh is called, so this keys on the address.
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: ipKey,
  message: { error: "Too many refresh attempts, try again later" },
});

module.exports = {
  generalLimiter, scanLimiter, loginLimiter, loginIpLimiter, refreshLimiter, userOrIp,
};
