// Adams Foods orders: the office's order sheet, made in the app. A customer's
// template is what it usually orders; an order starts from it and keeps only
// the lines asked for. Prices are admin-only, on the way out and on the way in.

const router = require("express").Router();
const multer = require("multer");
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { isAdminRole } = require("../middleware/roles");
const { pacificToday } = require("../utils/lot");
const { readOrderWorkbook } = require("../utils/afOrderSheet");

const ORDER_ROLES = ["admin", "manager"];
const DAYS = ["MON", "TUES", "WED", "THUR", "FRI", "SAT", "SUN"];
const LBS_RE = /^\d{1,7}(\.\d{1,3})?$/;
const PRICE_RE = /^\d{1,6}(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const fmtDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d || null));
const text = (v, max = 200) => {
  const t = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const key = (code, description) => `${String(code).trim()}|${String(description).trim().toUpperCase()}`;
const sendError = (res, err, what) => {
  if (err.status) return res.status(err.status).json({ code: err.code, error: err.message });
  console.error(`${what}:`, err);
  return res.status(500).json({ error: "Internal Server Error" });
};

const fmtTemplateLine = (r, admin) => ({
  id: r.id, position: r.position, code: r.code, tag: r.tag, description: r.description,
  ...(admin ? { price: r.price != null ? String(r.price) : null } : {}),
});

const fmtCustomer = (r) => ({
  customerId: r.customer_id, name: r.name, displayName: r.display_name || r.name,
  shipTo: r.ship_to, dueDay: r.due_day, templateFrom: fmtDay(r.template_from),
  active: r.active, lineCount: r.line_count != null ? Number(r.line_count) : undefined,
});

const fmtLine = (r, admin) => ({
  lineId: r.line_id, position: r.position, code: r.code, tag: r.tag, description: r.description,
  qtyCases: r.qty_cases, lbs: r.lbs != null ? String(r.lbs) : null, note: r.note,
  fromTemplate: r.from_template,
  ...(admin ? { price: r.price != null ? String(r.price) : null } : {}),
});

const fmtOrder = (r) => ({
  orderId: r.order_id, orderNo: r.order_no, customerId: r.customer_id, customerName: r.customer_name,
  shipTo: r.ship_to, orderDate: fmtDay(r.order_date), dueDay: r.due_day, po: r.po, notes: r.notes,
  status: r.status, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  sentBy: r.sent_by, sentAt: r.sent_at, cancelledBy: r.cancelled_by, cancelledAt: r.cancelled_at,
  filledBy: r.filled_by, filledAt: r.filled_at, checkedBy: r.checked_by,
  ...(r.line_count != null ? {
    lineCount: Number(r.line_count), cases: Number(r.cases || 0), lbsOnly: r.lbs_only != null ? String(r.lbs_only) : "0",
  } : {}),
});

// ── Item codes ───────────────────────────────────────────────────────────────

router.get("/af-items", verifyToken, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  try {
    const { rows } = await pool.query(
      `SELECT item_id, code, tag, description FROM af_items
        WHERE tenant_id = $1 AND active AND ($2 = '%%' OR code ILIKE $2 OR description ILIKE $2)
        ORDER BY code, description LIMIT $3`, [req.tenantId, like, limit]);
    res.json(rows.map((r) => ({ itemId: r.item_id, code: r.code, tag: r.tag, description: r.description })));
  } catch (err) {
    sendError(res, err, "list af items");
  }
});

router.post("/af-items", verifyToken, requireRole("admin"), async (req, res) => {
  const code = text(req.body?.code, 12);
  const description = text(req.body?.description);
  if (!code || !/^\d{5,7}$/.test(code)) return res.status(400).json({ error: "An item code is 5 to 7 digits." });
  if (!description) return res.status(400).json({ error: "Say what the item is." });
  try {
    const { rows } = await pool.query(
      `INSERT INTO af_items (tenant_id, code, tag, description) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, code, description) DO UPDATE SET active = TRUE
       RETURNING item_id, code, tag, description`,
      [req.tenantId, code, text(req.body?.tag, 12)?.toUpperCase() || null, description.toUpperCase()]);
    const r = rows[0];
    res.status(201).json({ itemId: r.item_id, code: r.code, tag: r.tag, description: r.description });
  } catch (err) {
    sendError(res, err, "add af item");
  }
});

