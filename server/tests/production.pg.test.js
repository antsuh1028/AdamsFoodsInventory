const request = require("supertest");
const express = require("express");
const jwt     = require("jsonwebtoken");

// ── Env ───────────────────────────────────────────────────────────────────────
process.env.JWT_SECRET      = "test-secret";
process.env.AWS_BUCKET_NAME = "test-bucket";
process.env.AWS_REGION      = "us-east-1";

const TENANT_ID     = "23a57670-bc2d-487a-bab8-d05cf10acbc8";
const USER_ID       = "550e8400-e29b-41d4-a716-446655440001";
const INV_ID        = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PRC_INV_ID    = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ORDER_ID      = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ORDER_ITEM_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const RETURN_ID     = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const makeToken = (role = "admin") =>
  jwt.sign({ userId: USER_ID, role, username: "tester", tenantId: TENANT_ID }, process.env.JWT_SECRET, { expiresIn: "1h" });

const adminToken = makeToken("admin");
const userToken  = makeToken("user");

// ── Mock data ─────────────────────────────────────────────────────────────────
const fiveBoxes = [
  { weight: "50" }, { weight: "50" }, { weight: "50" }, { weight: "50" }, { weight: "50" },
];

const pgInvItem = {
  id: INV_ID, tenant_id: TENANT_ID,
  location: "N302", lot: "TEST-LOT", vendor: "Test Vendor", brand: "Test Brand",
  species: "Beef", description: "Short Ribs", grade: "Choice",
  quantity: "5", weight: "250.00",
  packdate: "2026-04-01", date_recvd: "2026-04-01",
  est: null, price: null, type: "raw", scan_image_key: null, source_id: null,
  boxes: fiveBoxes,
};

const pgPrcItem = {
  id: PRC_INV_ID, tenant_id: TENANT_ID,
  location: "N303", lot: "NB-001", vendor: "Noblesse Trading", brand: "Adams Foods",
  species: "Beef", description: "Short Ribs Processed", grade: "Choice",
  quantity: "3", weight: "140.00",
  packdate: "2026-04-20", date_recvd: "2026-04-20",
  est: null, price: null, type: "prc", scan_image_key: null, source_id: INV_ID,
  boxes: [{ weight: "45" }, { weight: "48" }, { weight: "47" }],
};

const pgOrder = {
  id: ORDER_ID, tenant_id: TENANT_ID,
  sent_date: "2026-04-20", processor_name: "Noblesse Trading",
  status: "pending", return_date: null, yield: null,
  created_at: new Date(),
};

const pgOrderClosed = { ...pgOrder, status: "returned", return_date: "2026-04-25", yield: "56.00" };

const pgOrderItem = {
  id: ORDER_ITEM_ID, production_order_id: ORDER_ID,
  inventory_id: INV_ID, weight_sent: "250.00",
  boxes_sent: fiveBoxes,
  location: "N302", lot: "TEST-LOT", species: "Beef", description: "Short Ribs",
};

const pgReturn = {
  id: RETURN_ID, production_order_id: ORDER_ID,
  inventory_id: PRC_INV_ID, created_at: new Date(),
  location: "N303", lot: "NB-001", species: "Beef", description: "Short Ribs Processed",
};

// ── Mock pg pool ──────────────────────────────────────────────────────────────
const mockClient = { query: jest.fn(), release: jest.fn() };

jest.mock("../utils/pg", () => ({ query: jest.fn(), connect: jest.fn() }));
const pool = require("../utils/pg");

