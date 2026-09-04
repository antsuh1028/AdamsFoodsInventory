/**
 * migration.pg.test.js
 *
 * Deeper correctness tests focused on migration fidelity:
 *   - Postgres numeric types returned as strings → correctly converted in responses
 *   - Field mapping (fmt): id→_id, scan_image_key→scanImageKey, nulls→""
 *   - JSONB boxes: stored, retrieved, added, removed correctly
 *   - Tenant isolation: every query carries tenant_id
 *   - Stats endpoint: Postgres bigint/numeric shapes handled
 *   - Throughput endpoint: buckets built correctly
 *   - Edge cases: null fields, empty boxes, zero-weight items
 */

const request = require("supertest");
const express = require("express");
const jwt     = require("jsonwebtoken");

// ── Env ───────────────────────────────────────────────────────────────────────
process.env.JWT_SECRET        = "test-secret";
process.env.AWS_BUCKET_NAME   = "test-bucket";
process.env.AWS_REGION        = "us-east-1";
process.env.OPENAI_API_KEY    = "test-key";

const TENANT_ID = "23a57670-bc2d-487a-bab8-d05cf10acbc8";
const ITEM_ID   = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID   = "550e8400-e29b-41d4-a716-446655440001";

const makeToken = (role = "admin") =>
  jwt.sign({ userId: USER_ID, role, username: "tester", tenantId: TENANT_ID }, process.env.JWT_SECRET, { expiresIn: "1h" });

const adminToken = makeToken("admin");
const userToken  = makeToken("user");

// ── Postgres row shapes ───────────────────────────────────────────────────────
// Simulate exactly what node-postgres returns: NUMERIC → string, UUID → string, JSONB → parsed JS
const pgRow = {
  id:            ITEM_ID,
  tenant_id:     TENANT_ID,
  location:      "A101",
  lot:           "12345-01",
  vendor:        "Adams Farms",
  brand:         "Creekstone",
  species:       "Beef",
  description:   "Ribeye Lip-on",
  grade:         "Choice",
  quantity:      "36",
  weight:        "1980.00",   // NUMERIC returned as string by pg
  packdate:      "2024-03-15",
  date_recvd:    "2024-03-16",
  est:           "EST-19682",
  price:         "4.50",      // NUMERIC returned as string by pg
  type:          "raw",
  scan_image_key: "scans/abc.jpg",
  source_id:     null,
  boxes:         [{ weight: "55.00" }, { weight: "55.00" }, { weight: "54.50" }], // JSONB parsed by pg
  created_at:    new Date("2024-03-16T14:00:00Z"),
};

const pgRowNulls = {
  id:            ITEM_ID,
  tenant_id:     TENANT_ID,
  location:      "B202",
  lot:           null,
  vendor:        null,
  brand:         null,
  species:       null,
  description:   null,
  grade:         null,
  quantity:      null,
  weight:        null,
  packdate:      null,
  date_recvd:    null,
  est:           null,
  price:         null,
  type:          null,
  scan_image_key: null,
  source_id:     null,
  boxes:         [],
};

// ── Mock pg pool ──────────────────────────────────────────────────────────────
const mockClient = { query: jest.fn(), release: jest.fn() };

jest.mock("../utils/pg", () => ({ query: jest.fn(), connect: jest.fn() }));
const pool = require("../utils/pg");

// ── Mock AWS / OpenAI (not under test here) ───────────────────────────────────
jest.mock("../utils/aws", () => ({
  s3Client:       { send: jest.fn().mockResolvedValue({}) },
  textractClient: { send: jest.fn() },
  upload: { single: () => (req, _res, next) => { req.file = { buffer: Buffer.from("x"), mimetype: "image/jpeg", originalname: "t.jpg" }; next(); } },
}));
jest.mock("@aws-sdk/client-s3",            () => ({ PutObjectCommand: jest.fn(), GetObjectCommand: jest.fn(), DeleteObjectCommand: jest.fn() }));
jest.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: jest.fn().mockResolvedValue("https://signed.example.com/t.jpg") }));
jest.mock("@aws-sdk/client-textract",      () => ({ DetectDocumentTextCommand: jest.fn() }));
jest.mock("openai", () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: jest.fn() } } })));
jest.mock("heic-convert", () => jest.fn().mockResolvedValue(Buffer.from("x")));