// ── Customers and their templates ────────────────────────────────────────────

router.get("/af-customers", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM af_customer_items i WHERE i.customer_id = c.customer_id) AS line_count
         FROM af_customers c WHERE c.tenant_id = $1
        ORDER BY c.active DESC, c.name`, [req.tenantId]);
    res.json(rows.map(fmtCustomer));
  } catch (err) {
    sendError(res, err, "list af customers");
  }
});

const loadCustomer = async (db, tenantId, id, admin) => {
  const c = await db.query("SELECT * FROM af_customers WHERE customer_id = $1 AND tenant_id = $2", [id, tenantId]);
  if (!c.rows.length) return null;
  const lines = await db.query(
    "SELECT * FROM af_customer_items WHERE customer_id = $1 AND tenant_id = $2 ORDER BY position, id", [id, tenantId]);
  return { ...fmtCustomer(c.rows[0]), lines: lines.rows.map((l) => fmtTemplateLine(l, admin)) };
};

router.get("/af-customers/:id", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid customer id" });
  try {
    const c = await loadCustomer(pool, req.tenantId, id, isAdminRole(req.role));
    if (!c) return res.status(404).json({ error: "Customer not found" });
    res.json(c);
  } catch (err) {
    sendError(res, err, "read af customer");
  }
});

// A template's lines as sent, checked. Prices are taken as given: only admin reaches here.
const cleanTemplateLines = (lines) => {
  if (!Array.isArray(lines)) return [];
  return lines.map((l, i) => {
    const code = text(l?.code, 12);
    const description = text(l?.description);
    if (!code || !/^\d{5,7}$/.test(code) || !description) throw fail(400, `Line ${i + 1} needs an item code and a description.`);
    const price = l?.price == null || l.price === "" ? null : String(l.price).trim();
    if (price != null && !PRICE_RE.test(price)) throw fail(400, `Line ${i + 1}: a price is dollars and cents, like 5.99.`);
    return { code, tag: text(l?.tag, 12)?.toUpperCase() || null, description, price };
  });
};

const writeTemplate = async (client, tenantId, customerId, lines) => {
  await client.query("DELETE FROM af_customer_items WHERE customer_id = $1 AND tenant_id = $2", [customerId, tenantId]);
  if (!lines.length) return;
  await client.query(
    `INSERT INTO af_customer_items (tenant_id, customer_id, position, code, tag, description, price)
     SELECT $1, $2, p, c, t, d, pr::numeric FROM UNNEST($3::int[], $4::text[], $5::text[], $6::text[], $7::text[])
         AS x(p, c, t, d, pr)`,
    [tenantId, customerId, lines.map((_, i) => i), lines.map((l) => l.code), lines.map((l) => l.tag),
     lines.map((l) => l.description), lines.map((l) => l.price)]);
};

const customerHead = (b) => ({
  displayName: text(b.displayName), shipTo: text(b.shipTo),
  dueDay: b.dueDay && DAYS.includes(String(b.dueDay).toUpperCase()) ? String(b.dueDay).toUpperCase() : null,
});

router.post("/af-customers", verifyToken, requireRole("admin"), async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 60);
  if (!name) return res.status(400).json({ error: "Name the customer." });
  const client = await pool.connect();
  try {
    const lines = cleanTemplateLines(b.lines);
    const h = customerHead(b);
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO af_customers (tenant_id, name, display_name, ship_to, due_day, template_from)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING customer_id`,
      [req.tenantId, name, h.displayName, h.shipTo, h.dueDay, pacificToday()]);
    await writeTemplate(client, req.tenantId, ins.rows[0].customer_id, lines);
    await client.query("COMMIT");
    res.status(201).json(await loadCustomer(pool, req.tenantId, ins.rows[0].customer_id, true));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return res.status(409).json({ error: `There is already a customer named ${name}.` });
    sendError(res, err, "add af customer");
  } finally {
    client.release();
  }
});

