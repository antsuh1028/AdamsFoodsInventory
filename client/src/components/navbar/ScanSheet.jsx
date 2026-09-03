import React, { useEffect, useRef, useState } from "react";
import { Box, Flex, Text, Badge, IconButton, Tooltip } from "@chakra-ui/react";
import { EditIcon, DeleteIcon, RepeatIcon } from "@chakra-ui/icons";
import NumericKeypad from "./NumericKeypad";
import {
  kgToLb, toDisplayHundredths, fromHundredths,
} from "../../utils/weight";
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

// Only shown when the caller supplies handlers, so the read-only uses of this
// grid stay exactly as they were.
const ACTIONS_COL = { key: "_actions", label: "", w: "96px", align: "center" };

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
  if (status === "duplicate") return <Badge colorScheme="orange" fontSize="10px">Duplicate</Badge>;
  // Taken off the tally on purpose. Still shown, because a soft void that hid
  // the row would tell a reviewer nothing.
  if (status === "voided") return <Badge colorScheme="gray" fontSize="10px">Voided</Badge>;
  if (status === "pending") return <Badge colorScheme="orange" fontSize="10px">Sending</Badge>;
  return <Badge colorScheme="green" fontSize="10px">Saved</Badge>;
};

const NOT_A_BOX = new Set(["duplicate", "rejected", "voided"]);

// The grid shows pounds, always — it is the on-screen preview of the tally, so
// it has to agree with the paper box for box.
//
// Rows arrive in three shapes: a live session row (carries displayWeight, its
// converted twin), a row stored since conversion shipped (already LB), and a
// row stored BEFORE it shipped (still kilograms). The last is why this converts
// rather than trusting weightUnit — production ran without conversion for a
// while, so those rows are real.
const inKg = (s) => String(s.weightUnit || "").toUpperCase() === "KG";
const weightOf = (s) => {
  if (s.displayWeight) return s.displayWeight;
  return inKg(s) ? kgToLb(s.weight) : s.weight;
};
const unitOf = () => "LB";
// What the label actually said, for the ←KG marker. A row that predates the
// conversion has no convertedFrom flag but is still a kilogram box.
const kgOrigin = (s) => (s.convertedFrom || (inKg(s) ? "KG" : null));

// Shown to two decimal places, like the paper tally. Rounded per box before
// anything is summed, so the column on screen adds up to the figure under it —
// and to the one that prints.
const cents = (s) => Number(toDisplayHundredths(weightOf(s)));
const show = (n) => fromHundredths(n);

