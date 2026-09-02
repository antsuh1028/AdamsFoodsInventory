import React, { useEffect, useRef } from "react";
import { Box, Flex, Text, Badge } from "@chakra-ui/react";
import { fmtDate } from "../../pages/noblesse/shared";

// The scanned weights as a spreadsheet: one row per box, filling downward as
// the operator scans, with the running total pinned in a footer row.
//
// This is the primary readout during a session, so it borrows the cell styling
// already used by the incoming-records grid rather than inventing a new look.

const COLS = [
  { key: "_n",       label: "#",         w: "48px",  align: "center" },
  { key: "weight",   label: "Weight",    w: "110px", align: "right", strong: true },
  { key: "unit",     label: "Unit",      w: "60px",  align: "center" },
  { key: "gtin",     label: "GTIN",      w: "160px" },
  { key: "packed",   label: "Packed",    w: "110px" },
  { key: "serial",   label: "Serial",    w: "150px" },
  { key: "time",     label: "Scanned",   w: "90px",  align: "center" },
  { key: "_status",  label: "Synced",    w: "90px",  align: "center" },
];

const headStyle = {
  position: "sticky", top: 0, zIndex: 1,
  background: "#EDF2F7", borderBottom: "2px solid #A0AEC0",
  padding: "8px 10px", fontSize: "12px", fontWeight: 700,
  color: "#4A5568", textTransform: "uppercase", letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};

const cellStyle = {
  border: "1px solid #E2E8F0",
  padding: "6px 10px",
  fontSize: "15px",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums", // digits line up column-wise like a spreadsheet
};

const StatusCell = ({ status }) => {
  if (status === "rejected") return <Badge colorScheme="red" fontSize="10px">Rejected</Badge>;
  // Not counted: the server already held this box, so it is not a second one.
  if (status === "duplicate") return <Badge colorScheme="purple" fontSize="10px">Duplicate</Badge>;
  if (status === "pending") return <Badge colorScheme="orange" fontSize="10px">Sending</Badge>;
  return <Badge colorScheme="green" fontSize="10px">Saved</Badge>;
};

const NOT_A_BOX = new Set(["duplicate", "rejected"]);

const ScanSheet = ({ scans = [], totals = [] }) => {
  const endRef = useRef(null);
  const counted = scans.filter((s) => !NOT_A_BOX.has(s.status)).length;
  const skipped = scans.length - counted;

  // Follow the newest row, the way a spreadsheet does as you fill it.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [scans.length]);

  return (
    <Box border="1px solid" borderColor="gray.300" borderRadius="md" overflow="hidden" bg="white">
      <Box overflowX="auto" overflowY="auto" maxH="48vh">
        <table style={{ width: "100%", minWidth: "820px", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} style={{ ...headStyle, textAlign: c.align || "left", width: c.w }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scans.length === 0 ? (
              <tr>
                <td colSpan={COLS.length}
                  style={{ ...cellStyle, textAlign: "center", color: "#A0AEC0", padding: "28px 10px" }}>
                  Scan a box to begin — weights appear here as you go.
                </td>
              </tr>
            ) : (
              scans.map((s, i) => {
                const rejected = s.status === "rejected";
                const dup = s.status === "duplicate";
                return (
                  <tr key={s.localId ?? i}
                    style={{ background: rejected ? "#FFF5F5" : dup ? "#FAF5FF" : i % 2 ? "#F7FAFC" : "white" }}>
                    <td style={{ ...cellStyle, textAlign: "center", color: "#A0AEC0",
                      background: "#EDF2F7", fontSize: "13px" }}>{i + 1}</td>
                    <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700,
                      fontSize: "17px", color: rejected ? "#C53030" : dup ? "#805AD5" : "#1A365D",
                      textDecoration: dup ? "line-through" : undefined }}>
                      {s.weight}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "center", color: "#718096" }}>{s.weightUnit}</td>
                    <td style={{ ...cellStyle, color: "#4A5568" }}>{s.gtin || "—"}</td>
                    <td style={{ ...cellStyle, color: "#4A5568" }}>
                      {s.productionDate ? fmtDate(s.productionDate) : "—"}
                    </td>
                    <td style={{ ...cellStyle, color: "#4A5568" }}>
                      {s.isManual ? <em style={{ color: "#DD6B20" }}>manual entry</em> : (s.serial || "—")}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "center", color: "#718096", fontSize: "13px" }}>
                      {s.scannedAt ? new Date(s.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "center" }}>
                      <StatusCell status={s.status} />
                    </td>
                  </tr>
                );
              })
            )}
            <tr ref={endRef} />
          </tbody>
        </table>
      </Box>

      <Flex borderTop="2px solid" borderColor="gray.400" bg="gray.50"
        px={3} py={2} align="center" justify="space-between" gap={4} wrap="wrap">
        {/* Counts boxes that actually arrived. A duplicate is the same box
            scanned twice and a rejection never recorded, so neither adds to
            the count the total is quoted against. */}
        <Flex align="baseline" gap={3} wrap="wrap">
          <Text fontSize="sm" fontWeight="bold" color="gray.600" textTransform="uppercase" letterSpacing="wide">
            {counted} box{counted === 1 ? "" : "es"}
          </Text>
          {skipped > 0 && (
            <Text fontSize="xs" color="purple.600">
              {skipped} not counted
            </Text>
          )}
        </Flex>
        <Flex gap={5} wrap="wrap">
          {totals.length === 0 ? (
            <Text fontSize="lg" color="gray.400">—</Text>
          ) : (
            totals.map((t) => (
              <Flex key={t.unit} align="baseline" gap={2}>
                <Text fontSize="xs" color="gray.500" textTransform="uppercase">Total {t.unit}</Text>
                <Text fontSize="2xl" fontWeight="bold" color="blue.800"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t.total}
                </Text>
              </Flex>
            ))
          )}
        </Flex>
      </Flex>
    </Box>
  );
};

export default ScanSheet;