// Default transactional query handler for production routes
const makeHandler = (overrides = {}) => (sql = "") => {
  for (const [key, val] of Object.entries(overrides)) {
    if (sql.includes(key)) return Promise.resolve(val);
  }
  const s = sql.toLowerCase().trim();
  if (/^(begin|commit|rollback)/.test(s))                   return Promise.resolve({ rows: [] });
  if (s.includes("into history"))                            return Promise.resolve({ rows: [], rowCount: 1 });
  if (s.includes("insert into production_orders"))           return Promise.resolve({ rows: [pgOrder], rowCount: 1 });
  if (s.includes("insert into production_order_items"))      return Promise.resolve({ rows: [], rowCount: 1 });
  if (s.includes("insert into production_order_returns"))    return Promise.resolve({ rows: [], rowCount: 1 });
  if (s.includes("insert into inventory"))                   return Promise.resolve({ rows: [pgPrcItem], rowCount: 1 });
  if (s.includes("update production_orders"))                return Promise.resolve({ rows: [pgOrderClosed], rowCount: 1 });
  if (s.includes("update inventory"))                        return Promise.resolve({ rows: [pgInvItem], rowCount: 1 });
  if (s.includes("delete from inventory"))                   return Promise.resolve({ rows: [pgInvItem], rowCount: 1 });
  if (s.includes("delete from production_order_returns"))    return Promise.resolve({ rows: [], rowCount: 1 });
  if (s.includes("delete from production_order_items"))      return Promise.resolve({ rows: [], rowCount: 1 });
  if (s.includes("delete from production_orders"))           return Promise.resolve({ rows: [], rowCount: 1 });
  // SUM queries must be checked before generic table-scan matches
  if (s.includes("coalesce(sum(weight_sent)"))               return Promise.resolve({ rows: [{ total: "250.00" }] });
  if (s.includes("coalesce(sum(i.weight)"))                  return Promise.resolve({ rows: [{ total: "140.00" }] });
  if (s.includes("select * from production_orders"))         return Promise.resolve({ rows: [pgOrder], rowCount: 1 });
  if (s.includes("select * from inventory") || s.includes("from inventory where id"))
    return Promise.resolve({ rows: [pgInvItem], rowCount: 1 });
  if (s.includes("from production_order_items"))             return Promise.resolve({ rows: [pgOrderItem], rowCount: 1 });
  if (s.includes("from production_order_returns"))           return Promise.resolve({ rows: [pgReturn], rowCount: 1 });
  return Promise.resolve({ rows: [], rowCount: 0 });
};

