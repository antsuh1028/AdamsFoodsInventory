/* global BigInt */
// The directive is not decoration: CRA's linter fails the build on BigInt without
// it, the same way utils/weight.js has always needed it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Input, Textarea, ButtonGroup,
  Alert, AlertIcon, Stat, StatLabel, StatNumber, StatHelpText, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import FloatingWindow from "../FloatingWindow";
import useScanSession from "../../hooks/useScanSession";
import { createScanAssembler } from "../../utils/scanInput";
import { parseGs1 } from "../../utils/gs1";
import { primeAudio, beepSuccess, beepError } from "../../utils/scanFeedback";
import ScanSheet from "./ScanSheet";
import NumericKeypad from "./NumericKeypad";
import TypeWeights from "./TypeWeights";
import LotPicker from "../LotPicker";
import VendorInput from "../VendorInput";
import {
  toPounds, toDisplay, toDisplayHundredths, fromHundredths,
} from "../../utils/weight";
import { today, fmtDate, upper } from "../../pages/noblesse/shared";
import printWeightManifest from "../../pages/noblesse/printWeightManifest";

// Operator-facing scanning screen.

// Inputs must not be "helped" by iPadOS — autocorrect on a lot number is
// silent data corruption.
const rawInputProps = {
  // Cosmetic only — it restyles the glyphs and leaves the value alone.
  textTransform: "uppercase",
  autoCorrect: "off",
  // "characters" so the iPad keyboard is in caps, matching what the field stores.
  autoCapitalize: "characters",
  spellCheck: false,
  style: { touchAction: "manipulation" },
};

const StatCard = ({ label, value, help, color = "gray.800", size = "3xl" }) => (
  <Stat
    px={4} py={3} bg="white" borderRadius="lg"
    border="1px solid" borderColor="gray.200" minW={{ base: "130px", md: "150px" }} flex="1 1 130px"
  >
    <StatLabel fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
      {label}
    </StatLabel>
    <StatNumber fontSize={size} lineHeight="1.1" color={color}>{value}</StatNumber>
    {help && <StatHelpText fontSize="xs" mb={0}>{help}</StatHelpText>}
  </Stat>
);

// The keypad panel: a permanent part of an open session, not something to go
// looking for.

// A batch of one weight is still thirty boxes, and a mis-keyed count invents every
// one of them.
const MAX_BATCH = 500;

