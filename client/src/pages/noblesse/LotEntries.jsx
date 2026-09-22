import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Flex, Text, Badge, Button, Spinner, Alert, AlertIcon,
  Table, Thead, Tbody, Tr, Th, Td, Grid, useToast,
} from "@chakra-ui/react";
import {
  CheckIcon, CloseIcon, ChevronDownIcon, ChevronRightIcon,
} from "@chakra-ui/icons";
import FloatingWindow from "../../components/FloatingWindow";
import ScanSheet from "../../components/navbar/ScanSheet";
import axiosInstance from "../../utils/axiosInstance";
import printWeightManifest from "./printWeightManifest";
import printRegistrationForm from "./printRegistrationForm";
import {
  fmtDate, fmtWeight, weighedDay, SheetField, SectionBar,
} from "./shared";

// The two entries behind a lot, each in its own window.
//
// Read-only on purpose. Editing lives on the tabs that own these records, and
// a second editor for the same row is how two screens come to disagree. These
// exist so a figure on the report can be traced to the paper it came from
// without leaving the report.
//
// Both windows take a lot NUMBER rather than an id: the report row has one,
// and the list endpoints already search on it.

const exactLot = (rows, lotNumber, key) =>
  (rows || []).filter((r) => String(r[key] || "").trim() === String(lotNumber).trim());

// A value where the sheet has an input. Matches sheetInputProps rather than
// inventing a second look: 16px on touch, and the same 44px minimum, so the
// read-only sheet lines up row for row with the editable one.
const SheetText = ({ children }) => (
  <Flex
    align="center" px={2}
    minH={{ base: "44px", md: "32px" }}
    fontSize={{ base: "16px", md: "sm" }}
    textTransform="uppercase"
  >
    {children === null || children === undefined || children === ""
      ? <Text as="span" color="gray.400">—</Text>
      : children}
  </Flex>
);

// The sheet's own checkbox rows, ticked or not.
const SheetCheck = ({ on }) => (
  <Flex align="center" px={2} minH={{ base: "44px", md: "32px" }}>
    {on
      ? <CheckIcon color="green.600" boxSize={3} />
      : <CloseIcon color="gray.400" boxSize={2} />}
  </Flex>
);

// The registration form's own grid, from the tab that owns it.
const SHEET = {
  templateColumns: { base: "1fr", md: "1fr 2fr 1fr 2fr" },
  gap: "1px",
  bg: "gray.200",
  border: "1px solid",
  borderColor: "gray.200",
};

// Shared shell: both windows load one lot, and both can come back empty.
const LotWindow = ({
  isOpen, onClose, title, lotNumber, zIndex, loading, error, empty, footer, children,
}) => (
  <FloatingWindow
    isOpen={isOpen}
    onClose={onClose}
    title={`${title} — ${lotNumber || ""}`}
    width="62%"
    zIndex={zIndex}
    footer={footer}
  >
    <Box px={1} pb={2}>
      {loading && <Flex justify="center" py={8}><Spinner /></Flex>}
      {error && (
        <Alert status="error" borderRadius="md"><AlertIcon />{error}</Alert>
      )}
      {!loading && !error && empty}
      {!loading && !error && !empty && children}
    </Box>
  </FloatingWindow>
);