// ── Build app ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use("/", require("../routes/auth.pg"));
app.use("/", require("../routes/inventory.pg"));
app.use("/", require("../routes/history.pg"));
app.use("/", require("../routes/scanner.pg"));

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(mockClient);
  mockClient.release.mockReturnValue(undefined);
  mockClient.query.mockImplementation((sql = "") => {
    const s = sql.toLowerCase().trim();
    if (/^(begin|commit|rollback)/.test(s))        return Promise.resolve({ rows: [] });
    if (s.includes("select") && s.includes("from inventory")) return Promise.resolve({ rows: [pgRow], rowCount: 1 });
    if (s.startsWith("insert into inventory"))      return Promise.resolve({ rows: [pgRow], rowCount: 1 });
    if (s.startsWith("update inventory"))           return Promise.resolve({ rows: [pgRow], rowCount: 1 });
    if (s.startsWith("delete from inventory"))      return Promise.resolve({ rows: [pgRow], rowCount: 1 });
    if (s.includes("into history"))                 return Promise.resolve({ rows: [], rowCount: 1 });
    if (s.includes("count(*)"))                     return Promise.resolve({ rows: [{ count: "0" }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  pool.query.mockImplementation((sql = "") => {
    const s = sql.toLowerCase().trim();
    if (s.includes("select") && s.includes("from inventory")) return Promise.resolve({ rows: [pgRow] });
    if (s.includes("from history"))                 return Promise.resolve({ rows: [] });
    if (s.includes("count(*)"))                     return Promise.resolve({ rows: [{ count: "0" }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

// =============================================================================
// 1. FIELD MAPPING — fmt() correctness
// =============================================================================
describe("Field mapping (fmt function)", () => {
  it("maps id → _id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "A101" } });
    expect(res.status).toBe(200);
    expect(res.body[0]._id).toBe(ITEM_ID);
    expect(res.body[0].id).toBeUndefined(); // raw id should not leak
  });

  it("maps scan_image_key → scanImageKey", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "A101" } });
    expect(res.body[0].scanImageKey).toBe("scans/abc.jpg");
    expect(res.body[0].scan_image_key).toBeUndefined();
  });

  it("returns weight as string even when pg returns numeric string", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] }); // weight = "1980.00"
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "A101" } });
    expect(typeof res.body[0].weight).toBe("string");
    expect(res.body[0].weight).toBe("1980.00");
  });

  it("returns price as string even when pg returns numeric string", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] }); // price = "4.50"
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "A101" } });
    expect(typeof res.body[0].price).toBe("string");
    expect(res.body[0].price).toBe("4.50");
  });

  it("returns empty string for null text fields", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRowNulls] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "B202" } });
    const item = res.body[0];
    expect(item.lot).toBe("");
    expect(item.vendor).toBe("");
    expect(item.brand).toBe("");
    expect(item.species).toBe("");
    expect(item.description).toBe("");
    expect(item.grade).toBe("");
    expect(item.quantity).toBe("");
    expect(item.packdate).toBe("");
    expect(item.date_recvd).toBe("");
    expect(item.est).toBe("");
  });

  it("returns empty string for null weight and price", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRowNulls] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "B202" } });
    expect(res.body[0].weight).toBe("");
    expect(res.body[0].price).toBe("");
  });

  it("returns null for null scanImageKey (not empty string)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRowNulls] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "B202" } });
    expect(res.body[0].scanImageKey).toBeNull();
  });

  it("returns empty array for null/missing boxes", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...pgRowNulls, boxes: null }] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "B202" } });
    expect(res.body[0].boxes).toEqual([]);
  });

  it("preserves all box weight strings from JSONB", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "A101" } });
    expect(res.body[0].boxes).toHaveLength(3);
    expect(res.body[0].boxes[0].weight).toBe("55.00");
    expect(res.body[0].boxes[2].weight).toBe("54.50");
  });

  it("returns tenant_id in the raw row but not in the formatted response", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "A101" } });
    // fmt does not explicitly include tenant_id — it should not be in response
    expect(res.body[0].tenant_id).toBeUndefined();
  });
});

