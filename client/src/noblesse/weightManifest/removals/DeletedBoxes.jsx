// The boxes a removal took off a tally, with their weights.

import { Box, Flex, Text } from "@chakra-ui/react";
import { detailValue } from "./DetailGrid";

// Integer thousandths, never floats — the same rule the scanner, the server and
// the printed manifest follow, so a total shown here cannot disagree with the
// one that was on the tally. Parsed off the decimal string directly: no
// Number(weight) ever happens, so "76.20" and "76.2" add up identically.
const sumByUnit = (items) => {
  const totals = new Map();
  for (const it of items || []) {
    if (!it || it.weight == null || it.voided_at) continue;
    const [whole, frac = ""] = String(it.weight).split(".");
    const th = (Number(whole) || 0) * 1000 + Number((frac + "000").slice(0, 3));
    const unit = it.weight_unit || "LB";
    totals.set(unit, (totals.get(unit) || 0) + th);
  }
  return [...totals.entries()].map(([unit, th]) => `${(th / 1000).toFixed(2)} ${unit}`);
};

// Every box that went with a deleted session. Voided rows are kept and struck
// through rather than dropped — what was on the tally and what counted are
// different questions, and the audit trail has to answer both.
const BOX_COLUMNS = [
  ["item_id", "Box #", "left"],
  ["weight", "Weight", "right"],
  ["weight_unit", "Unit", "left"],
  ["original_weight", "Label", "right"],
  ["converted_from", "From", "left"],
  ["serial", "Serial", "left"],
  ["gtin", "GTIN", "left"],
  ["production_date", "Prod. date", "left"],
  ["is_manual", "Manual", "left"],
  ["raw_barcode", "Barcode", "left"],
];

const DeletedBoxes = ({ items }) => {
  const voided = items.filter((it) => it.voided_at).length;
  const totals = sumByUnit(items);
  return (
    <Box>
      <Flex align="baseline" gap={2} mb={1} wrap="wrap">
        <Text fontSize="xs" fontWeight="600" color="gray.600"
          textTransform="uppercase" letterSpacing="wide">
          {items.length} box{items.length === 1 ? "" : "es"}
        </Text>
        {totals.length > 0 && (
          <Text fontSize="xs" color="gray.700" fontWeight="600">
            {totals.join("  ·  ")}
          </Text>
        )}
        {voided > 0 && (
          <Text fontSize="xs" color="gray.500">
            ({voided} voided, not in that total)
          </Text>
        )}
      </Flex>
      {/* A scroll container with no floor lets the table crush to nothing. */}
      <Box overflowX="auto" width="100%" borderWidth="1px" borderColor="gray.200"
        borderRadius="md">
        <Box as="table" width="100%" style={{ minWidth: "760px", borderCollapse: "collapse" }}>
          <Box as="thead">
            <Box as="tr">
              {BOX_COLUMNS.map(([key, label, align]) => (
                <Box as="th" key={key} bg="gray.100" px={2} py={1} textAlign={align}
                  fontSize="9px" fontWeight="bold" color="gray.600"
                  textTransform="uppercase" letterSpacing="wide"
                  borderBottom="1px solid" borderColor="gray.300">
                  {label}
                </Box>
              ))}
            </Box>
          </Box>
          <Box as="tbody">
            {items.map((it, i) => (
              <Box as="tr" key={it.item_id ?? i} bg={i % 2 ? "gray.50" : "white"}>
                {BOX_COLUMNS.map(([key, , align]) => (
                  <Box as="td" key={key} px={2} py={1} textAlign={align} fontSize="11px"
                    color={it.voided_at ? "gray.400" : "gray.800"}
                    borderBottom="1px solid" borderColor="gray.100"
                    style={{
                      textDecoration: it.voided_at ? "line-through" : "none",
                      fontFamily: key === "raw_barcode" || key === "gtin" ? "monospace" : undefined,
                      whiteSpace: "nowrap",
                    }}>
                    {detailValue(key, it[key]) ?? "—"}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export { sumByUnit, BOX_COLUMNS, DeletedBoxes };
