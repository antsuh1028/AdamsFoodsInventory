// Adams Foods order picking: the floor scans boxes into the lines of sent orders.
// A scanned box is HELD on its line (no other order can take it) and leaves stock
// only when the order is finished. A line asks for cases, pounds, or both: exact
// cases AND at least the pounds. An order is never finished short.

const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { boxFromBarcode } = require("../utils/afBox");
const { toThousandths } = require("../utils/weight");

const PICK_ROLES = ["floor", "user", "manager", "admin"];
// What the AF pallet tag prints: P, the lot number, then the pallet: P26314-02-01.
const PALLET_RE = /^P(.+)-(\d{2})$/;

const fail = (status, message, code, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const mils = (w) => (w == null || w === "" ? 0n : toThousandths(String(w)));
const lbText = (m) => {
  const v = BigInt(m);
  const s = `${v / 1000n}.${String(v % 1000n).padStart(3, "0")}`.replace(/\.?0+$/, "");
  return s || "0";
};
const sendError = (res, err, what) => {
  if (err.status) {
    const { status, code, message, ...rest } = err;
    return res.status(status).json({ code, error: message, ...rest });
  }
  console.error(`${what}:`, err);
  return res.status(500).json({ error: "Internal Server Error" });
};

/**
 * Where a line stands. `picks` carry weight (pounds, decimal string).
 * full: everything asked for is there. room: another box may still go on.
 */
const lineState = (line, picks) => {
  const count = picks.length;
  const total = picks.reduce((a, p) => a + mils(p.weight), 0n);
  const qty = line.qty_cases;
  const want = line.lbs != null ? mils(line.lbs) : null;
  const casesOk = qty == null || count === qty;
  const lbsOk = want == null || total >= want;
  const room = qty != null ? count < qty : total < want;
  // Pounds only: a box that could come off and still leave the line at its weight.
  const lightest = picks.reduce((m, p) => (m == null || mils(p.weight) < m ? mils(p.weight) : m), null);
  const extraBox = qty == null && want != null && count > 1 && total - lightest >= want;
  let short = null;
  if (qty != null && count === qty && !lbsOk) {
    short = `${count} of ${qty} cases, but ${lbText(want - total)} lb short of ${lbText(want)} lb. `
      + "Take a light box off and scan a heavier one.";
  }
  return { count, totalLb: lbText(total), full: casesOk && lbsOk, room, extraBox, short };
};

// Orders with their lines, each line's held boxes and where it stands.
const loadOrders = async (db, tenantId, { orderIds = null, status = "sent" } = {}) => {
  const orders = await db.query(
    `SELECT * FROM af_orders WHERE tenant_id = $1
        AND ($2::int[] IS NULL OR order_id = ANY($2::int[]))
        AND ($3::text IS NULL OR status = $3)
      ORDER BY ${status === "filled" ? "filled_at DESC" : "due_day NULLS LAST, order_no"}
      LIMIT ${status === "filled" ? 50 : 200}`,
    [tenantId, orderIds, orderIds ? null : status]);
  if (!orders.rows.length) return [];
  const ids = orders.rows.map((o) => o.order_id);
  const lines = await db.query(
    "SELECT * FROM af_order_lines WHERE order_id = ANY($1::int[]) ORDER BY order_id, position, line_id", [ids]);
  const picks = await db.query(
    `SELECT p.pick_id, p.line_id, p.order_id, p.picked_by, p.picked_at, b.box_id, b.weight::text AS weight,
            b.pallet_no, b.item_code, b.status AS box_status, l.lot_number, i.description AS item
       FROM af_order_picks p
       JOIN af_lot_boxes b ON b.box_id = p.box_id
       JOIN af_lots l ON l.af_lot_id = b.af_lot_id
       LEFT JOIN af_lot_items i ON i.item_id = b.item_id
      WHERE p.order_id = ANY($1::int[])
      ORDER BY p.picked_at, p.pick_id`, [ids]);
  return orders.rows.map((o) => ({
    orderId: o.order_id, orderNo: o.order_no, customerName: o.customer_name, shipTo: o.ship_to,
    orderDate: o.order_date instanceof Date ? o.order_date.toISOString().slice(0, 10) : o.order_date,
    dueDay: o.due_day, po: o.po, notes: o.notes, status: o.status,
    filledAt: o.filled_at, filledBy: o.filled_by, checkedBy: o.checked_by,
    lines: lines.rows.filter((l) => l.order_id === o.order_id).map((l) => {
      const mine = picks.rows.filter((p) => p.line_id === l.line_id);
      return {
        lineId: l.line_id, code: l.code, tag: l.tag, description: l.description,
        qtyCases: l.qty_cases, lbs: l.lbs != null ? lbText(mils(l.lbs)) : null, note: l.note,
        picks: mine.map((p) => ({
          pickId: p.pick_id, boxId: p.box_id, weight: p.weight, lotNumber: p.lot_number, palletNo: p.pallet_no,
          item: p.item, itemCode: p.item_code, pickedBy: p.picked_by,
        })),
        ...lineState(l, mine),
      };
    }),
  }));
};

// The line, its order locked so two scanners on one order take turns.
const lockLine = async (client, tenantId, lineId) => {
  const { rows } = await client.query(
    `SELECT l.*, o.status AS order_status, o.order_no
       FROM af_order_lines l JOIN af_orders o ON o.order_id = l.order_id
      WHERE l.line_id = $1 AND l.tenant_id = $2`, [lineId, tenantId]);
  const line = rows[0];
  if (!line) throw fail(404, "That order line was not found.", "NO_LINE");
  await client.query("SELECT 1 FROM af_orders WHERE order_id = $1 FOR UPDATE", [line.order_id]);
  if (line.order_status !== "sent") {
    throw fail(409, `Order #${line.order_no} is ${line.order_status}, so nothing can be picked onto it.`, "NOT_OPEN");
  }
  const picks = await client.query(
    `SELECT p.pick_id, b.weight::text AS weight FROM af_order_picks p JOIN af_lot_boxes b ON b.box_id = p.box_id
      WHERE p.line_id = $1`, [lineId]);
  return { line, picks: picks.rows };
};

// Who is holding a box, in words.
const holder = async (db, boxId) => {
  const { rows } = await db.query(
    `SELECT o.order_no, o.customer_name, l.code FROM af_order_picks p
       JOIN af_orders o ON o.order_id = p.order_id JOIN af_order_lines l ON l.line_id = p.line_id
      WHERE p.box_id = $1`, [boxId]);
  return rows[0] ? `order #${rows[0].order_no} (${rows[0].customer_name}, ${rows[0].code})` : null;
};

// Puts boxes on a line, after checking each is free and the line has room for all of them.
const hold = async (client, req, line, before, boxes) => {
  const qty = line.qty_cases;
  const want = line.lbs != null ? mils(line.lbs) : null;
  if (qty != null && before.length + boxes.length > qty) {
    const left = Math.max(qty - before.length, 0);
    throw fail(409, left === 0
      ? `This line is full: ${qty} of ${qty} cases.`
      : `That is ${boxes.length} boxes, but this line has room for ${left} more.`, "LINE_FULL", { room: left });
  }
  if (qty == null && want != null && before.reduce((a, p) => a + mils(p.weight), 0n) >= want) {
    throw fail(409, `This line already has its ${lbText(want)} lb.`, "LINE_FULL", { room: 0 });
  }
  for (const b of boxes) {
    if (b.item_code && b.item_code !== line.code) {
      throw fail(409, `That box is item ${b.item_code}; this line is ${line.code} ${line.description}.`, "WRONG_ITEM");
    }
    const by = await holder(client, b.box_id);
    if (by) throw fail(409, `That box is already on ${by}.`, "HELD");
  }
  try {
    await client.query(
      `INSERT INTO af_order_picks (tenant_id, order_id, line_id, box_id, picked_by)
       SELECT $1, $2, $3, id, $4 FROM UNNEST($5::int[]) AS id`,
      [req.tenantId, line.order_id, line.line_id, req.username || null, boxes.map((b) => b.box_id)]);
  } catch (err) {
    // Picked onto another order in the same moment.
    if (err.code === "23505") throw fail(409, "That box was just picked onto another order.", "HELD");
    throw err;
  }
};

const IN_STOCK = "b.tenant_id = $1 AND b.status = 'in_stock' AND b.removed_at IS NULL";

router.get("/af-picking/orders", verifyToken, requireRole(...PICK_ROLES), async (req, res) => {
  try {
    res.json(await loadOrders(pool, req.tenantId, { status: req.query.status === "filled" ? "filled" : "sent" }));
  } catch (err) {
    sendError(res, err, "list picking orders");
  }
});

// One scan onto a line. A box label holds that box; a pallet tag returns the pallet's
// free boxes so the floor can choose which to take (POST .../boxes).
router.post("/af-picking/lines/:lineId/scan", verifyToken, requireRole(...PICK_ROLES), async (req, res) => {
  const lineId = Number(req.params.lineId);
  if (!Number.isInteger(lineId)) return res.status(400).json({ error: "Invalid line id" });
  const text = String(req.body?.barcode || "").trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { line, picks } = await lockLine(client, req.tenantId, lineId);

    const pallet = PALLET_RE.exec(text.toUpperCase());
    if (pallet) {
      const { rows } = await client.query(
        `SELECT b.box_id, b.weight::text AS weight, b.item_code, b.pallet_no, l.lot_number, i.description AS item,
                (SELECT o.order_no FROM af_order_picks p JOIN af_orders o ON o.order_id = p.order_id
                  WHERE p.box_id = b.box_id) AS held_on
           FROM af_lot_boxes b JOIN af_lots l ON l.af_lot_id = b.af_lot_id
           LEFT JOIN af_lot_items i ON i.item_id = b.item_id
          WHERE ${IN_STOCK} AND UPPER(l.lot_number) = $2 AND b.pallet_no = $3
          ORDER BY b.box_id`, [req.tenantId, pallet[1], Number(pallet[2])]);
      await client.query("ROLLBACK");
      if (!rows.length) {
        return res.status(404).json({ code: "NO_PALLET", error: `Pallet ${text} has no boxes in stock.` });
      }
      const free = rows.filter((r) => r.held_on == null);
      const room = line.qty_cases != null ? Math.max(line.qty_cases - picks.length, 0) : null;
      return res.json({
        pallet: {
          code: text.toUpperCase(), lotNumber: rows[0].lot_number, palletNo: Number(pallet[2]), room,
          boxes: free.map((r) => ({ boxId: r.box_id, weight: r.weight, item: r.item, itemCode: r.item_code })),
          heldElsewhere: rows.length - free.length,
        },
      });
    }

    const read = boxFromBarcode(text, req.username);
    if (read.error) throw fail(400, read.error.message, read.error.code);
    const box = read.box;
    // A packer box is its GTIN and serial; a label without a serial is any free box of that code, weight and day.
    const found = await client.query(
      box.serial
        ? `SELECT b.* FROM af_lot_boxes b WHERE ${IN_STOCK} AND b.serial = $2 AND COALESCE(b.gtin, '') = COALESCE($3, '')
            ORDER BY b.box_id LIMIT 1`
        : `SELECT b.* FROM af_lot_boxes b WHERE ${IN_STOCK} AND b.serial IS NULL AND COALESCE(b.gtin, '') = COALESCE($2, '')
             AND b.weight = $3::numeric AND b.pack_date IS NOT DISTINCT FROM $4::date
             AND NOT EXISTS (SELECT 1 FROM af_order_picks p WHERE p.box_id = b.box_id)
            ORDER BY b.box_id LIMIT 1`,
      box.serial ? [req.tenantId, box.serial, box.gtin] : [req.tenantId, box.gtin, box.weight, box.packDate]);
    if (!found.rows.length) {
      throw fail(404, "That box is not in stock on any lot. Was it received through Lot Registration?", "NOT_IN_STOCK");
    }
    await hold(client, req, line, picks, found.rows);
    await client.query("COMMIT");
    res.json({ picked: { boxId: found.rows[0].box_id, weight: found.rows[0].weight },
      order: (await loadOrders(pool, req.tenantId, { orderIds: [line.order_id] }))[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err, "pick scan");
  } finally {
    client.release();
  }
});

// The boxes chosen from a pallet, onto the line together.
router.post("/af-picking/lines/:lineId/boxes", verifyToken, requireRole(...PICK_ROLES), async (req, res) => {
  const lineId = Number(req.params.lineId);
  const ids = [...new Set((Array.isArray(req.body?.boxIds) ? req.body.boxIds : []).map(Number))].filter(Number.isInteger);
  if (!Number.isInteger(lineId)) return res.status(400).json({ error: "Invalid line id" });
  if (!ids.length) return res.status(400).json({ error: "Pick at least one box." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { line, picks } = await lockLine(client, req.tenantId, lineId);
    const found = await client.query(
      `SELECT b.* FROM af_lot_boxes b WHERE ${IN_STOCK} AND b.box_id = ANY($2::int[]) ORDER BY b.box_id FOR UPDATE`,
      [req.tenantId, ids]);
    if (found.rows.length !== ids.length) throw fail(409, "One of those boxes is no longer in stock.", "NOT_IN_STOCK");
    await hold(client, req, line, picks, found.rows);
    await client.query("COMMIT");
    res.json({ order: (await loadOrders(pool, req.tenantId, { orderIds: [line.order_id] }))[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err, "pick pallet boxes");
  } finally {
    client.release();
  }
});

// A box back off its line, and back to stock.
router.delete("/af-picking/picks/:pickId", verifyToken, requireRole(...PICK_ROLES), async (req, res) => {
  const pickId = Number(req.params.pickId);
  if (!Number.isInteger(pickId)) return res.status(400).json({ error: "Invalid pick id" });
  try {
    const { rows } = await pool.query(
      `DELETE FROM af_order_picks p USING af_orders o
        WHERE p.pick_id = $1 AND p.tenant_id = $2 AND o.order_id = p.order_id AND o.status = 'sent'
      RETURNING p.order_id`, [pickId, req.tenantId]);
    if (!rows.length) return res.status(409).json({ code: "NOT_OPEN", error: "That box is not on an open order." });
    res.json({ order: (await loadOrders(pool, req.tenantId, { orderIds: [rows[0].order_id] }))[0] });
  } catch (err) {
    sendError(res, err, "unpick box");
  }
});

// Finished: every line full, someone has checked it, and its boxes leave stock.
router.post("/af-picking/orders/:id/finish", verifyToken, requireRole(...PICK_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid order id" });
  const checkedBy = String(req.body?.checkedBy || "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 60);
  if (!checkedBy) return res.status(400).json({ code: "NO_CHECKER", error: "Say who checked this order." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      "SELECT * FROM af_orders WHERE order_id = $1 AND tenant_id = $2 FOR UPDATE", [id, req.tenantId]);
    if (!cur.rows.length) throw fail(404, "Order not found.");
    if (cur.rows[0].status !== "sent") throw fail(409, `That order is ${cur.rows[0].status}.`, "NOT_OPEN");
    const [order] = await loadOrders(client, req.tenantId, { orderIds: [id] });
    const notFull = order.lines.filter((l) => !l.full);
    if (notFull.length) {
      throw fail(409, `${notFull.length} line${notFull.length === 1 ? " is" : "s are"} not full yet: `
        + notFull.map((l) => l.code).join(", ") + ". An order is not finished short.", "NOT_FULL");
    }
    const boxIds = order.lines.flatMap((l) => l.picks.map((p) => p.boxId));
    const gone = await client.query(
      `SELECT box_id FROM af_lot_boxes WHERE box_id = ANY($1::int[]) AND (status <> 'in_stock' OR removed_at IS NOT NULL)
        FOR UPDATE`, [boxIds]);
    if (gone.rows.length) {
      throw fail(409, `${gone.rows.length} box${gone.rows.length === 1 ? " has" : "es have"} left stock since being picked. `
        + "Take them off and scan others.", "BOX_GONE", { boxIds: gone.rows.map((r) => r.box_id) });
    }
    await client.query("UPDATE af_lot_boxes SET status = 'out' WHERE box_id = ANY($1::int[])", [boxIds]);
    await client.query(
      `UPDATE af_orders SET status = 'filled', filled_at = now(), filled_by = $3, checked_by = $4, updated_at = now()
        WHERE order_id = $1 AND tenant_id = $2`, [id, req.tenantId, req.username || null, checkedBy]);
    await client.query("COMMIT");
    res.json({ order: (await loadOrders(pool, req.tenantId, { orderIds: [id] }))[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err, "finish order");
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.lineState = lineState;
