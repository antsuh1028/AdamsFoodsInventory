import React, { useRef, useState } from "react";
import {
  Box, Flex, Text, Button, IconButton, useToast, Badge,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import { DeleteIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import { fmtDate, today, cellInputStyle } from "./shared";
import FloatingWindow from "../../components/FloatingWindow";

export const RECEIPT_LINE_COLS = [
  { key: "lot",         label: "Lot No.",     w: "110px", type: "text", placeholder: "N26124-01" },
  { key: "brand",       label: "Brand",       w: "95px",  type: "text", placeholder: "IBP" },
  { key: "species",     label: "Species",     w: "80px",  type: "text", placeholder: "Beef" },
  { key: "description", label: "Description", w: "160px", type: "text", placeholder: "Brisket" },
  { key: "grade",       label: "Grade",       w: "70px",  type: "text", placeholder: "CH" },
  { key: "weight",      label: "WT (#)",      w: "85px",  type: "text", placeholder: "1842" },
  { key: "qty",         label: "QTY (C.S.)",  w: "80px",  type: "text", placeholder: "24" },
  { key: "packDate",    label: "Pack Date",   w: "135px", type: "date", placeholder: "" },
  { key: "temp",        label: "Temp (°F)",   w: "80px",  type: "text", placeholder: "27" },
  { key: "estNo",       label: "EST No.",     w: "80px",  type: "text", placeholder: "9268" },
];

export const emptyLine = () => ({
  lot: "", brand: "", species: "", description: "",
  grade: "", weight: "", qty: "", packDate: "", temp: "", estNo: "",
});

// Input style for Excel grid cells — no border, fills cell
const xlInput = {
  display: "block", width: "100%", border: "none", outline: "none",
  padding: "7px 10px", fontSize: "16px", fontFamily: "inherit",
  background: "transparent", boxSizing: "border-box",
};

// Input style for header fields (Date, BOL, Driver)
const hdInput = (w) => ({
  border: "1px solid #CBD5E0", borderRadius: "4px",
  padding: "6px 10px", fontSize: "15px", fontFamily: "inherit",
  outline: "none", background: "white",
  width: w || "auto",
});

// Excel-style column header
const XlTh = ({ children, w, center, ...props }) => (
  <Box
    as="th"
    px={2} py="7px"
    bg="gray.100"
    border="1px solid" borderColor="gray.400"
    fontSize="sm" fontWeight="bold" color="gray.600"
    textTransform="uppercase" letterSpacing="wide"
    whiteSpace="nowrap" textAlign={center ? "center" : "left"}
    style={w ? { minWidth: w } : {}}
    {...props}
  >
    {children}
  </Box>
);

// Excel-style data cell — when isInput, focus turns border blue
const XlTd = ({ children, isInput, center, ...props }) => (
  <Box
    as="td"
    p={isInput ? 0 : "7px 10px"}
    border="1px solid" borderColor="gray.300"
    fontSize="md" color="gray.800"
    whiteSpace="nowrap" verticalAlign="middle"
    textAlign={center ? "center" : undefined}
    sx={isInput ? { "&:focus-within": { outline: "2px solid #3182CE", outlineOffset: "-1px", zIndex: 1, position: "relative" } } : undefined}
    {...props}
  >
    {children}
  </Box>
);

// Row number cell
const XlRowNum = ({ n }) => (
  <Box
    as="td"
    px={2} py="7px"
    bg="gray.50" border="1px solid" borderColor="gray.300"
    fontSize="sm" color="gray.400" textAlign="center"
    userSelect="none" style={{ minWidth: "32px" }}
  >
    {n}
  </Box>
);

const cellValue = (col, l) => {
  const v = l[col.key];
  if (col.key === "weight")   return v ? `${v} lb` : "—";
  if (col.key === "temp")     return v ? `${v}°F`  : "—";
  if (col.key === "packDate") return fmtDate(v);
  return v || "—";
};

// ── Inspection section (unchanged) ────────────────────────────────────────────

const INSPECTION_CHECKS = [
  { key: "truckStructure",    label: "Truck/trailer structure conditions" },
  { key: "truckCleanliness",  label: "Truck/trailer cleanliness" },
  { key: "noOdors",           label: "No offensive odors" },
  { key: "noTornPackages",    label: "No torn outer packages" },
  { key: "palletsGood",       label: "Pallets in good condition" },
  { key: "noExposedProducts", label: "No exposed products" },
  { key: "doorsSecured",      label: "Truck/trailer doors secured properly" },
];

const emptyInspection = () => ({
  truckStructure: "acceptable", truckCleanliness: "acceptable", noOdors: "acceptable",
  noTornPackages: "acceptable", palletsGood: "acceptable", noExposedProducts: "acceptable",
  doorsSecured: "acceptable", truckTemp: "", verifiedBy: "",
});

const InspectionSection = ({ receipt, isAdmin, onReceiptUpdate }) => {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft]       = useState(null);
  const [saving, setSaving]     = useState(false);

  const insp    = receipt.inspection || {};
  const hasData = INSPECTION_CHECKS.some((c) => insp[c.key]) || insp.truckTemp || insp.verifiedBy;
  const anyBad  = INSPECTION_CHECKS.some((c) => insp[c.key] === "unacceptable");
  const inStyle = (w) => ({ ...cellInputStyle, width: w });

  const startEdit = () => { setDraft({ ...emptyInspection(), ...insp }); setExpanded(true); };

  const save = async () => {
    setSaving(true);
    try {
      const res = await axiosInstance.patch(`/noblesse-receipts/${receipt.id}/inspection`, { inspection: draft });
      onReceiptUpdate(res.data);
      setExpanded(false); setDraft(null);
    } catch {
      toast({ title: "Failed to save inspection", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box borderTop="1px" borderColor="gray.200" bg="gray.50" px={4} py={3} mb={8}>
      <Flex align="center" justify="space-between" mb={expanded ? 3 : 0}>
        <Text fontSize="sm" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wide">
          Vehicle Inspection
        </Text>
        {isAdmin && !expanded && (
          <Button size="xs" variant="ghost" colorScheme="gray" onClick={startEdit}>
            {hasData ? "Edit" : "Fill in"}
          </Button>
        )}
      </Flex>

      {expanded && draft ? (
        <Box>
          <Flex flexWrap="wrap" gap={4} mb={3}>
            {INSPECTION_CHECKS.map((check) => (
              <Box key={check.key}>
                <Text fontSize="10px" color="gray.500" mb="2px">{check.label}</Text>
                <Flex gap={1}>
                  <Button size="xs"
                    colorScheme={draft[check.key] === "acceptable" ? "green" : "gray"}
                    variant={draft[check.key] === "acceptable" ? "solid" : "outline"}
                    onClick={() => setDraft((d) => ({ ...d, [check.key]: "acceptable" }))}>
                    Acceptable
                  </Button>
                  <Button size="xs"
                    colorScheme={draft[check.key] === "unacceptable" ? "red" : "gray"}
                    variant={draft[check.key] === "unacceptable" ? "solid" : "outline"}
                    onClick={() => setDraft((d) => ({ ...d, [check.key]: "unacceptable" }))}>
                    Unacceptable
                  </Button>
                </Flex>
              </Box>
            ))}
            <Box>
              <Text fontSize="10px" color="gray.500" mb="2px">Truck Temp (°F)</Text>
              <input value={draft.truckTemp || ""}
                onChange={(e) => setDraft((d) => ({ ...d, truckTemp: e.target.value }))}
                style={inStyle("70px")} placeholder="27" />
            </Box>
            <Box>
              <Text fontSize="10px" color="gray.500" mb="2px">Verified By</Text>
              <input value={draft.verifiedBy || ""}
                onChange={(e) => setDraft((d) => ({ ...d, verifiedBy: e.target.value }))}
                style={inStyle("160px")} placeholder="Name / Signature" />
            </Box>
          </Flex>
          <Flex gap={1}>
            <Button size="xs" colorScheme="blue" isLoading={saving} onClick={save}>Save</Button>
            <Button size="xs" variant="ghost" onClick={() => { setExpanded(false); setDraft(null); }}>Cancel</Button>
          </Flex>
        </Box>
      ) : hasData ? (
        <Flex gap={4} align="center" flexWrap="wrap">
          {anyBad
            ? <Box as="span" fontSize="sm" color="red.600" fontWeight="semibold">Issues noted</Box>
            : <Box as="span" fontSize="sm" color="green.600" fontWeight="semibold">All acceptable</Box>
          }
          {INSPECTION_CHECKS.filter((c) => insp[c.key] === "unacceptable").map((c) => (
            <Text key={c.key} fontSize="sm" color="red.600">⚠ {c.label}</Text>
          ))}
          {insp.truckTemp  && <Text fontSize="sm" color="gray.600">Temp: {insp.truckTemp}°F</Text>}
          {insp.verifiedBy && <Text fontSize="sm" color="gray.600">Verified by: {insp.verifiedBy}</Text>}
        </Flex>
      ) : (
        <Text fontSize="sm" color="gray.300" fontStyle="italic">Not completed</Text>
      )}
    </Box>
  );
};

// ── Editable receipt card ──────────────────────────────────────────────────────

const DailyReceiptCard = ({ receipt, onReceiptUpdate, onReceiptDelete, onInventoryPush, isAdmin, canDelete = false }) => {
  const toast = useToast();
  const [editing, setEditing]         = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [draftDate, setDraftDate]     = useState("");
  const [draftBol, setDraftBol]       = useState("");
  const [draftDriver, setDraftDriver] = useState("");
  const [draftLines, setDraftLines]   = useState([]);
  const [saving, setSaving]           = useState(false);
  const [pushOpen, setPushOpen]       = useState(false);
  const [pushing, setPushing]         = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Cancel takes focus, so Enter on the dialog does not delete the record.
  const cancelDeleteRef = useRef(null);

  const pushLines = (receipt.lines || []).filter((l) => l.lot || l.description || l.brand);

  const handlePushToInventory = async () => {
    setPushing(true);
    try {
      const res = await axiosInstance.post(`/noblesse-receipts/${receipt.id}/push-to-inventory`);
      onReceiptUpdate(res.data.receipt);
      onInventoryPush(res.data.items);
      setPushOpen(false);
      toast({ title: `${res.data.items.length} item(s) added to inventory`, status: "success", position: "top", duration: 3000, isClosable: true });
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to push to inventory";
      toast({ title: msg, status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setPushing(false);
    }
  };

  const startEdit = () => {
    setDraftDate(receipt.shipmentDate || "");
    setDraftBol(receipt.bolNumber || "");
    setDraftDriver(receipt.driver || "");
    setDraftLines(receipt.lines.length > 0 ? receipt.lines.map((l) => ({ ...l })) : [emptyLine()]);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await axiosInstance.delete(`/noblesse-receipts/${receipt.id}`);
      setConfirmDelete(false);
      onReceiptDelete(receipt.id);
    } catch {
      toast({ title: "Failed to delete", status: "error", position: "top", duration: 3000, isClosable: true });
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await axiosInstance.patch(`/noblesse-receipts/${receipt.id}`, {
        shipmentDate: draftDate   || null,
        bolNumber:    draftBol    || null,
        driver:       draftDriver || null,
        lines:        draftLines,
      });
      onReceiptUpdate(res.data);
      setEditing(false);
    } catch {
      toast({ title: "Failed to save", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSaving(false);
    }
  };

  const updateLine = (i, field, val) =>
    setDraftLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const addLine    = () => setDraftLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i) => setDraftLines((prev) => prev.filter((_, idx) => idx !== i));

  const handleCellKey = (e, rowIdx) => {
    if (e.key === "Enter") { e.preventDefault(); if (rowIdx === draftLines.length - 1) addLine(); }
  };

  const NCOLS = RECEIPT_LINE_COLS.length + 2; // row# + cols + delete

  return (
    <>
      <Box border="1px" borderColor="gray.200"
        borderRadius="lg" mb={5} overflow="hidden" boxShadow="sm">

        {/* Card header */}
        <Box bg="gray.50" px={4} py={3}
          borderBottom="1px" borderColor="gray.200">
          <Text fontSize="sm" fontWeight="bold" textTransform="uppercase"
            letterSpacing="widest" color="gray.400" mb={2}>
            Daily Incoming Product Record
          </Text>

          <Flex align="center" justify="space-between" flexWrap="wrap" gap={2}>
            <Flex gap={4} align="center" flexWrap="wrap">
              <Text fontSize="xl" fontWeight="semibold" color="gray.800">
                {fmtDate(receipt.shipmentDate) || "No date"}
              </Text>
              {receipt.bolNumber && <Text fontSize="md" color="gray.500">BOL # {receipt.bolNumber}</Text>}
              {receipt.driver    && <Text fontSize="md" color="gray.500">Driver: {receipt.driver}</Text>}
              {receipt.createdAt && (
                <Text fontSize="sm" color="gray.400">Logged: {fmtDate(receipt.createdAt)}</Text>
              )}
              {receipt.inventoryPushed && (
                <Badge colorScheme="green" variant="subtle" fontSize="sm" px={2} py={0.5} borderRadius="md">
                  In Inventory
                </Badge>
              )}
            </Flex>
            {isAdmin && (
              <Flex gap={1} align="center">
                {!receipt.inventoryPushed && pushLines.length > 0 && (
                  <Button size="xs" colorScheme="teal" variant="outline"
                    onClick={() => setPushOpen(true)}>
                    Add to Inventory
                  </Button>
                )}
                <Button size="xs" variant="ghost" colorScheme="gray" onClick={startEdit}>Edit</Button>
                <IconButton icon={<DeleteIcon />} size="xs" variant="ghost" colorScheme="red"
                  aria-label="Delete record" isLoading={deleting} onClick={() => setConfirmDelete(true)}
                  isDisabled={!canDelete} title={canDelete ? "Delete record" : "Admins only"} />
              </Flex>
            )}
          </Flex>
        </Box>

        {/* Table */}
        <Box overflowX="auto">
          <Box as="table" borderCollapse="collapse" style={{ minWidth: "100%" }}>
            <thead>
              <tr>
                {RECEIPT_LINE_COLS.map((c) => (
                  <Box key={c.key} as="th" px={3} py="9px"
                    bg="gray.50" border="1px solid" borderColor="gray.200"
                    fontSize="md" fontWeight="semibold" color="gray.500"
                    textTransform="uppercase" letterSpacing="wide"
                    whiteSpace="nowrap" textAlign="left"
                    style={{ minWidth: c.w }}>
                    {c.label}
                  </Box>
                ))}
              </tr>
            </thead>
            <tbody>
              {receipt.lines.length === 0 ? (
                <Box as="tr">
                  <Box as="td" colSpan={RECEIPT_LINE_COLS.length}
                    border="1px solid" borderColor="gray.100" px={3} py={3}>
                    <Text fontSize="sm" color="gray.300" fontStyle="italic">No line items recorded.</Text>
                  </Box>
                </Box>
              ) : (
                receipt.lines.map((l, j) => (
                  <Box as="tr" key={j} bg={j % 2 === 0 ? "white" : "gray.50"}>
                    {RECEIPT_LINE_COLS.map((col, ci) => (
                      <Box key={col.key} as="td" px={3} py="9px"
                        border="1px solid" borderColor="gray.100"
                        fontSize="md" whiteSpace="nowrap"
                        fontWeight={ci === 0 ? "medium" : "normal"}
                        color={ci === 0 ? "blue.700" : "gray.700"}>
                        {cellValue(col, l)}
                      </Box>
                    ))}
                  </Box>  
                ))
              )}
            </tbody>
          </Box>
        </Box>
      </Box>

      <InspectionSection receipt={receipt} isAdmin={isAdmin} onReceiptUpdate={onReceiptUpdate} />

      {/* Edit modal */}
      <FloatingWindow
        isOpen={editing}
        onClose={cancelEdit}
        title={`Edit Daily Record — ${fmtDate(receipt.shipmentDate) || "No date"}`}
        width={1600}
        footer={<Flex gap={2} justify="flex-end" width="100%">
          <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
          <Button size="sm" colorScheme="blue" isLoading={saving} onClick={saveEdit}>Save Changes</Button>
        </Flex>}
      >
        <Box mb={4}>
          <Flex gap={4} align="flex-end" flexWrap="wrap">
            <Box>
              <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Date</Text>
              <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)}
                style={hdInput("140px")} autoFocus />
            </Box>
            <Box>
              <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">BOL #</Text>
              <input value={draftBol} onChange={(e) => setDraftBol(e.target.value)}
                style={hdInput("90px")} placeholder="BOL #" />
            </Box>
            <Box>
              <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Driver</Text>
              <input value={draftDriver} onChange={(e) => setDraftDriver(e.target.value)}
                style={hdInput("160px")} placeholder="Name" />
            </Box>
          </Flex>
        </Box>

        {/* Excel grid */}
        <Box overflowX="auto" maxH="60vh">
          <Box as="table" borderCollapse="collapse" style={{ minWidth: "100%" }}>
            <thead>
              <tr>
                <XlTh center w="32px">#</XlTh>
                {RECEIPT_LINE_COLS.map((c) => <XlTh key={c.key} w={c.w}>{c.label}</XlTh>)}
                <XlTh w="36px" />
              </tr>
            </thead>
            <tbody>
              {draftLines.map((line, i) => (
                <Box as="tr" key={i}>
                  <XlRowNum n={i + 1} />
                  {RECEIPT_LINE_COLS.map((col) => (
                    <XlTd key={col.key} isInput>
                      <input
                        type={col.type}
                        value={line[col.key] || ""}
                        onChange={(e) => updateLine(i, col.key, e.target.value)}
                        placeholder={col.placeholder}
                        onKeyDown={(e) => handleCellKey(e, i)}
                        style={xlInput}
                      />
                    </XlTd>
                  ))}
                  <XlTd center>
                    <IconButton icon={<DeleteIcon />} size="xs" variant="ghost" colorScheme="red"
                      aria-label="Remove" isDisabled={draftLines.length === 1}
                      onClick={() => removeLine(i)} />
                  </XlTd>
                </Box>
              ))}
              <Box as="tr" cursor="cell" onClick={addLine} _hover={{ bg: "blue.50" }}>
                <Box as="td" colSpan={NCOLS}
                  border="1px solid" borderColor="gray.200" px={3} py="9px">
                  <Text fontSize="sm" color="gray.400" fontStyle="italic">+ add row</Text>
                </Box>
              </Box>
            </tbody>
          </Box>
        </Box>
      </FloatingWindow>

      {/* Push to inventory confirmation modal */}
      <FloatingWindow
        isOpen={pushOpen}
        onClose={() => setPushOpen(false)}
        title="Add to NTI Inventory"
        width={800}
        footer={<>
          <Button size="sm" variant="ghost" onClick={() => setPushOpen(false)}>Cancel</Button>
          <Button size="sm" colorScheme="teal" isLoading={pushing} onClick={handlePushToInventory}>
            Confirm — Add {pushLines.length} Item(s)
          </Button>
        </>}
      >
        <Text fontSize="sm" color="gray.500" mb={3}>
              The following {pushLines.length} line(s) from this receipt will each become a new row in NTI Inventory.
              Received date will be set to <strong>{fmtDate(receipt.shipmentDate) || "—"}</strong>.
            </Text>
            <Box overflowX="auto">
              <Box as="table" borderCollapse="collapse" width="100%" fontSize="sm">
                <thead>
                  <tr>
                    {["Lot", "Brand", "Species", "Description", "Grade", "Weight", "Cases"].map((h) => (
                      <Box key={h} as="th" px={3} py="7px"
                        bg="gray.100" border="1px solid" borderColor="gray.300"
                        fontSize="sm" fontWeight="bold" color="gray.500"
                        textTransform="uppercase" letterSpacing="wide" whiteSpace="nowrap" textAlign="left">
                        {h}
                      </Box>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pushLines.map((l, i) => (
                    <Box as="tr" key={i} bg={i % 2 === 0 ? "white" : "gray.50"}>
                      {[l.lot, l.brand, l.species, l.description, l.grade,
                        l.weight ? `${l.weight} lb` : "—",
                        l.qty    || "—"
                      ].map((v, ci) => (
                        <Box key={ci} as="td" px={3} py="7px"
                          border="1px solid" borderColor="gray.200"
                          color={v === "—" ? "gray.300" : "gray.700"}
                          fontWeight={ci === 0 ? "medium" : "normal"}
                          whiteSpace="nowrap">
                          {v || "—"}
                        </Box>
                      ))}
                    </Box>
                  ))}
                </tbody>
              </Box>
            </Box>
      </FloatingWindow>

      {/* Deleting a day's record takes every product line with it and there is
          no undo, so name what is about to go rather than asking "are you sure". */}
      <AlertDialog
        isOpen={confirmDelete}
        leastDestructiveRef={cancelDeleteRef}
        onClose={() => setConfirmDelete(false)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete this record?
            </AlertDialogHeader>

            <AlertDialogBody>
              <Text mb={3}>
                This permanently deletes the incoming record for{" "}
                <strong>{fmtDate(receipt.shipmentDate) || "no date"}</strong>
                {receipt.bolNumber ? <> (BOL {receipt.bolNumber})</> : null}
                {" "}and all {receipt.lines?.length || 0} product line
                {receipt.lines?.length === 1 ? "" : "s"} on it.
              </Text>
              {receipt.inventoryPushed && (
                <Text color="orange.600" fontWeight="medium" fontSize="sm">
                  These lines were already pushed to inventory. Deleting this record
                  does not remove them from inventory.
                </Text>
              )}
              <Text fontSize="sm" color="gray.500" mt={2}>
                This cannot be undone.
              </Text>
            </AlertDialogBody>

            <AlertDialogFooter gap={2}>
              <Button ref={cancelDeleteRef} onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button colorScheme="red" onClick={handleDelete} isLoading={deleting}>
                Delete record
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
};

// ── Flat table view ────────────────────────────────────────────────────────────

const TABLE_COLS = [
  { key: "shipmentDate", label: "Date",        w: "105px" },
  { key: "lot",          label: "Lot No.",      w: "110px" },
  { key: "brand",        label: "Brand",        w: "80px"  },
  { key: "species",      label: "Species",      w: "75px"  },
  { key: "description",  label: "Description",  w: "160px" },
  { key: "grade",        label: "Grade",        w: "65px"  },
  { key: "weight",       label: "WT (lb)",      w: "80px"  },
  { key: "qty",          label: "Cases",        w: "60px"  },
  { key: "packDate",     label: "Pack Date",    w: "105px" },
  { key: "temp",         label: "Temp (°F)",    w: "75px"  },
  { key: "estNo",        label: "EST No.",      w: "75px"  },
  { key: "_status",      label: "In Inventory", w: "90px"  },
];

const AllLinesTable = ({ receipts }) => {
  // Flatten all lines from all receipts, sorted newest date first
  const rows = [...receipts]
    .sort((a, b) => (b.shipmentDate || "").localeCompare(a.shipmentDate || ""))
    .flatMap((r) => {
      if (r.lines.length === 0) {
        return [{ shipmentDate: r.shipmentDate, inventoryPushed: r.inventoryPushed, _empty: true }];
      }
      return r.lines.map((l) => ({ ...l, shipmentDate: r.shipmentDate, inventoryPushed: r.inventoryPushed }));
    });

  if (rows.length === 0) {
    return <Text fontSize="md" color="gray.400">No records logged yet.</Text>;
  }

  const cellVal = (row, col) => {
    if (col.key === "_status") return null; // rendered separately
    if (col.key === "shipmentDate") return fmtDate(row.shipmentDate) || "—";
    if (col.key === "weight")   return row.weight   ? `${row.weight} lb` : "—";
    if (col.key === "temp")     return row.temp     ? `${row.temp}°F`    : "—";
    if (col.key === "packDate") return fmtDate(row.packDate) || "—";
    const v = row[col.key];
    return v || "—";
  };

  return (
    <Box overflowX="auto">
      <Box as="table" borderCollapse="collapse" width="100%" fontSize="sm">
        <thead>
          <tr>
            {TABLE_COLS.map((c) => (
              <Box key={c.key} as="th"
                px={3} py="8px"
                bg="gray.100" border="1px solid" borderColor="gray.300"
                fontSize="sm" fontWeight="bold" color="gray.500"
                textTransform="uppercase" letterSpacing="wide"
                whiteSpace="nowrap" textAlign="left"
                style={{ minWidth: c.w }}>
                {c.label}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <Box as="tr" key={i} bg={i % 2 === 0 ? "white" : "gray.50"}>
              {TABLE_COLS.map((col, ci) => (
                <Box key={col.key} as="td"
                  px={3} py="8px"
                  border="1px solid" borderColor="gray.100"
                  fontSize="md" whiteSpace="nowrap"
                  fontWeight={ci === 0 ? "semibold" : "normal"}
                  color={
                    col.key === "_status" ? undefined
                    : ci === 0 ? "gray.700"
                    : row._empty || cellVal(row, col) === "—" ? "gray.300"
                    : "gray.700"
                  }>
                  {col.key === "_status" ? (
                    row.inventoryPushed
                      ? <Badge colorScheme="green" variant="subtle" fontSize="sm" px={2} py={0.5} borderRadius="md">Yes</Badge>
                      : <Text as="span" color="gray.300" fontSize="sm">—</Text>
                  ) : (
                    cellVal(row, col)
                  )}
                </Box>
              ))}
            </Box>
          ))}
        </tbody>
      </Box>
    </Box>
  );
};

// ── Tab root ───────────────────────────────────────────────────────────────────

const DAYS_PER_PAGE = 5;

export const IncomingRecordsTab = ({ receipts, onReceiptAdded, onReceiptUpdate, onReceiptDelete, onInventoryPush, isAdmin, canDelete = false }) => {
  const [page, setPage]         = useState(0);
  const [viewMode, setViewMode] = useState("cards"); // "cards" | "table"
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [newDate, setNewDate]   = useState(today());
  const [newBol, setNewBol]     = useState("");
  const [newDriver, setNewDriver] = useState("");
  const [newLines, setNewLines] = useState([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const updateLine = (i, field, val) =>
    setNewLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const addLine    = () => setNewLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i) => setNewLines((prev) => prev.filter((_, idx) => idx !== i));

  const cancelNewRecord = () => {
    setNewRecordOpen(false);
    setNewDate(today()); setNewBol(""); setNewDriver(""); setNewLines([emptyLine()]);
  };

  const submitNewRecord = async () => {
    const validLines = newLines.filter((l) => l.lot || l.brand || l.description);
    setSubmitting(true);
    try {
      const res = await axiosInstance.post("/noblesse-receipts", {
        shipmentDate: newDate, bolNumber: newBol, driver: newDriver, lines: validLines,
      });
      toast({ title: "Record logged", status: "success", position: "top", duration: 2000, isClosable: true });
      onReceiptAdded(res.data);
      setPage(0);
      cancelNewRecord();
    } catch {
      toast({ title: "Failed to save", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCellKey = (e, rowIdx) => {
    if (e.key === "Enter") { e.preventDefault(); if (rowIdx === newLines.length - 1) addLine(); }
  };

  const NCOLS = RECEIPT_LINE_COLS.length + 2;

  // Unique shipment dates sorted newest-first
  const allDates = [...new Set(receipts.map((r) => r.shipmentDate).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));

  const totalPages  = Math.max(1, Math.ceil(allDates.length / DAYS_PER_PAGE));
  const pageDateSet = new Set(allDates.slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE));

  // Receipts visible on this page; undated receipts appear on page 0 only
  const visible = receipts.filter((r) =>
    r.shipmentDate ? pageDateSet.has(r.shipmentDate) : page === 0
  );

  // Segmented control style helpers
  const segBtn = (active) => ({
    size: "xs",
    variant: "ghost",
    colorScheme: active ? "blue" : "gray",
    bg: active ? "blue.50" : "transparent",
    border: "1px solid",
    borderColor: active ? "blue.300" : "gray.200",
    borderRadius: "none",
  });

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={4}>
        <Text fontSize="sm" fontWeight="semibold" color="gray.600"
          textTransform="uppercase" letterSpacing="wide">
          Daily Records
        </Text>
        <Flex align="center" gap={3}>
          {/* View toggle */}
          <Flex>
            <Button {...segBtn(viewMode === "cards")}
              borderRightWidth={0} borderLeftRadius="md"
              onClick={() => setViewMode("cards")}>
              Cards
            </Button>
            <Button {...segBtn(viewMode === "table")}
              borderRightRadius="md"
              onClick={() => setViewMode("table")}>
              Table
            </Button>
          </Flex>

          {/* Pagination controls — cards mode only */}
          {viewMode === "cards" && totalPages > 1 && (
            <Flex align="center" gap={2}>
              <Button size="xs" variant="ghost" colorScheme="gray"
                isDisabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                ← Newer
              </Button>
              <Text fontSize="sm" color="gray.400">{page + 1} / {totalPages}</Text>
              <Button size="xs" variant="ghost" colorScheme="gray"
                isDisabled={page === totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                Older →
              </Button>
            </Flex>
          )}

          {/* New record button */}
          {isAdmin && (
            <Button size="xs" colorScheme="blue" onClick={() => setNewRecordOpen(true)}>
              + New Record
            </Button>
          )}
        </Flex>
      </Flex>

      {viewMode === "table" ? (
        <AllLinesTable receipts={receipts} />
      ) : (
        <>
          {/* New record modal */}
          <FloatingWindow
            isOpen={newRecordOpen}
            onClose={cancelNewRecord}
            title="New Daily Incoming Product Record"
            width={1600}
            footer={<Flex gap={2} justify="flex-end" width="100%">
              <Button size="sm" variant="ghost" onClick={cancelNewRecord}>Cancel</Button>
              <Button size="sm" colorScheme="blue" isLoading={submitting} onClick={submitNewRecord}>Save Record</Button>
            </Flex>}
          >
            <Box mb={4}>
              <Flex gap={4} align="flex-end" flexWrap="wrap">
                <Box>
                  <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Date</Text>
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                    style={hdInput("140px")} autoFocus />
                </Box>
                <Box>
                  <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">BOL #</Text>
                  <input placeholder="e.g. 8289" value={newBol} onChange={(e) => setNewBol(e.target.value)}
                    style={hdInput("90px")} />
                </Box>
                <Box>
                  <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Driver</Text>
                  <input placeholder="Name" value={newDriver} onChange={(e) => setNewDriver(e.target.value)}
                    style={hdInput("160px")} />
                </Box>
              </Flex>
            </Box>

            {/* Excel grid */}
            <Box overflowX="auto" maxH="60vh">
              <Box as="table" borderCollapse="collapse" style={{ minWidth: "100%" }}>
                <thead>
                  <tr>
                    <XlTh center w="32px">#</XlTh>
                    {RECEIPT_LINE_COLS.map((c) => <XlTh key={c.key} w={c.w}>{c.label}</XlTh>)}
                    <XlTh w="36px" />
                  </tr>
                </thead>
                <tbody>
                  {newLines.map((line, i) => (
                    <Box as="tr" key={i}>
                      <XlRowNum n={i + 1} />
                      {RECEIPT_LINE_COLS.map((col) => (
                        <XlTd key={col.key} isInput>
                          <input
                            type={col.type}
                            value={line[col.key]}
                            onChange={(e) => updateLine(i, col.key, e.target.value)}
                            placeholder={col.placeholder}
                            onKeyDown={(e) => handleCellKey(e, i)}
                            style={xlInput}
                          />
                        </XlTd>
                      ))}
                      <XlTd center>
                        <IconButton icon={<DeleteIcon />} size="xs" variant="ghost" colorScheme="red"
                          aria-label="Remove" isDisabled={newLines.length === 1}
                          onClick={() => removeLine(i)} />
                      </XlTd>
                    </Box>
                  ))}
                  {/* Add-row tap target */}
                  <Box as="tr" cursor="cell" onClick={addLine} _hover={{ bg: "blue.50" }}>
                    <Box as="td" colSpan={NCOLS}
                      border="1px solid" borderColor="gray.200" px={3} py="9px">
                      <Text fontSize="sm" color="gray.400" fontStyle="italic">+ add row</Text>
                    </Box>
                  </Box>
                </tbody>
              </Box>
            </Box>
          </FloatingWindow>

          {visible.length === 0 && !isAdmin && (
            <Text fontSize="md" color="gray.400">No records logged yet.</Text>
          )}

          {visible.map((r) => (
            <DailyReceiptCard key={r.id} receipt={r}
              onReceiptUpdate={onReceiptUpdate}
              onReceiptDelete={onReceiptDelete}
              onInventoryPush={onInventoryPush}
              isAdmin={isAdmin}
              canDelete={canDelete} />
          ))}

          {totalPages > 1 && (
            <Flex justify="center" gap={2} mt={4}>
              <Button size="xs" variant="ghost" colorScheme="gray"
                isDisabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                ← Newer
              </Button>
              <Text fontSize="sm" color="gray.400" alignSelf="center">{page + 1} / {totalPages}</Text>
              <Button size="xs" variant="ghost" colorScheme="gray"
                isDisabled={page === totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                Older →
              </Button>
            </Flex>
          )}
        </>
      )}
    </Box>
  );
};