export const LotFormWindow = ({ lotNumber, isOpen, onClose, zIndex = 1400 }) => {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (lot) => {
    setLoading(true);
    setError("");
    setForm(null);
    try {
      const { data } = await axiosInstance.get("/noblesse-registration-forms", {
        params: { q: lot },
      });
      // The search is a LIKE, so N26253-0 would also bring back N26253-06.
      setForm(exactLot(data, lot, "lotNumber")[0] || null);
    } catch (e) {
      setError(e?.response?.data?.error || "Could not load the registration form.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && lotNumber) load(lotNumber);
  }, [isOpen, lotNumber, load]);

  // The printer the Registration Forms tab uses, given the same object — so a
  // form printed from here is the same paper as one printed from there.
  const printFooter = form ? (
    <Flex justify="flex-end" width="100%">
      <Button size="sm" variant="outline" onClick={() => printRegistrationForm(form)}>
        Print
      </Button>
    </Flex>
  ) : null;

  return (
    <LotWindow
      isOpen={isOpen} onClose={onClose} title="Registration form"
      lotNumber={lotNumber} zIndex={zIndex}
      loading={loading} error={error}
      empty={!form && (
        <Text fontSize="sm" color="gray.600">
          No registration form for this lot. That is what the
          {" "}<b>Weighed, not registered</b> notice is about.
        </Text>
      )}
      footer={printFooter}
    >
      {form && (
        <>
          <Flex align="center" justify="space-between" gap={2} mb={2} wrap="wrap">
            <Flex align="center" gap={2} wrap="wrap">
              <Text fontSize="lg" fontWeight="700" color="blue.700">
                {form.lotNumber}
              </Text>
              <Badge colorScheme={form.status === "completed" ? "green" : "yellow"}>
                {form.status === "completed" ? "completed" : "in progress"}
              </Badge>
            </Flex>
            <Text fontSize="sm" fontWeight="bold" color="blue.700">
              Date: {form.formDate || "—"}
            </Text>
          </Flex>

          {/* The same sheet the Registration Forms tab draws, with the values
              in place of its inputs — same grid, same sections, same order. */}
          <Grid {...SHEET} mb={3}>
            <SectionBar>Logistics &amp; Vendor</SectionBar>
            <SheetField label="Date Received"><SheetText>{form.dateReceived}</SheetText></SheetField>
            <SheetField label="Time Received"><SheetText>{form.timeReceived}</SheetText></SheetField>
            <SheetField label="Vendor Lot/(IC)#"><SheetText>{form.vendorLot}</SheetText></SheetField>
            <SheetField label="Vendor"><SheetText>{form.vendor}</SheetText></SheetField>

            <SectionBar>Product Identification</SectionBar>
            <SheetField label="Product Description" full>
              <SheetText>{form.productDescription}</SheetText>
            </SheetField>
            <SheetField label="Processing Type" full>
              <SheetText>{form.processingType}</SheetText>
            </SheetField>
            <SheetField label="Original Wt. (lbs)">
              <SheetText>
                {form.originalWeight != null ? fmtWeight(form.originalWeight) : null}
              </SheetText>
            </SheetField>
            <SheetField label="Total Quantity (c/s)">
              <SheetText>{form.totalQuantity}</SheetText>
            </SheetField>
            <SheetField label="Spec."><SheetText>{form.spec}</SheetText></SheetField>
            <SheetField label="Brand"><SheetText>{form.brand}</SheetText></SheetField>
            <SheetField label="EST#"><SheetText>{form.estNumber}</SheetText></SheetField>
            <SheetField label="Grade"><SheetText>{form.grade}</SheetText></SheetField>

            <SectionBar>Estimation/Checks</SectionBar>
            <SheetField label="Due Date?"><SheetText>{form.dueDate}</SheetText></SheetField>
            <SheetField label="Predicted Yield (%)">
              <SheetText>
                {form.predictedYield != null ? `${form.predictedYield}%` : null}
              </SheetText>
            </SheetField>
            <SheetField label="Manifest/BL Attached?" plain>
              <SheetCheck on={form.manifestBlAttached} />
            </SheetField>
            <SheetField label="Process Report Attached?" plain>
              <SheetCheck on={form.processReportAttached} />
            </SheetField>

            <SectionBar>Processing &amp; Yield</SectionBar>
            {/* The computed figure, not the retired hand-typed actual_yield.
                Unmeasured and 0% are different claims and stay different. */}
            <SheetField label="Yield">
              <SheetText>
                {form.yield?.measured && form.yield.percent != null
                  ? `${form.yield.percent.toFixed(1)}%${form.yield.basis === "registered" ? " (registered wt.)" : ""}`
                  : <Text as="span" color="gray.400" textTransform="none">not weighed out</Text>}
              </SheetText>
            </SheetField>
            <SheetField label="Weighed In / Out">
              <SheetText>
                {form.yield?.inLb
                  ? `${fmtWeight(form.yield.inLb)} / ${fmtWeight(form.yield.outLb)} lb`
                  : null}
              </SheetText>
            </SheetField>
            <SheetField label="Temp."><SheetText>{form.temp}</SheetText></SheetField>
            <SheetField label="Checked By"><SheetText>{form.checkedBy}</SheetText></SheetField>
            <SheetField label="Remarks" full><SheetText>{form.remarks}</SheetText></SheetField>
          </Grid>

          <Text fontSize="xs" color="gray.500">
            Read-only here. Edit it on the Registration Forms tab.
          </Text>
        </>
      )}
    </LotWindow>
  );
};

export const LotManifestWindow = ({ lotNumber, isOpen, onClose, zIndex = 1410 }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  // The boxes, per session, fetched on first expand and kept — the list row
  // carries totals but not the boxes themselves.
  const [details, setDetails] = useState({});
  const [expanded, setExpanded] = useState(null);
  const toast = useToast();

  const load = useCallback(async (lot) => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axiosInstance.get("/box-batches", { params: { q: lot } });
      setSessions(exactLot(data, lot, "lot_number"));
    } catch (e) {
      setError(e?.response?.data?.error || "Could not load the weighing sessions.");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && lotNumber) load(lotNumber);
  }, [isOpen, lotNumber, load]);

  // One fetch serves both looking and printing, so opening a session and then
  // printing it does not go back to the server twice.
  const boxesFor = async (batchId) => {
    if (details[batchId]) return details[batchId];
    try {
      const { data } = await axiosInstance.get(`/box-batches/${batchId}`);
      setDetails((prev) => ({ ...prev, [batchId]: data }));
      return data;
    } catch {
      toast({
        title: "Could not load that session",
        status: "error", duration: 3000, position: "top",
      });
      return null;
    }
  };

  const toggle = async (batchId) => {
    if (expanded === batchId) {
      setExpanded(null);
      return;
    }
    setExpanded(batchId);
    if (!details[batchId]) {
      setBusyId(batchId);
      await boxesFor(batchId);
      setBusyId(null);
    }
  };

  const print = async (batch) => {
    setBusyId(batch.batch_id);
    const data = await boxesFor(batch.batch_id);
    setBusyId(null);
    if (!data) return;
    printWeightManifest({
      lotNumber: data.lot_number,
      vendor: data.vendor,
      shipTo: data.ship_to,
      billOfLading: data.bill_of_lading,
      itemDescription: data.item_description,
      date: fmtDate(weighedDay(data)),
      scans: data.items,
      memo: data.remarks,
    });
  };

  const totalOf = (b) => (b.totals || []).find((t) => t.unit === "LB")?.total || "0";

  return (
    <LotWindow
      isOpen={isOpen} onClose={onClose} title="Weight manifests"
      lotNumber={lotNumber} zIndex={zIndex}
      loading={loading} error={error}
      empty={sessions.length === 0 && (
        <Text fontSize="sm" color="gray.600">
          No weighing session carries this lot.
        </Text>
      )}
    >
      <Box overflowX="auto">
        <Table size="sm" minWidth="640px">
          <Thead>
            <Tr>
              <Th width="1%" />
              <Th>Weighed</Th>
              <Th>Direction</Th>
              <Th isNumeric>Boxes</Th>
              <Th isNumeric>Total</Th>
              <Th>Status</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {sessions.map((b) => {
              const open = expanded === b.batch_id;
              const detail = details[b.batch_id];
              return (
                <React.Fragment key={b.batch_id}>
                  {/* Double-click anywhere on the row, or the chevron — the
                      chevron is what makes it findable. */}
                  <Tr
                    onDoubleClick={() => toggle(b.batch_id)}
                    cursor="pointer"
                    _hover={{ bg: "gray.50" }}
                    title="Double-click to see the boxes"
                  >
                    <Td>
                      <Button
                        size="xs" variant="ghost" px={1}
                        aria-label={open ? "Hide the boxes" : "Show the boxes"}
                        onClick={() => toggle(b.batch_id)}
                      >
                        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                      </Button>
                    </Td>
                    <Td whiteSpace="nowrap">{fmtDate(weighedDay(b))}</Td>
                    <Td>
                      <Badge colorScheme={b.direction === "outgoing" ? "teal" : "blue"}>
                        {b.direction}
                      </Badge>
                      {b.source === "imported" && (
                        <Badge ml={1} colorScheme="gray" fontSize="9px">tally</Badge>
                      )}
                    </Td>
                    <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}>{b.box_count}</Td>
                    <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}>
                      {fmtWeight(totalOf(b))} lb
                    </Td>
                    <Td>
                      <Badge colorScheme={b.status === "closed" ? "gray" : "yellow"}>
                        {b.status}
                      </Badge>
                    </Td>
                    <Td>
                      <Button
                        size="xs"
                        isLoading={busyId === b.batch_id}
                        onClick={() => print(b)}
                      >
                        Print
                      </Button>
                    </Td>
                  </Tr>
                  {open && (
                    <Tr>
                      <Td colSpan={7} bg="gray.50" px={2} py={2}>
                        {!detail && <Flex justify="center" py={4}><Spinner size="sm" /></Flex>}
                        {/* No edit handlers, so it renders read-only — the same
                            grid the scanner and the manifest tab draw. */}
                        {detail && <ScanSheet scans={detail.items || []} />}
                      </Td>
                    </Tr>
                  )}
                </React.Fragment>
              );
            })}
          </Tbody>
        </Table>
      </Box>
      <Text fontSize="xs" color="gray.500" mt={2}>
        Read-only here. Correct a box on the Weight Manifests tab.
      </Text>
    </LotWindow>
  );
};
