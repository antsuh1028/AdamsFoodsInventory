// Formatters and history logging more than one Noblesse route uses.

const pool = require("../../../utils/pg");

const fmtDate = (d) => d instanceof Date ? d.toISOString().slice(0, 10) : (d || null);

const fmtNtiItem = (row) => ({
  id:           row.id,
  lot:          row.lot,
  description:  row.description,
  brand:        row.brand,
  grade:        row.grade,
  species:      row.species,
  est:          row.est,
  packDate:     fmtDate(row.pack_date),
  weight:       row.weight != null ? Number(row.weight) : null,
  qtyCases:     row.qty_cases,
  qtyPallets:   row.qty_pallets,
  receivedDate: fmtDate(row.received_date),
  notes:        row.notes,
  // Raw stock and processing output share a lot number, so without the stage
  // the two are indistinguishable in the picker and output gets reprocessed.
  // Defaulted here because rows predating the column read back NULL.
  stage:        row.stage || "raw",
  lotId:        row.lot_id ?? null,
  // What the registration form claimed on arrival, kept apart from weight and
  // qty_cases, which are what is left after shipping and processing.
  registeredWeight: row.registered_weight != null ? Number(row.registered_weight) : null,
  registeredCases:  row.registered_cases ?? null,
  // Cases on the form's hand-typed runs, which never came off qty_cases. Present
  // only where the query joined it in.
  formManualCases:  row.form_manual_cases ?? 0,
  createdAt:    row.created_at,
});

const logNtiHistory = (tenantId, action, item, extra = {}, performedBy = null) => {
  if ((item.lot || "").toUpperCase() === "TEST") return Promise.resolve();
  return pool.query(
    `INSERT INTO nti_inventory_history (tenant_id, action, item_id, lot, snapshot, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, action, item.id || null, item.lot || null, JSON.stringify({ ...item, ...extra }), performedBy]
  ).catch((err) => console.error("nti history log error:", err.message));
};

module.exports = { fmtDate, fmtNtiItem, logNtiHistory };
