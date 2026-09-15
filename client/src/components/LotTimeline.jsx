import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Flex, Text, Badge, Spinner, Alert, AlertIcon, Divider, Button, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../utils/axiosInstance";
import getRole from "../utils/getRole";
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
  received:           { label: "Received",       color: "blue" },
  registered:         { label: "Registered",     color: "gray" },
  processing:         { label: "Processing",     color: "yellow" },
  processing_done:    { label: "Processed",      color: "teal" },
  processed:          { label: "Re-stocked",     color: "teal" },
  report_filed:       { label: "Report filed",   color: "yellow" },
  report_rejected:    { label: "Rejected",       color: "red" },
  shipped:            { label: "Shipped",        color: "green" },
  shipment_draft:     { label: "On a load",      color: "gray" },
  shipment_cancelled: { label: "Load cancelled", color: "red" },
};

// A departure is not an arrival, and they rendered identically before the
// timeline carried a direction.
const kindOf = (e) => {
  if (e.kind === "weighed") {
    return e.direction === "outgoing"
      ? { label: "Weighed out", color: "green" }
      : { label: "Weighed in", color: "blue" };
  }
  return KIND[e.kind] || { label: e.kind, color: "gray" };
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

// The yield, stated as a claim rather than a number. A lot nothing has left
// yet reads "not measured", never 0%.
const YieldLine = ({ y }) => {
  if (!y) return null;
  if (!y.measured) {
    return (
      <Flex gap={2} align="baseline" wrap="wrap">
        <Badge colorScheme="gray">Yield not measured</Badge>
        <Text fontSize="sm" color="gray.600">
          {y.inLb
            ? `${y.inLb} lb came in. Nothing has been weighed out of this lot yet.`
            : "Nothing has been weighed on either side of this lot."}
        </Text>
      </Flex>
    );
  }
  if (y.percent == null) {
    return (
      <Flex gap={2} align="baseline" wrap="wrap">
        <Badge colorScheme="gray">Yield not measured</Badge>
        <Text fontSize="sm" color="gray.600">
          {y.outLb} lb weighed out, but nothing recorded coming in to divide it by.
        </Text>
      </Flex>
    );
  }
  return (
    <Flex gap={3} align="baseline" wrap="wrap">
      <Text fontSize="2xl" fontWeight="bold" color="green.700"
        style={{ fontVariantNumeric: "tabular-nums" }}>
        {y.percent.toFixed(1)}%
      </Text>
      <Text fontSize="sm" color="gray.700" style={{ fontVariantNumeric: "tabular-nums" }}>
        {y.outLb} out of {y.inLb} lb · {y.unaccountedLb} unaccounted
      </Text>
      {/* A yield on a typed Original Weight is not the same claim as one on
          bench weights, so it never passes for one. */}
      {y.basis === "registered" && (
        <Badge colorScheme="yellow" fontSize="9px">
          against the form&apos;s original weight, not bench weights
        </Badge>
      )}
    </Flex>
  );
};

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
  const isAdmin = getRole() === "admin";
  const toast = useToast();
  const [data, setData] = useState(null);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

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

  // Closing states a result, so the server's refusal is shown in full — it
  // names the draft load still holding the lot.
  const lifecycle = async (action) => {
    setBusy(true);
    try {
      await axiosInstance.post(`/lots/${lotId}/${action}`);
      await load();
      toast({ title: action === "close" ? "Lot closed" : "Lot reopened",
        status: "success", duration: 3000, position: "top" });
    } catch (err) {
      toast({ title: `Could not ${action} this lot`,
        description: err.response?.data?.error || err.message,
        status: "error", duration: 9000, position: "top", isClosable: true });
    } finally { setBusy(false); }
  };

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
            {data.lot.status === "closed" && <Badge colorScheme="gray">Closed</Badge>}
            <Text fontSize="sm" color="gray.500">{data.lot.lotDate}</Text>
            {data.lot.notes && <Text fontSize="sm" color="gray.500">· {data.lot.notes}</Text>}
          </Flex>

          {/* Raw, processed and committed are kept apart rather than added into
              one number: a lot can be partly each, and a single total would
              hide exactly the distinction someone is checking. */}
          <Flex gap={6} wrap="wrap" px={3} py={3} bg="gray.50" borderRadius="md"
            border="1px solid" borderColor="gray.200" mb={4}>
            <Figure label="Weighed in" value={lb(f.weighedIn)} strong />
            <Figure label="Boxes in" value={f.boxesIn || null} unit="" />
            <Divider orientation="vertical" height="40px" />
            <Figure label="Weighed out" value={lb(f.weighedOut)} strong />
            <Figure label="Boxes out" value={f.boxesOut || null} unit="" />
            <Divider orientation="vertical" height="40px" />
            <Figure label="Raw on hand" value={lb(f.rawOnHand)} />
            <Figure label="In processing" value={lb(f.inProcessing)} />
            <Figure label="Processed" value={lb(f.processedOnHand)} />
            {f.processedCases > 0 && <Figure label="Cases out" value={f.processedCases} unit="" />}
          </Flex>

          <Box px={3} py={3} bg="green.50" borderRadius="md" border="1px solid"
            borderColor="green.200" mb={4}>
            <Text fontSize="xs" color="gray.500" textTransform="uppercase"
              letterSpacing="wide" mb={1}>
              Yield
            </Text>
            <YieldLine y={data.yield} />
            {/* The figures as they stood at close, shown beside the live ones
                rather than instead of them: a correction made afterwards moves
                one and not the other, and that difference is worth seeing. */}
            {data.lot.status === "closed" && (
              <Text fontSize="xs" color="gray.600" mt={2}>
                Closed{data.lot.closedBy ? ` by ${data.lot.closedBy}` : ""}
                {data.lot.closedAt ? ` on ${String(data.lot.closedAt).slice(0, 10)}` : ""}
                {data.lot.closedYield != null
                  ? ` — frozen at ${data.lot.closedYield.toFixed(1)}% `
                    + `(${lb(data.lot.closedOutLb)} out of ${lb(data.lot.closedInLb)} lb)`
                  : " — no yield was measured"}
              </Text>
            )}
          </Box>

          {/* Offered, never applied. The app cannot tell "finished, with a 28%
              loss" from "more going out tomorrow". */}
          {data.closeSuggestion && (
            <Alert status="warning" borderRadius="md" mb={4} alignItems="flex-start">
              <AlertIcon />
              <Box flex="1">
                <Text fontSize="sm" fontWeight="bold">
                  Nothing has left this lot in {data.closeSuggestion.idleDays} days.
                </Text>
                <Text fontSize="sm" mt={1} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {lb(data.closeSuggestion.inLb)} lb in, {lb(data.closeSuggestion.outLb)} lb
                  out, {lb(data.closeSuggestion.unaccountedLb)} unaccounted
                  {data.closeSuggestion.percent != null
                    && ` (${(100 - data.closeSuggestion.percent).toFixed(1)}%)`}.
                </Text>
                <Button size="sm" colorScheme="blue" mt={3} isLoading={busy}
                  onClick={() => lifecycle("close")}>
                  Close lot
                </Button>
              </Box>
            </Alert>
          )}

          {/* Always available, not only when prompted — a lot can plainly be
              finished before the idle window is up. */}
          <Flex gap={2} mb={4} wrap="wrap">
            {data.lot.status !== "closed" && !data.closeSuggestion && (
              <Button size="sm" variant="outline" isLoading={busy}
                onClick={() => lifecycle("close")}>
                Close lot
              </Button>
            )}
            {data.lot.status === "closed" && isAdmin && (
              <Button size="sm" variant="ghost" isLoading={busy}
                onClick={() => lifecycle("reopen")}>
                Reopen lot
              </Button>
            )}
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
                const k = kindOf(e);
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