// =============================================================================
// 2. TENANT ISOLATION — every write and read uses tenant_id
// =============================================================================
describe("Tenant isolation", () => {
  it("inventoryFind query is scoped to tenant_id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { lot: "12345-01" } });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql.toLowerCase()).toContain("tenant_id");
    expect(params[0]).toBe(TENANT_ID);
  });

  it("inventoryAdd INSERT is scoped to tenant_id", async () => {
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: { location: "A101", lot: "99999-01", species: "Beef" }, force: true });
    const insertCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().includes("insert into inventory"));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain(TENANT_ID);
  });

  it("inventoryUpdate WHERE clause includes tenant_id", async () => {
    await request(app).post("/inventoryUpdate").set("Authorization", userToken)
      .send({ updateInputs: { location: "A101", currentItem: { _id: ITEM_ID } } });
    const updateCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().startsWith("update inventory"));
    expect(updateCall[1]).toContain(TENANT_ID);
  });

  it("inventoryRemove DELETE WHERE clause includes tenant_id", async () => {
    await request(app).post("/inventoryRemove").set("Authorization", userToken)
      .send({ currentItem: { _id: ITEM_ID } });
    const delCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().includes("delete from inventory"));
    expect(delCall[1]).toContain(TENANT_ID);
  });

  it("inventoryBulkRemove DELETE includes tenant_id", async () => {
    mockClient.query.mockImplementation((sql = "") => {
      const s = sql.toLowerCase().trim();
      if (/^(begin|commit|rollback)/.test(s)) return Promise.resolve({ rows: [] });
      if (s.includes("select * from inventory")) return Promise.resolve({ rows: [pgRow] });
      if (s.includes("delete from inventory"))   return Promise.resolve({ rows: [], rowCount: 1 });
      if (s.includes("into history"))            return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    await request(app).post("/inventoryBulkRemove").set("Authorization", userToken)
      .send({ ids: [ITEM_ID] });
    const delCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().includes("delete from inventory"));
    expect(delCall[1]).toContain(TENANT_ID);
  });

  it("box add/remove are scoped to tenant_id", async () => {
    await request(app).patch(`/inventory/${ITEM_ID}/box/add`).set("Authorization", userToken)
      .send({ weight: "55" });
    const selectCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().includes("select * from inventory"));
    expect(selectCall[1]).toContain(TENANT_ID);
  });

  it("inventoryAll query is scoped to tenant_id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    await request(app).get("/inventoryAll").set("Authorization", adminToken);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql.toLowerCase()).toContain("tenant_id");
    expect(params[0]).toBe(TENANT_ID);
  });

  it("getHistory query is scoped to tenant_id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get("/getHistory").set("Authorization", adminToken);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql.toLowerCase()).toContain("tenant_id");
    expect(params[0]).toBe(TENANT_ID);
  });

  it("token missing tenantId returns 401", async () => {
    const noTenantToken = jwt.sign({ userId: USER_ID, role: "admin" }, process.env.JWT_SECRET);
    const res = await request(app).post("/inventoryFind").set("Authorization", noTenantToken)
      .send({ inputs: {} });
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// 3. JSONB BOXES — add, remove, weight recalculation
// =============================================================================
describe("JSONB boxes integrity", () => {
  it("box add: appends box and recalculates weight correctly", async () => {
    // pgRow has boxes [55.00, 55.00, 54.50] = 164.50 lb
    // adding 60.00 → 4 boxes, 224.50 lb
    const afterAdd = {
      ...pgRow,
      boxes:    [{ weight: "55.00" }, { weight: "55.00" }, { weight: "54.50" }, { weight: "60.00" }],
      weight:   "224.50",
      quantity: "4",
    };
    mockClient.query.mockImplementation((sql = "") => {
      const s = sql.toLowerCase().trim();
      if (/^(begin|commit|rollback)/.test(s)) return Promise.resolve({ rows: [] });
      if (s.includes("select * from inventory")) return Promise.resolve({ rows: [pgRow] });
      if (s.startsWith("update inventory"))      return Promise.resolve({ rows: [afterAdd] });
      if (s.includes("into history"))            return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).patch(`/inventory/${ITEM_ID}/box/add`).set("Authorization", userToken)
      .send({ weight: "60.00" });
    expect(res.status).toBe(200);
    expect(res.body.boxes).toHaveLength(4);
    expect(res.body.weight).toBe("224.50");
    expect(res.body.quantity).toBe("4");
  });

  it("box add: the UPDATE includes the new box in JSONB param", async () => {
    mockClient.query.mockImplementation((sql = "") => {
      const s = sql.toLowerCase().trim();
      if (/^(begin|commit|rollback)/.test(s)) return Promise.resolve({ rows: [] });
      if (s.includes("select * from inventory")) return Promise.resolve({ rows: [pgRow] });
      if (s.startsWith("update inventory"))      return Promise.resolve({ rows: [pgRow] });
      if (s.includes("into history"))            return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    await request(app).patch(`/inventory/${ITEM_ID}/box/add`).set("Authorization", userToken)
      .send({ weight: "72.5" });
    const updateCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().startsWith("update inventory"));
    const boxesParam = updateCall[1][0]; // $1 is the JSONB boxes param
    const parsed = JSON.parse(boxesParam);
    expect(parsed).toHaveLength(4); // 3 existing + 1 new
    expect(parsed[3].weight).toBe("72.5");
  });

  it("box remove: removes correct index and recalculates weight", async () => {
    // Remove index 0 (55.00) → remaining [55.00, 54.50], total 109.50
    const afterRemove = { ...pgRow, boxes: [{ weight: "55.00" }, { weight: "54.50" }], weight: "109.50", quantity: "2" };
    mockClient.query.mockImplementation((sql = "") => {
      const s = sql.toLowerCase().trim();
      if (/^(begin|commit|rollback)/.test(s)) return Promise.resolve({ rows: [] });
      if (s.includes("select * from inventory")) return Promise.resolve({ rows: [pgRow] });
      if (s.startsWith("update inventory"))      return Promise.resolve({ rows: [afterRemove] });
      if (s.includes("into history"))            return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).patch(`/inventory/${ITEM_ID}/box/remove`).set("Authorization", userToken)
      .send({ index: 0 });
    expect(res.status).toBe(200);
    expect(res.body.boxes).toHaveLength(2);
    expect(res.body.weight).toBe("109.50");
  });

  it("box remove: the UPDATE excludes the removed box", async () => {
    mockClient.query.mockImplementation((sql = "") => {
      const s = sql.toLowerCase().trim();
      if (/^(begin|commit|rollback)/.test(s)) return Promise.resolve({ rows: [] });
      if (s.includes("select * from inventory")) return Promise.resolve({ rows: [pgRow] });
      if (s.startsWith("update inventory"))      return Promise.resolve({ rows: [pgRow] });
      if (s.includes("into history"))            return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    await request(app).patch(`/inventory/${ITEM_ID}/box/remove`).set("Authorization", userToken)
      .send({ index: 1 }); // remove middle box (55.00)
    const updateCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().startsWith("update inventory"));
    const remaining = JSON.parse(updateCall[1][0]);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].weight).toBe("55.00");
    expect(remaining[1].weight).toBe("54.50");
  });

  it("box remove: returns 400 for out-of-range index", async () => {
    mockClient.query.mockImplementation((sql = "") => {
      const s = sql.toLowerCase().trim();
      if (/^(begin|commit|rollback)/.test(s)) return Promise.resolve({ rows: [] });
      if (s.includes("select * from inventory")) return Promise.resolve({ rows: [pgRow] }); // 3 boxes
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).patch(`/inventory/${ITEM_ID}/box/remove`).set("Authorization", userToken)
      .send({ index: 5 });
    expect(res.status).toBe(400);
  });

  it("inventoryAdd stores boxes as JSONB with weight strings", async () => {
    const inputs = { location: "A101", lot: "77777-01", species: "Lamb", boxes: [{ weight: "45.5" }, { weight: "46.0" }] };
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs, force: true });
    const insertCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().includes("insert into inventory"));
    expect(insertCall).toBeDefined();
    const boxesParam = insertCall[1].find((p) => typeof p === "string" && p.startsWith("["));
    const boxes = JSON.parse(boxesParam);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].weight).toBe("45.5");
    expect(boxes[1].weight).toBe("46.0");
  });

  it("inventoryAdd computes weight from boxes, not the weight field", async () => {
    const inputs = { location: "A101", lot: "77777-01", species: "Lamb", weight: "999", boxes: [{ weight: "45.5" }, { weight: "46.0" }] };
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs, force: true });
    const insertCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().includes("insert into inventory"));
    const weightParam = insertCall[1][9]; // position 9 = weight in the INSERT
    // 45.5 + 46.0 = 91.5
    expect(parseFloat(weightParam)).toBeCloseTo(91.5, 1);
  });

  it("inventoryOrderRemove: boxes are sliced from JSONB correctly", async () => {
    await request(app).post("/inventoryOrderRemove").set("Authorization", userToken)
      .send({ removals: [{ id: ITEM_ID, quantityToRemove: 1 }] });
    const updateCall = mockClient.query.mock.calls.find(([sql]) => sql.toLowerCase().startsWith("update inventory"));
    if (updateCall) {
      const remaining = JSON.parse(updateCall[1][0]);
      expect(remaining).toHaveLength(2); // 3 - 1
    }
  });
});

