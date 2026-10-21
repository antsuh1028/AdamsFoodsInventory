// Registration forms: the record of what came in for a lot, and its history.

const router = require("express").Router();
const pool = require("../../utils/pg");
const verifyToken = require("../../middleware/verifyToken.pg");
const requireRole = require("../../middleware/requireRole");
const { lotColumns } = require("../../utils/lotRegistry");
const { syncRegistrationStock } = require("../../utils/registrationStock");
const { yieldLateralSql, yieldFrom } = require("../../utils/lotYield");
const { searchTerm, searchClause } = require("../../utils/search");
const { fmtDate } = require("./helpers/shared");

const fmtRegistrationForm = (row) => {
  // Handle processingDates: use JSON column if available, otherwise build from legacy columns
  let processingDates = [];
  if (row.processing_dates && Array.isArray(row.processing_dates)) {
    processingDates = row.processing_dates.map(pd => ({
      date: fmtDate(pd.date),
      weight: pd.weight != null ? Number(pd.weight) : null,
      // Cases processed. Rows written before this existed have no `cases` key,
      // so it reads as null rather than 0 — nobody entered zero, it was never
      // asked for.
      cases: pd.cases != null && pd.cases !== "" ? Number(pd.cases) : null,
      // Which accepted processing report wrote this row. Dropping it here made
      // the row render as editable AND made the save path merge the original
      // back alongside the client's id-less copy, so every save duplicated it.
      // Set to null it did the same thing by another route: the merge guard
      // tested for the KEY, which a null still has. So a manual row carries no
      // reportId key at all.
      ...(pd.reportId != null ? { reportId: Number(pd.reportId) } : {}),
      // The FP lot a run came from; such rows never count against the form's cases.
      ...(pd.fp ? { fp: String(pd.fp) } : {}),
    }));
  } else {
    // Fallback to legacy columns for existing data
    if (row.processing_date_1 || row.processed_weight_1) {
      processingDates.push({
        date: fmtDate(row.processing_date_1),
        weight: row.processed_weight_1 != null ? Number(row.processed_weight_1) : null
      });
    }
    if (row.processing_date_2 || row.processed_weight_2) {
      processingDates.push({
        date: fmtDate(row.processing_date_2),
        weight: row.processed_weight_2 != null ? Number(row.processed_weight_2) : null
      });
    }
  }

  return {
    id:                     row.id,
    lotNumber:              row.lot_number,
    // So the lot picker shows what is already selected when a form is reopened.
    lotId:                  row.lot_id ?? null,
    formDate:               fmtDate(row.form_date),
    dateReceived:           fmtDate(row.date_received),
    timeReceived:           row.time_received,
    vendorLot:              row.vendor_lot,
    vendor:                 row.vendor,
    productDescription:     row.product_description,
    processingType:         row.processing_type,
    spec:                   row.spec,
    brand:                  row.brand,
    estNumber:              row.est_number,
    grade:                  row.grade,
    dueDate:                fmtDate(row.due_date),
    predictedYield:         row.predicted_yield      != null ? Number(row.predicted_yield)      : null,
    manifestBlAttached:     !!row.manifest_bl_attached,
    processReportAttached:  !!row.process_report_attached,
    originalWeight:         row.original_weight      != null ? Number(row.original_weight)      : null,
    totalQuantity:          row.total_quantity,
    processingDates:        processingDates,
    // Hand-typed and no longer editable anywhere. Kept so old forms still
    // show what someone once wrote, but `yield` below is the real figure.
    actualYield:            row.actual_yield         != null ? Number(row.actual_yield)         : null,
    // Present only where the query joined the figures in.
    yield: row.boxes_out !== undefined
      ? yieldFrom({ ...row, form_weight: row.original_weight })
      : null,
    temp:                   row.temp,
    remarks:                row.remarks,
    checkedBy:              row.checked_by,
    status:                 row.status,
    createdAt:              row.created_at,
    updatedAt:              row.updated_at,
  };
};

