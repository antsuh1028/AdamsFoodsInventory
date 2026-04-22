const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

// ── Env ───────────────────────────────────────────────────────────────────────
process.env.JWT_SECRET = "test-secret";
process.env.AWS_BUCKET_NAME = "test-bucket";
process.env.AWS_REGION = "us-east-1";
process.env.OPENAI_API_KEY = "test-key";

const TENANT_ID = "23a57670-bc2d-487a-bab8-d05cf10acbc8";
const ITEM_ID   = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID   = "550e8400-e29b-41d4-a716-446655440001";

// ── Token helpers ─────────────────────────────────────────────────────────────
const makeToken = (role = "admin", username = "testuser") =>
  jwt.sign({ userId: USER_ID, role, username, tenantId: TENANT_ID }, process.env.JWT_SECRET, { expiresIn: "1h" });

const adminToken   = makeToken("admin",   "admin@af.com");
const managerToken = makeToken("manager", "manager@af.com");
const userToken    = makeToken("user",    "user@af.com");

// ── Mock data ─────────────────────────────────────────────────────────────────
const pgMockItem = {
  id:            ITEM_ID,
  tenant_id:     TENANT_ID,
  location:      "A101",
  lot:           "12345-01",
  vendor:        "Test Vendor",
  brand:         "Test Brand",
  species:       "Beef",
  description:   "Test Description",
  grade:         "Choice",
  quantity:      "10",
  weight:        500.00,
  packdate:      "2024-01-01",
  date_recvd:    "2024-01-02",
  est:           "EST123",
  price:         5.00,
  type:          "raw",
  scan_image_key: null,
  source_id:     null,
  boxes:         [{ weight: "50" }, { weight: "60" }],
};

// Alias — all items now carry boxes JSONB inline
const pgMockItemWithBoxes = pgMockItem;

// ── Mock pg pool ──────────────────────────────────────────────────────────────
const mockClient = {
  query:   jest.fn(),
  release: jest.fn(),
};

jest.mock("../utils/pg", () => ({
  query:   jest.fn(),
  connect: jest.fn(),
}));

const pool = require("../utils/pg");

// SQL-aware query handler — inspects the statement and returns sensible defaults.
// Pass `overrides` as { "sql_substring": { rows, rowCount } } to customise per-test.
const makeQueryHandler = (overrides = {}) => (sql = "") => {
  for (const [key, val] of Object.entries(overrides)) {
    if (sql.includes(key)) return Promise.resolve(val);
  }
  const s = sql.toLowerCase().trim();
  if (/^(begin|commit|rollback)/.test(s))           return Promise.resolve({ rows: [] });
  if (s.startsWith("insert into inventory"))         return Promise.resolve({ rows: [pgMockItem], rowCount: 1 });
  if (s.startsWith("update inventory"))              return Promise.resolve({ rows: [pgMockItem], rowCount: 1 });
  if (s.startsWith("delete from inventory"))         return Promise.resolve({ rows: [pgMockItem], rowCount: 1 });
  if (s.includes("into history"))                   return Promise.resolve({ rows: [], rowCount: 1 });
  if (s.includes("count(*)"))                       return Promise.resolve({ rows: [{ count: "0" }] });
  if (s.includes("select") && s.includes("from inventory"))
    return Promise.resolve({ rows: [pgMockItem], rowCount: 1 });
  return Promise.resolve({ rows: [], rowCount: 0 });
};

// Pool-level query handler (used for non-transactional queries)
const makePoolHandler = (overrides = {}) => (sql = "") => {
  for (const [key, val] of Object.entries(overrides)) {
    if (sql.includes(key)) return Promise.resolve(val);
  }
  const s = sql.toLowerCase().trim();
  if (s.includes("count(*)"))                       return Promise.resolve({ rows: [{ count: "0" }] });
  if (s.includes("select") && s.includes("from inventory"))
    return Promise.resolve({ rows: [pgMockItem] });
  if (s.includes("from history"))                   return Promise.resolve({ rows: [] });
  return Promise.resolve({ rows: [], rowCount: 0 });
};

