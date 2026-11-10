// Mixing lots: N lots mixed before processing into one NX lot with its own form.

const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { RECEPTION_ROLES } = require("../middleware/receptionRoles");
const { lotDescriptionSql } = require("../utils/lotDescription");
const { parseCases } = require("../utils/registrationStock");
const {
  SOURCE_CHECKS_SQL, sourceBlock, mixUseBlock, lockMix, issueMixLot, mixSources,
  addSources, removeSource, refreshMix,
} = require("../utils/lotMix");

const fmtDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d || null));
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim().toUpperCase());

// Logged after the commit: a history write must never fail a mix that has happened.
const logHistory = (tenantId, action, lot, snapshot, who) =>
  pool.query(
    `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot, performed_by)
     VALUES ($1, $2, NULL, $3, $4, $5)`,
    [tenantId, action, lot, JSON.stringify(snapshot), who || null]
  ).catch((err) => console.error("lot mix history log error:", err.message));

const sendError = (res, err, what) => {
  if (err.status) {
    const { status, code, message, refused } = err;
    return res.status(status).json({ code, error: message, ...(refused ? { refused } : {}) });
  }
  console.error(`${what}:`, err);
  return res.status(500).json({ error: "Internal Server Error" });
};

// Runs `work` in a transaction with the NX lot locked.
const withMix = async (tenantId, mixLotId, work) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mix = await lockMix(client, tenantId, mixLotId);
    const out = await work(client, mix);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const loadMix = async (tenantId, mixLotId) => {
  const lot = await pool.query(
    `SELECT l.*, f.id AS form_id, f.product_description, f.original_weight::text AS original_weight,
            f.total_quantity,
            (SELECT s.qty_cases FROM nti_inventory s
              WHERE s.tenant_id = l.tenant_id AND s.lot_id = l.lot_id AND s.stage = 'raw'
              ORDER BY s.id LIMIT 1) AS cases_on_hand
       FROM lots l
       LEFT JOIN noblesse_registration_forms f ON f.tenant_id = l.tenant_id AND f.lot_id = l.lot_id
      WHERE l.lot_id = $1 AND l.tenant_id = $2 AND l.kind = 'mixed'`, [mixLotId, tenantId]);
  if (!lot.rows.length) return null;
  const r = lot.rows[0];
  const [sources, locked] = await Promise.all([
    mixSources(pool, tenantId, mixLotId), mixUseBlock(pool, tenantId, mixLotId),
  ]);
  return {
    lotId: r.lot_id, lotNumber: r.lot_number, lotDate: fmtDay(r.lot_date), status: r.status,
    createdAt: r.created_at, formId: r.form_id ?? null,
    productDescription: r.product_description || null,
    originalWeight: r.original_weight ?? null, totalQuantity: r.total_quantity ?? null,
    cases: parseCases(r.total_quantity),
    casesOnHand: r.cases_on_hand ?? null,
    sources,
    // Lots can be added at any time, but taken out only until the mix is used.
    removeBlocked: locked,
  };
};

// N lots that could go into a mix, newest first, each with why it cannot when it cannot.
router.get("/lot-mixes/candidates", verifyToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  try {
    const recent = await pool.query(
      `SELECT l.lot_id FROM lots l
        WHERE l.tenant_id = $1 AND l.kind = 'internal' AND l.status = 'open'
          AND NOT EXISTS (SELECT 1 FROM lot_mix_members m WHERE m.lot_id = l.lot_id)
        ORDER BY l.lot_date DESC NULLS LAST, l.seq DESC NULLS LAST
        LIMIT $2`, [req.tenantId, limit]);
    const ids = recent.rows.map((r) => r.lot_id);
    if (!ids.length) return res.json([]);
    const { rows } = await pool.query(
      `WITH c AS (${SOURCE_CHECKS_SQL})
       SELECT c.*, l.lot_date, ${lotDescriptionSql("l")} AS description,
              f.vendor, f.date_received, f.original_weight::text AS original_weight, f.total_quantity
         FROM c JOIN lots l ON l.lot_id = c.lot_id
         LEFT JOIN LATERAL (SELECT * FROM noblesse_registration_forms f
                             WHERE f.tenant_id = l.tenant_id AND f.lot_id = l.lot_id
                             ORDER BY f.id LIMIT 1) f ON TRUE
        ORDER BY l.lot_date DESC NULLS LAST, l.seq DESC NULLS LAST`,
      [req.tenantId, ids]);
    res.json(rows.map((r) => ({
      lotId: r.lot_id, lotNumber: r.lot_number, lotDate: fmtDay(r.lot_date),
      description: r.description || null, vendor: r.vendor || null,
      dateReceived: fmtDay(r.date_received),
      originalWeight: r.original_weight ?? null, totalQuantity: r.total_quantity ?? null,
      cases: parseCases(r.total_quantity),
      registered: r.forms > 0,
      blocked: sourceBlock(r),
    })));
  } catch (err) {
    sendError(res, err, "list mix candidates");
  }
});