// ── Build test app ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use("/", require("../routes/production.pg"));

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(mockClient);
  mockClient.release.mockReturnValue(undefined);
  mockClient.query.mockImplementation(makeHandler());
  pool.query.mockImplementation((sql = "") => {
    const s = sql.toLowerCase();
    if (s.includes("from production_orders"))      return Promise.resolve({ rows: [pgOrder] });
    if (s.includes("from production_order_items")) return Promise.resolve({ rows: [pgOrderItem] });
    if (s.includes("from production_order_returns")) return Promise.resolve({ rows: [pgReturn] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

// =============================================================================
// POST /production-orders — Create order (Step 2)
// =============================================================================
describe("POST /production-orders", () => {
  const validBody = {
    sentDate: "2026-04-20",
    processorName: "Noblesse Trading",
    items: [{ inventoryId: INV_ID, weightSent: 250, boxesSent: fiveBoxes }],
  };

  it("returns 400 if sentDate is missing", async () => {
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ ...validBody, sentDate: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sentDate/i);
  });

  it("returns 400 if processorName is missing", async () => {
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ ...validBody, processorName: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/processorName/i);
  });

  it("returns 400 if items array is empty", async () => {
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ ...validBody, items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/items/i);
  });

  it("returns 400 if item is missing inventoryId", async () => {
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ ...validBody, items: [{ weightSent: 250, boxesSent: fiveBoxes }] });
    expect(res.status).toBe(400);
  });

  it("returns 400 if inventory item not found", async () => {
    mockClient.query.mockImplementation(makeHandler({
      "SELECT id, weight, boxes FROM inventory": { rows: [], rowCount: 0 },
    }));
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 if weightSent exceeds available weight", async () => {
    const lightItem = { ...pgInvItem, weight: "100.00" };
    mockClient.query.mockImplementation(makeHandler({
      "SELECT id, weight, boxes FROM inventory": { rows: [lightItem], rowCount: 1 },
    }));
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ ...validBody, items: [{ inventoryId: INV_ID, weightSent: 999, boxesSent: fiveBoxes }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds/i);
  });

  it("returns 201 and creates order on success (partial pallet → UPDATE inventory)", async () => {
    const partialBoxes = [{ weight: "50" }, { weight: "50" }];
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ ...validBody, items: [{ inventoryId: INV_ID, weightSent: 100, boxesSent: partialBoxes }] });
    expect(res.status).toBe(201);
    expect(res.body.order.id).toBe(ORDER_ID);
    expect(res.body.order.processorName).toBe("Noblesse Trading");
  });

  it("DELETEs inventory item when all boxes are sent", async () => {
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send(validBody); // all 5 boxes = full pallet
    expect(res.status).toBe(201);
    const deleteCalls = mockClient.query.mock.calls.filter(([sql]) =>
      sql.toLowerCase().includes("delete from inventory")
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("UPDATEs inventory when partial boxes remain", async () => {
    const partialBoxes = [{ weight: "50" }, { weight: "50" }];
    await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ ...validBody, items: [{ inventoryId: INV_ID, weightSent: 100, boxesSent: partialBoxes }] });
    const updateCalls = mockClient.query.mock.calls.filter(([sql]) =>
      sql.toLowerCase().startsWith("update inventory")
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("logs 'Sent to Processor' history for each item", async () => {
    await request(app).post("/production-orders").set("Authorization", adminToken)
      .send(validBody);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, p]) => p.some((v) => typeof v === "string" && v.includes("Sent to Processor")))).toBe(true);
  });

  it("logs 'Removed' history when full pallet is deleted", async () => {
    await request(app).post("/production-orders").set("Authorization", adminToken)
      .send(validBody);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, p]) => p.some((v) => typeof v === "string" && v.includes("Removed")))).toBe(true);
  });

  it("rolls back on DB error", async () => {
    mockClient.query.mockImplementation((sql = "") => {
      if (/^begin/i.test(sql)) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO production_orders")) return Promise.reject(new Error("DB fail"));
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("returns 403 with no token", async () => {
    const res = await request(app).post("/production-orders").send(validBody);
    expect(res.status).toBe(403);
  });

  it("order includes correct status=pending on creation", async () => {
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send(validBody);
    expect(res.body.order.status).toBe("pending");
  });

  it("response includes items array with boxesSent", async () => {
    const res = await request(app).post("/production-orders").set("Authorization", adminToken)
      .send(validBody);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items[0].boxesSent).toHaveLength(5);
  });
});

// =============================================================================
// GET /production-orders — List orders
// =============================================================================
describe("GET /production-orders", () => {
  it("returns 200 with orders list", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgOrder] });
    const res = await request(app).get("/production-orders").set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(ORDER_ID);
  });

  it("returns empty array when no orders", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/production-orders").set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("passes status filter in query when provided", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgOrder] });
    await request(app).get("/production-orders?status=pending").set("Authorization", adminToken);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql.toLowerCase()).toContain("status");
    expect(params).toContain("pending");
  });

  it("scopes query to tenant_id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get("/production-orders").set("Authorization", adminToken);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql.toLowerCase()).toContain("tenant_id");
    expect(params[0]).toBe(TENANT_ID);
  });

  it("formats order fields correctly", async () => {
    pool.query.mockResolvedValueOnce({ rows: [pgOrder] });
    const res = await request(app).get("/production-orders").set("Authorization", adminToken);
    const order = res.body[0];
    expect(order.id).toBe(ORDER_ID);
    expect(order.processorName).toBe("Noblesse Trading");
    expect(order.sentDate).toBe("2026-04-20");
    expect(order.status).toBe("pending");
  });

  it("returns 403 without token", async () => {
    const res = await request(app).get("/production-orders");
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GET /production-orders/:id — Single order with items + returns
// =============================================================================
describe("GET /production-orders/:id", () => {
  it("returns 404 if order not found", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // order query
    const res = await request(app).get(`/production-orders/${ORDER_ID}`).set("Authorization", adminToken);
    expect(res.status).toBe(404);
  });

  it("returns order with items and returns", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pgOrder] })
      .mockResolvedValueOnce({ rows: [pgOrderItem] })
      .mockResolvedValueOnce({ rows: [pgReturn] });
    const res = await request(app).get(`/production-orders/${ORDER_ID}`).set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(ORDER_ID);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.returns).toHaveLength(1);
  });

  it("items include location and species from JOIN", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pgOrder] })
      .mockResolvedValueOnce({ rows: [pgOrderItem] })
      .mockResolvedValueOnce({ rows: [pgReturn] });
    const res = await request(app).get(`/production-orders/${ORDER_ID}`).set("Authorization", adminToken);
    expect(res.body.items[0].location).toBe("N302");
    expect(res.body.items[0].species).toBe("Beef");
  });

  it("returns include location from JOIN", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pgOrder] })
      .mockResolvedValueOnce({ rows: [pgOrderItem] })
      .mockResolvedValueOnce({ rows: [pgReturn] });
    const res = await request(app).get(`/production-orders/${ORDER_ID}`).set("Authorization", adminToken);
    expect(res.body.returns[0].location).toBe("N303");
  });

  it("returns 403 without token", async () => {
    const res = await request(app).get(`/production-orders/${ORDER_ID}`);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// POST /production-orders/:id/returns — Add return pallet (Step 3)
// =============================================================================
describe("POST /production-orders/:id/returns", () => {
  const validReturn = {
    location: "N303", lot: "NB-001", species: "Beef",
    description: "Short Ribs Processed", grade: "Choice",
    brand: "Adams Foods", packdate: "2026-04-20", date_recvd: "2026-04-20",
    boxes: [{ weight: "45" }, { weight: "48" }, { weight: "47" }],
  };

  it("returns 400 if location is missing", async () => {
    const res = await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send({ ...validReturn, location: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/location/i);
  });

  it("returns 400 if lot is missing", async () => {
    const res = await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send({ ...validReturn, lot: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lot/i);
  });

  it("returns 400 if order not found", async () => {
    mockClient.query.mockImplementation(makeHandler({
      "SELECT * FROM production_orders": { rows: [], rowCount: 0 },
    }));
    const res = await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send(validReturn);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 201 and creates prc inventory item on success", async () => {
    const res = await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send(validReturn);
    expect(res.status).toBe(201);
    expect(res.body.inventoryId).toBe(PRC_INV_ID);
    expect(res.body.location).toBe("N303");
  });

  it("inserts prc inventory item with type='prc'", async () => {
    await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send(validReturn);
    const insertCall = mockClient.query.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("insert into inventory")
    );
    expect(insertCall).toBeDefined();
    // 'prc' is a SQL literal in the INSERT, not a parameter
    expect(insertCall[0]).toContain("'prc'");
  });

  it("sets vendor = processor_name on the new inventory item", async () => {
    await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send(validReturn);
    const insertCall = mockClient.query.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("insert into inventory")
    );
    expect(insertCall[1]).toContain("Noblesse Trading");
  });

  it("calculates weight from boxes", async () => {
    await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send(validReturn);
    const insertCall = mockClient.query.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("insert into inventory")
    );
    // 45 + 48 + 47 = 140
    const weight = insertCall[1].find((v) => v === "140.00" || v === 140 || parseFloat(v) === 140);
    expect(weight).toBeDefined();
  });

  it("logs 'Returned from Processor' history", async () => {
    await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send(validReturn);
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, p]) => p.some((v) => typeof v === "string" && v.includes("Returned from Processor")))).toBe(true);
  });

  it("inserts a production_order_returns record", async () => {
    await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send(validReturn);
    const returnInsert = mockClient.query.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("insert into production_order_returns")
    );
    expect(returnInsert).toBeDefined();
  });

  it("rolls back on error", async () => {
    mockClient.query.mockImplementation((sql = "") => {
      if (/^begin/i.test(sql)) return Promise.resolve({ rows: [] });
      if (sql.includes("SELECT * FROM production_orders")) return Promise.resolve({ rows: [pgOrder] });
      if (sql.toLowerCase().includes("insert into inventory")) return Promise.reject(new Error("DB fail"));
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post(`/production-orders/${ORDER_ID}/returns`)
      .set("Authorization", adminToken).send(validReturn);
    expect(res.status).toBe(400);
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
  });
});