// ── Mock AWS ──────────────────────────────────────────────────────────────────
jest.mock("../utils/aws", () => ({
  s3Client:       { send: jest.fn().mockResolvedValue({}) },
  textractClient: { send: jest.fn() },
  upload: {
    single: () => (req, _res, next) => {
      req.file = { buffer: Buffer.from("fake"), mimetype: "image/jpeg", originalname: "test.jpg" };
      next();
    },
  },
}));

jest.mock("@aws-sdk/client-s3",           () => ({ PutObjectCommand: jest.fn(), GetObjectCommand: jest.fn(), DeleteObjectCommand: jest.fn() }));
jest.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: jest.fn().mockResolvedValue("https://signed.example.com/test.jpg") }));
jest.mock("@aws-sdk/client-textract",      () => ({ DetectDocumentTextCommand: jest.fn() }));
const mockCreate = jest.fn();
jest.mock("openai", () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } },
})));
jest.mock("heic-convert", () => jest.fn().mockResolvedValue(Buffer.from("converted")));

// ── Build test app ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use("/", require("../routes/auth.pg"));
app.use("/", require("../routes/inventory.pg"));
app.use("/", require("../routes/history.pg"));
app.use("/", require("../routes/s3"));
app.use("/", require("../routes/scanner.pg"));

