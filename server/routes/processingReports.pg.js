const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");

// The shop-floor record of one processing run: which lot, which line, who ran
// it, how many cases went through.
//
// Two people touch it. The processing manager SUBMITS; nothing moves. The
// reception person who owns the registration form ACCEPTS; that is when cases
// come off the lot and a run row lands on the form.
//
// Tracked in CASES only. The manager counts cases, not pounds, and real weights
// come from the weighing benches at either end.

const DECIMAL_RE = /^\d{1,7}(\.\d{1,3})?$/;

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d || null));

const fmtReport = (r, pulls = [], workers = []) => ({
  reportId: r.report_id,
  lotId: r.lot_id,
  lotNumber: r.lot_number || null,
  processingDate: fmtDate(r.processing_date),
  processingType: r.processing_type,
  lineNo: r.line_no,
  customer: r.customer,
  description: r.description,
  brand: r.brand,
  grade: r.grade,
  estNumber: r.est_number,
  packDate: fmtDate(r.pack_date),
  inputCases: r.input_cases,
  outputCases: r.output_cases,
  outputWeight: r.output_weight,
  inedibleWeight: r.inedible_weight,
  notes: r.notes,
  status: r.status,
  submittedBy: r.submitted_by,
  submittedAt: r.submitted_at,
  acceptedBy: r.accepted_by,
  acceptedAt: r.accepted_at,
  rejectReason: r.reject_reason,
  appliedFormId: r.applied_form_id,
  pulls: pulls.map((p) => ({ pullId: p.pull_id, position: p.position, cases: p.cases, notes: p.notes })),
  workers: workers.map((w) => w.name),
});

const loadReport = async (reportId, tenantId, client = pool) => {
  const head = await client.query(
    `SELECT r.*, l.lot_number
       FROM noblesse_processing_reports r
       JOIN lots l ON l.lot_id = r.lot_id
      WHERE r.report_id = $1 AND r.tenant_id = $2`,
    [reportId, tenantId]
  );
  if (!head.rows.length) return null;
  const pulls = await client.query(
    `SELECT * FROM noblesse_processing_report_pulls WHERE report_id = $1 ORDER BY position, pull_id`,
    [reportId]
  );
  const workers = await client.query(
    `SELECT * FROM noblesse_processing_report_workers WHERE report_id = $1 ORDER BY position, worker_id`,
    [reportId]
  );
  return fmtReport(head.rows[0], pulls.rows, workers.rows);
};

// Whole cases only. A fractional case is not a thing anybody can pull.
const asCases = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const asDecimal = (v) => {
  if (v == null || v === "") return null;
  const s = String(v);
  return DECIMAL_RE.test(s) ? s : undefined;   // undefined = invalid
};

// ── Read ─────────────────────────────────────────────────────────────────────

