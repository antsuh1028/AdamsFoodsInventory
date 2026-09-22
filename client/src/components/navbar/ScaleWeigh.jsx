import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Progress, Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import { isSupported, connectScale } from "../../utils/scaleSerial";
import { parseScaleLine } from "../../utils/scaleParse";
import { createCaptureMachine } from "../../utils/scaleCapture";
import { looksWrong, looksLikeReweigh } from "../../utils/typedWeight";
import { beepError } from "../../utils/scanFeedback";

// Weighing finished boxes off the bench scale, hands-free.

// How long the confirmation stays up. Long enough to be seen over a shoulder,
// short enough to be gone before the next box lands.
const FLASH_MS = 2500;

const StateLine = ({ state, weight, queried, t }) => {
  // Queried outranks the machine's own state.
  if (queried) {
    return <Text fontSize="lg" color="yellow.700" fontWeight="600">{t("Held — answer below")}</Text>;
  }
  if (state === "DONE") {
    return <Text fontSize="lg" color="green.700" fontWeight="600">{t("Recorded — take the box off")}</Text>;
  }
  if (state === "SETTLING") {
    return <Text fontSize="lg" color="yellow.700" fontWeight="600">{t("Settling…")}</Text>;
  }
  return (
    <Text fontSize="lg" color="gray.500" fontWeight="600">
      {weight > 0 ? t("Settling…") : t("Place a box on the scale")}
    </Text>
  );
};