// ─────────────────────────────────────────────────────────────────────────────
// Shared beforeEach
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(mockClient);
  mockClient.query.mockImplementation(makeQueryHandler());
  mockClient.release.mockReturnValue(undefined);
  pool.query.mockImplementation(makePoolHandler());
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /login", () => {
  it("returns 401 for unknown user", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/login").send({ email: "x@x.com", password: "pass" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong password", async () => {
    const bcrypt = require("bcrypt");
    const hashed = await bcrypt.hash("correct", 10);
    pool.query.mockResolvedValueOnce({ rows: [{ id: USER_ID, username: "x@x.com", password: hashed, role: "admin", tenant_id: TENANT_ID }] });
    const res = await request(app).post("/login").send({ email: "x@x.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns token on valid login", async () => {
    const bcrypt = require("bcrypt");
    const hashed = await bcrypt.hash("pass", 10);
    pool.query.mockResolvedValueOnce({ rows: [{ id: USER_ID, username: "x@x.com", password: hashed, role: "admin", tenant_id: TENANT_ID }] });
    const res = await request(app).post("/login").send({ email: "x@x.com", password: "pass" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it("token payload includes tenantId", async () => {
    const bcrypt = require("bcrypt");
    const hashed = await bcrypt.hash("pass", 10);
    pool.query.mockResolvedValueOnce({ rows: [{ id: USER_ID, username: "x@x.com", password: hashed, role: "admin", tenant_id: TENANT_ID }] });
    const res = await request(app).post("/login").send({ email: "x@x.com", password: "pass" });
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.tenantId).toBe(TENANT_ID);
  });

  it("migrates legacy plaintext password to bcrypt on successful login", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, username: "x@x.com", password: "plaintext", role: "user", tenant_id: TENANT_ID }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE SET password
    const res = await request(app).post("/login").send({ email: "x@x.com", password: "plaintext" });
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE users SET password"), expect.any(Array));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────
describe("Auth middleware", () => {
  it("returns 403 when no token provided", async () => {
    const res = await request(app).post("/inventoryFind").send({ inputs: {} });
    expect(res.status).toBe(403);
  });

  it("returns 401 for invalid token", async () => {
    const res = await request(app).post("/inventoryFind").set("Authorization", "bad.token.here").send({ inputs: {} });
    expect(res.status).toBe(401);
  });

  it("returns 403 for user role on admin-only route", async () => {
    const res = await request(app).get("/inventoryAll").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });

  it("returns 403 for manager role on admin-only route", async () => {
    const res = await request(app).get("/inventoryAll").set("Authorization", managerToken);
    expect(res.status).toBe(403);
  });

  it("returns 403 for user role on history route", async () => {
    const res = await request(app).get("/getHistory").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });

  it("allows manager on history route", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...pgMockItem, _id: ITEM_ID }] });
    const res = await request(app).get("/getHistory").set("Authorization", managerToken);
    expect(res.status).toBe(200);
  });

  it("token without tenantId is rejected with 401", async () => {
    const tokenNoTenant = jwt.sign({ userId: USER_ID, role: "user" }, process.env.JWT_SECRET);
    const res = await request(app).post("/inventoryFind").set("Authorization", tokenNoTenant).send({ inputs: {} });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY ADD
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryAdd", () => {
  const validInputs = {
    location: "A101", lot: "12345-01", species: "Beef",
    vendor: "V", brand: "B", description: "Desc", grade: "Choice",
    quantity: "10", weight: "500", type: "raw",
  };

  it("returns 400 if location is missing", async () => {
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: { ...validInputs, location: "" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 if location does not exist", async () => {
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: { ...validInputs, location: "ZZZZZ" } });
    expect(res.status).toBe(400);
  });

  it("returns 409 if location occupied and not forced", async () => {
    // count query returns 1 (occupied)
    mockClient.query.mockImplementation(makeQueryHandler({ "SELECT COUNT(*)": { rows: [{ count: "1" }] } }));
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs, force: false });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LOCATION_OCCUPIED");
  });

  it("creates item successfully when forced", async () => {
    mockClient.query.mockImplementation(makeQueryHandler({ "SELECT COUNT(*)": { rows: [{ count: "1" }] } }));
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs, force: true });
    expect(res.status).toBe(201);
    expect(res.body._id).toBeDefined();
  });

  it("creates item when location is empty", async () => {
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs, force: false });
    expect(res.status).toBe(201);
  });

  it("logs 'Scanner Add' when source is scanner", async () => {
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs, source: "scanner" });
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.includes("Scanner Add"))).toBe(true);
  });

  it("logs 'Added' when source is not scanner", async () => {
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs });
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.includes("Added"))).toBe(true);
  });

  it("stores boxes as JSONB in the INSERT when provided", async () => {
    const inputs = { ...validInputs, boxes: [{ weight: "50" }, { weight: "60" }] };
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs, force: true });
    const inventoryInserts = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("insert into inventory"));
    // boxes are passed as a JSON string parameter, not separate inserts
    expect(inventoryInserts.length).toBeGreaterThanOrEqual(1);
    const params = inventoryInserts[0][1];
    const boxesParam = params.find((p) => typeof p === "string" && p.startsWith("["));
    expect(boxesParam).toBeDefined();
    expect(JSON.parse(boxesParam)).toHaveLength(2);
  });

  it("rolls back and returns 500 on DB error", async () => {
    mockClient.query.mockImplementation((sql) => {
      if (sql.toLowerCase().includes("insert into inventory")) return Promise.reject(new Error("DB error"));
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs, force: true });
    expect(res.status).toBe(500);
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY FIND
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryFind", () => {
  it("returns items when found", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgMockItem] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "A101" } });
    expect(res.status).toBe(200);
    expect(res.body[0]._id).toBe(ITEM_ID);
    expect(Array.isArray(res.body[0].boxes)).toBe(true);
  });

  it("returns 'INVALID' text when no results", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "A999" } });
    expect(res.status).toBe(200);
    expect(res.text).toBe("INVALID");
  });

  it("builds query with all supported fields", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgMockItemWithBoxes] });
    await request(app).post("/inventoryFind").set("Authorization", userToken).send({
      inputs: { location: "A101", lot: "12345-01", vendor: "V", brand: "B", species: "Beef", description: "D", grade: "Choice" },
    });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("WHERE");
    expect(params).toContain(TENANT_ID);
    expect(params).toContain("A101");
  });

  it("returns 500 on DB error", async () => {
    pool.query.mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: {} });
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY UPDATE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryUpdate", () => {
  it("returns 400 if location missing", async () => {
    const res = await request(app).post("/inventoryUpdate").set("Authorization", userToken)
      .send({ updateInputs: { currentItem: { _id: ITEM_ID } } });
    expect(res.status).toBe(400);
  });

  it("returns 400 if item ID missing", async () => {
    const res = await request(app).post("/inventoryUpdate").set("Authorization", userToken)
      .send({ updateInputs: { location: "A101" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 if item not found", async () => {
    mockClient.query.mockImplementation(makeQueryHandler({ "UPDATE inventory": { rows: [], rowCount: 0 } }));
    const res = await request(app).post("/inventoryUpdate").set("Authorization", userToken)
      .send({ updateInputs: { location: "A101", currentItem: { _id: ITEM_ID } } });
    expect(res.status).toBe(404);
  });

  it("updates successfully and logs history", async () => {
    const res = await request(app).post("/inventoryUpdate").set("Authorization", userToken)
      .send({ updateInputs: { location: "A101", lot: "12345-01", currentItem: { _id: ITEM_ID } } });
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(ITEM_ID);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.includes("Updated"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY REMOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryRemove", () => {
  it("returns 400 if no ID", async () => {
    const res = await request(app).post("/inventoryRemove").set("Authorization", userToken)
      .send({ currentItem: {} });
    expect(res.status).toBe(400);
  });

  it("returns 404 if item not found", async () => {
    mockClient.query.mockImplementation(makeQueryHandler({ "DELETE FROM inventory": { rows: [], rowCount: 0 } }));
    const res = await request(app).post("/inventoryRemove").set("Authorization", userToken)
      .send({ currentItem: { _id: ITEM_ID } });
    expect(res.status).toBe(404);
  });

  it("removes item and logs history", async () => {
    const res = await request(app).post("/inventoryRemove").set("Authorization", userToken)
      .send({ currentItem: { _id: ITEM_ID } });
    expect(res.status).toBe(200);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.includes("Removed"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY MOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryMove", () => {
  it("returns 400 if missing params", async () => {
    const res = await request(app).post("/inventoryMove").set("Authorization", userToken)
      .send({ itemId: ITEM_ID });
    expect(res.status).toBe(400);
  });

  it("returns 404 if item not found", async () => {
    mockClient.query.mockImplementation(makeQueryHandler({ "SELECT * FROM inventory": { rows: [], rowCount: 0 } }));
    const res = await request(app).post("/inventoryMove").set("Authorization", userToken)
      .send({ itemId: ITEM_ID, destLocation: "B101" });
    expect(res.status).toBe(404);
  });

  it("moves item and logs from→to in history", async () => {
    const res = await request(app).post("/inventoryMove").set("Authorization", userToken)
      .send({ itemId: ITEM_ID, destLocation: "B101" });
    expect(res.status).toBe(200);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.some((p) => typeof p === "string" && p.includes("→")))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BULK REMOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryBulkRemove", () => {
  it("returns 400 if no IDs", async () => {
    const res = await request(app).post("/inventoryBulkRemove").set("Authorization", userToken)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("removes items and logs one history entry per item", async () => {
    mockClient.query.mockImplementation((sql) => {
      const s = sql.toLowerCase().trim();
      if (/^(begin|commit|rollback)/.test(s)) return Promise.resolve({ rows: [] });
      if (s.includes("select * from inventory")) return Promise.resolve({ rows: [pgMockItem, { ...pgMockItem, id: "id2" }] });
      if (s.includes("delete from inventory"))   return Promise.resolve({ rows: [], rowCount: 2 });
      if (s.includes("into history"))            return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await request(app).post("/inventoryBulkRemove").set("Authorization", userToken)
      .send({ ids: [ITEM_ID, "id2"] });
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(2);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls).toHaveLength(2);
    expect(historyCalls.every(([, params]) => params.includes("Bulk Removed"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH FIELD
// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /inventory/:id/field", () => {
  it("returns 400 for invalid field", async () => {
    const res = await request(app).patch(`/inventory/${ITEM_ID}/field`).set("Authorization", userToken)
      .send({ field: "boxes", value: "x" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing field", async () => {
    const res = await request(app).patch(`/inventory/${ITEM_ID}/field`).set("Authorization", userToken)
      .send({ value: "x" });
    expect(res.status).toBe(400);
  });

  it("returns 404 if item not found", async () => {
    mockClient.query.mockImplementation(makeQueryHandler({ "UPDATE inventory SET": { rows: [], rowCount: 0 } }));
    const res = await request(app).patch(`/inventory/${ITEM_ID}/field`).set("Authorization", userToken)
      .send({ field: "lot", value: "99999-01" });
    expect(res.status).toBe(404);
  });

  it("updates editable field and logs history", async () => {
    const res = await request(app).patch(`/inventory/${ITEM_ID}/field`).set("Authorization", userToken)
      .send({ field: "lot", value: "99999-01" });
    expect(res.status).toBe(200);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.some((p) => typeof p === "string" && p.includes('Field Updated: lot')))).toBe(true);
  });

  it("accepts all editable fields", async () => {
    const fields = ["lot", "vendor", "brand", "species", "description", "grade", "packdate", "date_recvd", "est", "price", "type"];
    for (const field of fields) {
      jest.clearAllMocks();
      pool.connect.mockResolvedValue(mockClient);
      mockClient.query.mockImplementation(makeQueryHandler());
      mockClient.release.mockReturnValue(undefined);
      pool.query.mockImplementation(makePoolHandler());
      const res = await request(app).patch(`/inventory/${ITEM_ID}/field`).set("Authorization", userToken)
        .send({ field, value: "testval" });
      expect(res.status).toBe(200);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOX ADD / REMOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /inventory/:id/box", () => {
  it("add — returns 400 if weight missing", async () => {
    const res = await request(app).patch(`/inventory/${ITEM_ID}/box/add`).set("Authorization", userToken).send({});
    expect(res.status).toBe(400);
  });

  it("add — inserts box, updates weight/quantity, logs history", async () => {
    // JSONB flow: SELECT item (with existing boxes) → UPDATE boxes JSONB → log history
    mockClient.query.mockImplementation((sql) => {
      const s = sql.toLowerCase().trim();
      if (/^(begin|commit|rollback)/.test(s)) return Promise.resolve({ rows: [] });
      if (s.includes("select * from inventory")) return Promise.resolve({ rows: [pgMockItem], rowCount: 1 });
      if (s.includes("update inventory"))        return Promise.resolve({ rows: [pgMockItem], rowCount: 1 });
      if (s.includes("into history"))            return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).patch(`/inventory/${ITEM_ID}/box/add`).set("Authorization", userToken)
      .send({ weight: "55.5" });
    expect(res.status).toBe(200);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.some((p) => typeof p === "string" && p.includes("Box Added")))).toBe(true);
  });

  it("remove — returns 400 if index missing", async () => {
    const res = await request(app).patch(`/inventory/${ITEM_ID}/box/remove`).set("Authorization", userToken).send({});
    expect(res.status).toBe(400);
  });

  it("remove — returns 400 for out-of-range index", async () => {
    const res = await request(app).patch(`/inventory/${ITEM_ID}/box/remove`).set("Authorization", userToken)
      .send({ index: 99 });
    expect(res.status).toBe(400);
  });

  it("remove — removes box, recalculates weight, logs history", async () => {
    const res = await request(app).patch(`/inventory/${ITEM_ID}/box/remove`).set("Authorization", userToken)
      .send({ index: 0 });
    expect(res.status).toBe(200);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.some((p) => typeof p === "string" && p.includes("Box Removed")))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ORDER PARTIAL REMOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryOrderRemove", () => {
  it("returns 400 if no removals", async () => {
    const res = await request(app).post("/inventoryOrderRemove").set("Authorization", userToken)
      .send({ removals: [] });
    expect(res.status).toBe(400);
  });

  it("marks item as not_found if missing", async () => {
    mockClient.query.mockImplementation(makeQueryHandler({ "SELECT * FROM inventory": { rows: [], rowCount: 0 } }));
    const res = await request(app).post("/inventoryOrderRemove").set("Authorization", userToken)
      .send({ removals: [{ id: "missing", quantityToRemove: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("not_found");
  });

  it("deletes item when all boxes removed", async () => {
    // Item has exactly 1 box; removing 1 → delete entire item
    const singleBoxItem = { ...pgMockItem, boxes: [{ weight: "50" }], quantity: "1" };
    mockClient.query.mockImplementation((sql) => {
      const s = sql.toLowerCase().trim();
      if (/^(begin|commit|rollback)/.test(s)) return Promise.resolve({ rows: [] });
      if (s.includes("select * from inventory")) return Promise.resolve({ rows: [singleBoxItem] });
      if (s.includes("into history"))            return Promise.resolve({ rows: [] });
      if (s.includes("delete from inventory"))   return Promise.resolve({ rows: [], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await request(app).post("/inventoryOrderRemove").set("Authorization", userToken)
      .send({ removals: [{ id: ITEM_ID, quantityToRemove: 1 }] });
    expect(res.body.results[0].status).toBe("deleted");
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.some((p) => typeof p === "string" && p.includes("item deleted")))).toBe(true);
  });

  it("updates item when boxes remain", async () => {
    // pgMockItem has 2 boxes; removing 1 leaves 1
    const res = await request(app).post("/inventoryOrderRemove").set("Authorization", userToken)
      .send({ removals: [{ id: ITEM_ID, quantityToRemove: 1 }] });
    expect(res.body.results[0].status).toBe("updated");
    expect(res.body.results[0].remaining).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY LOCATION
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /verifyLocation", () => {
  it("returns OK for a valid location", async () => {
    const res = await request(app).post("/verifyLocation").set("Authorization", userToken)
      .send({ location: "A101" });
    expect(res.text).toBe("OK");
  });

  it("returns INVALID for an unknown location", async () => {
    const res = await request(app).post("/verifyLocation").set("Authorization", userToken)
      .send({ location: "ZZZZZ" });
    expect(res.text).toBe("INVALID");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /getHistory", () => {
  it("returns history rows for admin", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "h1", change: "Added", _id: "h1" }] });
    const res = await request(app).get("/getHistory").set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns history rows for manager", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/getHistory").set("Authorization", managerToken);
    expect(res.status).toBe(200);
  });

  it("returns 403 for user role", async () => {
    const res = await request(app).get("/getHistory").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });

  it("maps id to _id on returned rows", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "h1", change: "Added" }] });
    const res = await request(app).get("/getHistory").set("Authorization", adminToken);
    expect(res.body[0]._id).toBe("h1");
  });
});

describe("POST /addHistory", () => {
  it("returns 400 if change missing", async () => {
    const res = await request(app).post("/addHistory").set("Authorization", adminToken).send({});
    expect(res.status).toBe(400);
  });

  it("creates history entry for admin", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "h1", change: "Manual" }] });
    const res = await request(app).post("/addHistory").set("Authorization", adminToken)
      .send({ change: "Manual", location: "A101", lot: "12345-01" });
    expect(res.status).toBe(201);
  });

  it("returns 403 for user role", async () => {
    const res = await request(app).post("/addHistory").set("Authorization", userToken).send({ change: "x" });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY ALL / DISTINCT
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /inventoryAll", () => {
  it("returns 403 for non-admin", async () => {
    const res = await request(app).get("/inventoryAll").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });

  it("returns all items for admin", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgMockItemWithBoxes, pgMockItemWithBoxes] });
    const res = await request(app).get("/inventoryAll").set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]._id).toBe(ITEM_ID);
  });
});

describe("GET /inventoryDistinct", () => {
  it("returns vendors and brands", async () => {
    pool.query.mockResolvedValueOnce({ rows: [
      { vendor: "Adams Foods", brand: "Creekstone" },
      { vendor: "adams foods", brand: null },
    ]});
    const res = await request(app).get("/inventoryDistinct").set("Authorization", userToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.vendors)).toBe(true);
    expect(Array.isArray(res.body.brands)).toBe(true);
  });

  it("deduplicates case-insensitively", async () => {
    pool.query.mockResolvedValueOnce({ rows: [
      { vendor: "Adams Foods", brand: "Brand" },
      { vendor: "adams foods", brand: "brand" },
    ]});
    const res = await request(app).get("/inventoryDistinct").set("Authorization", userToken);
    expect(res.body.vendors).toHaveLength(1);
    expect(res.body.brands).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCANNER RESOLVE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /scanner-resolve", () => {
  const inputs = {
    location: "A101", lot: "12345-01", vendor: "V", brand: "B", species: "Beef",
    description: "D", grade: "Choice", quantity: "5", weight: "250", type: "raw",
    boxes: [{ weight: "50" }, { weight: "60" }],
  };

  it("update action — updates item, replaces boxes via JSONB, logs Scanner Update", async () => {
    const res = await request(app).post("/scanner-resolve").set("Authorization", userToken)
      .send({ action: "update", existingId: ITEM_ID, inputs });
    expect(res.status).toBe(200);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.includes("Scanner Update"))).toBe(true);
    // Boxes replaced via UPDATE inventory SET boxes = $1::jsonb (not DELETE FROM boxes)
    const boxUpdates = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("set boxes"));
    expect(boxUpdates).toHaveLength(1);
  });

  it("update action — returns 404 if item not found", async () => {
    mockClient.query.mockImplementation(makeQueryHandler({ "UPDATE inventory": { rows: [], rowCount: 0 } }));
    const res = await request(app).post("/scanner-resolve").set("Authorization", userToken)
      .send({ action: "update", existingId: ITEM_ID, inputs });
    expect(res.status).toBe(404);
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("override action — removes old item, inserts new, logs both history entries", async () => {
    const res = await request(app).post("/scanner-resolve").set("Authorization", userToken)
      .send({ action: "override", existingId: ITEM_ID, inputs });
    expect(res.status).toBe(201);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls).toHaveLength(2);
    expect(historyCalls[0][1]).toContain("Scanner Override - Removed");
    expect(historyCalls[1][1]).toContain("Scanner Override - Added");
  });

  it("override action — returns 404 if existing item not found", async () => {
    mockClient.query.mockImplementation(makeQueryHandler({ "SELECT * FROM inventory": { rows: [], rowCount: 0 } }));
    const res = await request(app).post("/scanner-resolve").set("Authorization", userToken)
      .send({ action: "override", existingId: ITEM_ID, inputs });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid action", async () => {
    const res = await request(app).post("/scanner-resolve").set("Authorization", userToken)
      .send({ action: "noop", existingId: ITEM_ID, inputs });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACT ORDER — lot lookup uses pg
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /extract-order", () => {
  const { textractClient } = require("../utils/aws");

  beforeEach(() => {
    textractClient.send.mockResolvedValue({
      Blocks: [{ BlockType: "LINE", Text: "(12345-01) BEEF RIBEYE" }, { BlockType: "LINE", Text: "14" }],
    });
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ items: [{ lot: "12345-01", quantity: "14", description: "BEEF RIBEYE" }] }) } }],
    });
  });

  it("returns items with matched inventory rows", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgMockItem] }); // lot lookup
    const res = await request(app).post("/extract-order").set("Authorization", userToken);
    expect(res.status).toBe(200);
    expect(res.body.items[0].lot).toBe("12345-01");
    expect(res.body.items[0].matches).toHaveLength(1);
    expect(res.body.items[0].matches[0]._id).toBe(ITEM_ID);
  });

  it("returns empty matches when lot not in inventory", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // no matches
    const res = await request(app).post("/extract-order").set("Authorization", userToken);
    expect(res.status).toBe(200);
    expect(res.body.items[0].matches).toHaveLength(0);
  });

  it("lot lookup is scoped to tenant", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).post("/extract-order").set("Authorization", userToken);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("tenant_id");
    expect(params).toContain(TENANT_ID);
  });

  it("returns 422 if GPT returns no items", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ items: [] }) } }],
    });
    const res = await request(app).post("/extract-order").set("Authorization", userToken);
    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-ONLY ROUTES
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin-only routes reject non-admin", () => {
  it("GET /inventoryAll — user gets 403",        async () => expect((await request(app).get("/inventoryAll").set("Authorization", userToken)).status).toBe(403));
  it("GET /inventoryStats — user gets 403",       async () => expect((await request(app).get("/inventoryStats").set("Authorization", userToken)).status).toBe(403));
  it("GET /inventoryAll — manager gets 403",      async () => expect((await request(app).get("/inventoryAll").set("Authorization", managerToken)).status).toBe(403));
  it("GET /inventoryStats — manager gets 403",    async () => expect((await request(app).get("/inventoryStats").set("Authorization", managerToken)).status).toBe(403));
  it("GET /list-scans — user gets 403",           async () => expect((await request(app).get("/list-scans").set("Authorization", userToken)).status).toBe(403));
  it("GET /inventoryWeeklyThroughput — user 403", async () => expect((await request(app).get("/inventoryWeeklyThroughput").set("Authorization", userToken)).status).toBe(403));
});
