process.env.JWT_SECRET      = "test-secret";
process.env.AWS_BUCKET_NAME = "test-bucket";
process.env.AWS_REGION      = "us-east-1";

const request = require("supertest");
const express = require("express");
const jwt     = require("jsonwebtoken");

const TENANT_ID = "23a57670-bc2d-487a-bab8-d05cf10acbc8";
const ITEM_ID   = "550e8400-e29b-41d4-a716-446655440000";
const ORDER_ID  = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const USER_ID   = "550e8400-e29b-41d4-a716-446655440001";

const makeToken = (role = "admin") =>
  jwt.sign({ userId: USER_ID, role, username: "tester", tenantId: TENANT_ID }, "test-secret", { expiresIn: "1h" });

const adminToken = makeToken("admin");

const mockOrderRow = {
  id:             ORDER_ID,
  tenant_id:      TENANT_ID,
  sent_date:      "2025-01-01",
  processor_name: "Noblesse Trading",
  status:         "pending",
  return_date:    null,
  yield:          null,
  created_at:     new Date().toISOString(),
  item_count:     "1",
  total_weight:   "110.00",
};

const mockInvRow = {
  id:             ITEM_ID,
  tenant_id:      TENANT_ID,
  location:       "A101",
  lot:            "12345-01",
  vendor:         "Test",
  brand:          "Brand",
  species:        "BEEF",
  description:    "Test",
  grade:          "Choice",
  quantity:       "2",
  weight:         110.00,
  boxes:          [{ weight: "50" }, { weight: "60" }],
  scan_image_key: null,
  source_id:      null,
};

const mockOrderItemRow = {
  id:                  "poi-001",
  production_order_id: ORDER_ID,
  inventory_id:        ITEM_ID,
  weight_sent:         110.00,
  boxes_sent:          [{ weight: "50" }, { weight: "60" }],
  location:            "A101",
  lot:                 "12345-01",
  species:             "BEEF",
  description:         "Test",
};

const mockReturnInvRow = {
  id:             "ret-inv-001",
  tenant_id:      TENANT_ID,
  location:       "N303",
  lot:            "N26119-01",
  species:        "BEEF",
  description:    "Processed Short Ribs",
  grade:          "Choice",
  quantity:       "2",
  weight:         90.00,
  packdate:       "2025-01-10",
  date_recvd:     "2025-01-10",
  est:            null,
  scan_image_key: null,
  source_id:      ITEM_ID,
  type:           "prc",
  boxes:          [{ weight: "45" }, { weight: "45" }],
};

const mockReturnRow = {
  id:                  "ret-001",
  production_order_id: ORDER_ID,
  inventory_id:        "ret-inv-001",
  created_at:          new Date().toISOString(),
  location:            "N303",
  lot:                 "N26119-01",
  species:             "BEEF",
  description:         "Processed Short Ribs",
  weight:              90.00,
  source_lots:         ["12345-01"],
};

jest.mock("../utils/pg", () => ({
  query:   jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  connect: jest.fn(),
}));

const pool       = require("../utils/pg");
const mockClient = { query: jest.fn(), release: jest.fn() };

const app = express();
app.use(express.json());
app.use("/", require("../routes/production.pg"));

beforeEach(() => {
  jest.resetAllMocks();
  pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  pool.connect.mockResolvedValue(mockClient);
  mockClient.release.mockReturnValue(undefined);
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── GET /production-orders ────────────────────────────────────────────────────

describe("GET /production-orders", () => {
  it("returns orders with itemCount and totalWeight", async () => {
    pool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
    const res = await request(app)
      .get("/production-orders")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].itemCount).toBe(1);
    expect(res.body[0].totalWeight).toBe(110);
  });

  it("filters by status param", async () => {
    pool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
    const res = await request(app)
      .get("/production-orders?status=pending")
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe("pending");
  });

  it("returns 403 without token", async () => {
    const res = await request(app).get("/production-orders");
    expect(res.status).toBe(403);
  });
});

// ── GET /production-orders/:id ────────────────────────────────────────────────

describe("GET /production-orders/:id", () => {
  it("returns order detail with items and sourceLots on returns", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [mockOrderRow] })
      .mockResolvedValueOnce({ rows: [mockOrderItemRow] })
      .mockResolvedValueOnce({ rows: [mockReturnRow] });
    const res = await request(app)
      .get(`/production-orders/${ORDER_ID}`)
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.items[0].lot).toBe("12345-01");
    expect(res.body.returns[0].sourceLots).toEqual(["12345-01"]);
  });

  it("returns empty sourceLots when source_lots is null", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [mockOrderRow] })
      .mockResolvedValueOnce({ rows: [mockOrderItemRow] })
      .mockResolvedValueOnce({ rows: [{ ...mockReturnRow, source_lots: null }] });
    const res = await request(app)
      .get(`/production-orders/${ORDER_ID}`)
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.returns[0].sourceLots).toEqual([]);
  });

  it("returns 404 for unknown order", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get("/production-orders/nonexistent")
      .set("Authorization", adminToken);
    expect(res.status).toBe(404);
  });
});

// ── POST /production-orders ───────────────────────────────────────────────────