// Admin edits a customer and its template. Dated today, so an older workbook cannot overwrite it.
router.put("/af-customers/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid customer id" });
  const b = req.body || {};
  const client = await pool.connect();
  try {
    const lines = Array.isArray(b.lines) ? cleanTemplateLines(b.lines) : null;
    const h = customerHead(b);
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE af_customers SET display_name = $3, ship_to = $4, due_day = $5,
              active = COALESCE($6, active), template_from = $7, updated_at = now()
        WHERE customer_id = $1 AND tenant_id = $2 RETURNING customer_id`,
      [id, req.tenantId, h.displayName, h.shipTo, h.dueDay,
       typeof b.active === "boolean" ? b.active : null, pacificToday()]);
    if (!upd.rows.length) throw fail(404, "Customer not found");
    if (lines) await writeTemplate(client, req.tenantId, id, lines);
    await client.query("COMMIT");
    res.json(await loadCustomer(pool, req.tenantId, id, true));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err, "edit af customer");
  } finally {
    client.release();
  }
});

// The office's workbook in: every tab's newest order becomes that customer's template,
// and every product line an item code. Dry run first; a template edited in the app
// more recently than the workbook's order is kept.
router.post("/af-customers/import", verifyToken, requireRole("admin"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const dryRun = req.query.dryRun === "1" || req.body?.dryRun === "1";
  let book;
  try {
    book = await readOrderWorkbook(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `That file could not be read as an order workbook: ${err.message}` });
  }
  if (!book.templates.length) return res.status(400).json({ error: "No customer tabs with an order on them were found." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT customer_id, name, template_from FROM af_customers WHERE tenant_id = $1", [req.tenantId]);
    const byName = new Map(existing.rows.map((r) => [r.name.toUpperCase(), r]));
    const plan = book.templates.map((t) => {
      const had = byName.get(t.name.toUpperCase());
      const keep = had && had.template_from && t.from && fmtDay(had.template_from) > t.from;
      return {
        name: t.name, displayName: t.displayName, shipTo: t.shipTo, dueDay: t.dueDay, from: t.from,
        lines: t.lines.length, priced: t.lines.filter((l) => l.price).length,
        action: !had ? "new" : keep ? "kept (edited in the app since)" : "replaced",
      };
    });
    const knownItems = await client.query("SELECT code, description FROM af_items WHERE tenant_id = $1", [req.tenantId]);
    const known = new Set(knownItems.rows.map((r) => key(r.code, r.description)));
    const newItems = book.items.filter((i) => !known.has(key(i.code, i.description)));

    if (!dryRun) {
      for (const t of book.templates) {
        const p = plan.find((x) => x.name === t.name);
        if (p.action.startsWith("kept")) continue;
        const had = byName.get(t.name.toUpperCase());
        let id = had && had.customer_id;
        const due = t.dueDay && DAYS.includes(t.dueDay) ? t.dueDay : null;
        if (id) {
          await client.query(
            `UPDATE af_customers SET display_name = $3, ship_to = $4, due_day = $5, template_from = $6, updated_at = now()
              WHERE customer_id = $1 AND tenant_id = $2`,
            [id, req.tenantId, t.displayName, t.shipTo, due, t.from]);
        } else {
          id = (await client.query(
            `INSERT INTO af_customers (tenant_id, name, display_name, ship_to, due_day, template_from)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING customer_id`,
            [req.tenantId, t.name, t.displayName, t.shipTo, due, t.from])).rows[0].customer_id;
        }
        await writeTemplate(client, req.tenantId, id, t.lines);
      }
      if (newItems.length) {
        await client.query(
          `INSERT INTO af_items (tenant_id, code, tag, description)
           SELECT $1, c, t, d FROM UNNEST($2::text[], $3::text[], $4::text[]) AS x(c, t, d)
           ON CONFLICT (tenant_id, code, description) DO NOTHING`,
          [req.tenantId, newItems.map((i) => i.code), newItems.map((i) => i.tag), newItems.map((i) => i.description)]);
      }
    }
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    res.json({ dryRun, customers: plan, items: { inFile: book.items.length, new: newItems.length } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err, "import order workbook");
  } finally {
    client.release();
  }
});

// ── Orders ───────────────────────────────────────────────────────────────────

router.get("/af-orders", verifyToken, async (req, res) => {
  const status = ["draft", "sent", "filled", "cancelled"].includes(req.query.status) ? req.query.status : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
              (SELECT COUNT(*) FROM af_order_lines l WHERE l.order_id = o.order_id) AS line_count,
              (SELECT SUM(qty_cases) FROM af_order_lines l WHERE l.order_id = o.order_id) AS cases,
              (SELECT SUM(lbs) FROM af_order_lines l WHERE l.order_id = o.order_id AND l.qty_cases IS NULL) AS lbs_only
         FROM af_orders o
        WHERE o.tenant_id = $1 AND ($2::text IS NULL OR o.status = $2)
          AND ($3 = '%%' OR o.customer_name ILIKE $3 OR o.order_no::text ILIKE $3 OR o.po ILIKE $3)
        ORDER BY o.order_no DESC LIMIT 300`, [req.tenantId, status, like]);
    res.json(rows.map(fmtOrder));
  } catch (err) {
    sendError(res, err, "list af orders");
  }
});