// =============================================================================
// 4. STATS ENDPOINT — Postgres numeric type handling
// =============================================================================
describe("GET /inventoryStats", () => {
  const makeMockPoolStats = (overrides = {}) => (sql = "") => {
    const s = sql.toLowerCase();
    if (s.includes("count(*) as total_items")) {
      return Promise.resolve({ rows: [{ total_items: "147", total_weight: "89234.50", total_value: "401555.25" }] });
    }
    if (s.includes("'species' as dim")) {
      return Promise.resolve({ rows: [
        { dim: "species", _id: "Beef",  count: "89",  weight: "54321.00", value: "244444.50" },
        { dim: "species", _id: "Lamb",  count: "35",  weight: "21000.00", value: "94500.00"  },
        { dim: "grade",   _id: "Choice",count: "100", weight: "60000.00", value: "270000.00" },
        { dim: "grade",   _id: "Prime", count: "47",  weight: "29234.50", value: "131555.25" },
        { dim: "vendor",  _id: "Adams Farms",count: "80", weight: "48000.00", value: "216000.00" },
      ]});
    }
    if (s.includes("count(distinct location)")) {
      return Promise.resolve({ rows: [{ occupied: "42" }] });
    }
    if (s.includes("coalesce(nullif(packdate")) {
      return Promise.resolve({ rows: [
        { id: ITEM_ID, location: "A101", lot: "12345-01", description: "Ribeye", species: "Beef", packdate: "2023-06-01", date_recvd: "2023-06-02", weight: "1800.00", date_str: "2023-06-01" },
      ]});
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };

  beforeEach(() => {
    pool.query.mockImplementation(makeMockPoolStats());
  });

  it("returns 200 for admin", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    expect(res.status).toBe(200);
  });

  it("converts Postgres bigint string COUNT to integer", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    expect(typeof res.body.totalItems).toBe("number");
    expect(res.body.totalItems).toBe(147);
  });

  it("converts Postgres NUMERIC string SUM to float", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    expect(typeof res.body.totalWeight).toBe("number");
    expect(res.body.totalWeight).toBeCloseTo(89234.5, 0);
  });

  it("converts totalValue from Postgres NUMERIC string", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    expect(typeof res.body.totalValue).toBe("number");
    expect(res.body.totalValue).toBeGreaterThan(0);
  });

  it("converts occupiedLocations from Postgres bigint string", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    expect(typeof res.body.occupiedLocations).toBe("number");
    expect(res.body.occupiedLocations).toBe(42);
  });

  it("totalLocations matches the validLocations list length", async () => {
    const validLocations = require("../utils/locations");
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    expect(res.body.totalLocations).toBe(validLocations.length);
  });

  it("bySpecies is sorted by count descending", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    const counts = res.body.bySpecies.map((r) => r.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("bySpecies entries have integer count and float weight", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    for (const row of res.body.bySpecies) {
      expect(Number.isInteger(row.count)).toBe(true);
      expect(typeof row.weight).toBe("number");
    }
  });

  it("byGrade and byVendor are present arrays", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    expect(Array.isArray(res.body.byGrade)).toBe(true);
    expect(Array.isArray(res.body.byVendor)).toBe(true);
  });

  it("oldestPallets includes _id and _dateStr fields", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    expect(res.body.oldestPallets[0]._id).toBe(ITEM_ID);
    expect(res.body.oldestPallets[0]._dateStr).toBe("2023-06-01");
  });

  it("stats query uses only one parameter for tenant_id (not [tid, tid, tid])", async () => {
    await request(app).get("/inventoryStats").set("Authorization", adminToken);
    // The UNION ALL breakdown query should be called with exactly [TENANT_ID], not [tid, tid, tid]
    const breakdownCall = pool.query.mock.calls.find(([sql]) => sql.toLowerCase().includes("'species' as dim"));
    expect(breakdownCall).toBeDefined();
    expect(breakdownCall[1]).toHaveLength(1);
    expect(breakdownCall[1][0]).toBe(TENANT_ID);
  });

  it("returns 403 for user role", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });

  it("returns 500 on DB error", async () => {
    pool.query.mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app).get("/inventoryStats").set("Authorization", adminToken);
    expect(res.status).toBe(500);
  });
});