router.get("/processing-reports", verifyToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const params = [req.tenantId, limit];
  let where = "";
  if (req.query.status) {
    params.push(String(req.query.status));
    where += ` AND r.status = $${params.length}`;
  }
  // Matched by id, or by the lot NUMBER when the caller has no id — a form
  // saved before lot_id existed, or for an external lot whose id never
  // resolved, only knows the number.
  if (req.query.lotId) {
    params.push(Number(req.query.lotId));
    where += ` AND r.lot_id = $${params.length}`;
  } else if (req.query.lotNumber) {
    params.push(String(req.query.lotNumber));
    where += ` AND l.lot_number = $${params.length}`;
  }
  try {
    const result = await pool.query(
      `SELECT r.*, l.lot_number,
              (SELECT COALESCE(json_agg(json_build_object(
                        'pullId', p.pull_id, 'position', p.position,
                        'cases', p.cases, 'notes', p.notes) ORDER BY p.position, p.pull_id), '[]'::json)
                 FROM noblesse_processing_report_pulls p WHERE p.report_id = r.report_id) AS pulls,
              (SELECT COALESCE(json_agg(w.name ORDER BY w.position, w.worker_id), '[]'::json)
                 FROM noblesse_processing_report_workers w WHERE w.report_id = r.report_id) AS workers
         FROM noblesse_processing_reports r
         JOIN lots l ON l.lot_id = r.lot_id
        WHERE r.tenant_id = $1${where}
        ORDER BY r.processing_date DESC NULLS LAST, r.report_id DESC
        LIMIT $2`,
      params
    );
    res.json(result.rows.map((r) => ({
      ...fmtReport(r),
      pulls: r.pulls || [],
      workers: r.workers || [],
    })));
  } catch (err) {
    console.error("list processing reports:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/processing-reports/:id", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid report id" });
  try {
    const report = await loadReport(id, req.tenantId);
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  } catch (err) {
    console.error("get processing report:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── Submit and edit ──────────────────────────────────────────────────────────

// Pulls, workers and the head fields shared by create and edit.
const validateBody = (body) => {
  const pulls = Array.isArray(body.pulls) ? body.pulls : [];
  const cleanPulls = pulls
    .map((p) => ({ cases: asCases(p && p.cases), notes: (p && p.notes) || null }))
    .filter((p) => p.cases !== null);
  if (!cleanPulls.length) {
    return { error: "At least one pull with a whole number of cases is required" };
  }

  for (const [key, label] of [["outputWeight", "outputWeight"], ["inedibleWeight", "inedibleWeight"]]) {
    if (asDecimal(body[key]) === undefined) {
      return { error: `${label} must be a decimal string with at most 3 decimal places` };
    }
  }

  const outputCases = body.outputCases == null || body.outputCases === ""
    ? null : asCases(body.outputCases);
  if (body.outputCases != null && body.outputCases !== "" && outputCases === null) {
    return { error: "outputCases must be a whole number greater than zero" };
  }

  const workers = (Array.isArray(body.workers) ? body.workers : [])
    .map((w) => String(w || "").trim()).filter(Boolean);

  return {
    ok: true,
    cleanPulls,
    workers,
    outputCases,
    head: {
      processingDate: body.processingDate || null,
      processingType: body.processingType || null,
      lineNo: body.lineNo || null,
      customer: body.customer || null,
      description: body.description || null,
      brand: body.brand || null,
      grade: body.grade || null,
      estNumber: body.estNumber || null,
      packDate: body.packDate || null,
      outputWeight: asDecimal(body.outputWeight),
      inedibleWeight: asDecimal(body.inedibleWeight),
      notes: body.notes || null,
    },
  };
};

const writeChildren = async (client, reportId, cleanPulls, workers) => {
  await client.query(`DELETE FROM noblesse_processing_report_pulls WHERE report_id = $1`, [reportId]);
  await client.query(`DELETE FROM noblesse_processing_report_workers WHERE report_id = $1`, [reportId]);
  if (cleanPulls.length) {
    await client.query(
      `INSERT INTO noblesse_processing_report_pulls (report_id, position, cases, notes)
       SELECT $1, p, c, n FROM UNNEST($2::int[], $3::int[], $4::text[]) AS t(p, c, n)`,
      [reportId, cleanPulls.map((_, i) => i), cleanPulls.map((p) => p.cases),
       cleanPulls.map((p) => p.notes)]
    );
  }
  if (workers.length) {
    await client.query(
      `INSERT INTO noblesse_processing_report_workers (report_id, position, name)
       SELECT $1, p, n FROM UNNEST($2::int[], $3::text[]) AS t(p, n)`,
      [reportId, workers.map((_, i) => i), workers]
    );
  }
};

router.post("/processing-reports", verifyToken, async (req, res) => {
  const body = req.body || {};
  const lotId = Number(body.lotId);
  if (!Number.isInteger(lotId)) {
    return res.status(400).json({ error: "lotId is required" });
  }

  const v = validateBody(body);
  if (v.error) return res.status(400).json({ error: v.error });

  const inputCases = v.cleanPulls.reduce((sum, p) => sum + p.cases, 0);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Resolved by id, never by parsing the number — an external lot has no
    // N{YY}{JJJ}-{NN} to parse.
    const lot = await client.query(
      `SELECT lot_id FROM lots WHERE lot_id = $1 AND tenant_id = $2`,
      [lotId, req.tenantId]
    );
    if (!lot.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ code: "NO_SUCH_LOT", error: "That lot is not in the registry" });
    }

    const h = v.head;
    const inserted = await client.query(
      `INSERT INTO noblesse_processing_reports
         (tenant_id, lot_id, processing_date, processing_type, line_no, customer,
          description, brand, grade, est_number, pack_date, input_cases,
          output_cases, output_weight, inedible_weight, notes, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING report_id`,
      [req.tenantId, lotId, h.processingDate, h.processingType, h.lineNo, h.customer,
       h.description, h.brand, h.grade, h.estNumber, h.packDate, inputCases,
       v.outputCases, h.outputWeight, h.inedibleWeight, h.notes, req.username]
    );
    const reportId = inserted.rows[0].report_id;
    await writeChildren(client, reportId, v.cleanPulls, v.workers);

    await client.query("COMMIT");
    res.status(201).json(await loadReport(reportId, req.tenantId));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("create processing report:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Editable only while submitted. Once accepted the numbers have moved stock, so
// changing them would leave the lot disagreeing with the report that moved it.
router.patch("/processing-reports/:id", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid report id" });

  const v = validateBody(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const inputCases = v.cleanPulls.reduce((sum, p) => sum + p.cases, 0);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT status FROM noblesse_processing_reports
        WHERE report_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, req.tenantId]
    );
    if (!cur.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }
    if (cur.rows[0].status === "accepted") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "ALREADY_ACCEPTED",
        error: "This report has been accepted and its cases are off the lot. Un-accept it first.",
      });
    }

    const h = v.head;
    await client.query(
      `UPDATE noblesse_processing_reports
          SET processing_date = $1, processing_type = $2, line_no = $3, customer = $4,
              description = $5, brand = $6, grade = $7, est_number = $8, pack_date = $9,
              input_cases = $10, output_cases = $11, output_weight = $12,
              inedible_weight = $13, notes = $14,
              status = 'submitted', reject_reason = NULL
        WHERE report_id = $15 AND tenant_id = $16`,
      [h.processingDate, h.processingType, h.lineNo, h.customer, h.description,
       h.brand, h.grade, h.estNumber, h.packDate, inputCases, v.outputCases,
       h.outputWeight, h.inedibleWeight, h.notes, id, req.tenantId]
    );
    await writeChildren(client, id, v.cleanPulls, v.workers);

    await client.query("COMMIT");
    res.json(await loadReport(id, req.tenantId));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("patch processing report:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// ── Accept: the only step that moves stock ───────────────────────────────────

router.post("/processing-reports/:id/accept", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid report id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Locked first: the lock is what makes a double-click safe.
    const head = await client.query(
      `SELECT r.*, l.lot_number
         FROM noblesse_processing_reports r
         JOIN lots l ON l.lot_id = r.lot_id
        WHERE r.report_id = $1 AND r.tenant_id = $2
          FOR UPDATE OF r`,
      [id, req.tenantId]
    );
    if (!head.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }
    const report = head.rows[0];
    if (report.status !== "submitted") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: report.status === "accepted" ? "ALREADY_ACCEPTED" : "NOT_SUBMITTED",
        error: report.status === "accepted"
          ? `Already accepted by ${report.accepted_by || "someone"} — its cases are already off the lot.`
          : "A rejected report has to be resubmitted before it can be accepted.",
      });
    }

    const forms = await client.query(
      `SELECT id, lot_number FROM noblesse_registration_forms
        WHERE tenant_id = $2
          AND (lot_id = $1 OR (lot_id IS NULL AND lot_number = $3))
        ORDER BY id`,
      [report.lot_id, req.tenantId, report.lot_number]
    );
    if (!forms.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "NO_FORM_FOR_LOT",
        error: "This lot has no registration form yet — register it before accepting a report.",
      });
    }
    if (forms.rows.length > 1) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "AMBIGUOUS_FORM",
        error: `This lot has ${forms.rows.length} registration forms, so there is no single one to apply to.`,
        formIds: forms.rows.map((f) => f.id),
      });
    }
    const formId = forms.rows[0].id;

    const stock = await client.query(
      `SELECT id, qty_cases FROM nti_inventory
        WHERE tenant_id = $2 AND stage = 'raw'
          AND (lot_id = $1 OR (lot_id IS NULL AND lot = $3))
        FOR UPDATE`,
      [report.lot_id, req.tenantId, report.lot_number]
    );
    if (!stock.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "NO_RAW_STOCK",
        error: "There is no raw stock on this lot to take cases from.",
      });
    }
    const raw = stock.rows[0];
    const onHand = Number(raw.qty_cases) || 0;

    // Refused, never floored. The old processing-order path silently clamped to
    // zero, which is the behaviour this replaces.
    if (report.input_cases > onHand) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "INSUFFICIENT_STOCK",
        error: `The report uses ${report.input_cases} cases but only ${onHand} are on the lot.`,
        requested: report.input_cases,
        onHand,
      });
    }

    // Cases only. `weight` is left alone: nobody weighed what went through.
    await client.query(
      `UPDATE nti_inventory SET qty_cases = qty_cases - $1
        WHERE id = $2 AND tenant_id = $3`,
      [report.input_cases, raw.id, req.tenantId]
    );

    // Appended in SQL so a concurrent form save cannot clobber it in a
    // read-modify-write. reportId is what lets the form PATCH protect the row.
    await client.query(
      `UPDATE noblesse_registration_forms
          SET processing_dates = COALESCE(processing_dates, '[]'::jsonb) || $1::jsonb
        WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify([{
        date: fmtDate(report.processing_date),
        cases: String(report.input_cases),
        weight: "",
        reportId: id,
      }]), formId, req.tenantId]
    );

    const updated = await client.query(
      `UPDATE noblesse_processing_reports
          SET status = 'accepted', accepted_by = $1, accepted_at = now(), applied_form_id = $2
        WHERE report_id = $3 AND tenant_id = $4
      RETURNING *`,
      [req.username, formId, id, req.tenantId]
    );

    await client.query("COMMIT");

    // After the commit: a history write must never fail a movement that has
    // already happened.
    pool.query(
      `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot, performed_by)
       VALUES ($1, 'processed', $2, $3, $4, $5)`,
      [req.tenantId, raw.id, forms.rows[0].lot_number,
       JSON.stringify({ reportId: id, casesConsumed: report.input_cases, formId }),
       req.username]
    ).catch((err) => console.error("nti history log error:", err.message));

    res.json({ ...(await loadReport(id, req.tenantId)), appliedFormId: updated.rows[0].applied_form_id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("accept processing report:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Sent back to the floor. Moves nothing.
router.post("/processing-reports/:id/reject", verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid report id" });
  const reason = (req.body && req.body.reason) || null;

  try {
    const cur = await pool.query(
      `SELECT status FROM noblesse_processing_reports WHERE report_id = $1 AND tenant_id = $2`,
      [id, req.tenantId]
    );
    if (!cur.rows.length) return res.status(404).json({ error: "Report not found" });
    if (cur.rows[0].status === "accepted") {
      return res.status(409).json({
        code: "ALREADY_ACCEPTED",
        error: "This report was accepted and moved stock. Un-accept it first.",
      });
    }
    await pool.query(
      `UPDATE noblesse_processing_reports SET status = 'rejected', reject_reason = $1
        WHERE report_id = $2 AND tenant_id = $3`,
      [reason, id, req.tenantId]
    );
    res.json(await loadReport(id, req.tenantId));
  } catch (err) {
    console.error("reject processing report:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// The undo for an accept. Admin only, because it puts cases back.
router.post("/processing-reports/:id/unaccept", verifyToken, requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid report id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const head = await client.query(
      `SELECT r.*, l.lot_number
         FROM noblesse_processing_reports r
         JOIN lots l ON l.lot_id = r.lot_id
        WHERE r.report_id = $1 AND r.tenant_id = $2
          FOR UPDATE OF r`,
      [id, req.tenantId]
    );
    if (!head.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }
    const report = head.rows[0];
    if (report.status !== "accepted") {
      await client.query("ROLLBACK");
      return res.status(409).json({ code: "NOT_ACCEPTED", error: "This report has not been accepted." });
    }

    await client.query(
      `UPDATE nti_inventory SET qty_cases = COALESCE(qty_cases, 0) + $1
        WHERE tenant_id = $3 AND stage = 'raw'
          AND (lot_id = $2 OR (lot_id IS NULL AND lot = $4))`,
      [report.input_cases, report.lot_id, req.tenantId, report.lot_number]
    );

    // Only this report's row comes out; hand-entered runs are untouched.
    if (report.applied_form_id) {
      await client.query(
        `UPDATE noblesse_registration_forms
            SET processing_dates = COALESCE((
                  SELECT jsonb_agg(e) FROM jsonb_array_elements(processing_dates) e
                   WHERE COALESCE((e->>'reportId')::int, -1) <> $1
                ), '[]'::jsonb)
          WHERE id = $2 AND tenant_id = $3`,
        [id, report.applied_form_id, req.tenantId]
      );
    }

    await client.query(
      `UPDATE noblesse_processing_reports
          SET status = 'submitted', accepted_by = NULL, accepted_at = NULL, applied_form_id = NULL
        WHERE report_id = $1 AND tenant_id = $2`,
      [id, req.tenantId]
    );

    await client.query("COMMIT");
    res.json(await loadReport(id, req.tenantId));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("unaccept processing report:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

router.delete("/processing-reports/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid report id" });
  try {
    const cur = await pool.query(
      `SELECT status FROM noblesse_processing_reports WHERE report_id = $1 AND tenant_id = $2`,
      [id, req.tenantId]
    );
    if (!cur.rows.length) return res.status(404).json({ error: "Report not found" });
    if (cur.rows[0].status === "accepted") {
      return res.status(409).json({
        code: "ALREADY_ACCEPTED",
        error: "Un-accept it first — deleting it now would leave the cases off the lot with nothing explaining why.",
      });
    }
    // Pulls and workers cascade.
    await pool.query(
      `DELETE FROM noblesse_processing_reports WHERE report_id = $1 AND tenant_id = $2`,
      [id, req.tenantId]
    );
    res.json({ deleted: true, reportId: id });
  } catch (err) {
    console.error("delete processing report:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
