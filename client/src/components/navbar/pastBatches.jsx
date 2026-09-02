import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Spinner, Alert, AlertIcon, IconButton,
} from "@chakra-ui/react";
import { ArrowBackIcon } from "@chakra-ui/icons";
import FloatingWindow from "../FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";
import ScanSheet from "./ScanSheet";
import printWeightManifest from "../../pages/noblesse/printWeightManifest";
import { fmtDate } from "../../pages/noblesse/shared";

// Reads stored weighing sessions back. Without this the box data is
// write-only — scanned, saved, and unreachable outside the live session.
//
// Reuses ScanSheet so a stored batch looks exactly like it did while being
// scanned, and the same manifest can be reprinted from it.

const PastBatches = ({ isOpen, onClose }) => {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openBatch, setOpenBatch] = useState(null);
  const [loadingBatch, setLoadingBatch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axiosInstance.get("/box-batches");
      setBatches(data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Could not load batches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) { setOpenBatch(null); return; }
    load();
  }, [isOpen, load]);

  const openOne = async (batchId) => {
    setLoadingBatch(true);
    try {
      const { data } = await axiosInstance.get(`/box-batches/${batchId}`);
      setOpenBatch(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Could not load that batch");
    } finally {
      setLoadingBatch(false);
    }
  };

  const totalsText = (totals) =>
    Array.isArray(totals) && totals.length
      ? totals.map((t) => `${t.total} ${t.unit}`).join("  ·  ")
      : "—";

  const printOpen = () => {
    if (!openBatch) return;
    printWeightManifest({
      lotNumber: openBatch.lot_number,
      vendor: openBatch.vendor,
      shipTo: openBatch.ship_to,
      billOfLading: openBatch.bill_of_lading,
      itemDescription: openBatch.item_description,
      date: fmtDate(String(openBatch.created_at).slice(0, 10)),
      scans: openBatch.items,
    });
  };

  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title={openBatch ? `Batch ${openBatch.batch_id}${openBatch.lot_number ? " — " + openBatch.lot_number : ""}` : "Past Weighing Sessions"}
      width={1000}
      footer={
        <Flex gap={2} width="100%" justify="space-between" wrap="wrap">
          {openBatch ? (
            <Button size="sm" variant="outline" leftIcon={<ArrowBackIcon />}
              onClick={() => setOpenBatch(null)}>
              All sessions
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={load} isLoading={loading}>Refresh</Button>
          )}
          {openBatch && (
            <Button size="sm" colorScheme="blue" onClick={printOpen}
              isDisabled={!openBatch.items?.length}>
              Print manifest
            </Button>
          )}
        </Flex>
      }
    >
      {error && (
        <Alert status="error" borderRadius="md" mb={3} fontSize="sm">
          <AlertIcon />{error}
        </Alert>
      )}

      {loading || loadingBatch ? (
        <Flex justify="center" py={10}><Spinner color="blue.500" /></Flex>
      ) : openBatch ? (
        <Box>
          <Flex gap={4} wrap="wrap" mb={3} fontSize="sm" color="gray.600">
            <Text><strong>Lot:</strong> {openBatch.lot_number || "—"}</Text>
            <Text><strong>Opened:</strong> {new Date(openBatch.created_at).toLocaleString()}</Text>
            <Text><strong>Closed:</strong> {openBatch.closed_at ? new Date(openBatch.closed_at).toLocaleString() : "still open"}</Text>
          </Flex>
          <ScanSheet scans={openBatch.items} totals={[]} />
        </Box>
      ) : batches.length === 0 ? (
        <Text fontSize="sm" color="gray.400" py={6} textAlign="center">
          No weighing sessions recorded yet.
        </Text>
      ) : (
        <Box overflowX="auto">
          <Box as="table" width="100%" style={{ minWidth: "760px", borderCollapse: "collapse" }}>
            <Box as="thead">
              <Box as="tr">
                {["Lot", "Opened", "Boxes", "Total", "Status", ""].map((h, i) => (
                  <Box as="th" key={i} bg="gray.100" borderBottom="1px solid" borderColor="gray.300"
                    px={3} py={2} textAlign={i === 2 || i === 3 ? "right" : "left"}
                    fontSize="xs" fontWeight="bold" color="gray.600"
                    textTransform="uppercase" letterSpacing="wide">
                    {h}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box as="tbody">
              {batches.map((b, i) => (
                <Box as="tr" key={b.batch_id}
                  bg={i % 2 ? "gray.50" : "white"} _hover={{ bg: "blue.50" }}
                  cursor="pointer" onDoubleClick={() => openOne(b.batch_id)}>
                  <Box as="td" px={3} py={2} fontSize="sm" fontWeight="600" color="blue.700"
                    borderBottom="1px solid" borderColor="gray.100">
                    {b.lot_number || `Batch ${b.batch_id}`}
                  </Box>
                  <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
                    borderBottom="1px solid" borderColor="gray.100" whiteSpace="nowrap">
                    {new Date(b.created_at).toLocaleString()}
                  </Box>
                  <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
                    borderBottom="1px solid" borderColor="gray.100">
                    {b.box_count}
                  </Box>
                  <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
                    borderBottom="1px solid" borderColor="gray.100"
                    style={{ fontVariantNumeric: "tabular-nums" }} whiteSpace="nowrap">
                    {totalsText(b.totals)}
                  </Box>
                  <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100">
                    <Badge colorScheme={b.status === "closed" ? "green" : "orange"} fontSize="10px">
                      {b.status === "closed" ? "Closed" : "Open"}
                    </Badge>
                  </Box>
                  <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100" textAlign="right">
                    <IconButton aria-label="Open batch" size="xs" variant="ghost"
                      icon={<Text fontSize="sm">›</Text>}
                      onClick={() => openOne(b.batch_id)} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
          <Text fontSize="xs" color="gray.400" mt={2}>Double-click a session to see its boxes.</Text>
        </Box>
      )}
    </FloatingWindow>
  );
};

export default PastBatches;
