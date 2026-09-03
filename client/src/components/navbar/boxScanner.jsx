import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Input, Divider,
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
import getRole from "../../utils/getRole";
import { lotNumberForDate, today, fmtDate } from "../../pages/noblesse/shared";
import printWeightManifest from "../../pages/noblesse/printWeightManifest";

// Operator-facing scanning screen. Designed to be read across a bench by
// someone wearing gloves holding a box: big numbers, few controls, and an
// error state that cannot be mistaken for a success.

// Inputs must not be "helped" by iPadOS — autocorrect on a lot number is
// silent data corruption.
const rawInputProps = {
  autoCorrect: "off",
  autoCapitalize: "off",
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
// looking for. Most boxes are scanned, but a damaged or unbarcoded label has to
// be typed, and on the iPad that is only possible here — a paired Bluetooth
// scanner is an HID keyboard, so iPadOS suppresses its own on-screen keyboard.
//
// Nothing on this panel is focusable by default. That is deliberate: the global
// keydown handler below ignores keystrokes whose target is an INPUT, TEXTAREA or
// SELECT, so any field left focused here would silently swallow scans instead of
// recording them. The unit lives on the keypad as buttons, and the note — which
// needs a real keyboard and so is desktop-only in practice — stays collapsed.
const KeypadPanel = ({ onAdd, disabled }) => {
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState("LB");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const valid = /^\d{1,5}(\.\d{1,3})?$/.test(weight) && parseFloat(weight) > 0;

  const submit = async () => {
    if (!valid) return;
    await onAdd({ weight, weightUnit: unit, isManual: true, note });
    setWeight("");
    setNote("");
    setShowNote(false);
  };

  return (
    <Box p={3} bg="orange.50" borderRadius="md" border="1px solid" borderColor="orange.200">
      <Flex justify="space-between" align="baseline" mb={2} gap={2} wrap="wrap">
        <Text fontSize="sm" fontWeight="bold" color="orange.800">
          Type a weight — damaged or unbarcoded label
        </Text>
        <Button size="xs" variant="ghost" colorScheme="orange" tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowNote((v) => !v)}>
          {showNote ? "Hide note" : "Add note"}
        </Button>
      </Flex>

      <Flex gap={3} wrap="wrap" align="flex-start">
        <Box flex="0 0 240px" maxW="100%">
          <NumericKeypad
            value={weight}
            onChange={setWeight}
            onSubmit={submit}
            label="Weight"
            unit={unit}
            onUnitChange={setUnit}
            submitLabel="Add box"
            isDisabled={disabled}
          />
        </Box>

        <Box flex="1 1 200px">
          {showNote ? (
            <>
              <Text fontSize="xs" color="gray.600" mb={1}>Note (optional)</Text>
              <Input {...rawInputProps} size={{ base: "md", md: "lg" }} placeholder="torn label"
                value={note} onChange={(e) => setNote(e.target.value)} />
              {/* Said out loud because the consequence is silent: a focused
                  field takes the scanner's keystrokes instead of the session. */}
              <Text fontSize="xs" color="orange.700" mt={1}>
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
    </Box>
  );
};

const BoxScanner = ({ isOpen, onClose }) => {
  const {
    ready, durable, session, pending, resumable, lastError, stats, lastScan, scans,
    start, resume, stop, flush, addScan, undoLast, editScan, voidScan, eraseScan,
  } = useScanSession();

  // Erasing a row outright is admin-only. The server enforces it; this only
  // decides whether to draw the control.
  const isAdmin = getRole() === "admin";

  // One session is one lot, so the manifest produced at Stop covers exactly
  // these boxes. Defaults to today's lot; editable before the session opens.
  const [header, setHeader] = useState({
    lotNumber: lotNumberForDate(), vendor: "", billOfLading: "", itemDescription: "",
  });
  const setField = (key) => (e) => {
    const { value } = e.target;
    setHeader((h) => ({ ...h, [key]: value }));
  };

  const [confirmStart, setConfirmStart] = useState(false);
  // Focus sits on "Go back" so Enter dismisses rather than commits — the
  // scanner types Enter, and this dialog is open while one is in someone's hand.
  const cancelStartRef = useRef(null);
  const [rejection, setRejection] = useState(null);
  const [busy, setBusy] = useState(false);
  // Open by default: the keypad is part of the session, not something to go
  // hunting for when a torn label turns up mid-pallet. Collapsible because the
  // scan grid is the primary readout and sometimes wants the room.
  const [showManual, setShowManual] = useState(true);
  const [rowBusy, setRowBusy] = useState(null);
  const toast = useToast();
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

  // Confirmed before opening the batch, because the lot is fixed for the whole
  // session: every box scanned after this belongs to it, and getting it wrong
  // means re-scanning the pallet rather than editing a field.
  const doStart = async () => {
    setBusy(true);
    try {
      await primeAudio(); // iOS needs a gesture before audio will play
      await start({
        lotNumber: header.lotNumber.trim() || null,
        vendor: header.vendor.trim() || null,
        billOfLading: header.billOfLading.trim() || null,
        itemDescription: header.itemDescription.trim() || null,
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
    try {
      const result = await stop();
      if (result.closed) {
        toast({ title: "Batch closed",
          description: `${result.summary.totalBoxes} boxes recorded`,
          status: "success", position: "top", duration: 4000 });
      } else if (result.reason === "unflushed-scans") {
        toast({ title: "Not closed — scans still unsent",
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

  const onManualAdd = async (entry) => {
    try {
      await addScan(entry);
      beepSuccess();
      setRejection(null);
    } catch (err) {
      beepError();
      toast({ title: "Could not save", description: err.message,
        status: "error", position: "top" });
    }
  };


  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title="Box Weighing"
      width={980}
      footer={
        <Flex gap={2} width="100%" justify="space-between" wrap="wrap">
          <Button size={{ base: "sm", md: "lg" }} variant="outline" onClick={() => setShowManual((v) => !v)}
            isDisabled={!session}>
            {showManual ? "Hide keypad" : "Show keypad"}
          </Button>
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
              <Button size={{ base: "sm", md: "lg" }} colorScheme="red" onClick={onStop} isLoading={busy}>
                Stop &amp; close
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
            <Button size="sm" colorScheme="orange" onClick={onResume} isLoading={busy}>
              Resume it
            </Button>
          </Flex>
        </Alert>
      )}

      <Flex gap={3} wrap="wrap" mb={3} align="stretch">
        <StatCard
          label="Last box"
          value={lastScan ? lastScan.weight : "—"}
          help={lastScan ? lastScan.weightUnit : "waiting for a scan"}
          color={lastScan ? "blue.600" : "gray.400"}
        />
        <StatCard
          label="Unsent"
          value={pending}
          help={pending > 0 ? "keep this screen open" : "all synced"}
          color={pending > 0 ? "orange.500" : "green.600"}
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
            <Box flex="1 1 150px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Lot #</Text>
              <Input {...rawInputProps} size="md" value={header.lotNumber}
                onChange={setField("lotNumber")} placeholder="N26244-01" />
            </Box>
            <Box flex="1 1 150px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Vendor</Text>
              <Input {...rawInputProps} size="md" value={header.vendor}
                onChange={setField("vendor")} placeholder="TREX/GOP" />
            </Box>
            <Box flex="2 1 220px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Item description</Text>
              <Input {...rawInputProps} size="md" value={header.itemDescription}
                onChange={setField("itemDescription")} placeholder="HUMERUS BONE" />
            </Box>
            <Box flex="1 1 150px">
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>Ship to / BOL</Text>
              <Input {...rawInputProps} size="md" value={header.billOfLading}
                onChange={setField("billOfLading")} />
            </Box>
          </Flex>
        )}
      </Box>

      <ScanSheet
        scans={scans}
        totals={stats.totals}
        busyId={rowBusy}
        onEditWeight={session
          ? onRowChange((row, weight, unit) => editScan(row.localId, weight, unit),
              "Weight corrected")
          : undefined}
        onVoid={session
          ? onRowChange((row) => voidScan(row.localId), "Box taken off the tally")
          : undefined}
        onHardDelete={session && isAdmin
          ? onRowChange((row) => eraseScan(row.localId), "Row erased")
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

      {showManual && session && (
        <>
          <Divider my={3} />
          <KeypadPanel onAdd={onManualAdd} disabled={busy} />
        </>
      )}

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
                  ["Ship to / BOL", header.billOfLading.trim()],
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
                      <Text fontSize="sm" color="orange.500" fontStyle="italic">
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
  );
};

export default BoxScanner;
