import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Input, Badge, Textarea, Alert, AlertIcon, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import FloatingWindow from "../FloatingWindow";
import LotPicker from "../LotPicker";
import useScanSession from "../../hooks/useScanSession";
import ScaleWeigh from "./ScaleWeigh";
import TypeWeights from "./TypeWeights";
import { primeAudio, beepSuccess, beepError } from "../../utils/scanFeedback";
import { isSupported as scaleSupported } from "../../utils/scaleSerial";
import { toDisplayHundredths, fromHundredths } from "../../utils/weight";

// Weighing finished boxes on their way out.

const WeighFinishedBoxes = ({
  isOpen, onClose, adoptBatchId = null,
  // Opened from a shipment line: the lot is already decided, so the start form
  // shows it rather than asking again.
  presetLot = null,
  // Told which session was closed, so the caller can tie it to a load.
  onSessionClosed = null,
}) => {
  const toast = useToast();
  const {
    ready, durable, session, pending, scans, lastError, resumable,
    start, stop, addScan, undoLast, resume, adoptSession,
  } = useScanSession();

  const [lot, setLot] = useState({ lotId: null, lotNumber: "" });
  const [expectedBoxes, setExpectedBoxes] = useState("");
  const [busy, setBusy] = useState(false);
  const [typeMode, setTypeMode] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [remarks, setRemarks] = useState("");
  const cancelStopRef = useRef(null);

  const supported = scaleSupported();

  useEffect(() => {
    if (!isOpen || !presetLot || session) return;
    setLot({ lotId: presetLot.lotId ?? null, lotNumber: presetLot.lotNumber || "" });
  }, [isOpen, presetLot, session]);

  // Opened on a session that is already running, so the lot is already known and
  // the start form is skipped entirely.
  const adoptedRef = useRef(null);
  useEffect(() => {
    if (!isOpen) { adoptedRef.current = null; return; }
    if (!adoptBatchId || !ready || session) return;
    if (adoptedRef.current === adoptBatchId) return;
    adoptedRef.current = adoptBatchId;
    (async () => {
      const result = await adoptSession(adoptBatchId);
      if (!result.adopted && result.reason === "pending-scans") {
        // Refused rather than destroying unsent work.
        toast({
          status: "warning", duration: 12000, isClosable: true, position: "top",
          title: "Another session on this device has unsent weights",
          description:
            `${result.pending} weight(s) here have not reached the server yet. Carry ` +
            `on with that session and let it send, then come back to this one.`,
        });
      }
    })();
  }, [isOpen, adoptBatchId, ready, session, adoptSession, toast]);

  // With no scale reachable there is nothing for the primary path to do, so the
  // fallback becomes the path rather than an option to find.
  useEffect(() => { if (!supported) setTypeMode(true); }, [supported]);

  // The lot so far.
  const live = useMemo(
    () => scans.filter((s) => s.status !== "voided" && s.status !== "duplicate"),
    [scans]
  );
  const weights = useMemo(() => live.map((s) => s.displayWeight || s.weight), [live]);
  // Round per box, THEN sum — the rule the rest of this codebase follows
  // (ScanSheet, printWeightManifest).
  const total = useMemo(
    () => fromHundredths(weights.reduce((sum, w) => sum + toDisplayHundredths(w), 0n)),
    [weights]
  );

  const onStart = async () => {
    setBusy(true);
    try {
      await primeAudio(); // audio needs a gesture before it will play
      await start({
        // The id, not the text.
        lotId: lot.lotId ?? null,
        lotNumber: lot.lotNumber.trim() || null,
        expectedBoxes: expectedBoxes.trim() || null,
        direction: "outgoing",
      });
    } catch (err) {
      toast({ title: "Could not start weighing", description: err.message,
        status: "error", position: "top", duration: 6000, isClosable: true });
    } finally { setBusy(false); }
  };

  // Returns whether the box actually landed.
  const onAdd = async (weight) => {
    try {
      await addScan({ weight, weightUnit: "LB", isManual: true });
      beepSuccess();
      return true;
    } catch (err) {
      beepError();
      toast({ title: "That box was not recorded", description: err.message,
        status: "error", position: "top", duration: 6000, isClosable: true });
      return false;
    }
  };

  const onStop = async () => {
    setBusy(true);
    // Read before stop() clears it — the caller needs the id to tie it.
    const closedId = session?.batchId ?? null;
    try {
      await stop(remarks.trim() || null);
      if (closedId != null && onSessionClosed) await onSessionClosed(closedId);
      setConfirmStop(false);
      setRemarks("");
      setLot({ lotId: null, lotNumber: "" });
      setExpectedBoxes("");
      onClose();
    } catch (err) {
      toast({ title: "Could not close", description: err.message,
        status: "error", position: "top" });
    } finally { setBusy(false); }
  };

  const count = live.length;

  return (
    <>
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title={session ? `Weighing out of ${session.lotNumber || "lot"}` : "Weigh finished boxes"}
      width={560}
      footer={
        <Flex gap={2} width="100%" justify="space-between" align="center" wrap="wrap">
          <Flex gap={2} align="center">
            {session && pending > 0 && (
              <Badge colorScheme="yellow">{pending} not yet sent</Badge>
            )}
            {session && pending === 0 && count > 0 && (
              <Badge colorScheme="green">all saved</Badge>
            )}
          </Flex>
          <Flex gap={2}>
            {session && (
              <Button size="md" variant="ghost" onClick={undoLast} isDisabled={count === 0}>
                Undo last
              </Button>
            )}
            {!session ? (
              <Button size="md" colorScheme="blue" onClick={onStart}
                isLoading={busy}
                // The lot is required: every box recorded lands on it.
                isDisabled={!ready || !lot.lotId || Boolean(resumable)}>
                Start weighing
              </Button>
            ) : (
              <Button size="md" colorScheme="red" onClick={() => setConfirmStop(true)}
                isLoading={busy}>
                Stop &amp; close
              </Button>
            )}
          </Flex>
        </Flex>
      }
    >
      <Box>
        {!durable && (
          <Alert status="warning" borderRadius="md" mb={3} fontSize="sm" py={2}>
            <AlertIcon />
            This browser will not keep weights through a refresh. Finish the lot in
            one go.
          </Alert>
        )}
        {lastError && (
          <Alert status="warning" borderRadius="md" mb={3} fontSize="sm" py={2}>
            <AlertIcon />
            {lastError} — weights are held on this device and will be sent when it
            reconnects.
          </Alert>
        )}

        {/* AN UNFINISHED SESSION BLOCKS STARTING A NEW ONE.
            start() calls clearSession() before it opens anything, so pressing
            Start here with a batch still unflushed would DESTROY scans the
            server has never seen — including an incoming session someone left
            running on this device. There is one IndexedDB session per browser,
            so this screen and the incoming bench share it.
            Nothing is discarded from here. Throwing away boxes belonging to a
            different bench is not a decision to offer on this screen; it is
            offered where that session lives. */}
        {!session && resumable ? (
          <Alert status="warning" borderRadius="md" alignItems="flex-start">
            <AlertIcon />
            <Box>
              <Text fontWeight="bold" fontSize="sm">
                An unfinished session is still on this device.
              </Text>
              <Text fontSize="sm" mt={1}>
                Batch {resumable.batchId} ({resumable.lotNumber || "no lot"}) has{" "}
                {resumable.pending} weight{resumable.pending === 1 ? "" : "s"} that never
                reached the server.
              </Text>
              {resumable.direction === "outgoing" ? (
                <Button size="sm" colorScheme="yellow" mt={3} isLoading={busy}
                  onClick={async () => {
                    setBusy(true);
                    try { await resume(); } finally { setBusy(false); }
                  }}>
                  Carry on with it
                </Button>
              ) : (
                <Text fontSize="xs" color="gray.700" mt={2}>
                  It is an <b>incoming</b> session. Finish or close it on the box
                  weighing screen first — starting here would throw its weights away.
                </Text>
              )}
            </Box>
          </Alert>
        ) : !session ? (
          // The start form is two fields.
          <Box>
            <Text fontSize="sm" color="gray.600" mb={4}>
              Pick the lot these finished boxes came out of. Everything else about
              the product is taken from the lot.
            </Text>

            {/* Opened from a load, so say where the weights are going to land. */}
            {presetLot && (
              <Alert status="info" borderRadius="md" mb={4} fontSize="sm" py={2}>
                <AlertIcon />
                These boxes go on the load for {presetLot.lotNumber}. The session is
                tied to it when you close.
              </Alert>
            )}

            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>
              Lot
            </Text>
            <LotPicker
              size="md"
              allowCreate
              value={lot.lotId}
              lotNumber={lot.lotNumber}
              onChange={(picked) => setLot({
                lotId: picked ? picked.lotId : null,
                lotNumber: picked ? picked.lotNumber : "",
              })}
            />

            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mt={4} mb={1}>
              Boxes expected <Text as="span" textTransform="none">(optional)</Text>
            </Text>
            <Input size="md" width="140px" value={expectedBoxes} placeholder="80"
              inputMode="numeric" autoComplete="off"
              onChange={(e) => setExpectedBoxes(e.target.value)} />
            {/* A prompt, never a limit — box N+1 is not refused, it just says so. */}
            <Text fontSize="xs" color="gray.500" mt={1}>
              Only used to show progress. Going over is not blocked.
            </Text>
          </Box>
        ) : (
          <Box>
            {supported && (
              <Flex justify="flex-end" mb={2}>
                {/* Typing is the fallback for a scale that is not connected.
                    Mutually exclusive with the scale because the same box would
                    otherwise be recordable twice, once by each. */}
                <Button size="xs" variant="ghost"
                  onClick={() => setTypeMode((v) => !v)}>
                  {typeMode ? "Use the scale" : "Type weights instead"}
                </Button>
              </Flex>
            )}

            {typeMode ? (
              <TypeWeights
                disabled={busy}
                expected={session.expectedBoxes ?? null}
                weights={weights}
                onAdd={onAdd}
                onUndo={undoLast}
              />
            ) : (
              <ScaleWeigh
                disabled={busy}
                lotNumber={session.lotNumber || null}
                itemDescription={session.itemDescription || null}
                expected={session.expectedBoxes ?? null}
                weights={weights}
                onAdd={onAdd}
              />
            )}

            {/* What has been recorded, newest first — the check an operator
                actually makes is "did the last one go on", and that answer
                should not require scrolling. */}
            <Box mt={4}>
              <Flex justify="space-between" align="baseline" mb={2}>
                <Text fontSize="xs" color="gray.500" textTransform="uppercase"
                  letterSpacing="wide">
                  Recorded
                </Text>
                <Text fontSize="sm" fontWeight="600" color="gray.700"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {count} box{count === 1 ? "" : "es"} · {total} lb
                </Text>
              </Flex>
              <Flex wrap="wrap" gap={2} maxH="150px" overflowY="auto"
                p={2} border="1px solid" borderColor="gray.200" borderRadius="md">
                {count === 0 ? (
                  <Text fontSize="sm" color="gray.400">Nothing yet.</Text>
                ) : (
                  live.slice().reverse().map((s, i) => (
                    <Badge key={s.localId ?? i}
                      colorScheme={i === 0 ? "green" : "gray"}
                      fontSize="sm" px={2} py={1} borderRadius="md"
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                      {s.displayWeight || s.weight}
                    </Badge>
                  ))
                )}
              </Flex>
            </Box>
          </Box>
        )}
      </Box>
    </FloatingWindow>

    <AlertDialog isOpen={confirmStop} leastDestructiveRef={cancelStopRef}
      onClose={() => setConfirmStop(false)} isCentered>
      <AlertDialogOverlay>
        <AlertDialogContent>
          <AlertDialogHeader fontSize="lg" fontWeight="bold">
            Close this lot?
          </AlertDialogHeader>
          <AlertDialogBody>
            <Text fontSize="sm" mb={3}>
              {count} box{count === 1 ? "" : "es"} · <b>{total} lb</b> out of{" "}
              <b>{session?.lotNumber}</b>.
            </Text>
            {pending > 0 && (
              <Alert status="warning" borderRadius="md" fontSize="sm" py={2} mb={3}>
                <AlertIcon />
                {pending} still to send. Closing will send them first.
              </Alert>
            )}
            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>
              Remarks (optional)
            </Text>
            <Textarea size="sm" value={remarks} rows={2}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Anything worth noting about this lot" />
          </AlertDialogBody>
          <AlertDialogFooter gap={2}>
            <Button ref={cancelStopRef} onClick={() => setConfirmStop(false)}>
              Keep weighing
            </Button>
            <Button colorScheme="red" onClick={onStop} isLoading={busy}>
              Close the lot
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
    </>
  );
};

export default WeighFinishedBoxes;