// =============================================================================
// PATCH /production-orders/:id/close — Close order + yield
// =============================================================================
describe("PATCH /production-orders/:id/close", () => {
  it("returns 400 if order not found", async () => {
    mockClient.query.mockImplementation(makeHandler({
      "SELECT * FROM production_orders": { rows: [], rowCount: 0 },
    }));
    const res = await request(app).patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 if order is already closed", async () => {
    mockClient.query.mockImplementation(makeHandler({
      "SELECT * FROM production_orders": { rows: [pgOrderClosed], rowCount: 1 },
    }));
    const res = await request(app).patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already closed/i);
  });

  it("returns 200 with yield, totalSent, totalReturned", async () => {
    const res = await request(app).patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken).send({});
    expect(res.status).toBe(200);
    expect(res.body.totalSent).toBe(250);
    expect(res.body.totalReturned).toBe(140);
    expect(res.body.yieldPct).toBe("56.00");
  });

  it("calculates yield as (returned / sent) * 100", async () => {
    const res = await request(app).patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken).send({});
    const expected = ((140 / 250) * 100).toFixed(2);
    expect(res.body.yieldPct).toBe(expected);
  });

  it("sets status to 'returned' on the order", async () => {
    const res = await request(app).patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken).send({});
    expect(res.body.order.status).toBe("returned");
  });

  it("uses returnDate from body when provided", async () => {
    await request(app).patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken).send({ returnDate: "2026-04-25" });
    const updateCall = mockClient.query.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("update production_orders")
    );
    expect(updateCall[1]).toContain("2026-04-25");
  });

  it("logs 'Production Order Closed' history", async () => {
    await request(app).patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken).send({});
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, p]) => p.some((v) => typeof v === "string" && v.includes("Production Order Closed")))).toBe(true);
  });

  it("history entry includes yield percentage", async () => {
    await request(app).patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken).send({});
    const historyCalls = mockClient.query.mock.calls.filter(([sql]) => sql.toLowerCase().includes("into history"));
    expect(historyCalls.some(([, p]) => p.some((v) => typeof v === "string" && v.includes("56.00")))).toBe(true);
  });

  it("rolls back on error", async () => {
    mockClient.query.mockImplementation((sql = "") => {
      if (/^begin/i.test(sql)) return Promise.resolve({ rows: [] });
      if (sql.includes("SELECT * FROM production_orders")) return Promise.resolve({ rows: [pgOrder] });
      if (sql.toLowerCase().includes("coalesce(sum(weight_sent)")) return Promise.reject(new Error("DB fail"));
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).patch(`/production-orders/${ORDER_ID}/close`)
      .set("Authorization", adminToken).send({});
    expect(res.status).toBe(400);
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
  });
});