const loadOrder = async (db, tenantId, id, admin) => {
  const o = await db.query("SELECT * FROM af_orders WHERE order_id = $1 AND tenant_id = $2", [id, tenantId]);
  if (!o.rows.length) return null;
  const lines = await db.query(
    "SELECT * FROM af_order_lines WHERE order_id = $1 AND tenant_id = $2 ORDER BY position, line_id", [id, tenantId]);
  return { ...fmtOrder(o.rows[0]), lines: lines.rows.map((l) => fmtLine(l, admin)) };
};

router.get("/af-orders/:id", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid order id" });
  try {
    const o = await loadOrder(pool, req.tenantId, id, isAdminRole(req.role));
    if (!o) return res.status(404).json({ error: "Order not found" });
    res.json(o);
  } catch (err) {
    sendError(res, err, "read af order");
  }
});

// The ordered lines as sent: only lines asking for cases or pounds are kept.
// A price is admin's to set; anyone else's line takes the one it already had,
// else the customer's template price.
const cleanOrderLines = async (db, tenantId, customerId, orderId, lines, admin) => {
  if (!Array.isArray(lines)) throw fail(400, "lines is required");
  const known = new Map();
  if (!admin) {
    if (orderId) {
      const had = await db.query("SELECT code, description, price FROM af_order_lines WHERE order_id = $1", [orderId]);
      for (const r of had.rows) known.set(key(r.code, r.description), r.price);
    }
    if (customerId) {
      const tpl = await db.query("SELECT code, description, price FROM af_customer_items WHERE customer_id = $1", [customerId]);
      for (const r of tpl.rows) if (!known.has(key(r.code, r.description))) known.set(key(r.code, r.description), r.price);
    }
  }
  const out = [];
  lines.forEach((l, i) => {
    const qty = l?.qtyCases == null || l.qtyCases === "" ? null : Number(l.qtyCases);
    const lbs = l?.lbs == null || l.lbs === "" ? null : String(l.lbs).trim();
    if (qty == null && lbs == null) return;
    const code = text(l?.code, 12);
    const description = text(l?.description);
    if (!code || !description) throw fail(400, `Line ${i + 1} needs an item code and a description.`);
    if (qty != null && !(Number.isInteger(qty) && qty > 0 && qty < 10000)) throw fail(400, `${code}: cases is a whole number above zero.`);
    if (lbs != null && !(LBS_RE.test(lbs) && Number(lbs) > 0)) throw fail(400, `${code}: pounds is a number above zero, at most 3 decimals.`);
    let price = null;
    if (admin) {
      price = l?.price == null || l.price === "" ? null : String(l.price).trim();
      if (price != null && !PRICE_RE.test(price)) throw fail(400, `${code}: a price is dollars and cents, like 5.99.`);
    } else {
      const p = known.get(key(code, description));
      price = p != null ? String(p) : null;
    }
    out.push({ code, tag: text(l?.tag, 12)?.toUpperCase() || null, description, qty, lbs, price,
      note: text(l?.note), fromTemplate: l?.fromTemplate !== false });
  });
  return out;
};