const logRegistrationFormHistory = (tenantId, formId, action, lotNumber, changedFields = null, oldValues = null, newValues = null, performedBy = null) => {
  return pool.query(
    `INSERT INTO noblesse_registration_history (tenant_id, form_id, action, lot_number, changed_fields, old_values, new_values, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tenantId, formId, action, lotNumber, changedFields ? JSON.stringify(changedFields) : null,
     oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, performedBy]
  ).catch((err) => console.error("registration form history log error:", err.message));
};

// Stock sync must not fail a form save. The form is the record of truth, and an
// operator losing their entry to stock arithmetic is worse than stock lagging
// by one save. The outcome is RETURNED rather than swallowed, so the screen can
// say what happened instead of the divergence being silent.
const syncStock = async (tenantId, formId) => {
  try {
    const { action, shortfall, error } = await syncRegistrationStock(pool, tenantId, formId);
    // "blocked" is a refusal with a reason, not a failure — the form still
    // saved, and the message says what to do about the stock.
    if (action === "blocked") return { action, error };
    return shortfall ? { action, shortfall } : { action };
  } catch (err) {
    console.error("registration stock sync error:", err.message);
    return { action: "error", error: err.message };
  }
};

const getChangedFields = (oldData, newData) => {
  const changed = {};
  const changedFields = [];
  Object.keys(newData).forEach(key => {
    const oldVal = oldData[key];
    const newVal = newData[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changed[key] = { from: oldVal, to: newVal };
      changedFields.push(key);
    }
  });
  return { changedFields, changed };
};

const safeJsonParse = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error("JSON parse error:", err.message, "value:", value);
    return null;
  }
};

// `lot` comes from lotColumns(): the canonical lot_number plus its lot_id, or
// the caller's original text with a null id when it is not a lot number. The
// registration form is an incoming-side record, so it may create a lot.
// Report-sourced runs are not the client's to delete.
//
// An accepted processing report appends a run row carrying its reportId, and
// this route rewrites processing_dates whole — so reception saving a form they
// had open before accepting would erase it. Rows the payload omits but that
// carry a reportId are merged back from the row being updated. Removing one is
// what unaccept is for.
const MERGE_REPORT_RUNS = `(
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM (
      SELECT e FROM jsonb_array_elements(COALESCE($19::jsonb, '[]'::jsonb)) e
      UNION ALL
      SELECT e FROM jsonb_array_elements(COALESCE(processing_dates, '[]'::jsonb)) e
       -- Not a key-exists test: that is true for a manual row carrying
       -- reportId:null. Only a row with a real id is a report row to protect.
       WHERE e->>'reportId' IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE($19::jsonb, '[]'::jsonb)) p
            WHERE p->>'reportId' = e->>'reportId')
    ) merged
  )`;

const regFormValues = (body, lot) => {
  // Handle processingDates: convert array to JSON for storage
  const processingDatesJSON = body.processingDates && Array.isArray(body.processingDates)
    ? JSON.stringify(body.processingDates
        .filter(pd => pd.date || pd.weight || pd.cases)
        // A null reportId is not an answer, and stored as one it makes the
        // merge guard treat a hand-typed row as a report row.
        .map(({ reportId, ...rest }) =>
          (reportId != null ? { ...rest, reportId } : rest)))
    : null;

  return [
    lot.lotNumber            || null,
    body.formDate            || null,
    body.dateReceived        || null,
    body.timeReceived        || null,
    body.vendorLot           || null,
    body.vendor              || null,
    body.productDescription  || null,
    body.processingType      || null,
    body.spec                || null,
    body.brand               || null,
    body.estNumber           || null,
    body.grade               || null,
    body.dueDate             || null,
    body.predictedYield      != null && body.predictedYield !== "" ? Number(body.predictedYield) : null,
    !!body.manifestBlAttached,
    !!body.processReportAttached,
    body.originalWeight      != null && body.originalWeight !== "" ? Number(body.originalWeight) : null,
    body.totalQuantity       || null,
    processingDatesJSON,
    body.actualYield         != null && body.actualYield !== "" ? Number(body.actualYield) : null,
    body.temp                || null,
    body.remarks             || null,
    body.checkedBy           || null,
  ];
};

router.get("/noblesse-registration-forms", verifyToken, async (req, res) => {
  const term = searchTerm(req.query.q);
  const params = [req.tenantId];
  let where = "";
  if (term) {
    params.push(term);
    where = ` AND ${searchClause([
      "f.lot_number", "f.vendor_lot", "f.vendor", "f.product_description",
      "f.processing_type", "f.spec", "f.brand", "f.est_number", "f.grade",
      "f.remarks", "f.checked_by", "f.status",
    ], params.length)}`;
  }
  try {
    // A search looks past the newest 200 a plain listing stops at.
    const result = await pool.query(
      `SELECT f.*, y.weighed_in, y.weighed_out, y.boxes_in, y.boxes_out,
              y.estimated_in, y.estimated_out
         FROM noblesse_registration_forms f
         ${yieldLateralSql("f")}
        WHERE f.tenant_id = $1${where} ORDER BY f.created_at DESC LIMIT ${term ? 500 : 200}`,
      params
    );
    res.json(result.rows.map(fmtRegistrationForm));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/noblesse-registration-forms/all/history", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM noblesse_registration_history WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [req.tenantId]
    );
    const history = result.rows.map(row => ({
      id: row.id,
      formId: row.form_id,
      action: row.action,
      lotNumber: row.lot_number,
      changedFields: safeJsonParse(row.changed_fields),
      oldValues: safeJsonParse(row.old_values),
      newValues: safeJsonParse(row.new_values),
      performedBy: row.performed_by,
      createdAt: row.created_at,
    }));
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/noblesse-registration-forms/:id", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*, y.weighed_in, y.weighed_out, y.boxes_in, y.boxes_out,
              y.estimated_in, y.estimated_out
         FROM noblesse_registration_forms f
         ${yieldLateralSql("f")}
        WHERE f.id = $1 AND f.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(fmtRegistrationForm(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/noblesse-registration-forms", verifyToken, async (req, res) => {
  try {
    const lot = await lotColumns(req.tenantId, req.userId, req.body.lotNumber, pool, req.body.lotId);
    const result = await pool.query(
      `INSERT INTO noblesse_registration_forms
         (tenant_id, lot_number, form_date, date_received, time_received, vendor_lot, vendor,
          product_description, processing_type, spec, brand, est_number, grade,
          due_date, predicted_yield, manifest_bl_attached, process_report_attached,
          original_weight, total_quantity, processing_dates, actual_yield, temp, remarks, checked_by,
          lot_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [req.tenantId, ...regFormValues(req.body, lot), lot.lotId]
    );
    const form = result.rows[0];

    // Log creation
    logRegistrationFormHistory(req.tenantId, form.id, "created", form.lot_number, null, null, fmtRegistrationForm(form), req.username);

    const stock = await syncStock(req.tenantId, form.id);

    res.json({ ...fmtRegistrationForm(form), stock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/noblesse-registration-forms/:id", verifyToken, async (req, res) => {
  try {
    // Fetch old data first for history
    const oldRes = await pool.query(
      `SELECT * FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!oldRes.rows.length) return res.status(404).json({ error: "Not found" });
    const oldData = fmtRegistrationForm(oldRes.rows[0]);

    // Any case is the same status; anything else keeps the one the form has, never null.
    const asked = String(req.body.status || "").trim().toLowerCase();
    const status = ["in_progress", "completed"].includes(asked) ? asked : (oldRes.rows[0].status || "in_progress");
    const lot = await lotColumns(req.tenantId, req.userId, req.body.lotNumber, pool, req.body.lotId);
    const result = await pool.query(
      `UPDATE noblesse_registration_forms
       SET lot_number = $1, form_date = $2, date_received = $3, time_received = $4, vendor_lot = $5, vendor = $6,
           product_description = $7, processing_type = $8, spec = $9, brand = $10, est_number = $11, grade = $12,
           due_date = $13, predicted_yield = $14, manifest_bl_attached = $15, process_report_attached = $16,
           original_weight = $17, total_quantity = $18, processing_dates = ${MERGE_REPORT_RUNS}, actual_yield = $20, temp = $21, remarks = $22,
           checked_by = $23, status = $24, lot_id = $25, updated_at = NOW()
       WHERE id = $26 AND tenant_id = $27
       RETURNING *`,
      [...regFormValues(req.body, lot), status, lot.lotId, req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });

    const newForm = fmtRegistrationForm(result.rows[0]);
    const { changedFields } = getChangedFields(oldData, newForm);

    // Log update if there were changes
    if (changedFields.length > 0) {
      logRegistrationFormHistory(req.tenantId, req.params.id, "updated", newForm.lotNumber, changedFields, oldData, newForm, req.username);
    }

    // Re-synced on every save, not just when the weight changed: the lot,
    // description and case count all land on the stock row too.
    const stock = await syncStock(req.tenantId, req.params.id);

    res.json({ ...newForm, stock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/noblesse-registration-forms/:id/status", verifyToken, async (req, res) => {
  const { status } = req.body;
  const VALID = ["in_progress", "completed"];
  if (!VALID.includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const oldRes = await pool.query(
      `SELECT * FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!oldRes.rows.length) return res.status(404).json({ error: "Not found" });
    const oldForm = fmtRegistrationForm(oldRes.rows[0]);

    const result = await pool.query(
      `UPDATE noblesse_registration_forms SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [status, req.params.id, req.tenantId]
    );

    const newForm = fmtRegistrationForm(result.rows[0]);

    // Log status change
    if (oldForm.status !== newForm.status) {
      logRegistrationFormHistory(req.tenantId, req.params.id, "status_changed", newForm.lotNumber,
        ["status"], { status: oldForm.status }, { status: newForm.status }, req.username);
    }

    res.json(newForm);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/noblesse-registration-forms/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    // Read the whole row, not just the lot number: once the delete runs this is
    // the only copy of the form that will ever exist, so the history entry has
    // to carry it or the record is gone for good.
    const formRes = await pool.query(
      `SELECT * FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!formRes.rows.length) return res.status(404).json({ error: "Not found" });
    const deletedForm = fmtRegistrationForm(formRes.rows[0]);

    // Clear any links to weighing sessions first. That table deliberately has
    // no foreign key to this one (see the migration in boxes.pg.js), so nothing
    // cleans up after it — leaving rows here would attach this form's id to
    // whatever form later reuses it.
    await pool.query(
      `DELETE FROM registration_form_batches WHERE form_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    ).catch((err) => console.error("clear form box links:", err.message));

    const result = await pool.query(
      `DELETE FROM noblesse_registration_forms WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.tenantId]
    );

    // Logged as oldValues — this is what the form was before it ceased to exist.
    logRegistrationFormHistory(req.tenantId, req.params.id, "deleted", deletedForm.lotNumber,
      null, deletedForm, null, req.username);

    // Same reasoning as the box links above: nothing cleans up after this, and
    // stock left behind would be credited to whatever form reuses the id. The
    // sync sees a form that no longer exists and removes its row.
    const stock = await syncStock(req.tenantId, req.params.id);

    res.json({ deleted: result.rows[0].id, stock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/noblesse-registration-forms/:id/history", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM noblesse_registration_history WHERE form_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
      [req.params.id, req.tenantId]
    );
    const history = result.rows.map(row => ({
      id: row.id,
      action: row.action,
      lotNumber: row.lot_number,
      changedFields: safeJsonParse(row.changed_fields),
      oldValues: safeJsonParse(row.old_values),
      newValues: safeJsonParse(row.new_values),
      performedBy: row.performed_by,
      createdAt: row.created_at,
    }));
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
