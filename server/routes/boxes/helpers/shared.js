// Helpers more than one part of the box routes uses.

const pool = require("../../../utils/pg");

// Records a removal.
const logBoxRemoval = ({
  tenantId, action, batchId = null, itemId = null,
  lotNumber = null, summary = null, reason = null, details = null, performedBy = null,
}) => pool.query(
  `INSERT INTO box_removal_history
     (tenant_id, action, batch_id, item_id, lot_number, summary, reason, details, performed_by)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
  [tenantId, action, batchId, itemId, lotNumber, summary, reason,
   details ? JSON.stringify(details) : null, performedBy]
).catch((err) => console.error("box removal history log error:", err.message));

// Everything that currently prevents a weighing session being deleted.
const batchBlockers = async (q, batchId, tenantId) => {
  const groups = await q.query(
    `SELECT g.group_id, g.name, g.lot_number
       FROM manifest_group_batches m
       JOIN manifest_groups g ON g.group_id = m.group_id
      WHERE m.batch_id = $1 AND g.tenant_id = $2`,
    [batchId, tenantId]
  );
  const forms = await q.query(
    `SELECT f.id, f.lot_number
       FROM registration_form_batches r
       JOIN noblesse_registration_forms f ON f.id = r.form_id
      WHERE r.batch_id = $1 AND r.tenant_id = $2`,
    [batchId, tenantId]
  );
  const shipments = await q.query(
    `SELECT s.shipment_id, s.destination_name, s.status,
            s.ship_date, s.bill_of_lading
       FROM shipment_batches sb
       JOIN noblesse_shipments s ON s.shipment_id = sb.shipment_id
      WHERE sb.batch_id = $1 AND s.tenant_id = $2`,
    [batchId, tenantId]
  );
  return { groups: groups.rows, forms: forms.rows, shipments: shipments.rows };
};

// What a session can be searched by. Shared with the merged-manifest search,
// which must match a manifest whenever it matches one of its sessions.
const batchSearchColumns = (a) => [
  "lot_number", "vendor", "item_description", "ship_to", "bill_of_lading",
  "brand", "est_number", "grade", "remarks", "driver",
].map((c) => `${a}.${c}`).concat(`${a}.batch_id::text`);

module.exports = { batchBlockers, batchSearchColumns, logBoxRemoval };
