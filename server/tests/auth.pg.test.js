process.env.JWT_SECRET = "test-secret";

const request = require("supertest");
const express = require("express");
const jwt     = require("jsonwebtoken");

jest.mock("express-rate-limit", () => () => (_req, _res, next) => next());
jest.mock("../utils/pg",  () => ({ query: jest.fn() }));
jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash:    jest.fn().mockResolvedValue("$2b$10$newhash"),
}));

const pool   = require("../utils/pg");
const bcrypt = require("bcrypt");

const TENANT_ID = "23a57670-bc2d-487a-bab8-d05cf10acbc8";
const USER_ID   = "550e8400-e29b-41d4-a716-446655440001";

const mockUser = {
  id:        USER_ID,
  tenant_id: TENANT_ID,
  username:  "testuser",
  password:  "$2b$10$hashedpassword",
  role:      "admin",
};

const app = express();
app.use(express.json());
app.use("/", require("../routes/auth.pg"));

beforeEach(() => {
  jest.resetAllMocks();
  pool.query.mockResolvedValue({ rows: [] });
});

// ── POST /login ───────────────────────────────────────────────────────────────

describe("POST /login", () => {
  it("returns JWT token on valid credentials", async () => {
    pool.query.mockResolvedValueOnce({ rows: [mockUser] });
    bcrypt.compare.mockResolvedValueOnce(true);
    const res = await request(app)
      .post("/login")
      .send({ email: "testuser", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    const decoded = jwt.verify(res.body.token, "test-secret");
    expect(decoded.role).toBe("admin");
    expect(decoded.tenantId).toBe(TENANT_ID);
  });

  it("returns 401 on wrong password", async () => {
    pool.query.mockResolvedValueOnce({ rows: [mockUser] });
    bcrypt.compare.mockResolvedValueOnce(false);
    const res = await request(app)
      .post("/login")
      .send({ email: "testuser", password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it("returns 401 for unknown user", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/login")
      .send({ email: "nobody@example.com", password: "password" });
    expect(res.status).toBe(401);
  });

  it("is case-insensitive — UPPERCASE username finds user", async () => {
    pool.query.mockResolvedValueOnce({ rows: [mockUser] });
    bcrypt.compare.mockResolvedValueOnce(true);
    const res = await request(app)
      .post("/login")
      .send({ email: "TESTUSER", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    // Verify DB was queried with lowercased username
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ["testuser"]
    );
  });

  it("is case-insensitive — mixed case email username finds user", async () => {
    pool.query.mockResolvedValueOnce({ rows: [mockUser] });
    bcrypt.compare.mockResolvedValueOnce(true);
    const res = await request(app)
      .post("/login")
      .send({ email: "Nara@AdamsFoods.us", password: "password123" });
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ["nara@adamsfoods.us"]
    );
  });

  it("auto-migrates plaintext password to bcrypt on successful login", async () => {
    const legacyUser = { ...mockUser, password: "plaintext123" };
    pool.query
      .mockResolvedValueOnce({ rows: [legacyUser] }) // SELECT user
      .mockResolvedValueOnce({ rows: [] });           // UPDATE password (bcrypt migration)
    const res = await request(app)
      .post("/login")
      .send({ email: "testuser", password: "plaintext123" });
    expect(res.status).toBe(200);
    expect(bcrypt.hash).toHaveBeenCalledWith("plaintext123", 10);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("returns 401 for wrong plaintext password (no migration)", async () => {
    const legacyUser = { ...mockUser, password: "plaintext123" };
    pool.query.mockResolvedValueOnce({ rows: [legacyUser] });
    const res = await request(app)
      .post("/login")
      .send({ email: "testuser", password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });
});
