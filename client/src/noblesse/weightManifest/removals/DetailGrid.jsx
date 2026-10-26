// A removed row's stored details, as label and value pairs.

import React from "react";
import { Box, Text } from "@chakra-ui/react";
import { fmtDate } from "../../common/shared";

// The audit row carries the destroyed record in full (`details`), because for a
// deleted session that JSON is the only copy of those weights that still
// exists. It is rendered generically rather than field-by-field: a column added
// to batch_items later must show up here on its own, not silently drop out of
// the one place the box is still written down.

const DETAIL_LABELS = {
  batch_id: "Session #", item_id: "Box #", group_id: "Manifest #",
  lot_number: "Lot #", lot_id: "Lot record", name: "Manifest name",
  // Both columns feed the one line on the printed manifest, and both now mean
  // the vendor's lot. Nulls are dropped from the grid, so in practice only the
  // one a session actually carries is shown.
  vendor: "Vendor", item_description: "Item", ship_to: "Vendor Lot #/IC#",
  bill_of_lading: "Vendor Lot #/IC#", source: "Source", status: "Status",
  created_at: "Opened", closed_at: "Closed", scanned_at: "Scanned",
  weight: "Weight", weight_unit: "Unit", original_weight: "Weight on the label",
  converted_from: "Converted from", gtin: "GTIN", production_date: "Production date",
  serial: "Serial", raw_barcode: "Barcode", is_manual: "Entered by hand",
  edited_at: "Corrected", edited_by: "Corrected by", position: "Position",
  voided_at: "Voided", voided_by: "Voided by", void_reason: "Void reason",
  box_count: "Boxes",
};

// tenant_id is identical on every row here and says nothing about what happened.
const SKIP_DETAIL_KEYS = new Set(["tenant_id"]);

const detailLabel = (k) =>
  DETAIL_LABELS[k] || k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const detailValue = (key, value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "production_date") return fmtDate(value);
  if (/_at$/.test(key)) return new Date(value).toLocaleString();
  return String(value);
};

const DetailGrid = ({ data }) => {
  const pairs = Object.entries(data || {})
    .filter(([k]) => !SKIP_DETAIL_KEYS.has(k))
    .map(([k, v]) => [detailLabel(k), detailValue(k, v)])
    .filter(([, v]) => v !== null);
  if (!pairs.length) return null;
  return (
    <Box display="grid" gridTemplateColumns={{ base: "auto 1fr", md: "auto 1fr auto 1fr" }}
      columnGap={4} rowGap={1} fontSize="xs" mb={3}>
      {pairs.map(([label, value]) => (
        <React.Fragment key={label}>
          <Text color="gray.500" whiteSpace="nowrap">{label}</Text>
          <Text color="gray.800" style={{ wordBreak: "break-word" }}>{value}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
};

export { DETAIL_LABELS, SKIP_DETAIL_KEYS, detailLabel, detailValue, DetailGrid };
