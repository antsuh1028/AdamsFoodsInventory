const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

// ── Env ──────────────────────────────────────────────────────────────────────
process.env.JWT_SECRET = "test-secret";
process.env.AWS_BUCKET_NAME = "test-bucket";
process.env.AWS_REGION = "us-east-1";
process.env.OPENAI_API_KEY = "test-key";

// ── Token helpers ─────────────────────────────────────────────────────────────
// tenantId is required even though most routes in this file are the Mongo-era
// ones that ignore it: routes/s3.js uses verifyToken.pg, which 401s outright on
// a token without a tenant. Without it the admin-only tests below returned 401
// and never reached the role check they exist to prove.
const makeToken = (role = "admin", username = "testuser") =>
  jwt.sign(
    { userId: "user123", role, username, tenantId: "23a57670-bc2d-487a-bab8-d05cf10acbc8" },
    process.env.JWT_SECRET, { expiresIn: "1h" }
  );

const adminToken = makeToken("admin", "admin@af.com");
const managerToken = makeToken("manager", "manager@af.com");
const userToken = makeToken("user", "user@af.com");

// ── Mock Mongoose models ──────────────────────────────────────────────────────
const mockItem = {
  _id: "item001",
  location: "A101",
  lot: "12345-01",
  vendor: "Test Vendor",
  brand: "Test Brand",
  species: "Beef",
  description: "Test Description",
  grade: "Choice",
  quantity: "10",
  weight: "500.00",
  packdate: "2024-01-01",
  date_recvd: "2024-01-02",
  est: "EST123",
  price: "5.00",
  type: "raw",
  boxes: [{ weight: "50" }],
  toObject() { return { ...this }; },
  markModified() {},
  async save() { return this; },
};

jest.mock("../models/Freezer", () => {
  const mock = {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    countDocuments: jest.fn(),
    deleteMany: jest.fn(),
    distinct: jest.fn(),
    create: jest.fn(),
    aggregate: jest.fn(),
  };
  const constructor = jest.fn(() => mockItem);
  Object.assign(constructor, mock);
  return constructor;
});

jest.mock("../models/History", () => ({
  create: jest.fn().mockResolvedValue({}),
  find: jest.fn(),
  countDocuments: jest.fn(),
  insertMany: jest.fn().mockResolvedValue([]),
}));

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));

// ── Mock AWS ──────────────────────────────────────────────────────────────────
jest.mock("../utils/aws", () => ({
  s3Client: { send: jest.fn().mockResolvedValue({}) },
  textractClient: { send: jest.fn() },
  upload: {
    single: () => (req, res, next) => {
      req.file = { buffer: Buffer.from("fake"), mimetype: "image/jpeg", originalname: "test.jpg" };
      next();
    },
  },
}));

jest.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://signed-url.example.com/test.jpg"),
}));

jest.mock("@aws-sdk/client-textract", () => ({
  DetectDocumentTextCommand: jest.fn(),
}));

jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  }));
});

jest.mock("heic-convert", () => jest.fn().mockResolvedValue(Buffer.from("converted")));

// ── Build test app ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use("/", require("../routes/auth"));
app.use("/", require("../routes/inventory"));
app.use("/", require("../routes/history"));
app.use("/", require("../routes/s3"));
app.use("/", require("../routes/scanner"));

