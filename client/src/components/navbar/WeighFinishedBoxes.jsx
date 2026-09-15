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
    start, stop, addScan, undoLast, resume, discardResumable, adoptSession,
  } = useScanSession();

  const [lot, setLot] = useState({ lotId: null, lotNumber: "" });
  const [expectedBoxes, setExpectedBoxes] = useState("");
  // What is actually in the boxes. Left blank the server inherits it from the
  // incoming session, which is often wrong out here: what leaves is the
  // PROCESSED product, not what arrived.
  const [itemDescription, setItemDescription] = useState("");
  // Who the boxes are going to. Stored on the session, so a manifest printed
  // from it says where the product went.
  const [shipTo, setShipTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [typeMode, setTypeMode] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [remarks, setRemarks] = useState("");
  const cancelStopRef = useRef(null);

  const supported = scaleSupported();

  useEffect(() => {
    if (!isOpen || !presetLot || session) return;
    setLot({ lotId: presetLot.lotId ?? null, lotNumber: presetLot.lotNumber || "" });
    // The load already says what is going on the truck.
    if (presetLot.description) setItemDescription(presetLot.description);
    if (presetLot.shipTo) setShipTo(presetLot.shipTo);
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
        // Blank falls back to the incoming session's description server-side.
        itemDescription: itemDescription.trim().toUpperCase() || null,
        shipTo: shipTo.trim().toUpperCase() || null,
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
      const result = await stop(remarks.trim() || null);

      // Weights the server has not taken yet. The window stays where it is:
      // closing it here would hide the only screen that can still send them.
      if (!result?.closed) {
        toast({
          status: "warning", position: "top", duration: 9000, isClosable: true,
          title: "Not stopped — weights still unsent",
          description: `${result?.stillPending ?? 0} weight(s) have not reached `
            + `the server. Stay on this screen until they do.`,
        });
        return;
      }

      // The batch was deleted while this bench had it open.
      if (result.gone) {
        toast({
          status: "warning", position: "top", duration: 14000, isClosable: true,
          title: "That session no longer exists",
          description: `Session ${result.batchId} was deleted on the server, so `
            + `there was nothing to stop.`
            + (result.lost
              ? ` ${result.lost} weight(s) held here could not be saved and will `
                + `have to be weighed again.`
              : " This bench has been cleared."),
        });
      } else if (closedId != null && onSessionClosed) {
        await onSessionClosed(closedId);
      }

      setConfirmStop(false);
      setRemarks("");
      setLot({ lotId: null, lotNumber: "" });
      setExpectedBoxes("");
      setItemDescription("");
      setShipTo("");
      onClose();
    } catch (err) {
      toast({ title: "Could not stop the session", description: err.message,
        status: "error", position: "top" });
    } finally { setBusy(false); }
  };

  // Neither finishing nor carrying on: the batch stays open on the server and
  // on this device, so the next run picks it up where this one stopped.
  const onLeaveOpen = () => {
    setConfirmStop(false);
    setRemarks("");
    onClose();
  };

  const onDiscard = async () => {
    setConfirmDiscard(false);
    setBusy(true);
    try {
      const { lost } = await discardResumable();
      toast({
        status: "info", position: "top", duration: 5000,
        title: "Unfinished session discarded",
        description: lost
          ? `${lost} weight(s) that never reached the server were thrown away.`
          : "Nothing was pending.",
      });
    } catch (err) {
      toast({ title: "Could not discard it", description: err.message,
        status: "error", position: "top", duration: 5000 });
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
                Stop session
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
                <Flex gap={2} mt={3} wrap="wrap">
                  <Button size="sm" colorScheme="yellow" isLoading={busy}
                    onClick={async () => {
                      setBusy(true);
                      try { await resume(); } finally { setBusy(false); }
                    }}>
                    Carry on with it
                  </Button>
                  {/* The only way out when the batch cannot be resumed at all —
                      deleted on the server, say. Without it Start stays disabled
                      and the bench is stuck. */}
                  <Button size="sm" variant="ghost" isDisabled={busy}
                    onClick={() => setConfirmDiscard(true)}>
                    Discard it
                  </Button>
                </Flex>
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
              Item <Text as="span" textTransform="none">(optional)</Text>
            </Text>
            <Input size="md" value={itemDescription} autoComplete="off"
              placeholder="e.g. HUMERUS BONE"
              onChange={(e) => setItemDescription(e.target.value.toUpperCase())} />
            <Text fontSize="xs" color="gray.500" mt={1}>
              What is in the boxes. Left blank it is taken from the lot&apos;s
              incoming session, which is the raw product rather than this one.
            </Text>

            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mt={4} mb={1}>
              Going to <Text as="span" textTransform="none">(optional)</Text>
            </Text>
            <Input size="md" value={shipTo} autoComplete="off"
              placeholder="e.g. ADAMSFOODS"
              onChange={(e) => setShipTo(e.target.value.toUpperCase())} />

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
            {/* Lot and item together, so the operator can see what they are
                weighing in BOTH modes — the scale panel says it, the typing
                panel does not. */}
            <Flex align="baseline" gap={2} wrap="wrap" mb={2}>
              <Text fontSize="sm" fontWeight="bold" color="blue.700">
                {session.lotNumber || "No lot"}
              </Text>
              {session.itemDescription
                ? <Text fontSize="sm" color="gray.700">{session.itemDescription}</Text>
                : <Text fontSize="sm" color="gray.400">item not recorded</Text>}
              {session.shipTo && (
                <Badge colorScheme="blue" fontSize="9px">to {session.shipTo}</Badge>
              )}
            </Flex>

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

    <AlertDialog isOpen={confirmDiscard} leastDestructiveRef={cancelStopRef}
      onClose={() => setConfirmDiscard(false)} isCentered>
      <AlertDialogOverlay>
        <AlertDialogContent>
          <AlertDialogHeader fontSize="lg" fontWeight="bold">
            Throw this unfinished session away?
          </AlertDialogHeader>
          <AlertDialogBody>
            <Text fontSize="sm">
              {resumable?.pending
                ? `${resumable.pending} weight(s) on this device never reached the `
                  + `server. Discarding loses them for good — those boxes would have `
                  + `to be weighed again.`
                : "Nothing is waiting to be sent, so nothing is lost."}
            </Text>
            <Text fontSize="sm" mt={2} color="gray.600">
              Use this when the session cannot be carried on with — deleted on the
              server, or belonging to a lot that is long gone.
            </Text>
          </AlertDialogBody>
          <AlertDialogFooter gap={2}>
            <Button ref={cancelStopRef} onClick={() => setConfirmDiscard(false)}>
              Keep it
            </Button>
            <Button colorScheme="red" onClick={onDiscard} isLoading={busy}>
              Discard it
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>

    <AlertDialog isOpen={confirmStop} leastDestructiveRef={cancelStopRef}
      onClose={() => setConfirmStop(false)} isCentered>
      <AlertDialogOverlay>
        <AlertDialogContent>
          <AlertDialogHeader fontSize="lg" fontWeight="bold">
            Stop this weighing session?
          </AlertDialogHeader>
          <AlertDialogBody>
            <Text fontSize="sm" mb={3}>
              {count} box{count === 1 ? "" : "es"} · <b>{total} lb</b> out of{" "}
              <b>{session?.lotNumber}</b>.
            </Text>
            {/* This closes a BATCH, never the lot — stop() calls closeBatch and
                touches nothing else. Saying "close the lot" read as a decision
                nobody wanted to take with product still to come. */}
            <Alert status="info" borderRadius="md" fontSize="sm" py={2} mb={3}>
              <AlertIcon />
              <Box>
                This closes <b>this session</b>, not the lot.{" "}
                {session?.lotNumber} stays open — weigh more boxes into it
                whenever the next run comes off the line. To pick this same
                session back up, leave it open and use <b>Carry on weighing</b>
                on the Outgoing tab.
              </Box>
            </Alert>
            {count === 0 && (
              <Alert status="warning" borderRadius="md" fontSize="sm" py={2} mb={3}>
                <AlertIcon />
                Nothing has been recorded yet, so this would close an empty
                session. Leave it open instead if you are coming back to it.
              </Alert>
            )}
            {pending > 0 && (
              <Alert status="warning" borderRadius="md" fontSize="sm" py={2} mb={3}>
                <AlertIcon />
                {pending} still to send. Stopping sends them first; leaving it
                open keeps them on this device until it reconnects.
              </Alert>
            )}
            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>
              Remarks (optional)
            </Text>
            <Textarea size="sm" value={remarks} rows={2}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Anything worth noting about this run" />
          </AlertDialogBody>
          <AlertDialogFooter gap={2} flexWrap="wrap">
            <Button ref={cancelStopRef} onClick={() => setConfirmStop(false)}>
              Keep weighing
            </Button>
            {/* Done for now, but the lot is not finished — the answer that was
                missing, and the one a part-processed lot needs. */}
            <Button variant="outline" onClick={onLeaveOpen} isDisabled={busy}>
              Leave it open
            </Button>
            {/* Finishing a session is not destructive, so it does not wear the
                colour of something that is. */}
            <Button colorScheme="blue" onClick={onStop} isLoading={busy}>
              Stop session
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
    </>
  );
};

export default WeighFinishedBoxes;
