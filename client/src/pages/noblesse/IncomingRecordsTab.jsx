import React, { useState } from "react";
import { Box, Flex, Text, Button, IconButton, useToast } from "@chakra-ui/react";
import { AddIcon, DeleteIcon, CheckIcon, CloseIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import { fmtDate, today, cellInputStyle, Th, Td } from "./shared";

export const RECEIPT_LINE_COLS = [
  { key: "lot",           label: "Lot No.",          w: "90px",  type: "text", placeholder: "N26124-01" },
  { key: "vendorNo",      label: "Vendor No.",        w: "75px",  type: "text", placeholder: "" },
  { key: "vendorInvoice", label: "Vendor Invoice #",  w: "100px", type: "text", placeholder: "" },
  { key: "brand",         label: "Brand",             w: "85px",  type: "text", placeholder: "IBP" },
  { key: "species",       label: "Species",           w: "65px",  type: "text", placeholder: "Beef" },
  { key: "description",   label: "Description",       w: "140px", type: "text", placeholder: "Brisket" },
  { key: "grade",         label: "Grade",             w: "55px",  type: "text", placeholder: "CH" },
  { key: "weight",        label: "WT (#)",            w: "70px",  type: "text", placeholder: "1842" },
  { key: "qty",           label: "QTY (C.S.)",        w: "65px",  type: "text", placeholder: "24" },
  { key: "packDate",      label: "Pack Date",         w: "125px", type: "date", placeholder: "" },
  { key: "temp",          label: "Temp (°F)",         w: "65px",  type: "text", placeholder: "27" },
  { key: "estNo",         label: "EST No.",           w: "65px",  type: "text", placeholder: "9268" },
];

export const emptyLine = () => ({
  lot: "", vendorNo: "", vendorInvoice: "", brand: "", species: "", description: "",
  grade: "", weight: "", qty: "", packDate: "", temp: "", estNo: "",
});

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
    <Box borderTop="1px" borderColor="gray.200" bg="gray.50" px={4} py={3}>
      <Flex align="center" justify="space-between" mb={expanded ? 3 : 0}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wide">
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
            ? <Box as="span" fontSize="xs" color="red.600" fontWeight="semibold">Issues noted</Box>
            : <Box as="span" fontSize="xs" color="green.600" fontWeight="semibold">All acceptable</Box>
          }
          {INSPECTION_CHECKS.filter((c) => insp[c.key] === "unacceptable").map((c) => (
            <Text key={c.key} fontSize="xs" color="red.600">⚠ {c.label}</Text>
          ))}
          {insp.truckTemp  && <Text fontSize="xs" color="gray.600">Temp: {insp.truckTemp}°F</Text>}
          {insp.verifiedBy && <Text fontSize="xs" color="gray.600">Verified by: {insp.verifiedBy}</Text>}
        </Flex>
      ) : (
        <Text fontSize="xs" color="gray.300" fontStyle="italic">Not completed</Text>
      )}
    </Box>
  );
};

