import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Input, Badge, Textarea, Alert, AlertIcon, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import FloatingWindow from "../FloatingWindow";
import LangToggle from "../LangToggle";
import useLang from "../../hooks/useLang";
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
  // English or Spanish, remembered on this device. Only the labels and the
  // window's own words change; anything typed into a field is data and stays.
  const { lang, t, toggle: toggleLang } = useLang();
  // Read by effects that must not re-run when the language changes.
  const tRef = useRef(t);
  tRef.current = t;
  const {
    ready, durable, session, pending, scans, lastError, resumable,
    start, stop, addScan, addScanMany, undoLast, resume, discardResumable, adoptSession,
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
          title: tRef.current("Another session on this device has unsent weights"),
          description: tRef.current("{n} weight(s) here have not reached the server yet. Carry on with that session and let it send, then come back to this one.",
            { n: result.pending }),
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
      toast({ title: t("Could not start weighing"), description: err.message,
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
      toast({ title: t("That box was not recorded"), description: err.message,
        status: "error", position: "top", duration: 6000, isClosable: true });
      return false;
    }
  };

  // A pallet of identical cases off the line. Marked estimated by the panel:
  // the label figure, not a weighed one.
  const onAddMany = async (entries) => {
    try {
      await addScanMany(entries);
      beepSuccess();
      toast({ title: t("{n} boxes added", { n: entries.length }), status: "success",
        position: "top", duration: 4000,
        description: t("Marked estimated — the label figure, not a weighed one.") });
      return true;
    } catch (err) {
      beepError();
      toast({ title: t("Could not add those boxes"), description: err.message,
        status: "error", position: "top", duration: 6000 });
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
          title: t("Not stopped — weights still unsent"),
          description: t("{n} weight(s) have not reached the server. Stay on this screen until they do.",
            { n: result?.stillPending ?? 0 }),
        });
        return;
      }

      // The batch was deleted while this bench had it open.
      if (result.gone) {
        toast({
          status: "warning", position: "top", duration: 14000, isClosable: true,
          title: t("That session no longer exists"),
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
      toast({ title: t("Could not stop the session"), description: err.message,
        status: "error", position: "top" });
    } finally { setBusy(false); }
  };

  // Close this pallet and open the next one on the same lot, heading intact.
  //
  // A lot going out on several pallets is several sessions — one tag each — and
  // the heading is identical every time. Read off the SESSION rather than the
  // form, so it survives a session that was adopted or resumed rather than
  // typed here.
  const onNextPallet = async () => {
    setBusy(true);
    const closedId = session?.batchId ?? null;
    const heading = {
      lotId: lot.lotId ?? null,
      lotNumber: (session?.lotNumber || lot.lotNumber || "").trim() || null,
      expectedBoxes: String(session?.expectedBoxes ?? expectedBoxes ?? "").trim() || null,
      itemDescription: (session?.itemDescription || itemDescription || "").trim().toUpperCase() || null,
      shipTo: (session?.shipTo || shipTo || "").trim().toUpperCase() || null,
      direction: "outgoing",
    };
    try {
      const result = await stop(remarks.trim() || null);

      // Same refusal as a plain stop: unsent weights keep the bench where it is.
      if (!result?.closed) {
        toast({
          status: "warning", position: "top", duration: 9000, isClosable: true,
          title: t("Not stopped — weights still unsent"),
          description: t("{n} weight(s) have not reached the server. Stay on this screen until they do.",
            { n: result?.stillPending ?? 0 }),
        });
        return;
      }
      // The pallet just closed still has to reach the load it belongs to.
      if (!result.gone && closedId != null && onSessionClosed) {
        await onSessionClosed(closedId);
      }

      setConfirmStop(false);
      setRemarks("");
      // The heading is deliberately NOT cleared — that is the whole point.
      await start(heading);
      toast({
        status: "success", position: "top", duration: 4000,
        title: t("Next pallet started"),
        description: t("{lot} — the previous pallet is closed and has its own tag.",
          { lot: heading.lotNumber || t("Lot") }),
      });
    } catch (err) {
      toast({ title: t("Could not start the next pallet"), description: err.message,
        status: "error", position: "top", duration: 6000, isClosable: true });
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
        title: t("Unfinished session discarded"),
        description: lost
          ? t("{n} weight(s) that never reached the server were thrown away.", { n: lost })
          : t("Nothing was pending."),
      });
    } catch (err) {
      toast({ title: t("Could not discard it"), description: err.message,
        status: "error", position: "top", duration: 5000 });
    } finally { setBusy(false); }
  };

  const count = live.length;

  return (
    <>
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title={session
        ? t("Weighing out of {lot}", { lot: session.lotNumber || t("Lot") })
        : t("Weigh finished boxes")}
      headerActions={<LangToggle lang={lang} onToggle={toggleLang} />}
      width={560}
      footer={
        <Flex gap={2} width="100%" justify="space-between" align="center" wrap="wrap">
          <Flex gap={2} align="center">
            {session && pending > 0 && (
              <Badge colorScheme="yellow">{t("{n} not yet sent", { n: pending })}</Badge>
            )}
            {session && pending === 0 && count > 0 && (
              <Badge colorScheme="green">{t("all saved")}</Badge>
            )}
          </Flex>
          <Flex gap={2}>
            {session && (
              <Button size="md" variant="ghost" onClick={undoLast} isDisabled={count === 0}>
                {t("Undo last")}
              </Button>
            )}
            {!session ? (
              <Button size="md" colorScheme="blue" onClick={onStart}
                isLoading={busy}
                // The lot is required: every box recorded lands on it.
                isDisabled={!ready || !lot.lotId || Boolean(resumable)}>
                {t("Start weighing")}
              </Button>
            ) : (
              <Button size="md" colorScheme="red" onClick={() => setConfirmStop(true)}
                isLoading={busy}>
                {t("Stop session")}
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
            {t("This browser will not keep weights through a refresh. Finish the lot in one go.")}
          </Alert>
        )}
        {lastError && (
          <Alert status="warning" borderRadius="md" mb={3} fontSize="sm" py={2}>
            <AlertIcon />
            {t("{error} — weights are held on this device and will be sent when it reconnects.",
              { error: lastError })}
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
                {t("An unfinished session is still on this device.")}
              </Text>
              <Text fontSize="sm" mt={1}>
                {t("Batch {id} ({lot}) has {n} weight(s) that never reached the server.", {
                  id: resumable.batchId,
                  lot: resumable.lotNumber || "—",
                  n: resumable.pending,
                })}
              </Text>
              {resumable.direction === "outgoing" ? (
                <Flex gap={2} mt={3} wrap="wrap">
                  <Button size="sm" colorScheme="yellow" isLoading={busy}
                    onClick={async () => {
                      setBusy(true);
                      try { await resume(); } finally { setBusy(false); }
                    }}>
                    {t("Carry on with it")}
                  </Button>
                  {/* The only way out when the batch cannot be resumed at all —
                      deleted on the server, say. Without it Start stays disabled
                      and the bench is stuck. */}
                  <Button size="sm" variant="ghost" isDisabled={busy}
                    onClick={() => setConfirmDiscard(true)}>
                    {t("Discard it")}
                  </Button>
                </Flex>
              ) : (
                <Text fontSize="xs" color="gray.700" mt={2}>
                  {t("It is an incoming session. Finish or close it on the box weighing screen first — starting here would throw its weights away.")}
                </Text>
              )}
            </Box>
          </Alert>
        ) : !session ? (
          // The start form is two fields.
          <Box>
            <Text fontSize="sm" color="gray.600" mb={4}>
              {t("Pick the lot these finished boxes came out of. Everything else about the product is taken from the lot.")}
            </Text>

            {/* Opened from a load, so say where the weights are going to land. */}
            {presetLot && (
              <Alert status="info" borderRadius="md" mb={4} fontSize="sm" py={2}>
                <AlertIcon />
                {t("These boxes go on the load for {lot}. The session is tied to it when you close.",
                  { lot: presetLot.lotNumber })}
              </Alert>
            )}

            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>
              {t("Lot")}
            </Text>
            {/* Pick only. Finished boxes come out of a lot issued at Incoming,
                so there is nothing here to mint or type in. */}
            <LotPicker
              size="md"
              value={lot.lotId}
              lotNumber={lot.lotNumber}
              onChange={(picked) => setLot({
                lotId: picked ? picked.lotId : null,
                lotNumber: picked ? picked.lotNumber : "",
              })}
            />

            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mt={4} mb={1}>
              {t("Item")} <Text as="span" textTransform="none">{t("(optional)")}</Text>
            </Text>
            <Input size="md" value={itemDescription} autoComplete="off"
              placeholder="e.g. HUMERUS BONE"
              onChange={(e) => setItemDescription(e.target.value.toUpperCase())} />
            <Text fontSize="xs" color="gray.500" mt={1}>
              {t("What is in the boxes. Left blank it is taken from the lot's incoming session, which is the raw product rather than this one.")}
            </Text>

            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mt={4} mb={1}>
              {t("Going to")} <Text as="span" textTransform="none">{t("(optional)")}</Text>
            </Text>
            <Input size="md" value={shipTo} autoComplete="off"
              placeholder="e.g. ADAMSFOODS"
              onChange={(e) => setShipTo(e.target.value.toUpperCase())} />

            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mt={4} mb={1}>
              {t("Boxes expected")} <Text as="span" textTransform="none">{t("(optional)")}</Text>
            </Text>
            <Input size="md" width="140px" value={expectedBoxes} placeholder="80"
              inputMode="numeric" autoComplete="off"
              onChange={(e) => setExpectedBoxes(e.target.value)} />
            {/* A prompt, never a limit — box N+1 is not refused, it just says so. */}
            <Text fontSize="xs" color="gray.500" mt={1}>
              {t("Only used to show progress. Going over is not blocked.")}
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
                : <Text fontSize="sm" color="gray.400">{t("item not recorded")}</Text>}
              {session.shipTo && (
                <Badge colorScheme="blue" fontSize="9px">
                  {t("to {shipTo}", { shipTo: session.shipTo })}
                </Badge>
              )}
            </Flex>

            {supported && (
              <Flex justify="flex-end" mb={2}>
                {/* Typing is the fallback for a scale that is not connected.
                    Mutually exclusive with the scale because the same box would
                    otherwise be recordable twice, once by each. */}
                <Button size="xs" variant="ghost"
                  onClick={() => setTypeMode((v) => !v)}>
                  {typeMode ? t("Use the scale") : t("Type weights instead")}
                </Button>
              </Flex>
            )}

            {typeMode ? (
              <TypeWeights
                disabled={busy}
                expected={session.expectedBoxes ?? null}
                weights={weights}
                onAdd={onAdd}
                onAddMany={onAddMany}
                onUndo={undoLast}
                t={t}
              />
            ) : (
              <ScaleWeigh
                disabled={busy}
                lotNumber={session.lotNumber || null}
                itemDescription={session.itemDescription || null}
                expected={session.expectedBoxes ?? null}
                weights={weights}
                onAdd={onAdd}
                t={t}
              />
            )}

            {/* What has been recorded, newest first — the check an operator
                actually makes is "did the last one go on", and that answer
                should not require scrolling. */}
            <Box mt={4}>
              <Flex justify="space-between" align="baseline" mb={2}>
                <Text fontSize="xs" color="gray.500" textTransform="uppercase"
                  letterSpacing="wide">
                  {t("Recorded")}
                </Text>
                <Text fontSize="sm" fontWeight="600" color="gray.700"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t(count === 1 ? "{n} box" : "{n} boxes", { n: count })} · {total} lb
                </Text>
              </Flex>
              <Flex wrap="wrap" gap={2} maxH="150px" overflowY="auto"
                p={2} border="1px solid" borderColor="gray.200" borderRadius="md">
                {count === 0 ? (
                  <Text fontSize="sm" color="gray.400">{t("Nothing yet.")}</Text>
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
            {t("Throw this unfinished session away?")}
          </AlertDialogHeader>
          <AlertDialogBody>
            <Text fontSize="sm">
              {resumable?.pending
                ? t("{n} weight(s) on this device never reached the server. Discarding loses them for good — those boxes would have to be weighed again.",
                    { n: resumable.pending })
                : t("Nothing is waiting to be sent, so nothing is lost.")}
            </Text>
            <Text fontSize="sm" mt={2} color="gray.600">
              {t("Use this when the session cannot be carried on with — deleted on the server, or belonging to a lot that is long gone.")}
            </Text>
          </AlertDialogBody>
          <AlertDialogFooter gap={2}>
            <Button ref={cancelStopRef} onClick={() => setConfirmDiscard(false)}>
              {t("Keep it")}
            </Button>
            <Button colorScheme="red" onClick={onDiscard} isLoading={busy}>
              {t("Discard it")}
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
            {t("Stop this weighing session?")}
          </AlertDialogHeader>
          <AlertDialogBody>
            <Text fontSize="sm" mb={3}>
              {t(count === 1 ? "{n} box" : "{n} boxes", { n: count })} ·{" "}
              <b>{total} lb</b> — <b>{session?.lotNumber}</b>.
            </Text>
            {/* This closes a BATCH, never the lot — stop() calls closeBatch and
                touches nothing else. Saying "close the lot" read as a decision
                nobody wanted to take with product still to come. */}
            <Alert status="info" borderRadius="md" fontSize="sm" py={2} mb={3}>
              <AlertIcon />
              <Box>
                <b>{t("This closes this session, not the lot.")}</b>{" "}
                {t("{lot} stays open — weigh more boxes into it whenever the next run comes off the line. To pick this same session back up, leave it open and use Carry on weighing on the Outgoing tab.",
                  { lot: session?.lotNumber })}
              </Box>
            </Alert>
            {count === 0 && (
              <Alert status="warning" borderRadius="md" fontSize="sm" py={2} mb={3}>
                <AlertIcon />
                {t("Nothing has been recorded yet, so this would close an empty session. Leave it open instead if you are coming back to it.")}
              </Alert>
            )}
            {pending > 0 && (
              <Alert status="warning" borderRadius="md" fontSize="sm" py={2} mb={3}>
                <AlertIcon />
                {t("{n} still to send. Stopping sends them first; leaving it open keeps them on this device until it reconnects.",
                  { n: pending })}
              </Alert>
            )}
            <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>
              {t("Remarks (optional)")}
            </Text>
            <Textarea size="sm" value={remarks} rows={2}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Anything worth noting about this run" />
          </AlertDialogBody>
          <AlertDialogFooter gap={2} flexWrap="wrap">
            <Button ref={cancelStopRef} onClick={() => setConfirmStop(false)}>
              {t("Keep weighing")}
            </Button>
            {/* Done for now, but the lot is not finished — the answer that was
                missing, and the one a part-processed lot needs. */}
            <Button variant="outline" onClick={onLeaveOpen} isDisabled={busy}>
              {t("Leave it open")}
            </Button>
            {/* More of the same lot on another pallet. Closes this one and
                reopens with the same heading, so nothing is retyped. */}
            <Button variant="outline" colorScheme="teal" onClick={onNextPallet}
              isDisabled={busy || count === 0}>
              {t("Next pallet")}
            </Button>
            {/* Finishing a session is not destructive, so it does not wear the
                colour of something that is. */}
            <Button colorScheme="blue" onClick={onStop} isLoading={busy}>
              {t("Stop session")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
    </>
  );
};

export default WeighFinishedBoxes;
