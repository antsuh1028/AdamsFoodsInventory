const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");
const { yieldFrom } = require("../utils/lotYield");
const R = require("../utils/reportRange");

// The daily report. One range endpoint — the monthly view is the same figures
// over a wider range, so neither gets its own query.

const EMPTY_WEIGHING = { sessions: 0, boxes: 0, lb: "0", lots: 0 };

const fmtWeighing = (rows, direction) => {
  const r = rows.find((x) => x.direction === direction);
  if (!r) return EMPTY_WEIGHING;
  return { sessions: r.sessions, boxes: r.boxes, lb: r.lb, lots: r.lots };
};

const fmtLot = (r) => ({
  lotId: r.lot_id,
  lotNumber: r.lot_number,
  status: r.status,
  day: {
    boxesIn: r.day_boxes_in,
    lbIn: r.day_lb_in,
    boxesOut: r.day_boxes_out,
    lbOut: r.day_lb_out,
    loads: r.day_loads,
    shippedLb: r.day_shipped_lb,
    reports: r.day_reports,
    casesIn: r.day_cases_in,
    casesOut: r.day_cases_out,
  },
  // Running totals for the lot's whole life, not just the range — what the
  // range did is above, and the two answer different questions.
  yield: yieldFrom(r),
});

const fmtAttention = (r) => ({
  kind: r.kind,
  refId: r.ref_id,
  label: r.label,
  detail: r.detail,
  since: r.since,
  ageDays: r.age_days,
  who: r.who,
  // 'standing' is true right now whatever the range; 'range' happened in it.
  scope: r.scope,
});

router.get("/noblesse-report", verifyToken, requireRole("admin", "manager"), async (req, res) => {
  const range = R.parseRange(req.query.from, req.query.to);
  if (!range.ok) return res.status(400).json({ code: "BAD_RANGE", error: range.error });

  const args = [req.tenantId, range.from, range.to];
  try {
    const [weighing, shipped, processed, lotsIssued, forms, backdated, touched,
           attention] =
      await Promise.all([
        pool.query(R.WEIGHING, args),
        pool.query(R.SHIPPED, args),
        pool.query(R.PROCESSED, args),
        pool.query(R.LOTS_ISSUED, args),
        pool.query(R.FORMS, args),
        pool.query(R.BACKDATED, args),
        pool.query(R.LOTS_TOUCHED, args),
        pool.query(R.ATTENTION, args),
      ]);

    const s = shipped.rows[0];
    const p = processed.rows[0];
    const f = forms.rows[0];
    const b = backdated.rows[0];

    res.json({
      meta: {
        from: range.from,
        to: range.to,
        days: range.days,
        // True when the request asked past today and was shortened to it.
        clamped: range.clamped,
        basis: "business-date",
        generatedAt: new Date().toISOString(),
      },
      movement: {
        weighedIn:  fmtWeighing(weighing.rows, "incoming"),
        weighedOut: fmtWeighing(weighing.rows, "outgoing"),
        shipped: {
          loads: s.loads, lb: s.lb, cases: s.cases,
          lots: s.lots, destinations: s.destinations,
        },
        processed: {
          reports: p.reports, casesIn: p.cases_in, casesOut: p.cases_out,
          outputLb: p.output_lb, inedibleLb: p.inedible_lb, lots: p.lots,
        },
        lotsIssued: lotsIssued.rows[0].lots,
        forms: { received: f.forms, open: f.open },
      },
      // Entered in this range but counted on another day.
      backdated: { sessions: b.sessions, days: b.days },
      attention: {
        items: attention.rows.map(fmtAttention),
        counts: attention.rows.reduce((acc, r) => {
          acc[r.kind] = (acc[r.kind] || 0) + 1;
          return acc;
        }, {}),
        // The counts are of what came back, so say when that was capped.
        truncated: attention.rows.length >= R.ATTENTION_LIMIT,
        thresholds: {
          staleDraftDays: R.STALE_DRAFT_DAYS,
          idleLotDays: R.IDLE_LOT_DAYS,
        },
      },
      lots: touched.rows.map(fmtLot),
    });
  } catch (err) {
    console.error("Report error:", err);
    res.status(500).json({ error: "Failed to build the report" });
  }
});

module.exports = router;
