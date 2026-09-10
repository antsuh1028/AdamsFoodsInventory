import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Flex, Text, Badge, Spinner, Alert, AlertIcon, Divider,
} from "@chakra-ui/react";
import axiosInstance from "../utils/axiosInstance";
import { toDisplay } from "../utils/weight";
import FloatingWindow from "./FloatingWindow";

// One lot's whole life, in one place.
//
// Before the registry this was five text searches across five tables and some
// guessing, because the lot number was free text in each of them and nothing
// guaranteed the copies agreed. Now it is a query.
//
// Everything shown is derived on the server rather than stored, so a correction
// made anywhere shows up here on the next open instead of going stale.

const KIND = {
  received:        { label: "Received",   color: "blue" },
  weighed:         { label: "Weighed",    color: "blue" },
  registered:      { label: "Registered", color: "gray" },
  processing:      { label: "Processing", color: "yellow" },
  processing_done: { label: "Processed",  color: "teal" },
  processed:       { label: "Re-stocked", color: "teal" },
};

const STATUS = {
  received:   { label: "Received",   color: "blue" },
  processing: { label: "Processing", color: "yellow" },
  processed:  { label: "Processed",  color: "teal" },
  shipped:    { label: "Shipped",    color: "green" },
};

// Weights arrive as decimal strings and stay that way; a float here would drift
// against the manifest this is meant to reconcile with.
const lb = (v) => (v === null || v === undefined || v === "" ? null : toDisplay(v));

const Figure = ({ label, value, unit = "lb", strong }) => (
  <Box>
    <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">{label}</Text>
    <Flex align="baseline" gap={1}>
      <Text
        fontSize={strong ? "2xl" : "lg"}
        fontWeight={strong ? "bold" : "600"}
        color={strong ? "blue.800" : "gray.800"}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value ?? "—"}
      </Text>
      {value != null && unit && <Text fontSize="xs" color="gray.500">{unit}</Text>}
    </Flex>
  </Box>
);

const LotTimeline = ({ lotId, lotNumber, isOpen, onClose }) => {
  const [data, setData] = useState(null);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!lotId) return;
    setError(null);
    setData(null);
    setEvents(null);
    try {
      const [detail, timeline] = await Promise.all([
        axiosInstance.get(`/lots/${lotId}`),
        axiosInstance.get(`/lots/${lotId}/timeline`),
      ]);
      setData(detail.data);
      setEvents(timeline.data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }, [lotId]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const f = data?.figures;
  const status = STATUS[data?.status] || null;

  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title={`Lot ${lotNumber || lotId || ""}`}
      width={720}
      placement="right"
    >
      {error && (
        <Alert status="error" borderRadius="md" fontSize="sm" mb={3}>
          <AlertIcon />{error}
        </Alert>
      )}

      {!data && !error && (
        <Flex justify="center" py={8}><Spinner size="md" color="blue.500" /></Flex>
      )}

      {data && (
        <>
          <Flex align="baseline" gap={3} wrap="wrap" mb={3}>
            <Text fontSize="xl" fontWeight="bold" color="blue.800">{data.lot.lotNumber}</Text>
            {status && <Badge colorScheme={status.color}>{status.label}</Badge>}
            <Text fontSize="sm" color="gray.500">{data.lot.lotDate}</Text>
            {data.lot.notes && <Text fontSize="sm" color="gray.500">· {data.lot.notes}</Text>}
          </Flex>

          {/* Raw, processed and committed are kept apart rather than added into
              one number: a lot can be partly each, and a single total would
              hide exactly the distinction someone is checking. */}
          <Flex gap={6} wrap="wrap" px={3} py={3} bg="gray.50" borderRadius="md"
            border="1px solid" borderColor="gray.200" mb={4}>
            <Figure label="Weighed" value={lb(f.weighed)} strong />
            <Figure label="Boxes" value={f.boxCount || null} unit="" />
            <Divider orientation="vertical" height="40px" />
            <Figure label="Raw on hand" value={lb(f.rawOnHand)} />
            <Figure label="In processing" value={lb(f.inProcessing)} />
            <Figure label="Processed" value={lb(f.processedOnHand)} />
            {f.processedCases > 0 && <Figure label="Cases out" value={f.processedCases} unit="" />}
          </Flex>

          <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide" mb={2}>
            History
          </Text>

          {events && events.length === 0 && (
            <Box p={4} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
              <Text fontSize="sm" color="gray.600">
                Nothing has happened to this lot yet beyond being issued.
              </Text>
            </Box>
          )}

          {events && events.length > 0 && (
            <Box borderLeft="2px solid" borderColor="gray.200" ml={2} pl={4}>
              {events.map((e, i) => {
                const k = KIND[e.kind] || { label: e.kind, color: "gray" };
                return (
                  <Box key={`${e.kind}-${e.ref}-${i}`} position="relative" pb={4}>
                    <Box
                      position="absolute" left="-21px" top="6px" w="10px" h="10px"
                      borderRadius="full" bg="white"
                      border="2px solid"
                      borderColor={`${k.color}.400`}
                    />
                    <Flex align="baseline" gap={2} wrap="wrap">
                      <Text fontSize="xs" color="gray.500" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {String(e.at).slice(0, 10)}
                      </Text>
                      <Badge colorScheme={k.color} fontSize="9px">{k.label}</Badge>
                      <Text fontSize="sm" fontWeight="600" color="gray.800">{e.label}</Text>
                    </Flex>
                    <Flex align="baseline" gap={3} wrap="wrap" mt={0.5}>
                      {lb(e.weight) && (
                        <Text fontSize="sm" color="gray.700" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {lb(e.weight)} lb
                        </Text>
                      )}
                      {e.cases != null && (
                        <Text fontSize="sm" color="gray.600">{e.cases} cs</Text>
                      )}
                      {e.detail && <Text fontSize="xs" color="gray.500">{e.detail}</Text>}
                    </Flex>
                  </Box>
                );
              })}
            </Box>
          )}
        </>
      )}
    </FloatingWindow>
  );
};

export default LotTimeline;