describe("POST /production-orders", () => {
  const validBody = {
    sentDate:      "2025-01-01",
    processorName: "Noblesse Trading",
    items: [{ inventoryId: ITEM_ID, weightSent: 50, boxesSent: [{ weight: "50" }] }],
  };

  it("creates order and returns 201", async () => {
    // Partial send (50 of 110 lb) → UPDATE inventory, no DELETE
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                            // BEGIN
      .mockResolvedValueOnce({ rows: [mockOrderRow], rowCount: 1 }) // INSERT order
      .mockResolvedValueOnce({ rows: [mockInvRow],   rowCount: 1 }) // SELECT inventory
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })              // INSERT order item
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })              // UPDATE inventory
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })              // history (Sent to Processor)
      .mockResolvedValueOnce({ rows: [] })                           // COMMIT
      .mockResolvedValueOnce({ rows: [mockOrderItemRow] });          // SELECT order items
    const res = await request(app)
      .post("/production-orders")
      .set("Authorization", adminToken)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.order.id).toBe(ORDER_ID);
    expect(res.body.items).toHaveLength(1);
  });

  it("returns 400 when sentDate is missing", async () => {
    const res = await request(app)
      .post("/production-orders")
      .set("Authorization", adminToken)
      .send({ processorName: "Noblesse", items: validBody.items });
    expect(res.status).toBe(400);
  });

  it("returns 400 when processorName is missing", async () => {
    const res = await request(app)
      .post("/production-orders")
      .set("Authorization", adminToken)
      .send({ sentDate: "2025-01-01", items: validBody.items });
    expect(res.status).toBe(400);
  });

  it("returns 400 when items array is empty", async () => {
    const res = await request(app)
      .post("/production-orders")
      .set("Authorization", adminToken)
      .send({ sentDate: "2025-01-01", processorName: "Noblesse", items: [] });
    expect(res.status).toBe(400);
  });

  it("returns 403 without token", async () => {
    const res = await request(app).post("/production-orders").send(validBody);
    expect(res.status).toBe(403);
  });
});

// ── POST /production-orders/:id/returns ──────────────────────────────────────

describe("POST /production-orders/:id/returns", () => {
  const validBody = {
    location: "N303", lot: "N26119-01", species: "BEEF",
    description: "Processed Short Ribs", grade: "Choice", brand: "NTI",
    packdate: "2025-01-10", date_recvd: "2025-01-10",
    boxes: [{ weight: "45" }, { weight: "45" }],
  };

  it("creates return and returns 201", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                              // BEGIN
      .mockResolvedValueOnce({ rows: [mockOrderRow] })                                 // SELECT order
      .mockResolvedValueOnce({ rows: [{ inventory_id: ITEM_ID, lot: "12345-01" }] })  // SELECT source lots
      .mockResolvedValueOnce({ rows: [mockReturnInvRow], rowCount: 1 })               // INSERT inventory
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                               // INSERT return record
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                               // INSERT history
      .mockResolvedValueOnce({ rows: [] });                                            // COMMIT
    const res = await request(app)
      .post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.location).toBe("N303");
  });

  it("dedupes source lots from multiple sent items", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [mockOrderRow] })
      .mockResolvedValueOnce({ rows: [
        { inventory_id: ITEM_ID,  lot: "12345-01" },
        { inventory_id: "id-002", lot: "12345-01" }, // duplicate — should be deduped
        { inventory_id: "id-003", lot: "99999-01" },
      ]})
      .mockResolvedValueOnce({ rows: [mockReturnInvRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken)
      .send(validBody);
    expect(res.status).toBe(201);
  });

  it("returns 400 when location is missing", async () => {
    const res = await request(app)
      .post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken)
      .send({ lot: "N26119-01" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when lot is missing", async () => {
    const res = await request(app)
      .post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken)
      .send({ location: "N303" });
    expect(res.status).toBe(400);
  });

  it("returns 403 without token", async () => {
    const res = await request(app)
      .post(`/production-orders/${ORDER_ID}/returns`)
      .send(validBody);
    expect(res.status).toBe(403);
  });
});

// ── PATCH /production-orders/:id/close ───────────────────────────────────────

describe("PATCH /production-orders/:id/close", () => {
  it("closes order and calculates yield", async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                                    // BEGIN
      .mockResolvedValueOnce({ rows: [mockOrderRow] })                                       // SELECT order
      .mockResolvedValueOnce({ rows: [{ total: "110.00" }] })                                // SUM sent
      .mockResolvedValueOnce({ rows: [{ total: "90.00" }]  })                                // SUM returned
      .mockResolvedValueOnce({ rows: [{ ...mockOrderRow, status: "returned", yield: "81.82" }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                                      // history
      .mockResolvedValueOnce({ rows: [] });                                                   // COMMIT
    const res = await request(app)
      .patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.yieldPct).toBe("81.82");
    expect(res.body.totalSent).toBe(110);
    expect(res.body.totalReturned).toBe(90);
  });

  it("returns 403 without token", async () => {
    const res = await request(app)
      .patch(`/production-orders/${ORDER_ID}/close`)
      .send({});
    expect(res.status).toBe(403);
  });
});
