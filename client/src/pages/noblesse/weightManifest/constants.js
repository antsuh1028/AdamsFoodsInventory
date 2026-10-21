// Columns, removal labels and small formatters the manifest screens share.

const COLUMNS = [
  { key: "lot_number",       label: "Lot",     filter: "text",   width: "130px" },
  { key: "vendor",           label: "Vendor",  filter: "select", width: "150px" },
  { key: "item_description", label: "Item",    filter: "text",   width: "200px" },
  { key: "created_at",       label: "Weighed", filter: "none",   width: "170px" },
  { key: "box_count",        label: "Boxes",   filter: "none",   width: "80px", align: "right" },
  { key: "totals",           label: "Total",   filter: "none",   width: "150px", align: "right" },
  { key: "status",           label: "Status",  filter: "none",   width: "90px" },
];

// Restores are shown in the same trail, so the labels have to distinguish
// "gone for good" from "taken off but recoverable".
const REMOVAL_LABEL = {
  item_voided: "Voided",
  item_restored: "Restored",
  item_deleted: "Box erased",
  batch_deleted: "Session deleted",
  manifest_group_deleted: "Manifest removed",
};

const REMOVAL_COLOR = {
  item_voided: "yellow",
  item_restored: "green",
  item_deleted: "red",
  batch_deleted: "red",
  manifest_group_deleted: "gray",
};

// Sort key for a lot number.
//
// Upper-cased and trimmed so casing or a stray space cannot split one lot into
// two positions. A session with no lot at all becomes "", which sorts LAST
// descending — an unlabelled session belongs at the bottom, not above today's
// work just because the string happens to compare high.
const lotKey = (lotNumber) => String(lotNumber || "").trim().toUpperCase();

const totalsText = (totals) =>
  Array.isArray(totals) && totals.length
    ? totals.map((t) => `${t.total} ${t.unit}`).join("  ·  ")
    : "—";

export { COLUMNS, REMOVAL_LABEL, REMOVAL_COLOR, lotKey, totalsText };