const ScaleWeigh = ({
  onAdd, weights = [], expected = null, disabled = false,
  lotNumber = null, itemDescription = null,
  // Identity by default, so the untranslated incoming screen is unaffected.
  t = (text) => text,
}) => {
  const toast = useToast();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const [live, setLive] = useState(0);          // what the platform reads right now
  const [state, setState] = useState("EMPTY");
  const [flash, setFlash] = useState(null);     // the box just recorded
  const [queried, setQueried] = useState(null); // a capture held back for a question

  const handleRef = useRef(null);
  const machineRef = useRef(createCaptureMachine());
  const flashTimer = useRef(null);

  // The capture callback runs inside the serial read loop, which is started once
  // and closes over whatever these were at that moment.
  const weightsRef = useRef(weights);
  weightsRef.current = weights;
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  const queriedRef = useRef(null);
  queriedRef.current = queried;

  // onAdd beeps and toasts for itself; what it returns is whether the box actually
  // landed.
  const record = useCallback(async (weight) => {
    let ok = false;
    try {
      ok = await onAddRef.current(weight);
    } catch (err) {
      beepError();
      toast({
        status: "error", position: "top", duration: 6000, isClosable: true,
        title: "That box was not recorded", description: err.message,
      });
    }
    if (!ok) return;
    setFlash({ weight, at: Date.now() });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, [toast]);

  // One line off the wire. Parse it, hand it to the machine, act on the verdict.
  const onLine = useCallback((raw) => {
    // A capture waiting on an answer FREEZES the feed.
    if (queriedRef.current) return;

    // assumeUnit because this indicator prints a bare number with no unit.
    const reading = parseScaleLine(raw, { assumeUnit: "LB" });
    const result = machineRef.current.feed(reading);

    if (result.weight != null) setLive(result.weight);
    setState(result.state);
    if (!result.captured) return;

    // Advisory: stop the box at the gate rather than recording and apologising.
    const w = result.captured;
    const outlier = looksWrong(w, weightsRef.current);
    if (outlier.outlier) { beepError(); setQueried({ kind: "outlier", weight: w, ...outlier }); return; }

    const repeat = looksLikeReweigh(w, weightsRef.current);
    if (repeat.reweigh) { beepError(); setQueried({ kind: "reweigh", weight: w, ...repeat }); return; }

    record(w);
  }, [record]);

  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;

  const disconnect = useCallback(async () => {
    const h = handleRef.current;
    handleRef.current = null;
    if (h) await h.disconnect();
    setConnected(false);
  }, []);

  // `pick` forces the browser's port chooser — requestPort() only works from a
  // click, so this is wired to a button and never to an effect.
  const connect = async (pick = false) => {
    setError(null);
    setConnecting(true);
    try {
      machineRef.current.reset();
      handleRef.current = await connectScale({
        pick,
        // Through a ref so the loop always uses the current handler rather than
        // the one that existed when connect was pressed.
        onLine: (line) => onLineRef.current(line),
        onError: (err) => setError(err.message || String(err)),
        onDisconnect: () => setConnected(false),
      });
      setConnected(true);
    } catch (err) {
      setError(err && err.name === "NotFoundError" ? "No port chosen." : (err.message || String(err)));
    } finally {
      setConnecting(false);
    }
  };

  // Hand the port back on every exit path. A port still held by a closed panel
  // is what makes the next session say "access denied".
  useEffect(() => () => { clearTimeout(flashTimer.current); disconnect(); }, [disconnect]);
  useEffect(() => {
    const release = () => { handleRef.current?.disconnect?.(); };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, []);

  const count = weights.length;
  const remaining = expected ? Math.max(0, expected - count) : null;
  const captured = state === "DONE" && !queried;

  if (!isSupported()) {
    return (
      <Alert status="warning" borderRadius="md" alignItems="flex-start">
        <AlertIcon />
        <Box>
          <Text fontWeight="600" fontSize="sm">{t("This browser cannot read the scale.")}</Text>
          <Text fontSize="xs" color="gray.700">
            {t("Web Serial is Chrome or Edge on the desktop. Type the weights instead.")}
          </Text>
        </Box>
      </Alert>
    );
  }

  return (
    <Box>
      {/* WHICH LOT these boxes are coming out of, stated before anything else.
          Everything recorded here lands on that lot's manifest and feeds its
          yield, and a shift that weighs forty boxes onto the wrong lot has no
          way to tell afterwards which forty they were. */}
      <Box mb={3} px={3} py={2} bg="blue.50" borderRadius="md"
        borderLeft="4px solid" borderLeftColor="blue.400">
        <Text fontSize="xs" color="blue.900" textTransform="uppercase" letterSpacing="wide">
          {t("Weighing out of lot")}
        </Text>
        <Text fontSize="xl" fontWeight="bold" color="blue.900" lineHeight="1.2">
          {lotNumber || "—"}
        </Text>
        {itemDescription && (
          <Text fontSize="sm" color="gray.700">{itemDescription}</Text>
        )}
      </Box>

      <Flex align="center" gap={3} wrap="wrap" mb={3}>
        {!connected ? (
          <>
            <Button colorScheme="blue" onClick={() => connect(false)}
              isLoading={connecting} isDisabled={disabled}>
              {t("Connect scale")}
            </Button>
            {/* The way back from the wrong device: pick the port by hand. */}
            <Button size="xs" variant="outline" onClick={() => connect(true)}
              isDisabled={disabled || connecting}>
              {t("Choose port")}
            </Button>
          </>
        ) : (
          <>
            <Badge colorScheme="green" borderRadius="full" px={2}>{t("connected")}</Badge>
            <Button size="xs" variant="ghost" onClick={disconnect}>{t("Disconnect")}</Button>
            <Button size="xs" variant="outline"
              onClick={async () => { await disconnect(); connect(true); }}>
              {t("Choose port")}
            </Button>
          </>
        )}
        <Box flex={1} />
        <Text fontSize="xs" color="gray.500">
          {t("Reads the scale. BarTender keeps its own connection.")}
        </Text>
      </Flex>

      {error && (
        <Alert status="error" borderRadius="md" mb={3} fontSize="sm" py={2}>
          <AlertIcon />{error}
        </Alert>
      )}

      {/* The live platform reading, big enough to read from arm's length while
          holding a box. This is what is ON the scale, not what was recorded. */}
      <Box p={5} borderRadius="lg" textAlign="center"
        bg={queried ? "yellow.50" : captured ? "green.50" : "gray.50"}
        border="2px solid"
        borderColor={queried ? "yellow.300" : captured ? "green.300" : "gray.200"}
        transition="background-color 0.15s, border-color 0.15s">
        <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
          {t("On the scale")}
        </Text>
        <Flex align="baseline" justify="center" gap={3}>
          <Text fontSize="7xl" fontWeight="bold" lineHeight="1"
            color={queried ? "yellow.800" : captured ? "green.700" : "gray.800"}
            style={{ fontVariantNumeric: "tabular-nums" }}>
            {live.toFixed(2)}
          </Text>
          <Text fontSize="2xl" color="gray.500">lb</Text>
        </Flex>
        <Box mt={2}><StateLine state={state} weight={live} queried={queried} t={t} /></Box>
      </Box>

      {/* The confirmation. Separate from the live reading on purpose: the number
          above changes constantly, and the operator needs to see WHAT WAS
          BANKED without having to catch it as it goes past. */}
      <Box mt={3} minH="86px">
        {flash ? (
          <Flex align="center" gap={4} p={4} borderRadius="lg"
            bg="green.500" color="white">
            <Text fontSize="3xl">✓</Text>
            <Box>
              <Text fontSize="xs" textTransform="uppercase" letterSpacing="wide" opacity={0.9}>
                {t("Box {n} recorded", { n: count })}
              </Text>
              <Flex align="baseline" gap={2}>
                <Text fontSize="4xl" fontWeight="bold" lineHeight="1"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {flash.weight}
                </Text>
                <Text fontSize="lg" opacity={0.9}>lb</Text>
              </Flex>
            </Box>
          </Flex>
        ) : (
          <Flex align="center" gap={2} px={4} py={3} borderRadius="lg"
            bg="gray.50" border="1px dashed" borderColor="gray.200">
            <Text fontSize="sm" color="gray.500">
              {count === 0
                ? t("Nothing recorded yet.")
                : t("Last recorded: {weight} lb", { weight: weights[weights.length - 1] })}
            </Text>
          </Flex>
        )}
      </Box>

      {expected ? (
        <Box mt={3}>
          <Flex justify="space-between" align="baseline" mb={1}>
            <Text fontSize="sm" fontWeight="600" color="gray.700">
              {t("Box {n} of {total}", { n: count, total: expected })}
            </Text>
            <Text fontSize="xs" color={remaining === 0 ? "green.700" : "gray.500"}>
              {remaining === 0 ? t("all expected boxes weighed") : t("{n} to go", { n: remaining })}
            </Text>
          </Flex>
          <Progress value={Math.min(100, (count / expected) * 100)} size="sm"
            colorScheme={count > expected ? "yellow" : "blue"} borderRadius="full" />
        </Box>
      ) : (
        <Text fontSize="sm" color="gray.600" mt={3}>
          {t(count === 1 ? "{n} box recorded" : "{n} boxes recorded", { n: count })}
        </Text>
      )}

      {/* A capture held back for a question. Not a dialog: the operator's hands
          are on a box and a modal that steals focus is worse here than a panel
          they can answer when they look up. */}
      {queried && (
        <Box mt={3} p={4} borderRadius="lg" bg="yellow.50"
          border="2px solid" borderColor="yellow.300">
          <Flex align="baseline" gap={2} mb={2}>
            <Text fontSize="3xl" fontWeight="bold" color="yellow.800"
              style={{ fontVariantNumeric: "tabular-nums" }}>
              {queried.weight}
            </Text>
            <Text fontSize="md" color="gray.600">{t("lb — not recorded yet")}</Text>
          </Flex>

          {queried.kind === "reweigh" ? (
            <Text fontSize="sm" color="gray.800">
              {t("Exactly the same as the box before. That usually means the same box came back — a torn label, or a re-weigh to reprint one. Recording it again would count one box as two.")}
            </Text>
          ) : (
            <Text fontSize="sm" color="gray.800">
              {t("About {ratio}× {direction} than the rest of this lot, which is running around {median} lb a box.", {
                ratio: Math.round(queried.ratio > 1 ? queried.ratio : 1 / queried.ratio),
                direction: queried.direction === "high" ? t("heavier") : t("lighter"),
                median: queried.median.toFixed(2),
              })}
            </Text>
          )}

          <Flex gap={2} mt={3}>
            <Button size="sm" variant="outline"
              onClick={() => setQueried(null)}>
              {queried.kind === "reweigh" ? t("Same box — skip it") : t("Skip it")}
            </Button>
            <Button size="sm" colorScheme="yellow"
              onClick={() => { const w = queried.weight; setQueried(null); record(w); }}>
              {t("Record {weight} lb", { weight: queried.weight })}
            </Button>
          </Flex>
        </Box>
      )}
    </Box>
  );
};

export default ScaleWeigh;