const KeypadPanel = ({ onAdd, onAddMany, disabled }) => {
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState("LB");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  // "one" | "batch". A run of identical cases is a different act from weighing
  // one damaged box, so it is a mode rather than an extra field always on show.
  const [mode, setMode] = useState("one");
  const [cases, setCases] = useState("");
  // Which readout the shared keypad is typing into.
  const [field, setField] = useState("cases");
  const [confirm, setConfirm] = useState(null);
  const cancelBatchRef = useRef(null);

  const valid = /^\d{1,5}(\.\d{1,3})?$/.test(weight) && parseFloat(weight) > 0;
  const caseCount = parseInt(cases, 10);
  const batchReady = valid && Number.isInteger(caseCount)
    && caseCount > 0 && caseCount <= MAX_BATCH;

  // Shown before committing, because the operator is agreeing to a TOTAL, not to
  // two numbers.
  const batchTotal = batchReady
    ? fromHundredths(toDisplayHundredths(toPounds(weight, unit).weight) * BigInt(caseCount))
    : null;

  const submit = async () => {
    if (!valid) return;
    await onAdd({
      weight, weightUnit: unit, isManual: true, note,
      // Typed by a person on the keypad.
      entryMethod: "keyed",
    });
    setWeight("");
    setNote("");
    setShowNote(false);
  };

  const submitBatch = async () => {
    if (!batchReady) return;
    setConfirm(null);
    await onAddMany(Array.from({ length: caseCount }, () => ({
      weight, weightUnit: unit, isManual: true, note,
      entryMethod: "keyed",
      // NOT MEASURED.
      isEstimated: true,
    })));
    setCases("");
    setWeight("");
    setField("cases");
  };

  return (
    <Box>
      <Flex justify="space-between" align="baseline" mb={2} gap={2} wrap="wrap">
        <Text fontSize="xs" color="yellow.800">
          For damaged or unbarcoded labels
        </Text>
        <Flex gap={2}>
          {/* tabIndex -1 and mousedown prevented on every control here, like the
              keypad itself: a scanner types Enter after each scan, and a button
              left holding focus would be re-pressed instead. */}
          <ButtonGroup size="xs" isAttached variant="outline">
            {[["one", "One box"], ["batch", "Batch"]].map(([m, label]) => (
              <Button key={m} tabIndex={-1} onMouseDown={(e) => e.preventDefault()}
                colorScheme={mode === m ? "blue" : "gray"}
                variant={mode === m ? "solid" : "outline"}
                onClick={() => { setMode(m); setField("cases"); }}>
                {label}
              </Button>
            ))}
          </ButtonGroup>
          <Button size="xs" variant="ghost" colorScheme="yellow" tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowNote((v) => !v)}>
            {showNote ? "Hide note" : "Add note"}
          </Button>
        </Flex>
      </Flex>

      <Flex gap={3} wrap="wrap" align="flex-start">
        <Box flex="1 1 240px" maxW="100%">
          {mode === "batch" && (
            <Box mb={2}>
              {/* Two readouts, one keypad. Tapping a readout aims the pad at it,
                  which keeps the whole panel non-focusable — an input here would
                  silently swallow scans (CLAUDE.md §4). */}
              <Flex gap={2} mb={2}>
                {[
                  ["cases", "Cases", cases || "0", ""],
                  ["weight", "Weight each", weight || "0", unit],
                ].map(([key, label, shown, suffix]) => (
                  <Box key={key} flex={1} as="button" type="button" textAlign="left"
                    tabIndex={-1} onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setField(key)}
                    px={3} py={2} borderRadius="md" border="2px solid"
                    borderColor={field === key ? "blue.400" : "gray.200"}
                    bg={field === key ? "blue.50" : "white"}>
                    <Text fontSize="9px" color="gray.500" textTransform="uppercase"
                      letterSpacing="wide">
                      {label}
                    </Text>
                    <Text fontSize="xl" fontWeight="bold" lineHeight="1.2"
                      color={shown === "0" ? "gray.300" : "gray.800"}
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                      {shown}{suffix ? ` ${suffix}` : ""}
                    </Text>
                  </Box>
                ))}
              </Flex>

              {batchReady ? (
                <Alert status="warning" borderRadius="md" fontSize="xs" py={2}>
                  <AlertIcon boxSize={3} />
                  <Box>
                    <b>{caseCount} boxes × {toDisplay(toPounds(weight, unit).weight)} lb
                    {" "}= {batchTotal} lb</b>
                    <Text>
                      Recorded as <b>estimated</b> — the label figure, not a weighed one.
                    </Text>
                  </Box>
                </Alert>
              ) : (
                <Text fontSize="xs" color="gray.500">
                  {caseCount > MAX_BATCH
                    ? `That is more than ${MAX_BATCH} boxes — split it.`
                    : "Tap a box above, then type on the keypad."}
                </Text>
              )}
            </Box>
          )}

          <NumericKeypad
            value={mode === "batch" && field === "cases" ? cases : weight}
            onChange={mode === "batch" && field === "cases" ? setCases : setWeight}
            onSubmit={mode === "batch"
              ? () => { if (batchReady) setConfirm(true); }
              : submit}
            label={mode === "batch"
              ? (field === "cases" ? "Cases" : "Weight each")
              : "Weight"}
            maxDecimals={mode === "batch" && field === "cases" ? 0 : 3}
            unit={unit}
            // The unit belongs to the weight, so it is not offered while the pad
            // is aimed at the count.
            onUnitChange={mode === "batch" && field === "cases" ? undefined : setUnit}
            submitLabel="Add box"
            // In batch mode the pad's own submit is hidden and replaced below.
            hideSubmit={mode === "batch"}
            isDisabled={disabled}
          />

          {mode === "batch" && (
            <Button mt={2} width="100%" size="md" colorScheme="blue"
              tabIndex={-1} onMouseDown={(e) => e.preventDefault()}
              isDisabled={disabled || !batchReady}
              onClick={() => setConfirm(true)}>
              {batchReady ? `Add ${caseCount} boxes` : "Add boxes"}
            </Button>
          )}
        </Box>

        <Box flex="1 1 100%">
          {showNote ? (
            <>
              <Text fontSize="xs" color="gray.600" mb={1}>Note (optional)</Text>
              <Input {...rawInputProps} size={{ base: "md", md: "lg" }} placeholder="torn label"
                value={note} onChange={(e) => setNote(e.target.value)} />
              {/* Said out loud because the consequence is silent: a focused
                  field takes the scanner's keystrokes instead of the session. */}
              <Text fontSize="xs" color="yellow.800" mt={1}>
                Scans are not recorded while this field has focus. Hide it before
                scanning again.
              </Text>
            </>
          ) : (
            <Text fontSize="xs" color="gray.500">
              Scan as usual — this stays open for the boxes that cannot be scanned.
            </Text>
          )}
        </Box>
      </Flex>

      {/* Confirmed, unlike a single box. One tap here writes thirty rows, and a
          mis-keyed count invents every one of them — Undo takes back one box at
          a time, so the cost of getting this wrong is thirty corrections. */}
      <AlertDialog isOpen={Boolean(confirm)} leastDestructiveRef={cancelBatchRef}
        onClose={() => setConfirm(null)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Add {caseCount} boxes?
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="3xl" fontWeight="bold" color="blue.700" lineHeight="1.2"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {caseCount} × {valid ? toDisplay(toPounds(weight, unit).weight) : "—"} lb
              </Text>
              <Text fontSize="md" color="gray.700" mb={3}>
                = <b>{batchTotal} lb</b> on this lot
              </Text>
              <Text fontSize="sm">
                Each one is recorded as its own box, so any of them can be
                corrected or voided on its own afterwards.
              </Text>
              <Text fontSize="xs" color="gray.600" mt={2}>
                They are marked <b>estimated</b>: this is the figure on the label,
                and the boxes themselves vary. Totals will say so, and the printed
                tally writes them as <b>~{valid ? toDisplay(toPounds(weight, unit).weight) : ""}</b>.
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              {/* Focus sits on the safe option: the scanner types Enter, and an
                  Enter arriving while this is open must not commit the batch. */}
              <Button ref={cancelBatchRef} onClick={() => setConfirm(null)}>
                Go back
              </Button>
              <Button colorScheme="blue" onClick={submitBatch}>
                Add {caseCount} boxes
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
};

