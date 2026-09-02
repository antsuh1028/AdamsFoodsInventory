import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Input, Select, Divider,
  Alert, AlertIcon, Stat, StatLabel, StatNumber, StatHelpText, useToast,
} from "@chakra-ui/react";
import FloatingWindow from "../FloatingWindow";
import useScanSession from "../../hooks/useScanSession";
import { createScanAssembler } from "../../utils/scanInput";
import { parseGs1 } from "../../utils/gs1";
import { primeAudio, beepSuccess, beepError } from "../../utils/scanFeedback";
import ScanSheet from "./ScanSheet";
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
    border="1px solid" borderColor="gray.200" minW="150px" flex="1 1 150px"
  >
    <StatLabel fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
      {label}
    </StatLabel>
    <StatNumber fontSize={size} lineHeight="1.1" color={color}>{value}</StatNumber>
    {help && <StatHelpText fontSize="xs" mb={0}>{help}</StatHelpText>}
  </Stat>
);

const ManualEntry = ({ onAdd, disabled }) => {
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState("LB");
  const [note, setNote] = useState("");

  const valid = /^\d{1,5}(\.\d{1,3})?$/.test(weight) && parseFloat(weight) > 0;

  const submit = async () => {
    if (!valid) return;
    await onAdd({ weight, weightUnit: unit, isManual: true, note });
    setWeight("");
    setNote("");
  };

  return (
    <Box p={3} bg="orange.50" borderRadius="md" border="1px solid" borderColor="orange.200">
      <Text fontSize="sm" fontWeight="bold" color="orange.800" mb={2}>
        Manual entry — damaged or unbarcoded label
      </Text>
      <Flex gap={2} wrap="wrap" align="flex-end">
        <Box flex="1 1 140px">
          <Text fontSize="xs" color="gray.600" mb={1}>Weight</Text>
          <Input
            {...rawInputProps}
            size="lg" inputMode="decimal" placeholder="76.20"
            value={weight} onChange={(e) => setWeight(e.target.value)}
            isInvalid={weight.length > 0 && !valid}
          />
        </Box>
        <Box flex="0 0 110px">
          <Text fontSize="xs" color="gray.600" mb={1}>Unit</Text>
          <Select size="lg" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="LB">LB</option>
            <option value="KG">KG</option>
          </Select>
        </Box>
        <Box flex="2 1 200px">
          <Text fontSize="xs" color="gray.600" mb={1}>Note (optional)</Text>
          <Input {...rawInputProps} size="lg" placeholder="torn label"
            value={note} onChange={(e) => setNote(e.target.value)} />
        </Box>
        <Button size="lg" colorScheme="orange" onClick={submit}
          isDisabled={!valid || disabled}>
          Add
        </Button>
      </Flex>
    </Box>
  );
};

const BoxScanner = ({ isOpen, onClose }) => {
  const {
    ready, durable, session, pending, resumable, lastError, stats, lastScan, scans,
    start, resume, stop, flush, addScan, undoLast,
  } = useScanSession();

  // One session is one lot, so the manifest produced at Stop covers exactly
  // these boxes. Defaults to today's lot; editable before the session opens.
  const [header, setHeader] = useState({
    lotNumber: lotNumberForDate(), vendor: "", billOfLading: "", itemDescription: "",
  });
  const setField = (key) => (e) => {
    const { value } = e.target;
    setHeader((h) => ({ ...h, [key]: value }));
  };

  const [rejection, setRejection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
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

  const onStart = async () => {
    setBusy(true);
    try {
      await primeAudio(); // iOS needs a gesture before audio will play
      await start({
        lotNumber: header.lotNumber.trim() || null,
        vendor: header.vendor.trim() || null,
        billOfLading: header.billOfLading.trim() || null,
        itemDescription: header.itemDescription.trim() || null,
      });
    } catch (err) {
      toast({ title: "Could not start session", description: err.message,
        status: "error", position: "top", duration: 5000 });
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
          <Button size="lg" variant="outline" onClick={() => setShowManual((v) => !v)}
            isDisabled={!session}>
            {showManual ? "Hide manual entry" : "Manual entry"}
          </Button>
          <Flex gap={2} wrap="wrap">
            <Button size="lg" variant="outline" colorScheme="blue"
              onClick={onPrintManifest} isDisabled={scans.length === 0}>
              Print manifest
            </Button>
            <Button size="lg" variant="outline" onClick={onUndo} isDisabled={!session || pending === 0}>
              Undo last
            </Button>
            {!session ? (
              <Button size="lg" colorScheme="blue" onClick={onStart} isLoading={busy} isDisabled={!ready}>
                Start session
              </Button>
            ) : (
              <Button size="lg" colorScheme="red" onClick={onStop} isLoading={busy}>
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
          <Flex gap={6} wrap="wrap" align="baseline">
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

      <ScanSheet scans={scans} totals={stats.totals} />

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
                Use manual entry for this box.
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
            Weights are read from the barcode — nothing is typed.
          </Text>
        </Box>
      )}

      {showManual && session && (
        <>
          <Divider my={3} />
          <ManualEntry onAdd={onManualAdd} disabled={busy} />
        </>
      )}
    </FloatingWindow>
  );
};

export default BoxScanner;
