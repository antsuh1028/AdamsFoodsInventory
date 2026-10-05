import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Flex, Text, Badge, Button, Spinner, Alert, AlertIcon,
  Table, Thead, Tbody, Tr, Th, Td, useToast,
} from "@chakra-ui/react";
import { ChevronDownIcon, ChevronRightIcon } from "@chakra-ui/icons";
import FloatingWindow from "../../components/FloatingWindow";
import ScanSheet from "../../components/navbar/ScanSheet";
import axiosInstance from "../../utils/axiosInstance";
import printWeightManifest from "./printWeightManifest";
import { RegistrationFormModal, formToDraft } from "./RegistrationFormTab";
import { fmtDate, fmtWeight, weighedDay } from "./shared";

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

  // The Registration Forms tab's own sheet, read-only, so the two cannot differ.
  if (form && !loading) {
    return (
      <RegistrationFormModal readOnly isOpen={isOpen} onClose={onClose}
        draft={formToDraft(form)} setDraft={() => {}} zIndex={zIndex} />
    );
  }

  return (
    <LotWindow
      isOpen={isOpen} onClose={onClose} title="Registration form"
      lotNumber={lotNumber} zIndex={zIndex}
      loading={loading} error={error}
      empty={(
        <Text fontSize="sm" color="gray.600">
          No registration form for this lot. That is what the
          {" "}<b>Weighed, not registered</b> notice is about.
        </Text>
      )}
    />
  );
};

// With `batchId`, one chosen session, already opened to its boxes.
export const LotManifestWindow = ({ lotNumber, batchId = null, isOpen, onClose, zIndex = 1410 }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  // The boxes, per session, fetched on first expand and kept — the list row
  // carries totals but not the boxes themselves.
  const [details, setDetails] = useState({});
  const [expanded, setExpanded] = useState(null);
  const toast = useToast();

  const load = useCallback(async (lot, only) => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axiosInstance.get("/box-batches", { params: { q: lot } });
      const rows = exactLot(data, lot, "lot_number");
      setSessions(only ? rows.filter((b) => b.batch_id === only) : rows);
      if (only) {
        setExpanded(only);
        const { data: full } = await axiosInstance.get(`/box-batches/${only}`);
        setDetails((prev) => ({ ...prev, [only]: full }));
      }
    } catch (e) {
      setError(e?.response?.data?.error || "Could not load the weighing sessions.");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && lotNumber) load(lotNumber, batchId);
  }, [isOpen, lotNumber, batchId, load]);

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
      isOpen={isOpen} onClose={onClose} title={batchId ? "Weight manifest" : "Weight manifests"}
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