const writeLines = async (client, tenantId, orderId, lines) => {
  await client.query("DELETE FROM af_order_lines WHERE order_id = $1 AND tenant_id = $2", [orderId, tenantId]);
  if (!lines.length) return;
  await client.query(
    `INSERT INTO af_order_lines (order_id, tenant_id, position, code, tag, description, qty_cases, lbs, price, note, from_template)
     SELECT $1, $2, p, c, t, d, q, w::numeric, pr::numeric, n, f
       FROM UNNEST($3::int[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::text[], $10::text[], $11::boolean[])
         AS x(p, c, t, d, q, w, pr, n, f)`,
    [orderId, tenantId, lines.map((_, i) => i), lines.map((l) => l.code), lines.map((l) => l.tag),
     lines.map((l) => l.description), lines.map((l) => l.qty), lines.map((l) => l.lbs), lines.map((l) => l.price),
     lines.map((l) => l.note), lines.map((l) => l.fromTemplate)]);
};

const orderHead = (b) => {
  const orderDate = b.orderDate && DATE_RE.test(String(b.orderDate)) ? String(b.orderDate) : pacificToday();
  const due = b.dueDay ? String(b.dueDay).toUpperCase() : null;
  if (due && !DAYS.includes(due)) throw fail(400, `Due is a day: ${DAYS.join(", ")}.`);
  return { orderDate, dueDay: due, shipTo: text(b.shipTo), po: text(b.po, 60), notes: text(b.notes, 500) };
};

router.post("/af-orders", verifyToken, requireRole(...ORDER_ROLES), async (req, res) => {
  const b = req.body || {};
  const customerId = Number(b.customerId);
  if (!Number.isInteger(customerId)) return res.status(400).json({ error: "Pick a customer." });
  const admin = isAdminRole(req.role);
  const client = await pool.connect();
  try {
    const h = orderHead(b);
    await client.query("BEGIN");
    const cust = await client.query(
      "SELECT * FROM af_customers WHERE customer_id = $1 AND tenant_id = $2", [customerId, req.tenantId]);
    if (!cust.rows.length) throw fail(404, "Customer not found");
    const lines = await cleanOrderLines(client, req.tenantId, customerId, null, b.lines, admin);
    // One at a time, so two orders saved together cannot take the same number.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`af-order-no:${req.tenantId}`]);
    const next = await client.query(
      "SELECT COALESCE(MAX(order_no), 1000) + 1 AS n FROM af_orders WHERE tenant_id = $1", [req.tenantId]);
    const ins = await client.query(
      `INSERT INTO af_orders (tenant_id, order_no, customer_id, customer_name, ship_to, order_date, due_day, po, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING order_id`,
      [req.tenantId, next.rows[0].n, customerId, cust.rows[0].display_name || cust.rows[0].name,
       h.shipTo, h.orderDate, h.dueDay, h.po, h.notes, req.username || null]);
    await writeLines(client, req.tenantId, ins.rows[0].order_id, lines);
    await client.query("COMMIT");
    res.status(201).json(await loadOrder(pool, req.tenantId, ins.rows[0].order_id, admin));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err, "make af order");
  } finally {
    client.release();
  }
});