// The listing returns totals as [{ unit, total }] — an array, because a session
// can hold more than one unit.
const totalsOf = (batch) =>
  Array.isArray(batch.totals) && batch.totals.length
    ? batch.totals.map((t) => `${t.total} ${t.unit}`).join("  ·  ")
    : "—";

// `direction` decides which end of the process this session belongs to: incoming
// raw product arriving — barcoded, scanned.
const BoxScanner = ({ isOpen, onClose, adoptBatchId = null, direction = "incoming" }) => {
  const {
    ready, durable, session, pending, resumable, lastError, lastScan, scans,
    start, resume, discardResumable, stop, flush, addScan, addScanMany,
    undoLast, editScan, voidScan,
    listOpenSessions, adoptSession,
  } = useScanSession();

  // Sessions still open on the server.
  const [openSessions, setOpenSessions] = useState([]);
  const [adopting, setAdopting] = useState(null);

  useEffect(() => {
    if (!isOpen || session) { setOpenSessions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        // Scoped to this panel's own end of the process.
        const rows = await listOpenSessions(direction);
        if (!cancelled) setOpenSessions(rows);
      } catch {
        // A listing failure must not block starting a new session, which is
        // still the common case — the panel just does not offer to continue.
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, session, listOpenSessions, direction]);

  const onContinue = async (batch) => {
    setAdopting(batch.batch_id);
    try {
      const result = await adoptSession(batch.batch_id);
      if (!result.adopted && result.reason === "pending-scans") {
        toast({
          status: "warning", duration: 9000, isClosable: true, position: "top",
          title: "Finish the session already on this device first",
          description:
            `${result.pending} scan(s) here have not reached the server yet. ` +
            `Resume that session and let it flush, or discard it, before continuing another.`,
        });
      }
    } catch (err) {
      toast({ status: "error", position: "top", duration: 5000,
        title: "Could not continue that session", description: err.message });
    } finally {
      setAdopting(null);
    }
  };

  // One session is one lot, so the manifest produced at Stop covers exactly these
  // boxes.
  const [header, setHeader] = useState({
    lotNumber: "", lotId: null, vendor: "", billOfLading: "", itemDescription: "",
    // Recorded on the session, deliberately absent from the printed manifest.
    brand: "", estNumber: "", grade: "",
    // How many boxes to expect. A PROMPT, not a limit — box N+1 is never
    // refused, it just says so.
    expectedBoxes: "",
  });
  // Uppercased HERE, not just displayed that way.
  const setField = (key) => (e) => {
    const value = upper(e.target.value);
    setHeader((h) => ({ ...h, [key]: value }));
  };

  // Asked for at close, printed on the manifest as MEMO. Deliberately NOT a
  // field on the scanning surface: the global keydown handler bails on
  // INPUT/TEXTAREA/SELECT, so a textarea left focused there silently swallows
  // scans (CLAUDE.md §4). By the time this dialog is open, scanning is over.
  const [confirmStop, setConfirmStop] = useState(false);
  const [remarks, setRemarks] = useState("");
  const cancelStopRef = useRef(null);

  const [confirmStart, setConfirmStart] = useState(false);
  // Focus sits on "Go back" so Enter dismisses rather than commits — the
  // scanner types Enter, and this dialog is open while one is in someone's hand.
  const cancelStartRef = useRef(null);
  const [rejection, setRejection] = useState(null);
  const [busy, setBusy] = useState(false);
  // Open by default: the keypad is part of the session, not something to go hunting
  // for when a torn label turns up mid-pallet.
  const [showManual, setShowManual] = useState(true);
  // Typing mode, for the outgoing bench where finished boxes carry no barcode.
  // OFF by default: the typing field HOLDS FOCUS, and a focused field makes the
  // global keydown handler bail — so while this is on the scanner is deaf
  // (CLAUDE.md §4). A deliberate mode, never a default.
  const [typeMode, setTypeMode] = useState(false);

  // The session's own direction wins once one is open — an ADOPTED session carries
  // what it was created as, which may not be what this panel was opened for.
  const isOutgoing = session ? session.direction === "outgoing" : direction === "outgoing";

  // Typing is only ever on for an outgoing session.
  useEffect(() => {
    if (!isOutgoing && typeMode) setTypeMode(false);
  }, [isOutgoing, typeMode]);

  const [rowBusy, setRowBusy] = useState(null);
  // Declining a recovered batch throws away scans the server never received,
  // so it is confirmed rather than a single tap next to "Resume it".
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const cancelDiscardRef = useRef(null);
  const toast = useToast();

  // Opened by reopening a manifest, so the session to work on is already known.
  const adoptedRef = useRef(null);
  useEffect(() => {
    if (!isOpen) { adoptedRef.current = null; return; }
    if (!adoptBatchId || !ready || session) return;
    if (adoptedRef.current === adoptBatchId) return;
    adoptedRef.current = adoptBatchId;
    (async () => {
      const result = await adoptSession(adoptBatchId);
      if (!result.adopted && result.reason === "pending-scans") {
        // Refused rather than destroying unsent work. Say so — silently
        // showing an empty scanner would look like the reopen failed.
        toast({
          status: "warning", duration: 12000, isClosable: true, position: "top",
          title: "Another session on this device has unsent scans",
          description:
            `${result.pending} scan(s) here have not reached the server yet. Resume that ` +
            `session and let it flush, or discard it, then continue this one.`,
        });
      }
    })();
  }, [isOpen, adoptBatchId, ready, session, adoptSession, toast]);
  const assemblerRef = useRef(null);

  // Rebuilt only when the parse function changes, which is never — but keeping
  // it in a ref means the global key listener never closes over a stale one.
  const assembler = useMemo(
    () => createScanAssembler({ parse: parseGs1 }),
    []
  );
  assemblerRef.current = assembler;

  const handleScanResult = useCallback(async (result) => {
    if (!result) return;
    if (result.type === "scan") {
      setRejection(null);
      try {
        await addScan({
          weight: result.parsed.weight.value,
          weightUnit: result.parsed.weight.unit,
          rawBarcode: result.raw,
          gtin: result.parsed.gtin,
          serial: result.parsed.serial,
          productionDate: result.parsed.productionDate,
        });
        beepSuccess();
      } catch (err) {
        // A storage failure means the scan was never saved. That must be loud.
        beepError();
        setRejection({ code: "NOT_SAVED", reason: err.message, raw: result.raw });
      }
    } else {
      beepError();
      setRejection(result);
    }
  }, [addScan]);

  // Global keydown: the scanner is a keyboard, so there is no field to focus.
  useEffect(() => {
    if (!isOpen || !session) return undefined;
    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      // Do not swallow keystrokes meant for the manual-entry inputs.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "Enter" || e.key === "Tab") e.preventDefault();
      const result = assemblerRef.current.handleKey(e);
      if (result) handleScanResult(result);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, session, handleScanResult]);

  // Confirmed first: the lot is fixed for the session and every box lands on it.
  const doStart = async () => {
    setBusy(true);
    try {
      await primeAudio(); // iOS needs a gesture before audio will play
      await start({
        lotNumber: header.lotNumber.trim() || null,
        // The picker already knows exactly which lot was chosen, so send the id and
        // let the server skip parsing entirely.
        lotId: header.lotId ?? null,
        vendor: header.vendor.trim() || null,
        billOfLading: header.billOfLading.trim() || null,
        itemDescription: header.itemDescription.trim() || null,
        brand: header.brand.trim() || null,
        estNumber: header.estNumber.trim() || null,
        grade: header.grade.trim() || null,
        expectedBoxes: header.expectedBoxes.trim() || null,
        direction,
      });
      setConfirmStart(false);
    } catch (err) {
      toast({ title: "Could not start session", description: err.message,
        status: "error", position: "top", duration: 5000 });
      setConfirmStart(false);
    } finally { setBusy(false); }
  };

  const onResume = async () => {
    setBusy(true);
    try { await primeAudio(); await resume(); } finally { setBusy(false); }
  };

  const onStop = async () => {
    setBusy(true);
    setConfirmStop(false);
    try {
      const result = await stop(remarks.trim() || null);
      setRemarks("");
      if (result.gone) {
        // Deleted on the server while this bench still had it open. There is
        // nothing to close and nothing held here can reach it.
        toast({ title: "That session no longer exists",
          description: `Session ${result.batchId} was deleted on the server.`
            + (result.lost
              ? ` ${result.lost} scan(s) held here could not be saved.`
              : " This screen has been cleared."),
          status: "warning", position: "top", duration: 14000, isClosable: true });
      } else if (result.closed) {
        toast({ title: "Session stopped",
          description: `${result.summary.totalBoxes} boxes recorded`,
          status: "success", position: "top", duration: 4000 });
      } else if (result.reason === "unflushed-scans") {
        toast({ title: "Not stopped — scans still unsent",
          description: `${result.stillPending} scan(s) have not reached the server. Stay on this screen until they do.`,
          status: "warning", position: "top", duration: 8000, isClosable: true });
      }
    } finally { setBusy(false); }
  };

  const onPrintManifest = () => {
    printWeightManifest({
      lotNumber: session?.lotNumber || header.lotNumber,
      vendor: session?.vendor || header.vendor,
      billOfLading: session?.billOfLading || header.billOfLading,
      itemDescription: session?.itemDescription || header.itemDescription,
      date: fmtDate(today()),
      scans,
    });
  };

  const onUndo = async () => {
    const result = await undoLast();
    if (result.undone) {
      toast({ title: "Removed last box",
        description: `${result.record.weight} ${result.record.weightUnit}`,
        status: "info", position: "top", duration: 2500 });
    } else {
      toast({ title: "Nothing to undo",
        description: "Boxes already sent to the server cannot be removed here.",
        status: "warning", position: "top", duration: 4000 });
    }
  };

  // Correcting a row without stopping the session: a misread label or a box
  // weighed twice used to mean finishing the pallet and fixing it afterwards.
  const onRowChange = (run, title) => async (row, ...rest) => {
    setRowBusy(row.localId);
    try {
      await run(row, ...rest);
      if (title) toast({ title, status: "success", duration: 2000, position: "top" });
    } catch (err) {
      toast({
        title: "Could not change that box",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 5000, position: "top",
      });
    } finally {
      setRowBusy(null);
    }
  };

  const onDiscardResumable = async () => {
    setConfirmDiscard(false);
    setBusy(true);
    try {
      const { lost } = await discardResumable();
      toast({
        title: "Unfinished batch discarded",
        description: lost
          ? `${lost} unsent scan(s) were thrown away.`
          : "Nothing was pending.",
        status: "info", duration: 4000, position: "top",
      });
    } catch (err) {
      toast({
        title: "Could not discard it",
        description: err.message,
        status: "error", duration: 5000, position: "top",
      });
    } finally {
      setBusy(false);
    }
  };

  // Returns whether the box actually landed.
  const onManualAddMany = async (entries) => {
    try {
      await addScanMany(entries);
      beepSuccess();
      setRejection(null);
      toast({
        status: "success", position: "top", duration: 4000,
        title: `${entries.length} boxes added`,
        description: "Marked estimated — the label figure, not a weighed one.",
      });
      return true;
    } catch (err) {
      beepError();
      toast({ title: "Could not add those boxes", description: err.message,
        status: "error", position: "top" });
      return false;
    }
  };

  const onManualAdd = async (entry) => {
    try {
      await addScan(entry);
      beepSuccess();
      setRejection(null);
      return true;
    } catch (err) {
      beepError();
      toast({ title: "Could not save", description: err.message,
        status: "error", position: "top" });
      return false;
    }
  };


  return (
    <>
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title="Box Weighing"
      width={980}
      footer={
        <Flex gap={2} width="100%" justify="space-between" wrap="wrap">
          <Flex gap={2} wrap="wrap">
            <Button size={{ base: "sm", md: "lg" }} variant="outline" onClick={() => setShowManual((v) => !v)}
              isDisabled={!session}>
              {showManual ? "Hide keypad" : "Show keypad"}
            </Button>
            {isOutgoing && (
              <Button size={{ base: "sm", md: "lg" }} variant={typeMode ? "solid" : "outline"}
                colorScheme={typeMode ? "blue" : "gray"}
                isDisabled={!session}
                onClick={() => setTypeMode((v) => { if (!v) setShowManual(false); return !v; })}>
                {typeMode ? "Stop typing" : "Type weights"}
              </Button>
            )}
          </Flex>
          <Flex gap={2} wrap="wrap">
            <Button size={{ base: "sm", md: "lg" }} variant="outline" colorScheme="blue"
              onClick={onPrintManifest} isDisabled={scans.length === 0}>
              Print manifest
            </Button>
            <Button size={{ base: "sm", md: "lg" }} variant="outline" onClick={onUndo} isDisabled={!session || pending === 0}>
              Undo last
            </Button>
            {!session ? (
              <Button size={{ base: "sm", md: "lg" }} colorScheme="blue" onClick={() => setConfirmStart(true)}
                isLoading={busy} isDisabled={!ready}>
                Start session
              </Button>
            ) : (
              <Button size={{ base: "sm", md: "lg" }} colorScheme="red"
                onClick={() => setConfirmStop(true)} isLoading={busy}>
                Stop session
              </Button>
            )}
          </Flex>
        </Flex>
      }
    >
      {!durable && (
        <Alert status="error" borderRadius="md" mb={3}>
          <AlertIcon />
          <Box>
            <Text fontWeight="bold">Scans will not survive a reload on this device.</Text>
            <Text fontSize="sm">
              Local storage is unavailable — this is usually Private Browsing on iPad.
              Turn it off before scanning a real batch.
            </Text>
          </Box>
        </Alert>
      )}

      {/* Carry on with a session that is already open, instead of opening a
          second one against the same lot. Hidden once a session is running, and
          hidden when the local resume banner is showing — that one is more
          urgent, because it holds scans the server has never seen. */}
      {!session && !resumable && openSessions.length > 0 && (
        <Box mb={3} p={3} bg="blue.50" borderRadius="md"
          border="1px solid" borderColor="blue.200">
          <Text fontSize="sm" fontWeight="600" color="blue.800" mb={2}>
            {openSessions.length} session{openSessions.length === 1 ? "" : "s"} still open
          </Text>
          <Flex direction="column" gap={2}>
            {openSessions.map((b) => (
              <Flex key={b.batch_id} align="center" gap={3} wrap="wrap"
                bg="white" borderRadius="md" px={3} py={2}
                border="1px solid" borderColor="blue.100">
                <Text fontSize="sm" fontWeight="700" color="blue.700">
                  {b.lot_number || `Batch ${b.batch_id}`}
                </Text>
                {b.vendor && <Text fontSize="sm" color="gray.600">{b.vendor}</Text>}
                {b.item_description && (
                  <Text fontSize="xs" color="gray.500">{b.item_description}</Text>
                )}
                <Text fontSize="xs" color="gray.600">
                  {b.box_count} box{b.box_count === 1 ? "" : "es"}
                  {" · "}{totalsOf(b)}
                </Text>
                <Text fontSize="xs" color="gray.400" whiteSpace="nowrap">
                  opened {fmtDate(b.created_at)}
                </Text>
                <Box flex={1} />
                <Button size="sm" colorScheme="blue" variant="outline"
                  isLoading={adopting === b.batch_id}
                  isDisabled={!ready || adopting != null}
                  onClick={() => onContinue(b)}>
                  Continue
                </Button>
              </Flex>
            ))}
          </Flex>
        </Box>
      )}

      <AlertDialog isOpen={confirmStop} leastDestructiveRef={cancelStopRef}
        onClose={() => setConfirmStop(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Stop this session?
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={3}>
                {scans.length} box{scans.length === 1 ? "" : "es"} will be closed
                onto the manifest for{" "}
                <b>{session?.lotNumber || header.lotNumber || "this lot"}</b>.
              </Text>
              <Text fontSize="xs" color="gray.500" textTransform="uppercase"
                letterSpacing="wide" mb={1}>
                Remarks (optional)
              </Text>
              <Textarea size="sm" rows={3} value={remarks}
                onChange={(e) => setRemarks(upper(e.target.value))}
                placeholder="ANYTHING WORTH SAYING ABOUT THIS TALLY"
                autoCorrect="off" autoCapitalize="characters" spellCheck={false}
                textTransform="uppercase" />
              <Text fontSize="xs" color="gray.500" mt={1}>
                Printed on the manifest as MEMO. Editable afterwards.
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              {/* Focus sits here, not on Close: the scanner types Enter, and a
                  stray scan must not be able to end the session. */}
              <Button ref={cancelStopRef} onClick={() => setConfirmStop(false)}>
                Go back
              </Button>
              <Button colorScheme="red" onClick={onStop} isLoading={busy}>
                Stop session
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {resumable && !session && (
        <Alert status="warning" borderRadius="md" mb={3}>
          <AlertIcon />
          <Flex justify="space-between" align="center" width="100%" gap={3} wrap="wrap">
            <Box>
              <Text fontWeight="bold">An unfinished batch was found.</Text>
              <Text fontSize="sm">
                Batch {resumable.batchId} has {resumable.pending} scan(s) that never reached the server.
              </Text>
            </Box>
            <Flex gap={2} wrap="wrap">
              <Button size="sm" variant="outline" colorScheme="gray"
                onClick={() => setConfirmDiscard(true)} isDisabled={busy}>
                Discard it
              </Button>
              <Button size="sm" colorScheme="yellow" onClick={onResume} isLoading={busy}>
                Resume it
              </Button>
            </Flex>
          </Flex>
        </Alert>
      )}

      <Flex gap={3} wrap="wrap" mb={3} align="stretch">
        {/* Pounds, two decimals — the same figure the grid and the printed
            tally show. Echoing the raw label instead would flash kilograms for
            a non-American box and disagree with every other number on screen. */}
        <StatCard
          label="Last box"
          value={lastScan ? toDisplay(toPounds(lastScan.weight, lastScan.weightUnit).weight) : "—"}
          help={lastScan
            ? (lastScan.weightUnit === "KG" ? `LB — label read ${lastScan.weight} KG` : "LB")
            : "waiting for a scan"}
          color={lastScan ? "blue.600" : "gray.400"}
        />
        <StatCard
          label="Unsent"
          value={pending}
          help={pending > 0 ? "keep this screen open" : "all synced"}
          color={pending > 0 ? "yellow.500" : "green.600"}
          size="2xl"
        />
      </Flex>

      {/* The tally sheet heading. Captured before scanning so the printed form
          comes out complete rather than needing to be filled in by hand. */}
      <Box px={4} py={3} bg="white" borderRadius="lg" border="1px solid" borderColor="gray.200" mb={3}>
        {session ? (
          <Flex gap={{ base: 3, md: 6 }} wrap="wrap" align="baseline">
            <Box>
              <Text fontSize="xs" color="gray.500" textTransform="uppercase">Lot</Text>
              <Text fontSize="2xl" fontWeight="bold" color="red.800" lineHeight="1.1">
                {session.lotNumber || "—"}
              </Text>
            </Box>
            <Box><Text fontSize="xs" color="gray.500" textTransform="uppercase">Vendor</Text>
              <Text fontSize="md" fontWeight="600">{session.vendor || "—"}</Text></Box>
            <Box><Text fontSize="xs" color="gray.500" textTransform="uppercase">Item</Text>
              <Text fontSize="md" fontWeight="600">{session.itemDescription || "—"}</Text></Box>
            <Box><Text fontSize="xs" color="gray.500" textTransform="uppercase">BOL</Text>
              <Text fontSize="md" fontWeight="600">{session.billOfLading || "—"}</Text></Box>
          </Flex>
        ) : (
          <Flex gap={3} wrap="wrap">
            <Box flex="1 1 220px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Lot #</Text>
              {/* Starting a session is incoming-side, so this may issue a lot.
                  Safe to hold focusable fields: the header only renders before
                  the session opens, and nothing is being scanned yet. */}
              <LotPicker
                size="md"
                allowCreate
                value={header.lotId}
                lotNumber={header.lotNumber}
                onChange={(lot) => setHeader((h) => ({
                  ...h,
                  lotId: lot ? lot.lotId : null,
                  lotNumber: lot ? lot.lotNumber : "",
                }))}
              />
            </Box>
            <Box flex="1 1 150px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Vendor</Text>
              {/* Suggests the spellings already in use, without locking the
                  field — a new supplier still gets typed. */}
              <VendorInput {...rawInputProps} size="md" value={header.vendor}
                onChange={setField("vendor")} placeholder="TREX/GOP"
                listId="vendor-suggestions-scanner" />
            </Box>
            <Box flex="2 1 220px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Item description</Text>
              <Input {...rawInputProps} size="md" value={header.itemDescription}
                onChange={setField("itemDescription")} placeholder="HUMERUS BONE" />
            </Box>
            <Box flex="1 1 150px">
              {/* Still stored as bill_of_lading — the column is unchanged, only
                  what the operator is being asked for. */}
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Vendor Lot #/IC#</Text>
              <Input {...rawInputProps} size="md" value={header.billOfLading}
                onChange={setField("billOfLading")} />
            </Box>

            {/* Captured but NOT printed. These describe the product rather than
                the tally, and the manifest reproduces a paper form that has to
                keep matching it — so they are stored and shown on the session,
                never added to the sheet. Known at weighing time and tedious to
                reconstruct afterwards, which is the whole reason to take them. */}
            <Box flex="1 1 120px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Brand</Text>
              <Input {...rawInputProps} size="md" value={header.brand}
                onChange={setField("brand")} placeholder="IBP" />
            </Box>
            <Box flex="1 1 110px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>EST #</Text>
              <Input {...rawInputProps} size="md" value={header.estNumber}
                onChange={setField("estNumber")} placeholder="9268" />
            </Box>
            <Box flex="1 1 110px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Grade</Text>
              <Input {...rawInputProps} size="md" value={header.grade}
                onChange={setField("grade")} placeholder="CHOICE" />
            </Box>
            {/* Optional. Drives "Box 12 of 80" while weighing, so being short
                is noticed DURING the lot rather than after the truck has gone.
                Never a limit — box 81 is recorded and flagged, not refused. */}
            <Box flex="1 1 120px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>
                Expected boxes
              </Text>
              <Input {...rawInputProps} size="md" value={header.expectedBoxes}
                onChange={setField("expectedBoxes")} placeholder="80" inputMode="numeric" />
            </Box>
          </Flex>
        )}
      </Box>

      <ScanSheet
        scans={scans}
        busyId={rowBusy}
        onEditWeight={session
          ? onRowChange((row, weight, unit) => editScan(row.localId, weight, unit),
              "Weight corrected")
          : undefined}
        onVoid={session
          ? onRowChange((row) => voidScan(row.localId), "Box taken off the tally")
          : undefined}
      />

      {lastError && (
        <Alert status="warning" borderRadius="md" mb={3} fontSize="sm">
          <AlertIcon />
          <Box flex={1}>
            Could not reach the server ({lastError}). Scans are being kept on this
            device and will send automatically.
          </Box>
          <Button size="sm" onClick={flush}>Retry now</Button>
        </Alert>
      )}

      {rejection && (
        <Alert status="error" borderRadius="md" mb={3}>
          <AlertIcon />
          <Box flex={1}>
            <Text fontWeight="bold">
              {rejection.code === "NO_WEIGHT_AI"
                ? "This label has no weight barcode"
                : "Bad scan — not recorded"}
            </Text>
            <Text fontSize="sm">{rejection.reason}</Text>
            {rejection.code === "NO_WEIGHT_AI" && (
              <Text fontSize="sm" mt={1}>
                Type this box's weight on the keypad below.
              </Text>
            )}
          </Box>
          <Button size="sm" onClick={() => setRejection(null)}>Dismiss</Button>
        </Alert>
      )}

      {session ? (
        <Box p={4} bg="green.50" borderRadius="md" border="1px solid" borderColor="green.200" mb={3}>
          <Flex align="center" gap={3} wrap="wrap">
            <Badge colorScheme="green" fontSize="sm" px={2} py={1}>Scanning</Badge>
            <Text fontSize="sm" color="gray.700">
              Batch {session.batchId} — scan boxes now. Do not close this window while
              unsent scans remain.
            </Text>
          </Flex>
        </Box>
      ) : (
        <Box p={4} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300" mb={3}>
          <Text fontSize="sm" color="gray.600">
            Press <strong>Start session</strong> to open a batch, then scan each box.
            Weights are read from the barcode; a keypad opens with the session for
            the labels that cannot be scanned.
          </Text>
        </Box>
      )}


      <AlertDialog
        isOpen={confirmDiscard}
        leastDestructiveRef={cancelDiscardRef}
        onClose={() => setConfirmDiscard(false)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Discard the unfinished batch?
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={2}>
                {resumable
                  ? `Batch ${resumable.batchId} holds ${resumable.pending} scan(s) that never reached the server.`
                  : "This batch holds scans that never reached the server."}
              </Text>
              <Text fontSize="sm" color="red.700">
                There is no copy of them anywhere else. Discarding loses those
                weights for good — resuming sends them and takes a few seconds.
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              {/* Focus sits here: the scanner types Enter, and this is the
                  button that keeps the operator's work. */}
              <Button ref={cancelDiscardRef} onClick={() => setConfirmDiscard(false)}>
                Go back
              </Button>
              <Button colorScheme="red" onClick={onDiscardResumable} isLoading={busy}>
                Discard the scans
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <AlertDialog
        isOpen={confirmStart}
        leastDestructiveRef={cancelStartRef}
        onClose={() => setConfirmStart(false)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Check the lot and details before starting
            </AlertDialogHeader>

            <AlertDialogBody>
              <Text fontSize="sm" mb={3}>
                Every box scanned in this session is recorded against these details,
                and the lot number cannot be changed once scanning begins.
              </Text>

              <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden">
                {[
                  ["Lot #", header.lotNumber.trim()],
                  ["Vendor", header.vendor.trim()],
                  ["Item description", header.itemDescription.trim()],
                  ["Vendor Lot #/IC#", header.billOfLading.trim()],
                  ["Brand", header.brand.trim()],
                  ["EST #", header.estNumber.trim()],
                  ["Grade", header.grade.trim()],
                  ["Expected boxes", header.expectedBoxes.trim()],
                ].map(([label, value], i) => (
                  <Flex key={label} px={3} py={2} gap={{ base: 0, sm: 3 }}
                    direction={{ base: "column", sm: "row" }}
                    align={{ base: "flex-start", sm: "baseline" }}
                    bg={i % 2 ? "gray.50" : "white"}>
                    <Text fontSize="xs" color="gray.500" minW={{ base: "auto", sm: "120px" }}
                      textTransform="uppercase" letterSpacing="wide">
                      {label}
                    </Text>
                    {value ? (
                      <Text fontSize={label === "Lot #" ? "lg" : "sm"}
                        fontWeight={label === "Lot #" ? "bold" : "medium"}
                        color={label === "Lot #" ? "red.800" : "gray.800"}>
                        {value}
                      </Text>
                    ) : (
                      <Text fontSize="sm" color="yellow.600" fontStyle="italic">
                        not set — will print blank on the manifest
                      </Text>
                    )}
                  </Flex>
                ))}
              </Box>
            </AlertDialogBody>

            <AlertDialogFooter gap={2}>
              <Button ref={cancelStartRef} onClick={() => setConfirmStart(false)}>
                Go back and edit
              </Button>
              <Button colorScheme="blue" onClick={doStart} isLoading={busy}>
                Start scanning
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </FloatingWindow>

    {/* The keypad is its own window so it is reachable without scrolling the
        session window past the grid. It is a sibling rather than a child, but
        its isOpen is ANDed with the session window's — closing the session
        closes this with it, and it can never be left floating over a screen
        that has nothing to do with weighing.

        Placed right rather than centred: it would otherwise land on top of the
        grid's left-hand columns, which are the weight and unit being read. */}
    <FloatingWindow
      isOpen={isOpen && Boolean(session) && showManual}
      onClose={() => setShowManual(false)}
      title="Keypad"
      width={320}
      placement="right"
      zIndex={1401}
    >
      <KeypadPanel onAdd={onManualAdd} onAddMany={onManualAddMany} disabled={busy} />
    </FloatingWindow>

    {/* Typing, in its own window beside the session like the keypad, so it
        closes with the session and can never be left floating over another
        screen. */}
    <FloatingWindow
      isOpen={isOpen && Boolean(session) && typeMode}
      onClose={() => setTypeMode(false)}
      title="Type weights"
      width={520}
      placement="right"
      zIndex={1401}
    >
      <TypeWeights
        disabled={busy}
        expected={session?.expectedBoxes ?? null}
        // The lot so far, for the outlier check.
        weights={scans
          .filter((s) => s.status !== "voided" && s.status !== "duplicate")
          .map((s) => s.displayWeight || s.weight)}
        onAdd={(weight) => onManualAdd({ weight, weightUnit: "LB", isManual: true })}
        onUndo={onUndo}
      />
    </FloatingWindow>

    </>
  );
};

export default BoxScanner;
