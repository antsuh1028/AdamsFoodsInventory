// Changing a session after the fact: its heading, a flag, the driver.

const router = require("express").Router();
const pool = require("../../../utils/pg");
const verifyToken = require("../../../middleware/verifyToken.pg");
const { correctHeading, parseKeep } = require("../../../utils/nameCorrect");
const { parseWeighedOn } = require("../../../utils/weighedAt");
const { logBoxRemoval, batchBlockers } = require("../helpers/shared");

// Flag a session as a mistake, or clear the flag.
//
// This is a REQUEST, not a removal: the flag changes no weight, no count and no
// printed manifest. Deleting a session is admin-only and stays that way, so an
// operator who could take product out of a total by flagging it would be that
// gate under another name. What it buys is that the person who noticed can say
// so at the bench, instead of telling someone later and hoping.
//
// Not admin-gated on purpose — the whole point is that whoever weighed it can
// raise it. Clearing is open too: a flag raised by mistake is not a control.
router.post("/box-batches/:id/flag", verifyToken, async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }
  const raw = req.body?.reason;
  const reason = typeof raw === "string" ? raw.trim().slice(0, 500) || null : null;
  const clear = req.body?.clear === true;

  try {
    const found = await pool.query(
      `SELECT batch_id, lot_number FROM box_batches
        WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!found.rows.length) return res.status(404).json({ error: "Batch not found" });

    const updated = await pool.query(
      clear
        ? `UPDATE box_batches
              SET flagged_at = NULL, flagged_by = NULL, flag_reason = NULL
            WHERE batch_id = $1 AND tenant_id = $2
        RETURNING batch_id, flagged_at, flagged_by, flag_reason`
        // COALESCE keeps the FIRST report's time and author: a second person
        // adding a reason is not a new flag.
        : `UPDATE box_batches
              SET flagged_at = COALESCE(flagged_at, now()),
                  flagged_by = COALESCE(flagged_by, $3),
                  flag_reason = COALESCE($4, flag_reason)
            WHERE batch_id = $1 AND tenant_id = $2
        RETURNING batch_id, flagged_at, flagged_by, flag_reason`,
      clear ? [batchId, req.tenantId] : [batchId, req.tenantId, req.userId || null, reason]
    );

    // Survives the session it describes, like every other row in this table.
    logBoxRemoval({
      tenantId: req.tenantId,
      action: clear ? "flag_cleared" : "flagged",
      batchId,
      lotNumber: found.rows[0].lot_number,
      reason,
      performedBy: req.username || null,
    });

    res.json({ flagged: !clear, batch: updated.rows[0] });
  } catch (err) {
    console.error("flag box batch:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const MAX_DRIVER = 80;

// Set the driver on every pallet of one shipment, all or none.
router.post("/box-batches/driver", verifyToken, async (req, res) => {
  const ids = req.body?.batchIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200
      || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return res.status(400).json({ error: "batchIds must be a list of session ids" });
  }
  const raw = req.body?.driver;
  if (raw != null && typeof raw !== "string") {
    return res.status(400).json({ error: "driver must be text" });
  }
  // Blank clears it.
  const driver = String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase() || null;
  if (driver && driver.length > MAX_DRIVER) {
    return res.status(400).json({ error: `driver must be at most ${MAX_DRIVER} characters` });
  }
  const unique = [...new Set(ids)];
  try {
    const r = await pool.query(
      `UPDATE box_batches SET driver = $3
        WHERE tenant_id = $1 AND batch_id = ANY($2::int[]) AND direction = 'outgoing'
          AND (SELECT COUNT(*) FROM box_batches c
                WHERE c.tenant_id = $1 AND c.batch_id = ANY($2::int[]) AND c.direction = 'outgoing')
              = cardinality($2::int[])
        RETURNING batch_id`,
      [req.tenantId, unique, driver]
    );
    if (r.rowCount !== unique.length) {
      return res.status(404).json({ code: "NOT_ALL_FOUND", error: "Some of those outgoing sessions were not found. Nothing was changed." });
    }
    res.json({ driver, updated: r.rowCount });
  } catch (err) {
    console.error("set driver:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Edit a session's heading after the fact.
const EDITABLE_HEADER = {
  vendor: "vendor",
  itemDescription: "item_description",
  billOfLading: "bill_of_lading",
  shipTo: "ship_to",
  brand: "brand",
  estNumber: "est_number",
  grade: "grade",
  remarks: "remarks",
};

// What the dock may change on a session it weighed out. Everything else on an
// outgoing heading is admin-only — see the PATCH route.
const DOCK_EDITABLE = new Set(["itemDescription", "shipTo"]);

router.patch("/box-batches/:id", verifyToken, async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }

  // Only known fields, and an unknown one is REFUSED rather than ignored:
  // silently dropping a field would let a caller believe it had changed it.
  // The lot comes as a registry id, never as text, so a typo cannot mint a lot.
  const body = req.body || {};
  const unknown = Object.keys(body)
    .filter((k) => !EDITABLE_HEADER[k] && k !== "lotId" && k !== "weighedOn" && k !== "keepAsTyped");
  if (unknown.length) {
    return res.status(400).json({
      code: "NOT_EDITABLE",
      error: `Not editable here: ${unknown.join(", ")}.` +
             (unknown.includes("lotNumber")
               ? " Send the lot as lotId, picked from the lot registry."
               : ""),
    });
  }

  const hasLot = Object.prototype.hasOwnProperty.call(body, "lotId");
  // A number or a digit string only — Number([20]) is 20, and an array is not an id.
  const rawLot = body.lotId;
  const lotId = hasLot && (typeof rawLot === "number" || /^\d+$/.test(String(rawLot)))
    && !Array.isArray(rawLot) ? Number(rawLot) : NaN;
  if (hasLot && (!Number.isInteger(lotId) || lotId <= 0)) {
    return res.status(400).json({ code: "BAD_LOT", error: "lotId must be a lot from the registry." });
  }

  // The day the boxes were weighed, for a session entered after the fact.
  // Blank clears it back to "the day the session was opened".
  const hasDate = Object.prototype.hasOwnProperty.call(body, "weighedOn");
  const checkedDate = hasDate ? parseWeighedOn(body.weighedOn) : { ok: true, value: null };
  if (!checkedDate.ok) {
    return res.status(400).json({ code: "BAD_DATE", error: checkedDate.error });
  }
  const weighedOn = checkedDate.value;

  const fields = Object.entries(body).filter(([k]) => EDITABLE_HEADER[k]);
  if (!fields.length && !hasLot && !hasDate) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    const batch = await pool.query(
      `SELECT status, direction, lot_id, further_processing FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
      [batchId, req.tenantId]
    );
    if (!batch.rows.length) return res.status(404).json({ error: "Session not found" });

    const { status, direction } = batch.rows[0];
    const isAdmin = req.role === "admin";

    // On the way out the heading is the driver's paperwork. The dock says what
    // is in the boxes and where they are going; the rest — who weighed it, the
    // BOL, the grade — is reception's to answer for, so it stays admin-only.
    if (direction === "outgoing" && !isAdmin) {
      const denied = fields.map(([k]) => k).filter((k) => !DOCK_EDITABLE.has(k))
        .concat(hasLot ? ["lotId"] : [], hasDate ? ["weighedOn"] : []);
      if (denied.length) {
        return res.status(403).json({
          code: "ADMIN_ONLY_FIELD",
          error: `Only an admin can change ${denied.join(", ")} on an outgoing `
               + "session. You can edit the item description and where it is going.",
        });
      }
      // Only those two labels are left, and closing locks weights, not labels —
      // so they stay correctable after the session is stopped.
    } else if (status !== "open" && !isAdmin) {
      // Incoming is untouched: a closed tally is admin-only, as it always was.
      return res.status(403).json({
        code: "CLOSED_SESSION",
        error: "This session is closed. Only an admin can edit it.",
      });
    }

    // Clear typos in an outgoing item or customer take the list's spelling, unless kept as typed.
    let corrections = [];
    if (direction === "outgoing") {
      const keep = parseKeep(body.keepAsTyped).concat(batch.rows[0].further_processing ? ["shipTo"] : []);
      const fixed = await correctHeading(pool, req.tenantId, Object.fromEntries(fields), keep);
      for (const f of fixed.corrections) {
        const at = fields.findIndex(([k]) => k === f.field);
        fields[at] = [f.field, f.to];
      }
      corrections = fixed.corrections;
    }

    // Blank means "clear it", stored as NULL rather than "" so an empty field
    // prints as empty everywhere instead of as a stray space.
    const sets = [];
    const values = [batchId, req.tenantId];
    for (const [key, raw] of fields) {
      const value = typeof raw === "string" ? raw.trim() || null : null;
      values.push(value);
      sets.push(`${EDITABLE_HEADER[key]} = $${values.length}`);
    }

    if (hasDate) {
      values.push(weighedOn);
      sets.push(`weighed_on = $${values.length}`);
    }

    // Moving a session to another lot moves its boxes into that lot's totals
    // and yield. So it is refused while a form, a load or a merged manifest
    // still counts it — the same holders that block deleting it.
    if (hasLot && lotId !== batch.rows[0].lot_id) {
      const lot = await pool.query(
        `SELECT lot_id, lot_number FROM lots WHERE lot_id = $1 AND tenant_id = $2`,
        [lotId, req.tenantId]
      );
      if (!lot.rows.length) {
        return res.status(400).json({ code: "BAD_LOT", error: "That lot is not in the registry." });
      }
      const { groups, forms, shipments } = await batchBlockers(pool, batchId, req.tenantId);
      const holders = [
        ...forms.map((f) => `registration form ${f.lot_number || f.id}`),
        ...shipments.map((s) => `the load to ${s.destination_name} (${s.status})`),
        ...groups.map((g) => `merged manifest ${g.name || g.lot_number || g.group_id}`),
      ];
      if (holders.length) {
        return res.status(409).json({
          code: "LOT_IN_USE",
          error: `Cannot move this session to another lot while ${holders.join(", ")} `
               + "still counts it. Untie it there first, then change the lot.",
          holders: { forms, shipments, groups },
        });
      }
      // The registry's canonical number, never the caller's text.
      values.push(lot.rows[0].lot_id);
      sets.push(`lot_id = $${values.length}`);
      values.push(lot.rows[0].lot_number);
      sets.push(`lot_number = $${values.length}`);
    }

    if (!sets.length) {
      // Only the lot was sent, and it was already this lot.
      const same = await pool.query(
        `SELECT batch_id, lot_id, lot_number, vendor, ship_to, bill_of_lading,
                item_description, brand, est_number, grade, remarks, status,
                weighed_on::text AS weighed_on
           FROM box_batches WHERE batch_id = $1 AND tenant_id = $2`,
        [batchId, req.tenantId]
      );
      return res.json(same.rows[0]);
    }

    const updated = await pool.query(
      `UPDATE box_batches SET ${sets.join(", ")}
        WHERE batch_id = $1 AND tenant_id = $2
      RETURNING batch_id, lot_id, lot_number, vendor, ship_to, bill_of_lading,
                item_description, brand, est_number, grade, remarks, status,
                weighed_on::text AS weighed_on`,
      values
    );
    res.json({ ...updated.rows[0], corrections });
  } catch (err) {
    console.error("update batch heading:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
