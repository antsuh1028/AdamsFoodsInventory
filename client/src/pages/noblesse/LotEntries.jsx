import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Flex, Text, Badge, Button, Spinner, Alert, AlertIcon,
  Table, Thead, Tbody, Tr, Th, Td, SimpleGrid, useToast,
} from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";
import printWeightManifest from "./printWeightManifest";
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

const Field = ({ label, children }) => (
  <Box>
    <Text fontSize="10px" color="gray.500" fontWeight="700" textTransform="uppercase">
      {label}
    </Text>
    <Text fontSize="sm">{children || <Text as="span" color="gray.400">—</Text>}</Text>
  </Box>
);

// Shared shell: both windows load one lot, and both can come back empty.
const LotWindow = ({ isOpen, onClose, title, lotNumber, zIndex, loading, error, empty, children }) => (
  <FloatingWindow
    isOpen={isOpen}
    onClose={onClose}
    title={`${title} — ${lotNumber || ""}`}
    width="62%"
    zIndex={zIndex}
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
    >
      {form && (
        <>
          <Flex align="center" gap={2} mb={3} wrap="wrap">
            <Text fontSize="lg" fontWeight="700">{form.lotNumber}</Text>
            <Badge colorScheme={form.status === "completed" ? "green" : "yellow"}>
              {form.status === "completed" ? "completed" : "in progress"}
            </Badge>
            {form.yield?.measured && form.yield.percent != null && (
              <Badge colorScheme="blue">{form.yield.percent.toFixed(1)}% yield</Badge>
            )}
          </Flex>

          <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3} mb={3}>
            <Field label="Vendor">{form.vendor}</Field>
            <Field label="Vendor lot">{form.vendorLot}</Field>
            <Field label="Received">{form.dateReceived}</Field>
            <Field label="Due">{form.dueDate}</Field>
            <Field label="Product">{form.productDescription}</Field>
            <Field label="Brand">{form.brand}</Field>
            <Field label="EST">{form.estNumber}</Field>
            <Field label="Grade">{form.grade}</Field>
            <Field label="Processing">{form.processingType}</Field>
            <Field label="Original weight">
              {form.originalWeight != null ? `${fmtWeight(form.originalWeight)} lb` : null}
            </Field>
            <Field label="Total quantity">{form.totalQuantity}</Field>
            <Field label="Predicted yield">
              {form.predictedYield != null ? `${form.predictedYield}%` : null}
            </Field>
          </SimpleGrid>

          {form.remarks && (
            <Box mb={2}>
              <Field label="Remarks">{form.remarks}</Field>
            </Box>
          )}
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

  // The list row carries totals but not the boxes, and the manifest prints the
  // boxes — so it is fetched at print time rather than for every row on open.
  const print = async (batch) => {
    setBusyId(batch.batch_id);
    try {
      const { data } = await axiosInstance.get(`/box-batches/${batch.batch_id}`);
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
    } catch {
      toast({
        title: "Could not load that session",
        status: "error", duration: 3000, position: "top",
      });
    } finally {
      setBusyId(null);
    }
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
              <Th>Weighed</Th>
              <Th>Direction</Th>
              <Th isNumeric>Boxes</Th>
              <Th isNumeric>Total</Th>
              <Th>Status</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {sessions.map((b) => (
              <Tr key={b.batch_id}>
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
            ))}
          </Tbody>
        </Table>
      </Box>
      <Text fontSize="xs" color="gray.500" mt={2}>
        Read-only here. Correct a box on the Weight Manifests tab.
      </Text>
    </LotWindow>
  );
};