router.get("/lot-mixes/:id", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid lot id" });
  try {
    const mix = await loadMix(req.tenantId, id);
    if (!mix) return res.status(404).json({ error: "That mixed lot was not found." });
    res.json(mix);
  } catch (err) {
    sendError(res, err, "read mix");
  }
});

// Makes the NX lot and its registration form, and mixes the lots into it.
router.post("/lot-mixes", verifyToken, requireRole(...RECEPTION_ROLES), async (req, res) => {
  const b = req.body || {};
  const lotIds = Array.isArray(b.lotIds) ? b.lotIds : [];
  if (!lotIds.length) return res.status(400).json({ code: "NO_LOTS", error: "Pick the lots going into the mix." });
  const description = text(b.productDescription);
  if (!description) return res.status(400).json({ code: "NO_DESCRIPTION", error: "Say what the mixed product is." });
  const yieldPct = b.predictedYield == null || b.predictedYield === "" ? null : Number(b.predictedYield);
  if (yieldPct != null && !(Number.isFinite(yieldPct) && yieldPct >= 0 && yieldPct <= 100)) {
    return res.status(400).json({ error: "Predicted yield must be a percentage from 0 to 100." });
  }
  const dueDate = b.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate)) ? String(b.dueDate) : null;

  const client = await pool.connect();
  let made;
  try {
    await client.query("BEGIN");
    const lot = await issueMixLot(client, req.tenantId, req.userId);
    const form = await client.query(
      `INSERT INTO noblesse_registration_forms
         (tenant_id, lot_number, lot_id, form_date, date_received, product_description,
          processing_type, spec, due_date, predicted_yield, remarks, checked_by)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [req.tenantId, lot.lot_number, lot.lot_id, fmtDay(lot.lot_date), description,
       b.processingType ? String(b.processingType) : null, text(b.spec), dueDate, yieldPct,
       text(b.remarks), text(b.checkedBy)]);
    const out = await addSources(client, req.tenantId, lot.lot_id, lotIds, req.username);
    await client.query("COMMIT");
    made = { lot, formId: form.rows[0].id, out };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    return sendError(res, err, "make mix");
  }
  client.release();

  const { lot, formId, out } = made;
  logHistory(req.tenantId, "lot_mixed", lot.lot_number,
    { mixLotId: lot.lot_id, formId, added: out.added.map((a) => a.lotNumber) }, req.username);
  pool.query(
    `INSERT INTO noblesse_registration_history (tenant_id, form_id, action, lot_number, performed_by)
     VALUES ($1, $2, 'created', $3, $4)`, [req.tenantId, formId, lot.lot_number, req.username || null]
  ).catch((err) => console.error("registration form history log error:", err.message));
  try {
    res.status(201).json(await loadMix(req.tenantId, lot.lot_id));
  } catch (err) {
    sendError(res, err, "read new mix");
  }
});

// More lots into the mix. Allowed at any time: product for a mix can arrive later.
router.post("/lot-mixes/:id/lots", verifyToken, requireRole(...RECEPTION_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid lot id" });
  const lotIds = Array.isArray(req.body?.lotIds) ? req.body.lotIds : [];
  try {
    const out = await withMix(req.tenantId, id, async (client, mix) => ({
      mix, ...(await addSources(client, req.tenantId, id, lotIds, req.username)),
    }));
    logHistory(req.tenantId, "lot_mixed", out.mix.lot_number,
      { mixLotId: id, added: out.added.map((a) => a.lotNumber) }, req.username);
    res.json(await loadMix(req.tenantId, id));
  } catch (err) {
    sendError(res, err, "add to mix");
  }
});

// A lot back out of the mix, for a mistake. Only until the NX lot has been used.
router.delete("/lot-mixes/:id/lots/:lotId", verifyToken, requireRole(...RECEPTION_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const lotId = Number(req.params.lotId);
  if (!Number.isInteger(id) || !Number.isInteger(lotId)) return res.status(400).json({ error: "Invalid lot id" });
  try {
    const out = await withMix(req.tenantId, id, async (client, mix) => ({
      mix, ...(await removeSource(client, req.tenantId, id, lotId)),
    }));
    logHistory(req.tenantId, "lot_unmixed", out.mix.lot_number,
      { mixLotId: id, removed: out.removed.lotNumber }, req.username);
    res.json(await loadMix(req.tenantId, id));
  } catch (err) {
    sendError(res, err, "take out of mix");
  }
});

// Undoes the whole mix: every lot back on its own, and the NX lot and its form gone.
router.delete("/lot-mixes/:id", verifyToken, requireRole(...RECEPTION_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid lot id" });
  try {
    const out = await withMix(req.tenantId, id, async (client, mix) => {
      const blocked = await mixUseBlock(client, req.tenantId, id);
      if (blocked) throw Object.assign(new Error(blocked.replace("its lots can no longer be taken out",
        "the mix can no longer be undone")), { status: 409, code: "MIX_IN_USE" });
      // A report sent back still names the lot, so the lot cannot be deleted under it.
      const reports = await client.query(
        "SELECT COUNT(*)::int AS n FROM noblesse_processing_reports WHERE tenant_id = $1 AND lot_id = $2",
        [req.tenantId, id]);
      if (reports.rows[0].n > 0) {
        throw Object.assign(new Error(`${mix.lot_number} has a rejected processing report. Delete that report first.`),
          { status: 409, code: "MIX_IN_USE" });
      }
      const form = await client.query(
        "SELECT * FROM noblesse_registration_forms WHERE tenant_id = $1 AND lot_id = $2", [req.tenantId, id]);
      const sources = await mixSources(client, req.tenantId, id);
      for (const s of sources) await removeSource(client, req.tenantId, id, s.lotId);
      await client.query("DELETE FROM nti_inventory WHERE tenant_id = $1 AND lot_id = $2 AND stage = 'raw'",
        [req.tenantId, id]);
      await client.query(
        "DELETE FROM registration_form_batches WHERE tenant_id = $1 AND form_id = ANY($2::int[])",
        [req.tenantId, form.rows.map((f) => f.id)]);
      await client.query("DELETE FROM noblesse_registration_forms WHERE tenant_id = $1 AND lot_id = $2",
        [req.tenantId, id]);
      await client.query("DELETE FROM lots WHERE tenant_id = $1 AND lot_id = $2", [req.tenantId, id]);
      return { mix, form: form.rows[0] || null, sources };
    });
    logHistory(req.tenantId, "mix_undone", out.mix.lot_number,
      { mixLotId: id, sources: out.sources.map((s) => s.lotNumber), form: out.form }, req.username);
    if (out.form) {
      pool.query(
        `INSERT INTO noblesse_registration_history (tenant_id, form_id, action, lot_number, old_values, performed_by)
         VALUES ($1, $2, 'deleted', $3, $4, $5)`,
        [req.tenantId, out.form.id, out.mix.lot_number, JSON.stringify(out.form), req.username || null]
      ).catch((err) => console.error("registration form history log error:", err.message));
    }
    res.json({ undone: out.mix.lot_number, sources: out.sources.map((s) => s.lotNumber) });
  } catch (err) {
    sendError(res, err, "undo mix");
  }
});

// Recomputes a mix from its sources. Every source change already does this; it is here for repair.
router.post("/lot-mixes/:id/refresh", verifyToken, requireRole(...RECEPTION_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid lot id" });
  try {
    await withMix(req.tenantId, id, (client) => refreshMix(client, req.tenantId, id));
    res.json(await loadMix(req.tenantId, id));
  } catch (err) {
    sendError(res, err, "refresh mix");
  }
});

module.exports = router;