const ScanSheet = ({
  scans = [],
  // Supplying these turns the grid editable. Left out, it renders exactly as
  // before — the manifest tab uses it read-only for non-admins.
  onEditWeight, onVoid, onRestore, busyId = null,
}) => {
  const endRef = useRef(null);
  const [editing, setEditing] = useState(null);   // localId being corrected
  const [draft, setDraft] = useState("");
  const [draftUnit, setDraftUnit] = useState("LB");
  const countedRows = scans.filter((s) => !NOT_A_BOX.has(s.status));
  const counted = countedRows.length;
  const skipped = scans.length - counted;
  // Derived from the rows on screen rather than taken from the caller's total,
  // which is summed at storage precision. Displaying that beside per-box
  // rounded figures would let the column disagree with its own footer by a
  // cent — the disagreement a tally exists to rule out.
  const displayTotal = countedRows.reduce((acc, s) => acc + cents(s), 0);
  const editable = Boolean(onEditWeight || onVoid);
  const cols = editable ? [...COLS, ACTIONS_COL] : COLS;

  const startEdit = (row) => {
    setEditing(row.localId);
    setDraft(weightOf(row));
    // Stored weights are pounds, so that is where a correction starts — the
    // operator switches to KG when the label they are holding says kilograms.
    setDraftUnit("LB");
  };

  const commitEdit = async (row) => {
    const value = draft.trim();
    // Re-typing the same pound figure is a no-op; the same number in kilograms
    // is not, so the unit has to be part of that comparison.
    if (!value || (value === weightOf(row) && draftUnit === "LB")) {
      setEditing(null);
      return;
    }
    await onEditWeight(row, value, draftUnit);
    setEditing(null);
  };

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
              {cols.map((c) => (
                <th key={c.key} style={{ ...headStyle, textAlign: c.align || "left", width: c.w }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scans.length === 0 ? (
              <tr>
                <td colSpan={cols.length}
                  style={{ ...cellStyle, textAlign: "center", color: "#A0AEC0", padding: "28px 10px" }}>
                  Scan a box to begin — weights appear here as you go.
                </td>
              </tr>
            ) : (
              scans.map((s, i) => {
                const rejected = s.status === "rejected";
                const dup = s.status === "duplicate";
                const voided = s.status === "voided";
                const struck = dup || voided;
                const isEditing = editing === s.localId;
                const busy = busyId === s.localId;
                const rowEl = (
                  <tr key={s.localId ?? i}
                    style={{ background: rejected ? "#FFF5F5" : dup ? "#FAF5FF"
                      : voided ? "#F7F7F7" : i % 2 ? "#F7FAFC" : "white",
                      opacity: voided ? 0.65 : 1 }}>
                    <td style={{ ...cellStyle, textAlign: "center", color: "#A0AEC0",
                      background: "#EDF2F7", fontSize: "13px" }}>{i + 1}</td>
                    <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700,
                      fontSize: "17px", color: rejected ? "#C53030" : dup ? "#C05621"
                        : voided ? "#718096" : "#1A365D",
                      textDecoration: struck ? "line-through" : undefined }}>
                      {show(cents(s))}
                      {/* What the label said, before someone corrected it. The
                          point of keeping the original is that it stays visible. */}
                      {s.originalWeight && s.originalWeight !== weightOf(s) && (
                        <Tooltip label={`Scanned as ${s.originalWeight}, corrected by hand`}>
                          <Text as="span" fontSize="11px" color="orange.500"
                            fontWeight="400" ml={1} textDecoration="line-through">
                            {s.originalWeight}
                          </Text>
                        </Tooltip>
                      )}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "center", color: "#718096" }}>
                      {unitOf(s)}
                      {kgOrigin(s) && (
                        <span style={{ fontSize: "10px", color: "#2C7A7B", marginLeft: "4px" }}
                          title={`Label read ${s.weight} ${kgOrigin(s)}`}>
                          ←{kgOrigin(s)}
                        </span>
                      )}
                    </td>
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
                      {voided && s.voidReason && (
                        <Text fontSize="10px" color="gray.500" mt={0.5}>{s.voidReason}</Text>
                      )}
                    </td>
                    {editable && (
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        <Flex gap={1} justify="center">
                          {voided ? (
                            onRestore && (
                              <Tooltip label="Put this box back on the tally">
                                <IconButton aria-label="Restore" icon={<RepeatIcon />}
                                  size="xs" variant="ghost" colorScheme="blue" isLoading={busy}
                                  onClick={() => onRestore(s)} />
                              </Tooltip>
                            )
                          ) : (
                            <>
                              {onEditWeight && (
                                <Tooltip label="Correct this weight">
                                  <IconButton aria-label="Edit" icon={<EditIcon />}
                                    size="xs" variant="ghost" isLoading={busy}
                                    onClick={() => startEdit(s)} />
                                </Tooltip>
                              )}
                              {onVoid && (
                                <Tooltip label="Take this box off the tally">
                                  <IconButton aria-label="Void" icon={<DeleteIcon />}
                                    size="xs" variant="ghost" colorScheme="red" isLoading={busy}
                                    onClick={() => onVoid(s)} />
                                </Tooltip>
                              )}
                            </>
                          )}
                        </Flex>
                      </td>
                    )}
                  </tr>
                );
                return isEditing ? (
                  <React.Fragment key={s.localId ?? i}>
                    {rowEl}
                    <tr>
                      <td colSpan={cols.length} style={{ padding: 0, background: "#EBF8FF" }}>
                        <Box p={3} maxW="320px">
                          {/* Keyed in on a keypad drawn in the page: a paired
                              scanner is an HID keyboard, so iPadOS will not
                              show its own for a normal input. */}
                          <NumericKeypad
                            value={draft}
                            onChange={setDraft}
                            onSubmit={() => commitEdit(s)}
                            onCancel={() => setEditing(null)}
                            label={`Correct box ${i + 1}`}
                            unit={draftUnit}
                            onUnitChange={setDraftUnit}
                            submitLabel="Save weight"
                            isDisabled={busy}
                          />
                        </Box>
                      </td>
                    </tr>
                  </React.Fragment>
                ) : rowEl;
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
            <Text fontSize="xs" color="orange.600">
              {skipped} not counted
            </Text>
          )}
        </Flex>
        <Flex gap={5} wrap="wrap">
          {counted === 0 ? (
            <Text fontSize="lg" color="gray.400">—</Text>
          ) : (
            <Flex align="baseline" gap={2}>
              <Text fontSize="xs" color="gray.500" textTransform="uppercase">Total LB</Text>
              <Text fontSize="2xl" fontWeight="bold" color="blue.800"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {show(displayTotal)}
              </Text>
            </Flex>
          )}
        </Flex>
      </Flex>

    </Box>
  );
};

export default ScanSheet;