const DailyReceiptCard = ({ receipt, onReceiptUpdate, isAdmin }) => (
  <Box border="1px" borderColor="gray.200" borderRadius="lg" mb={5} overflow="hidden" boxShadow="sm">
    <Box bg="gray.50" px={4} py={3} borderBottom="1px" borderColor="gray.200">
      <Text fontSize="9px" fontWeight="bold" textTransform="uppercase" letterSpacing="widest" color="gray.400" mb={1}>
        Daily Incoming Product Record
      </Text>
      <Flex gap={4} align="center" flexWrap="wrap">
        <Text fontSize="sm" fontWeight="semibold" color="gray.800">
          {fmtDate(receipt.shipmentDate) || "No date"}
        </Text>
        {receipt.bolNumber && <Text fontSize="xs" color="gray.500">BOL # {receipt.bolNumber}</Text>}
        {receipt.driver    && <Text fontSize="xs" color="gray.500">Driver: {receipt.driver}</Text>}
      </Flex>
    </Box>

    <Box overflowX="auto">
      <Box as="table" width="100%" borderCollapse="collapse">
        <thead>
          <tr>{RECEIPT_LINE_COLS.map((c) => <Th key={c.key}>{c.label}</Th>)}</tr>
        </thead>
        <tbody>
          {receipt.lines.length === 0 ? (
            <Box as="tr">
              <Box as="td" colSpan={RECEIPT_LINE_COLS.length} px={3} py={3}>
                <Text fontSize="xs" color="gray.300" fontStyle="italic">No line items recorded.</Text>
              </Box>
            </Box>
          ) : receipt.lines.map((l, j) => (
            <Box as="tr" key={j} bg={j % 2 === 0 ? "white" : "gray.50"}>
              <Td color="blue.700" fontWeight="medium">{l.lot || "—"}</Td>
              <Td>{l.vendorNo      || "—"}</Td>
              <Td>{l.vendorInvoice || "—"}</Td>
              <Td>{l.brand        || "—"}</Td>
              <Td>{l.species      || "—"}</Td>
              <Td>{l.description  || "—"}</Td>
              <Td>{l.grade        || "—"}</Td>
              <Td>{l.weight       ? `${l.weight} lb` : "—"}</Td>
              <Td>{l.qty          || "—"}</Td>
              <Td>{fmtDate(l.packDate)}</Td>
              <Td>{l.temp         ? `${l.temp}°F` : "—"}</Td>
              <Td>{l.estNo        || "—"}</Td>
            </Box>
          ))}
        </tbody>
      </Box>
    </Box>

    <InspectionSection receipt={receipt} isAdmin={isAdmin} onReceiptUpdate={onReceiptUpdate} />
  </Box>
);

const NewReceiptForm = ({ onReceiptAdded }) => {
  const toast = useToast();
  const [open, setOpen]           = useState(false);
  const [newDate, setNewDate]     = useState(today());
  const [newBol, setNewBol]       = useState("");
  const [newDriver, setNewDriver] = useState("");
  const [newLines, setNewLines]   = useState([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  const updateLine = (i, field, val) =>
    setNewLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const addLine    = () => setNewLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i) => setNewLines((prev) => prev.filter((_, idx) => idx !== i));

  const cancel = () => {
    setOpen(false);
    setNewDate(today()); setNewBol(""); setNewDriver(""); setNewLines([emptyLine()]);
  };

  const submit = async () => {
    const validLines = newLines.filter((l) => l.lot || l.brand || l.description);
    setSubmitting(true);
    try {
      const res = await axiosInstance.post("/noblesse-receipts", {
        shipmentDate: newDate, bolNumber: newBol, driver: newDriver, lines: validLines,
      });
      toast({ title: "Record logged", status: "success", position: "top", duration: 2000, isClosable: true });
      onReceiptAdded(res.data);
      cancel();
    } catch {
      toast({ title: "Failed to save", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSubmitting(false);
    }
  };

  const inStyle = (w) => ({ ...cellInputStyle, width: w });
  const COLS = RECEIPT_LINE_COLS.length + 1;

  if (!open) {
    return (
      <Box border="2px dashed" borderColor="gray.200" borderRadius="lg" mb={5} px={4} py={3}
        cursor="pointer" _hover={{ borderColor: "blue.200", bg: "blue.50" }}
        onClick={() => setOpen(true)}>
        <Text fontSize="xs" color="gray.300" fontStyle="italic">+ new daily record</Text>
      </Box>
    );
  }

  return (
    <Box border="2px" borderColor="blue.300" borderRadius="lg" mb={5} overflow="hidden">
      <Box bg="blue.50" px={4} py={3} borderBottom="2px" borderColor="blue.300">
        <Text fontSize="9px" fontWeight="bold" textTransform="uppercase" letterSpacing="widest" color="blue.400" mb={2}>
          New Daily Incoming Product Record
        </Text>
        <Flex gap={4} align="flex-end" flexWrap="wrap">
          <Box>
            <Text fontSize="10px" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Date</Text>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
              style={inStyle("140px")} autoFocus />
          </Box>
          <Box>
            <Text fontSize="10px" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">BOL #</Text>
            <input placeholder="e.g. 8289" value={newBol} onChange={(e) => setNewBol(e.target.value)}
              style={inStyle("90px")} />
          </Box>
          <Box>
            <Text fontSize="10px" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Driver</Text>
            <input placeholder="Name" value={newDriver} onChange={(e) => setNewDriver(e.target.value)}
              style={inStyle("140px")} />
          </Box>
          <Flex gap={1} ml="auto">
            <IconButton icon={<CheckIcon />} size="xs" colorScheme="blue" aria-label="Save"
              isLoading={submitting} onClick={submit} />
            <IconButton icon={<CloseIcon />} size="xs" variant="ghost" colorScheme="gray" aria-label="Cancel"
              onClick={cancel} />
          </Flex>
        </Flex>
      </Box>

      <Box overflowX="auto">
        <Box as="table" width="100%" borderCollapse="collapse">
          <thead>
            <tr>
              {RECEIPT_LINE_COLS.map((c) => <Th key={c.key}>{c.label}</Th>)}
              <Th w="32px" />
            </tr>
          </thead>
          <tbody>
            {newLines.map((line, i) => (
              <Box as="tr" key={i} bg="blue.50">
                {RECEIPT_LINE_COLS.map((col) => (
                  <Td key={col.key} px={1}>
                    <input type={col.type} value={line[col.key]}
                      onChange={(e) => updateLine(i, col.key, e.target.value)}
                      placeholder={col.placeholder} style={inStyle(col.w)} />
                  </Td>
                ))}
                <Td px={1}>
                  <IconButton icon={<DeleteIcon />} size="xs" variant="ghost" colorScheme="red"
                    aria-label="Remove" isDisabled={newLines.length === 1} onClick={() => removeLine(i)} />
                </Td>
              </Box>
            ))}
            <Box as="tr" bg="blue.50" cursor="cell" onClick={addLine} _hover={{ bg: "blue.100" }}>
              <Box as="td" colSpan={COLS} px={3} py={1} borderBottom="2px" borderColor="blue.200">
                <Text fontSize="xs" color="blue.300" fontStyle="italic">+ add line</Text>
              </Box>
            </Box>
          </tbody>
        </Box>
      </Box>
    </Box>
  );
};

export const IncomingRecordsTab = ({ receipts, onReceiptAdded, onReceiptUpdate, isAdmin }) => (
  <Box>
    <Text fontSize="xs" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide" mb={4}>
      Daily Records
    </Text>
    {isAdmin && <NewReceiptForm onReceiptAdded={onReceiptAdded} />}
    {receipts.length === 0 && !isAdmin && (
      <Text fontSize="sm" color="gray.400">No records logged yet.</Text>
    )}
    {receipts.map((r) => (
      <DailyReceiptCard key={r.id} receipt={r} onReceiptUpdate={onReceiptUpdate} isAdmin={isAdmin} />
    ))}
  </Box>
);