// =============================================================================
// DELETE /production-orders/:id — Cancel order
// =============================================================================
describe("DELETE /production-orders/:id", () => {
  it("returns 400 if order not found", async () => {
    mockClient.query.mockImplementation(makeHandler({
      "SELECT * FROM production_orders": { rows: [], rowCount: 0 },
    }));
    const res = await request(app).delete(`/production-orders/${ORDER_ID}`)
      .set("Authorization", adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 200 with returnedItemsRemoved count", async () => {
    const res = await request(app).delete(`/production-orders/${ORDER_ID}`)
      .set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
    expect(typeof res.body.returnedItemsRemoved).toBe("number");
  });

  it("deletes return records before inventory (FK order)", async () => {
    await request(app).delete(`/production-orders/${ORDER_ID}`)
      .set("Authorization", adminToken);
    const calls = mockClient.query.mock.calls.map(([sql]) => sql.toLowerCase());
    const returnDeleteIdx  = calls.findIndex((s) => s.includes("delete from production_order_returns"));
    const invDeleteIdx     = calls.findIndex((s) => s.includes("delete from inventory"));
    expect(returnDeleteIdx).toBeLessThan(invDeleteIdx);
  });

  it("deletes order items before the order itself", async () => {
    await request(app).delete(`/production-orders/${ORDER_ID}`)
      .set("Authorization", adminToken);
    const calls = mockClient.query.mock.calls.map(([sql]) => sql.toLowerCase());
    const itemDeleteIdx  = calls.findIndex((s) => s.includes("delete from production_order_items"));
    const orderDeleteIdx = calls.findIndex((s) => s.includes("delete from production_orders") && !s.includes("items") && !s.includes("returns"));
    expect(itemDeleteIdx).toBeLessThan(orderDeleteIdx);
  });

  it("rolls back on error", async () => {
    mockClient.query.mockImplementation((sql = "") => {
      if (/^begin/i.test(sql)) return Promise.resolve({ rows: [] });
      if (sql.includes("SELECT * FROM production_orders")) return Promise.resolve({ rows: [pgOrder] });
      if (sql.toLowerCase().includes("from production_order_returns")) return Promise.reject(new Error("DB fail"));
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).delete(`/production-orders/${ORDER_ID}`)
      .set("Authorization", adminToken);
    expect(res.status).toBe(400);
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("returns 403 without token", async () => {
    const res = await request(app).delete(`/production-orders/${ORDER_ID}`);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// Tenant isolation
// =============================================================================
describe("Production routes — tenant isolation", () => {
  it("GET /production-orders scopes to tenant_id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get("/production-orders").set("Authorization", adminToken);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql.toLowerCase()).toContain("tenant_id");
    expect(params[0]).toBe(TENANT_ID);
  });

  it("POST /production-orders INSERT includes tenant_id", async () => {
    await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ sentDate: "2026-04-20", processorName: "Noblesse Trading", items: [{ inventoryId: INV_ID, weightSent: 250, boxesSent: fiveBoxes }] });
    const insertOrder = mockClient.query.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("insert into production_orders")
    );
    expect(insertOrder[1]).toContain(TENANT_ID);
  });

  it("GET /production-orders/:id scopes to tenant_id", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pgOrder] })
      .mockResolvedValueOnce({ rows: [pgOrderItem] })
      .mockResolvedValueOnce({ rows: [] });
    await request(app).get(`/production-orders/${ORDER_ID}`).set("Authorization", adminToken);
    const orderQuery = pool.query.mock.calls[0];
    expect(orderQuery[1]).toContain(TENANT_ID);
  });

  it("token missing tenantId returns 401", async () => {
    const noTenantToken = jwt.sign({ userId: USER_ID, role: "admin" }, process.env.JWT_SECRET);
    const res = await request(app).get("/production-orders").set("Authorization", noTenantToken);
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Box removal correctness — splice logic for duplicate weights
// =============================================================================
describe("Box removal splice logic", () => {
  it("removes only the correct number of boxes when duplicates exist", async () => {
    // Inventory has 4 boxes all at 50lb. Send 2 of them → 2 should remain.
    const fourBoxes = [{ weight: "50" }, { weight: "50" }, { weight: "50" }, { weight: "50" }];
    const invWithDupes = { ...pgInvItem, boxes: fourBoxes, weight: "200.00", quantity: "4" };
    const twoBoxes    = [{ weight: "50" }, { weight: "50" }];

    mockClient.query.mockImplementation(makeHandler({
      "SELECT id, weight, boxes FROM inventory": { rows: [invWithDupes], rowCount: 1 },
    }));

    await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ sentDate: "2026-04-20", processorName: "Noblesse Trading",
              items: [{ inventoryId: INV_ID, weightSent: 100, boxesSent: twoBoxes }] });

    const updateCall = mockClient.query.mock.calls.find(([sql]) =>
      sql.toLowerCase().startsWith("update inventory set weight")
    );
    // Should have updated (2 boxes remain), not deleted
    expect(updateCall).toBeDefined();
    const boxesParam = updateCall[1][1]; // $2 = boxes JSON
    const remaining  = JSON.parse(boxesParam);
    expect(remaining).toHaveLength(2);
  });

  it("deletes inventory when all duplicate-weight boxes are sent", async () => {
    const fourBoxes = [{ weight: "50" }, { weight: "50" }, { weight: "50" }, { weight: "50" }];
    const invWithDupes = { ...pgInvItem, boxes: fourBoxes, weight: "200.00", quantity: "4" };

    mockClient.query.mockImplementation(makeHandler({
      "SELECT id, weight, boxes FROM inventory": { rows: [invWithDupes], rowCount: 1 },
    }));

    await request(app).post("/production-orders").set("Authorization", adminToken)
      .send({ sentDate: "2026-04-20", processorName: "Noblesse Trading",
              items: [{ inventoryId: INV_ID, weightSent: 200, boxesSent: fourBoxes }] });

    const deleteCalls = mockClient.query.mock.calls.filter(([sql]) =>
      sql.toLowerCase().includes("delete from inventory")
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });
});
