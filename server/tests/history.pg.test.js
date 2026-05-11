process.env.JWT_SECRET = "test-secret";

const request = require("supertest");
const express = require("express");
const jwt     = require("jsonwebtoken");

const TENANT_ID = "23a57670-bc2d-487a-bab8-d05cf10acbc8";
const USER_ID   = "550e8400-e29b-41d4-a716-446655440001";

const makeToken = (role = "admin") =>
  jwt.sign({ userId: USER_ID, role, username: "tester", tenantId: TENANT_ID }, "test-secret", { expiresIn: "1h" });

const adminToken   = makeToken("admin");
const managerToken = makeToken("manager");
const userToken    = makeToken("user");

jest.mock("../utils/pg", () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

const pool = require("../utils/pg");

const mockHistoryItem = {
  id:             "h-001",
  tenant_id:      TENANT_ID,
  time:           "1/1/2025, 12:00:00 PM",
  change:         "Added",
  changed_by:     "tester",
  location:       "A101",
  lot:            "12345-01",
  brand:          "Test Brand",
  species:        "BEEF",
  description:    "Test Description",
  vendor:         "Test Vendor",
  grade:          "Choice",
  quantity:       "2",
  weight:         "110",
  packdate:       "2024-01-01",
  date_recvd:     "2024-01-02",
  est:            "EST123",
  created_at:     new Date().toISOString(),
  old_data:       null,
  scan_image_key: null,
};

const app = express();
app.use(express.json());
app.use("/", require("../routes/history.pg"));

beforeEach(() => {
  jest.resetAllMocks();
  pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

// Helper: mock the two parallel queries getHistory always runs (data + count)
const mockHistoryQueries = (items) => {
  pool.query
    .mockResolvedValueOnce({ rows: items })
    .mockResolvedValueOnce({ rows: [{ count: String(items.length) }] });
};

// ── GET /getHistory ───────────────────────────────────────────────────────────

describe("GET /getHistory", () => {
  it("returns items and total for admin", async () => {
    mockHistoryQueries([mockHistoryItem]);
    const res = await request(app)
      .get("/getHistory")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.hasMore).toBe(false);
  });

  it("returns items for manager", async () => {
    mockHistoryQueries([mockHistoryItem]);
    const res = await request(app)
      .get("/getHistory")
      .set("Authorization", managerToken);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it("rejects user role with 403", async () => {
    const res = await request(app)
      .get("/getHistory")
      .set("Authorization", userToken);
    expect(res.status).toBe(403);
  });

  it("returns 403 without token", async () => {
    const res = await request(app).get("/getHistory");
    expect(res.status).toBe(403);
  });

  it("includes scan_image_key in response items", async () => {
    mockHistoryQueries([{ ...mockHistoryItem, scan_image_key: "scans/test.jpg" }]);
    const res = await request(app)
      .get("/getHistory")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.items[0].scan_image_key).toBe("scans/test.jpg");
  });

  it("accepts search param", async () => {
    mockHistoryQueries([mockHistoryItem]);
    const res = await request(app)
      .get("/getHistory?search=12345")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it("accepts changeFilter=added", async () => {
    mockHistoryQueries([]);
    const res = await request(app)
      .get("/getHistory?changeFilter=added")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("accepts changeFilter=updated", async () => {
    mockHistoryQueries([mockHistoryItem]);
    const res = await request(app)
      .get("/getHistory?changeFilter=updated")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
  });

  it("accepts changeFilter=removed", async () => {
    mockHistoryQueries([]);
    const res = await request(app)
      .get("/getHistory?changeFilter=removed")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
  });

  it("accepts changeFilter=production", async () => {
    mockHistoryQueries([]);
    const res = await request(app)
      .get("/getHistory?changeFilter=production")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
  });

  it("accepts changeFilter=box", async () => {
    mockHistoryQueries([]);
    const res = await request(app)
      .get("/getHistory?changeFilter=box")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
  });

  it("ignores unknown changeFilter value (no SQL injection)", async () => {
    mockHistoryQueries([mockHistoryItem]);
    const res = await request(app)
      .get("/getHistory?changeFilter=DROP_TABLE")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    // Unknown filter is ignored — all results returned
    expect(res.body.items).toHaveLength(1);
  });

  it("combines search and changeFilter", async () => {
    mockHistoryQueries([]);
    const res = await request(app)
      .get("/getHistory?search=beef&changeFilter=removed")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
  });

  it("marks hasMore true when more results exist beyond loaded batch", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: Array(100).fill(mockHistoryItem) })
      .mockResolvedValueOnce({ rows: [{ count: "250" }] });
    const res = await request(app)
      .get("/getHistory")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.total).toBe(250);
  });

  it("respects offset param", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: "5" }] });
    const res = await request(app)
      .get("/getHistory?offset=5")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.offset).toBe(5);
    expect(res.body.hasMore).toBe(false);
  });
});