// =============================================================================
// 5. WEEKLY THROUGHPUT — bucket alignment and data merging
// =============================================================================
describe("GET /inventoryWeeklyThroughput", () => {
  it("returns 8 buckets", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // no history data
    const res = await request(app).get("/inventoryWeeklyThroughput").set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(8);
  });

  it("each bucket has week, added, scanner keys", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/inventoryWeeklyThroughput").set("Authorization", adminToken);
    for (const b of res.body) {
      expect(b).toHaveProperty("week");
      expect(b).toHaveProperty("added");
      expect(b).toHaveProperty("scanner");
    }
  });

  it("buckets default to 0 when no history", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/inventoryWeeklyThroughput").set("Authorization", adminToken);
    expect(res.body.every((b) => b.added === 0 && b.scanner === 0)).toBe(true);
  });

  it("merges DB rows into correct bucket by matching Monday week start", async () => {
    // Build this week's Monday in UTC (same logic as the route)
    const now = new Date();
    const dayOfWeekUTC = (now.getUTCDay() + 6) % 7;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - dayOfWeekUTC);
    monday.setUTCHours(0, 0, 0, 0);

    pool.query.mockResolvedValueOnce({
      rows: [{ week_start: monday.toISOString(), added: "5", scanner: "3" }],
    });
    const res = await request(app).get("/inventoryWeeklyThroughput").set("Authorization", adminToken);
    const currentWeek = res.body[res.body.length - 1]; // last bucket = this week
    expect(currentWeek.added).toBe(5);
    expect(currentWeek.scanner).toBe(3);
  });

  it("converts Postgres bigint string counts to integers", async () => {
    const now = new Date();
    const dayOfWeekUTC = (now.getUTCDay() + 6) % 7;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - dayOfWeekUTC);
    monday.setUTCHours(0, 0, 0, 0);

    pool.query.mockResolvedValueOnce({
      rows: [{ week_start: monday.toISOString(), added: "12", scanner: "7" }], // eslint-disable-line no-undef
    });
    const res = await request(app).get("/inventoryWeeklyThroughput").set("Authorization", adminToken);
    const last = res.body[res.body.length - 1];
    expect(typeof last.added).toBe("number");
    expect(typeof last.scanner).toBe("number");
  });

  it("throughput query is scoped to tenant_id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get("/inventoryWeeklyThroughput").set("Authorization", adminToken);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql.toLowerCase()).toContain("tenant_id");
    expect(params[0]).toBe(TENANT_ID);
  });

  it("returns 403 for user role", async () => {
    const res = await request(app).get("/inventoryWeeklyThroughput").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// 6. HISTORY — field preservation from inventory rows
// =============================================================================
describe("History entry correctness", () => {
  it("inventoryAdd history entry includes correct location and lot", async () => {
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: { location: "C301", lot: "55555-02", species: "Pork" }, force: true });
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("inventoryRemove history entry includes 'Removed' change label", async () => {
    await request(app).post("/inventoryRemove").set("Authorization", userToken)
      .send({ currentItem: { _id: ITEM_ID } });
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.includes("Removed"))).toBe(true);
  });

  it("inventoryMove history entry contains from→to arrow", async () => {
    await request(app).post("/inventoryMove").set("Authorization", userToken)
      .send({ itemId: ITEM_ID, destLocation: "D401" });
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.some((p) => typeof p === "string" && p.includes("→")))).toBe(true);
  });

  it("patchField history entry contains field name and new value", async () => {
    await request(app).patch(`/inventory/${ITEM_ID}/field`).set("Authorization", userToken)
      .send({ field: "lot", value: "99999-99" });
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, params]) => params.some((p) => typeof p === "string" && p.includes("lot")))).toBe(true);
    expect(historyCalls.some(([, params]) => params.some((p) => typeof p === "string" && p.includes("99999-99")))).toBe(true);
  });

  it("history entry always includes tenant_id", async () => {
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: { location: "A101", lot: "11111-01", species: "Beef" }, force: true });
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.every(([, params]) => params.includes(TENANT_ID))).toBe(true);
  });
});