// A draft or a sent order can be changed; a cancelled one is a record.
router.put("/af-orders/:id", verifyToken, requireRole(...ORDER_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid order id" });
  const admin = isAdminRole(req.role);
  const client = await pool.connect();
  try {
    const h = orderHead(req.body || {});
    await client.query("BEGIN");
    const cur = await client.query(
      "SELECT * FROM af_orders WHERE order_id = $1 AND tenant_id = $2 FOR UPDATE", [id, req.tenantId]);
    if (!cur.rows.length) throw fail(404, "Order not found");
    if (cur.rows[0].status === "cancelled") throw fail(409, "That order was cancelled, so it cannot be changed.", "CANCELLED");
    if (cur.rows[0].status === "filled") throw fail(409, "That order was filled, so it cannot be changed.", "FILLED");
    // Saving replaces the lines, which would drop the boxes already picked onto them.
    const picked = await client.query("SELECT COUNT(*)::int AS n FROM af_order_picks WHERE order_id = $1", [id]);
    if (picked.rows[0].n > 0) {
      throw fail(409, `The floor has started picking this order (${picked.rows[0].n} box${picked.rows[0].n === 1 ? "" : "es"}). `
        + "Take those boxes off first, or cancel the order.", "PICKING");
    }
    const lines = await cleanOrderLines(client, req.tenantId, cur.rows[0].customer_id, id, req.body?.lines, admin);
    if (cur.rows[0].status === "sent" && !lines.length) {
      throw fail(409, "A sent order needs at least one line. Cancel it instead.", "EMPTY");
    }
    await client.query(
      `UPDATE af_orders SET ship_to = $3, order_date = $4, due_day = $5, po = $6, notes = $7, updated_at = now()
        WHERE order_id = $1 AND tenant_id = $2`,
      [id, req.tenantId, h.shipTo, h.orderDate, h.dueDay, h.po, h.notes]);
    await writeLines(client, req.tenantId, id, lines);
    await client.query("COMMIT");
    res.json(await loadOrder(pool, req.tenantId, id, admin));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err, "edit af order");
  } finally {
    client.release();
  }
});

// To the floor: it needs a line and a due day.
router.post("/af-orders/:id/send", verifyToken, requireRole(...ORDER_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid order id" });
  try {
    const cur = await pool.query(
      `SELECT o.status, o.due_day, (SELECT COUNT(*)::int FROM af_order_lines l WHERE l.order_id = o.order_id) AS n
         FROM af_orders o WHERE o.order_id = $1 AND o.tenant_id = $2`, [id, req.tenantId]);
    if (!cur.rows.length) return res.status(404).json({ error: "Order not found" });
    const o = cur.rows[0];
    if (o.status !== "draft") return res.status(409).json({ code: "NOT_DRAFT", error: `That order is already ${o.status}.` });
    if (!o.n) return res.status(409).json({ code: "EMPTY", error: "No line asks for cases or pounds yet." });
    if (!o.due_day) return res.status(409).json({ code: "NO_DUE", error: "Pick a due day first." });
    await pool.query(
      `UPDATE af_orders SET status = 'sent', sent_by = $3, sent_at = now(), updated_at = now()
        WHERE order_id = $1 AND tenant_id = $2 AND status = 'draft'`, [id, req.tenantId, req.username || null]);
    res.json(await loadOrder(pool, req.tenantId, id, isAdminRole(req.role)));
  } catch (err) {
    sendError(res, err, "send af order");
  }
});

// A sent order withdrawn. Kept, so its number is never reused.
router.post("/af-orders/:id/cancel", verifyToken, requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid order id" });
  try {
    // A filled order's boxes have left; only an order still open can be withdrawn.
    const upd = await pool.query(
      `UPDATE af_orders SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), updated_at = now()
        WHERE order_id = $1 AND tenant_id = $2 AND status IN ('draft', 'sent') RETURNING order_id`,
      [id, req.tenantId, req.username || null]);
    if (!upd.rows.length) return res.status(404).json({ error: "No open order with that id." });
    // Boxes held for it go back to stock.
    await pool.query("DELETE FROM af_order_picks WHERE order_id = $1 AND tenant_id = $2", [id, req.tenantId]);
    res.json(await loadOrder(pool, req.tenantId, id, true));
  } catch (err) {
    sendError(res, err, "cancel af order");
  }
});

// A draft that was never sent can go; anything sent is cancelled instead.
router.delete("/af-orders/:id", verifyToken, requireRole(...ORDER_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid order id" });
  try {
    const del = await pool.query(
      "DELETE FROM af_orders WHERE order_id = $1 AND tenant_id = $2 AND status = 'draft' RETURNING order_no",
      [id, req.tenantId]);
    if (!del.rows.length) {
      return res.status(409).json({ code: "NOT_DRAFT", error: "Only a draft can be deleted. Cancel a sent order instead." });
    }
    res.json({ deleted: del.rows[0].order_no });
  } catch (err) {
    sendError(res, err, "delete af order");
  }
});

module.exports = router;
