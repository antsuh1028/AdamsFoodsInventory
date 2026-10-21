// Tying weighing sessions to a registration form.

const router = require("express").Router();
const pool = require("../../utils/pg");
const verifyToken = require("../../middleware/verifyToken.pg");
const { weightInLb } = require("../../utils/sqlWeight");

// Box weights feeding a registration form  A registration form records what came
// in; box weighing is how that figure is actually measured.

// The live figure for a form: every box across its linked sessions, converted
// and rounded exactly as the tally is, with voided rows excluded.
const boxTotalsForForm = async (formId, tenantId) => {
  const sessions = await pool.query(
    // Everything the form can be filled FROM, not just what it displays.
    `SELECT b.batch_id, b.lot_number, b.lot_id, b.vendor, b.item_description,
            b.bill_of_lading, b.brand, b.est_number, b.grade,
            -- Carried so the panel can LABEL a tie that should never have been
            -- made. New ones are refused now, but any that predate that guard
            -- are already sitting on filed forms, and without this they are
            -- indistinguishable from good ones — so nobody would ever find them.
            b.direction,
            b.status, b.source, b.created_at, b.weighed_on::text AS weighed_on,
            (SELECT COUNT(*)::int FROM batch_items i
              WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL) AS box_count,
            COALESCE((SELECT SUM(${weightInLb("i")})::text FROM batch_items i
              WHERE i.batch_id = b.batch_id AND i.voided_at IS NULL), '0') AS total
       FROM registration_form_batches r
       JOIN box_batches b ON b.batch_id = r.batch_id
      WHERE r.form_id = $1 AND r.tenant_id = $2
      ORDER BY r.position, b.batch_id`,
    [formId, tenantId]
  );

  const totals = await pool.query(
    `SELECT COUNT(*)::int AS box_count,
            COALESCE(SUM(${weightInLb("i")})::text, '0') AS total
       FROM batch_items i
       JOIN registration_form_batches r ON r.batch_id = i.batch_id
      WHERE r.form_id = $1 AND r.tenant_id = $2 AND i.voided_at IS NULL`,
    [formId, tenantId]
  );

  return {
    sessions: sessions.rows,
    boxCount: totals.rows[0] ? totals.rows[0].box_count : 0,
    totalWeight: totals.rows[0] ? totals.rows[0].total : "0",
    weightUnit: "LB",
  };
};

router.get("/noblesse-registration-forms/:id/box-batches", verifyToken, async (req, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) return res.status(400).json({ error: "Invalid form id" });
  try {
    res.json(await boxTotalsForForm(formId, req.tenantId));
  } catch (err) {
    console.error("read form box batches:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Tie one or more weighing sessions to a form.
router.post("/noblesse-registration-forms/:id/box-batches", verifyToken, async (req, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) return res.status(400).json({ error: "Invalid form id" });

  const { batchIds } = req.body || {};
  if (!Array.isArray(batchIds) || batchIds.length === 0) {
    return res.status(400).json({ error: "batchIds must be a non-empty array" });
  }
  if (!batchIds.every((id) => Number.isInteger(id))) {
    return res.status(400).json({ error: "batchIds must all be integers" });
  }
  const ids = [...new Set(batchIds)];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const form = await client.query(
      `SELECT id FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [formId, req.tenantId]
    );
    if (!form.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Registration form not found" });
    }

    // Counted rather than trusted, so a session id from another tenant cannot
    // be attached to this form.
    const owned = await client.query(
      `SELECT batch_id, lot_number, direction
         FROM box_batches WHERE batch_id = ANY($1::int[]) AND tenant_id = $2`,
      [ids, req.tenantId]
    );
    if (owned.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or more sessions were not found" });
    }

    // A registration form asserts "these boxes are the measurement of this
    // delivery".
    const outgoing = owned.rows.filter((b) => b.direction === "outgoing");
    if (outgoing.length) {
      await client.query("ROLLBACK");
      const names = outgoing.map((b) => b.lot_number || `batch ${b.batch_id}`).join(", ");
      return res.status(409).json({
        code: "OUTGOING_SESSION",
        error: `${names} weighed finished product going OUT, not an arrival. ` +
               `A registration form records what came in — those boxes belong ` +
               `on the Outgoing tab.`,
        sessions: outgoing.map((b) => ({ batchId: b.batch_id, lotNumber: b.lot_number })),
      });
    }

    // A weighing session belongs to ONE delivery.
    const claimed = await client.query(
      `SELECT r.batch_id, r.form_id, b.lot_number
         FROM registration_form_batches r
         JOIN box_batches b ON b.batch_id = r.batch_id
        WHERE r.batch_id = ANY($1::int[]) AND r.tenant_id = $2 AND r.form_id <> $3`,
      [ids, req.tenantId, formId]
    );
    if (claimed.rows.length) {
      await client.query("ROLLBACK");
      const names = claimed.rows
        .map((c) => `${c.lot_number || `batch ${c.batch_id}`} (form ${c.form_id})`)
        .join(", ");
      return res.status(409).json({
        code: "SESSION_ALREADY_TIED",
        error: `Already tied to another registration form: ${names}. ` +
               `Untie it there first.`,
        sessions: claimed.rows,
      });
    }

    // Re-linking to the SAME form is not an error — it is what a double tap
    // produces, and the link is identical either way.
    await client.query(
      `INSERT INTO registration_form_batches (form_id, batch_id, tenant_id, position)
       SELECT $1, b, $2, p FROM UNNEST($3::int[], $4::int[]) AS t(b, p)
       ON CONFLICT (form_id, batch_id) DO NOTHING`,
      [formId, req.tenantId, ids, ids.map((_, i) => i)]
    );

    await client.query("COMMIT");
    return res.status(201).json(await boxTotalsForForm(formId, req.tenantId));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("link form box batches:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Untie one session. The session and its boxes are untouched — only the link
// goes, which is why this one is a plain delete.
router.delete("/noblesse-registration-forms/:id/box-batches/:batchId",
  verifyToken, async (req, res) => {
    const formId = Number(req.params.id);
    const batchId = Number(req.params.batchId);
    if (!Number.isInteger(formId) || !Number.isInteger(batchId)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      await pool.query(
        `DELETE FROM registration_form_batches
          WHERE form_id = $1 AND batch_id = $2 AND tenant_id = $3`,
        [formId, batchId, req.tenantId]
      );
      res.json(await boxTotalsForForm(formId, req.tenantId));
    } catch (err) {
      console.error("unlink form box batch:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

module.exports = router;