// ── Shared model references ───────────────────────────────────────────────────
const FreezerModel = require("../models/Freezer");
const HistoryModel = require("../models/History");

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /login", () => {
  const UserModel = require("../models/User");

  beforeEach(() => jest.clearAllMocks());

  it("returns 401 for unknown user", async () => {
    UserModel.findOne.mockResolvedValue(null);
    const res = await request(app).post("/login").send({ email: "x@x.com", password: "pass" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong password", async () => {
    const bcrypt = require("bcrypt");
    UserModel.findOne.mockResolvedValue({ _id: "u1", username: "x@x.com", password: await bcrypt.hash("correct", 10), role: "admin" });
    const res = await request(app).post("/login").send({ email: "x@x.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns token on valid login", async () => {
    const bcrypt = require("bcrypt");
    UserModel.findOne.mockResolvedValue({ _id: "u1", username: "x@x.com", password: await bcrypt.hash("pass", 10), role: "admin" });
    const res = await request(app).post("/login").send({ email: "x@x.com", password: "pass" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY TOKEN / REQUIRE ROLE
// ─────────────────────────────────────────────────────────────────────────────
describe("Auth middleware", () => {
  beforeEach(() => jest.clearAllMocks());

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

  it("allows manager role on history route", async () => {
    HistoryModel.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
    const res = await request(app).get("/getHistory").set("Authorization", managerToken);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY ADD
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryAdd", () => {
  beforeEach(() => jest.clearAllMocks());

  const validInputs = {
    location: "A101",
    lot: "12345-01",
    species: "Beef",
    vendor: "V",
    brand: "B",
    description: "Desc",
    grade: "Choice",
    quantity: "10",
    weight: "500",
    type: "raw",
  };

  it("returns 400 if location is missing", async () => {
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: { ...validInputs, location: "" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 if location is invalid", async () => {
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: { ...validInputs, location: "ZZZZZ" } });
    expect(res.status).toBe(400);
  });

  it("returns 409 if location occupied and not forced", async () => {
    FreezerModel.countDocuments.mockResolvedValue(1);
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs, force: false });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LOCATION_OCCUPIED");
  });

  it("creates item successfully with force", async () => {
    FreezerModel.countDocuments.mockResolvedValue(1);
    FreezerModel.create.mockResolvedValue(mockItem);
    const res = await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs, force: true });
    expect(res.status).toBe(201);
    expect(HistoryModel.create).toHaveBeenCalled();
  });

  it("logs 'Scanner Add' when source is scanner", async () => {
    FreezerModel.countDocuments.mockResolvedValue(0);
    FreezerModel.create.mockResolvedValue(mockItem);
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs, source: "scanner" });
    expect(HistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({ change: "Scanner Add" }));
  });

  it("logs 'Added' when source is not scanner", async () => {
    FreezerModel.countDocuments.mockResolvedValue(0);
    FreezerModel.create.mockResolvedValue(mockItem);
    await request(app).post("/inventoryAdd").set("Authorization", userToken)
      .send({ inputs: validInputs });
    expect(HistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({ change: "Added" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY UPDATE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryUpdate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 if location missing", async () => {
    const res = await request(app).post("/inventoryUpdate").set("Authorization", userToken)
      .send({ updateInputs: { currentItem: { _id: "item001" } } });
    expect(res.status).toBe(400);
  });

  it("returns 404 if item not found", async () => {
    FreezerModel.findByIdAndUpdate.mockResolvedValue(null);
    const res = await request(app).post("/inventoryUpdate").set("Authorization", userToken)
      .send({ updateInputs: { location: "A101", currentItem: { _id: "item001" } } });
    expect(res.status).toBe(404);
  });

  it("updates and logs history", async () => {
    FreezerModel.findByIdAndUpdate.mockResolvedValue(mockItem);
    const res = await request(app).post("/inventoryUpdate").set("Authorization", userToken)
      .send({ updateInputs: { location: "A101", lot: "12345-01", currentItem: { _id: "item001" } } });
    expect(res.status).toBe(200);
    expect(HistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({ change: "Updated" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY REMOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryRemove", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 if no ID", async () => {
    const res = await request(app).post("/inventoryRemove").set("Authorization", userToken).send({ currentItem: {} });
    expect(res.status).toBe(400);
  });

  it("returns 404 if item not found", async () => {
    FreezerModel.findByIdAndDelete.mockResolvedValue(null);
    const res = await request(app).post("/inventoryRemove").set("Authorization", userToken).send({ currentItem: { _id: "item001" } });
    expect(res.status).toBe(404);
  });

  it("removes and logs history", async () => {
    FreezerModel.findByIdAndDelete.mockResolvedValue(mockItem);
    const res = await request(app).post("/inventoryRemove").set("Authorization", userToken).send({ currentItem: { _id: "item001" } });
    expect(res.status).toBe(200);
    expect(HistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({ change: "Removed" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY MOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryMove", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 if missing params", async () => {
    const res = await request(app).post("/inventoryMove").set("Authorization", userToken).send({ itemId: "item001" });
    expect(res.status).toBe(400);
  });

  it("returns 404 if item not found", async () => {
    FreezerModel.findById.mockResolvedValue(null);
    const res = await request(app).post("/inventoryMove").set("Authorization", userToken).send({ itemId: "item001", destLocation: "B101" });
    expect(res.status).toBe(404);
  });

  it("moves and logs with from→to", async () => {
    FreezerModel.findById.mockResolvedValue({ ...mockItem, location: "A101" });
    FreezerModel.findByIdAndUpdate.mockResolvedValue({ ...mockItem, location: "B101" });
    const res = await request(app).post("/inventoryMove").set("Authorization", userToken).send({ itemId: "item001", destLocation: "B101" });
    expect(res.status).toBe(200);
    expect(HistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({ change: "Moved: A101 → B101" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BULK REMOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryBulkRemove", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 if no IDs", async () => {
    const res = await request(app).post("/inventoryBulkRemove").set("Authorization", userToken).send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("removes items and logs one history entry per item", async () => {
    const items = [mockItem, { ...mockItem, _id: "item002" }];
    FreezerModel.find.mockReturnValue({ lean: () => Promise.resolve(items) });
    FreezerModel.deleteMany.mockResolvedValue({ deletedCount: 2 });
    const res = await request(app).post("/inventoryBulkRemove").set("Authorization", userToken).send({ ids: ["item001", "item002"] });
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(2);
    expect(HistoryModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ change: "Bulk Removed" })])
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH FIELD
// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /inventory/:id/field", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 for invalid field", async () => {
    const res = await request(app).patch("/inventory/item001/field").set("Authorization", userToken).send({ field: "boxes", value: "x" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing field", async () => {
    const res = await request(app).patch("/inventory/item001/field").set("Authorization", userToken).send({ value: "x" });
    expect(res.status).toBe(400);
  });

  it("updates editable field and logs history", async () => {
    FreezerModel.findByIdAndUpdate.mockResolvedValue(mockItem);
    const res = await request(app).patch("/inventory/item001/field").set("Authorization", userToken).send({ field: "lot", value: "99999-01" });
    expect(res.status).toBe(200);
    expect(HistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({ change: 'Field Updated: lot → "99999-01"' }));
  });

  it("allows type as an editable field", async () => {
    FreezerModel.findByIdAndUpdate.mockResolvedValue(mockItem);
    const res = await request(app).patch("/inventory/item001/field").set("Authorization", userToken).send({ field: "type", value: "prc" });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOX ADD / REMOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /inventory/:id/box", () => {
  beforeEach(() => jest.clearAllMocks());

  it("add — returns 400 if weight missing", async () => {
    const res = await request(app).patch("/inventory/item001/box/add").set("Authorization", userToken).send({});
    expect(res.status).toBe(400);
  });

  it("add — adds box and logs history", async () => {
    FreezerModel.findById.mockResolvedValue({ ...mockItem, boxes: [], markModified: jest.fn(), save: jest.fn().mockResolvedValue(mockItem) });
    const res = await request(app).patch("/inventory/item001/box/add").set("Authorization", userToken).send({ weight: "55.5" });
    expect(res.status).toBe(200);
    expect(HistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({ change: expect.stringContaining("Box Added") }));
  });

  it("remove — returns 400 if index missing", async () => {
    const res = await request(app).patch("/inventory/item001/box/remove").set("Authorization", userToken).send({});
    expect(res.status).toBe(400);
  });

  it("remove — returns 400 for invalid index", async () => {
    FreezerModel.findById.mockResolvedValue({ ...mockItem, boxes: [{ weight: "50" }] });
    const res = await request(app).patch("/inventory/item001/box/remove").set("Authorization", userToken).send({ index: 5 });
    expect(res.status).toBe(400);
  });

  it("remove — removes box and logs history", async () => {
    const item = { ...mockItem, boxes: [{ weight: "50" }, { weight: "60" }], markModified: jest.fn(), save: jest.fn().mockResolvedValue(mockItem) };
    FreezerModel.findById.mockResolvedValue(item);
    const res = await request(app).patch("/inventory/item001/box/remove").set("Authorization", userToken).send({ index: 0 });
    expect(res.status).toBe(200);
    expect(HistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({ change: expect.stringContaining("Box Removed") }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /getHistory", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns history for admin", async () => {
    HistoryModel.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([{ change: "Added" }]) }) });
    const res = await request(app).get("/getHistory").set("Authorization", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns history for manager", async () => {
    HistoryModel.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
    const res = await request(app).get("/getHistory").set("Authorization", managerToken);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ORDER PARTIAL REMOVE
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /inventoryOrderRemove", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 if no removals", async () => {
    const res = await request(app).post("/inventoryOrderRemove").set("Authorization", userToken).send({ removals: [] });
    expect(res.status).toBe(400);
  });

  it("marks item as not_found if missing", async () => {
    FreezerModel.findById.mockResolvedValue(null);
    const res = await request(app).post("/inventoryOrderRemove").set("Authorization", userToken)
      .send({ removals: [{ id: "missing", quantityToRemove: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("not_found");
  });

  it("deletes item when all boxes removed", async () => {
    const item = { ...mockItem, boxes: [{ weight: "50" }], markModified: jest.fn(), save: jest.fn() };
    FreezerModel.findById.mockResolvedValue(item);
    FreezerModel.findByIdAndDelete.mockResolvedValue(item);
    const res = await request(app).post("/inventoryOrderRemove").set("Authorization", userToken)
      .send({ removals: [{ id: "item001", quantityToRemove: 1 }] });
    expect(res.body.results[0].status).toBe("deleted");
    expect(HistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({ change: expect.stringContaining("item deleted") }));
  });

  it("updates item when boxes remain", async () => {
    const item = { ...mockItem, boxes: [{ weight: "50" }, { weight: "60" }], markModified: jest.fn(), save: jest.fn().mockResolvedValue({}) };
    FreezerModel.findById.mockResolvedValue(item);
    const res = await request(app).post("/inventoryOrderRemove").set("Authorization", userToken)
      .send({ removals: [{ id: "item001", quantityToRemove: 1 }] });
    expect(res.body.results[0].status).toBe("updated");
    expect(res.body.results[0].remaining).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRE ROLE — admin-only routes
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin-only routes reject non-admin", () => {
  it("GET /inventoryAll — user gets 403", async () => {
    const res = await request(app).get("/inventoryAll").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });

  it("GET /inventoryStats — user gets 403", async () => {
    const res = await request(app).get("/inventoryStats").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });

  it("POST /upload-pdf — user gets 403", async () => {
    const res = await request(app).post("/upload-pdf").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });

  it("GET /list-scans — user gets 403", async () => {
    const res = await request(app).get("/list-scans").set("Authorization", userToken);
    expect(res.status).toBe(403);
  });
});
