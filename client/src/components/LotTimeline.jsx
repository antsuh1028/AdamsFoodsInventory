import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Flex, Text, Badge, Spinner, Alert, AlertIcon, Divider, Button,
  IconButton, useToast,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon } from "@chakra-ui/icons";
import axiosInstance from "../utils/axiosInstance";
import getRole from "../utils/getRole";
import { toDisplay } from "../utils/weight";
import { translator } from "../utils/i18n";
import FloatingWindow from "./FloatingWindow";

// A prop rather than the shared language: Outgoing passes its own, and the
// Registration Forms tab, which opens this same window, stays English.
const ENGLISH = translator("en");

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
const YieldLine = ({ y, t }) => {
  if (!y) return null;
  if (!y.measured) {
    return (
      <Flex gap={2} align="baseline" wrap="wrap">
        <Badge colorScheme="gray">{t("Yield not measured")}</Badge>
        <Text fontSize="sm" color="gray.600">
          {y.inLb
            ? t("{in} lb came in. Nothing has been weighed out of this lot yet.", { in: y.inLb })
            : t("Nothing has been weighed on either side of this lot.")}
        </Text>
      </Flex>
    );
  }
  if (y.percent == null) {
    return (
      <Flex gap={2} align="baseline" wrap="wrap">
        <Badge colorScheme="gray">{t("Yield not measured")}</Badge>
        <Text fontSize="sm" color="gray.600">
          {t("{out} lb weighed out, but nothing recorded coming in to divide it by.", { out: y.outLb })}
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
        {t("{out} out of {in} lb · {unaccounted} unaccounted",
          { out: y.outLb, in: y.inLb, unaccounted: y.unaccountedLb })}
      </Text>
      {/* A yield on a typed Original Weight is not the same claim as one on
          bench weights, so it never passes for one. */}
      {y.basis === "registered" && (
        <Badge colorScheme="yellow" fontSize="9px">
          {t("against the form's original weight, not bench weights")}
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

// `onStep` lets the caller move to the lot either side without closing this
// window. It takes -1 or +1 and is given the list's own ordering, so "next"
// means next in what the person is looking at rather than next by id.
// Omitted, no arrows render — a caller with no list is unaffected.
const LotTimeline = ({
  lotId, lotNumber, isOpen, onClose, t = ENGLISH,
  onStep = null, stepPosition = null,
}) => {
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
      toast({ title: action === "close" ? t("Lot closed") : t("Lot reopened"),
        status: "success", duration: 3000, position: "top" });
    } catch (err) {
      toast({ title: action === "close"
        ? t("Could not close this lot") : t("Could not reopen this lot"),
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
      title={t("Lot {lot}", { lot: lotNumber || lotId || "" })}
      width={720}
      placement="right"
      headerActions={onStep ? (
        <Flex align="center" gap={1}>
          <IconButton
            aria-label={t("Previous lot")} title={t("Previous lot")}
            icon={<ChevronLeftIcon />} size="xs"
            isDisabled={!stepPosition || stepPosition.index <= 0}
            onClick={() => onStep(-1)}
          />
          {stepPosition && (
            <Text fontSize="xs" color="gray.600" whiteSpace="nowrap" px={1}>
              {stepPosition.index + 1} / {stepPosition.total}
            </Text>
          )}
          <IconButton
            aria-label={t("Next lot")} title={t("Next lot")}
            icon={<ChevronRightIcon />} size="xs"
            isDisabled={!stepPosition || stepPosition.index >= stepPosition.total - 1}
            onClick={() => onStep(1)}
          />
        </Flex>
      ) : null}
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
            {status && <Badge colorScheme={status.color}>{t(status.label)}</Badge>}
            {data.lot.status === "closed" && (
              <Badge colorScheme="gray">{t("Closed", { _as: "lot" })}</Badge>
            )}
            <Text fontSize="sm" color="gray.500">{data.lot.lotDate}</Text>
            {data.lot.notes && <Text fontSize="sm" color="gray.500">· {data.lot.notes}</Text>}
          </Flex>

          {/* Raw, processed and committed are kept apart rather than added into
              one number: a lot can be partly each, and a single total would
              hide exactly the distinction someone is checking. */}
          <Flex gap={6} wrap="wrap" px={3} py={3} bg="gray.50" borderRadius="md"
            border="1px solid" borderColor="gray.200" mb={4}>
            <Figure label={t("Weighed in")} value={lb(f.weighedIn)} strong />
            <Figure label={t("Boxes in")} value={f.boxesIn || null} unit="" />
            <Divider orientation="vertical" height="40px" />
            <Figure label={t("Weighed out")} value={lb(f.weighedOut)} strong />
            <Figure label={t("Boxes out")} value={f.boxesOut || null} unit="" />
            <Divider orientation="vertical" height="40px" />
            <Figure label={t("Raw on hand")} value={lb(f.rawOnHand)} />
            <Figure label={t("In processing")} value={lb(f.inProcessing)} />
            <Figure label={t("Processed")} value={lb(f.processedOnHand)} />
            {f.processedCases > 0 && (
              <Figure label={t("Cases out")} value={f.processedCases} unit="" />
            )}
          </Flex>

          <Box px={3} py={3} bg="green.50" borderRadius="md" border="1px solid"
            borderColor="green.200" mb={4}>
            <Text fontSize="xs" color="gray.500" textTransform="uppercase"
              letterSpacing="wide" mb={1}>
              {t("Yield")}
            </Text>
            <YieldLine y={data.yield} t={t} />
            {/* The figures as they stood at close, shown beside the live ones
                rather than instead of them: a correction made afterwards moves
                one and not the other, and that difference is worth seeing. */}
            {data.lot.status === "closed" && (
              <Text fontSize="xs" color="gray.600" mt={2}>
                {t("Closed", { _as: "lot" })}
                {data.lot.closedBy ? t(" by {who}", { who: data.lot.closedBy }) : ""}
                {data.lot.closedAt
                  ? t(" on {date}", { date: String(data.lot.closedAt).slice(0, 10) }) : ""}
                {data.lot.closedYield != null
                  ? t(" — frozen at {pct}% ({out} out of {in} lb)", {
                    pct: data.lot.closedYield.toFixed(1),
                    out: lb(data.lot.closedOutLb),
                    in: lb(data.lot.closedInLb),
                  })
                  : t(" — no yield was measured")}
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
                  {t("Nothing has left this lot in {n} days.", { n: data.closeSuggestion.idleDays })}
                </Text>
                <Text fontSize="sm" mt={1} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t("{in} lb in, {out} lb out, {unaccounted} unaccounted", {
                    in: lb(data.closeSuggestion.inLb),
                    out: lb(data.closeSuggestion.outLb),
                    unaccounted: lb(data.closeSuggestion.unaccountedLb),
                  })}
                  {data.closeSuggestion.percent != null
                    && ` (${(100 - data.closeSuggestion.percent).toFixed(1)}%)`}.
                </Text>
                <Button size="sm" colorScheme="blue" mt={3} isLoading={busy}
                  onClick={() => lifecycle("close")}>
                  {t("Close lot")}
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
                {t("Close lot")}
              </Button>
            )}
            {data.lot.status === "closed" && isAdmin && (
              <Button size="sm" variant="ghost" isLoading={busy}
                onClick={() => lifecycle("reopen")}>
                {t("Reopen lot")}
              </Button>
            )}
          </Flex>

          <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide" mb={2}>
            {t("History")}
          </Text>

          {events && events.length === 0 && (
            <Box p={4} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
              <Text fontSize="sm" color="gray.600">
                {t("Nothing has happened to this lot yet beyond being issued.")}
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
                      <Badge colorScheme={k.color} fontSize="9px">{t(k.label)}</Badge>
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
