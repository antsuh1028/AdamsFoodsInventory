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
//
// The indicator streams about twice a second whether or not anything is
// happening, so the work is deciding which reading IS a box. That decision
// lives in createCaptureMachine (scaleCapture.js) and nowhere else — this
// component feeds it lines and renders what it says.
//
//   EMPTY     nothing on the platform
//   SETTLING  a box is on it and still moving
//   DONE      captured; will not capture again until the platform clears
//
// The trap worth naming: AN EMPTY SCALE IS ALSO STABLE. Recording on "stable"
// alone would record a stream of zeros forever. The machine requires a weight
// above EMPTY_BELOW *and* the same figure held for HOLD_READINGS, and requires
// the platform to clear before it will arm again.
//
// The port is read-only. BarTender owns COM1 and polls the scale; we listen on
// COM2 to the replies. Nothing here can disturb it.

// How long the confirmation stays up. Long enough to be seen over a shoulder,
// short enough to be gone before the next box lands.
const FLASH_MS = 2500;

const StateLine = ({ state, weight, queried }) => {
  // Queried outranks the machine's own state. The machine says DONE — it did
  // capture — but nothing has been recorded, and a green "Recorded" over a box
  // that is still a question is the one thing this panel must never say.
  if (queried) {
    return <Text fontSize="lg" color="yellow.700" fontWeight="600">Held — answer below</Text>;
  }
  if (state === "DONE") {
    return <Text fontSize="lg" color="green.700" fontWeight="600">Recorded — take the box off</Text>;
  }
  if (state === "SETTLING") {
    return <Text fontSize="lg" color="yellow.700" fontWeight="600">Settling…</Text>;
  }
  return (
    <Text fontSize="lg" color="gray.500" fontWeight="600">
      {weight > 0 ? "Settling…" : "Place a box on the scale"}
    </Text>
  );
};

const ScaleWeigh = ({
  onAdd, weights = [], expected = null, disabled = false,
  lotNumber = null, itemDescription = null,
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

  // The capture callback runs inside the serial read loop, which is started
  // once and closes over whatever these were at that moment. Refs keep it
  // reading the CURRENT session instead of an empty list from mount.
  const weightsRef = useRef(weights);
  weightsRef.current = weights;
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  const queriedRef = useRef(null);
  queriedRef.current = queried;

  // onAdd beeps and toasts for itself; what it returns is whether the box
  // actually landed. The confirmation below is only ever shown for a TRUE —
  // a green "recorded" over a box the server refused is worse than silence,
  // because the operator walks away believing the manifest has it.
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
    // A capture waiting on an answer FREEZES the feed. Not a nicety: keep
    // reading and the next box settles, captures, and records AHEAD of the one
    // still being asked about — and then answering "record it" files it out of
    // order. Frozen, the readout stays on the weight in question and nothing
    // can be recorded or lost while the operator looks up.
    //
    // Note what deliberately does NOT happen when they answer: the machine is
    // not reset. It is in DONE, and DONE only clears when the platform does, so
    // the box still sitting on the scale cannot be captured a second time.
    if (queriedRef.current) return;

    // assumeUnit because this indicator prints a bare number with no unit. The
    // station is set to pounds; a line that DOES carry a unit still wins, so a
    // switch to kg shows up rather than being silently relabelled.
    const reading = parseScaleLine(raw, { assumeUnit: "LB" });
    const result = machineRef.current.feed(reading);

    if (result.weight != null) setLive(result.weight);
    setState(result.state);
    if (!result.captured) return;

    // Both guards are advisory and both stop the box at the gate rather than
    // recording and apologising: an unwanted row is far harder to notice later
    // than a question now.
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

  const connect = async () => {
    setError(null);
    setConnecting(true);
    try {
      machineRef.current.reset();
      handleRef.current = await connectScale({
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
          <Text fontWeight="600" fontSize="sm">This browser cannot read the scale.</Text>
          <Text fontSize="xs" color="gray.700">
            Web Serial is Chrome or Edge on the desktop. Type the weights instead.
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
          Weighing out of lot
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
          <Button colorScheme="blue" onClick={connect} isLoading={connecting} isDisabled={disabled}>
            Connect scale
          </Button>
        ) : (
          <>
            <Badge colorScheme="green" borderRadius="full" px={2}>connected</Badge>
            <Button size="xs" variant="ghost" onClick={disconnect}>Disconnect</Button>
          </>
        )}
        <Box flex={1} />
        <Text fontSize="xs" color="gray.500">
          Reads the scale. BarTender keeps its own connection.
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
          On the scale
        </Text>
        <Flex align="baseline" justify="center" gap={3}>
          <Text fontSize="7xl" fontWeight="bold" lineHeight="1"
            color={queried ? "yellow.800" : captured ? "green.700" : "gray.800"}
            style={{ fontVariantNumeric: "tabular-nums" }}>
            {live.toFixed(2)}
          </Text>
          <Text fontSize="2xl" color="gray.500">lb</Text>
        </Flex>
        <Box mt={2}><StateLine state={state} weight={live} queried={queried} /></Box>
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
                Box {count} recorded
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
                ? "Nothing recorded yet."
                : `Last recorded: ${weights[weights.length - 1]} lb`}
            </Text>
          </Flex>
        )}
      </Box>

      {expected ? (
        <Box mt={3}>
          <Flex justify="space-between" align="baseline" mb={1}>
            <Text fontSize="sm" fontWeight="600" color="gray.700">
              Box {count} of {expected}
            </Text>
            <Text fontSize="xs" color={remaining === 0 ? "green.700" : "gray.500"}>
              {remaining === 0 ? "all expected boxes weighed" : `${remaining} to go`}
            </Text>
          </Flex>
          <Progress value={Math.min(100, (count / expected) * 100)} size="sm"
            colorScheme={count > expected ? "yellow" : "blue"} borderRadius="full" />
        </Box>
      ) : (
        <Text fontSize="sm" color="gray.600" mt={3}>
          {count} box{count === 1 ? "" : "es"} recorded
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
            <Text fontSize="md" color="gray.600">lb — not recorded yet</Text>
          </Flex>

          {queried.kind === "reweigh" ? (
            <Text fontSize="sm" color="gray.800">
              Exactly the same as the box before. That usually means the{" "}
              <b>same box came back</b> — a torn label, or a re-weigh to reprint one.
              Recording it again would count one box as two.
            </Text>
          ) : (
            <Text fontSize="sm" color="gray.800">
              About <b>{Math.round(queried.ratio > 1 ? queried.ratio : 1 / queried.ratio)}×</b>{" "}
              {queried.direction === "high" ? "heavier" : "lighter"} than the rest of this lot,
              which is running around <b>{queried.median.toFixed(2)} lb</b> a box.
            </Text>
          )}

          <Flex gap={2} mt={3}>
            <Button size="sm" variant="outline"
              onClick={() => setQueried(null)}>
              {queried.kind === "reweigh" ? "Same box — skip it" : "Skip it"}
            </Button>
            <Button size="sm" colorScheme="yellow"
              onClick={() => { const w = queried.weight; setQueried(null); record(w); }}>
              Record {queried.weight} lb
            </Button>
          </Flex>
        </Box>
      )}
    </Box>
  );
};

export default ScaleWeigh;