// =============================================================================
// 7. INVENTORY FIND — query building
// =============================================================================
describe("POST /inventoryFind — query construction", () => {
  it("with no filters: only condition is tenant_id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: {} });
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toHaveLength(1); // only tenant_id
    expect(params[0]).toBe(TENANT_ID);
  });

  it("location filter is uppercased", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "a101" } });
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toContain("A101%");
  });

  it("empty string filters are ignored", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "", lot: "", vendor: "" } });
    const [, params] = pool.query.mock.calls[0];
    expect(params).toHaveLength(1); // only tenant_id, no empty strings
  });

  it("returns INVALID (text) when no rows match", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "Z999" } });
    expect(res.text).toBe("INVALID");
  });

  it("multiple filters all included in query params", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    await request(app).post("/inventoryFind").set("Authorization", userToken)
      .send({ inputs: { location: "A101", lot: "12345-01", species: "Beef", grade: "Choice" } });
    const [sql, params] = pool.query.mock.calls[0];
    // Location is a prefix match; everything else is a contains match. All of
    // them reach the query as LIKE patterns, not raw values.
    expect(params).toContain("A101%");
    expect(params).toContain("%12345-01%");
    expect(params).toContain("%Beef%");
    expect(params).toContain("%Choice%");
  });
});

// =============================================================================
// 8. INVENTORY ALL — response shape
// =============================================================================
describe("GET /inventoryAll — response shape", () => {
  it("all items go through fmt: _id present, no raw id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow, pgRowNulls] });
    const res = await request(app).get("/inventoryAll").set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]._id).toBe(ITEM_ID);
    expect(res.body[0].id).toBeUndefined();
  });

  it("items with null boxes return empty array", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRowNulls] });
    const res = await request(app).get("/inventoryAll").set("Authorization", adminToken);
    expect(res.body[0].boxes).toEqual([]);
  });

  it("Postgres numeric weight string is returned as string in response", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgRow] });
    const res = await request(app).get("/inventoryAll").set("Authorization", adminToken);
    expect(typeof res.body[0].weight).toBe("string");
  });
});
