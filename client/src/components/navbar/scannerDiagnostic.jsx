import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Code, Divider, Table, Thead, Tbody, Tr, Th, Td,
  Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import FloatingWindow from "../FloatingWindow";
import { parseGs1 } from "../../utils/gs1";

// Answers the one question that cannot be answered without the hardware in hand:
// what does this particular scanner actually transmit? Trigger one scan into
// this window and it shows the exact payload, any prefix or suffix, whether
// FNC1/GS came through, the inter-key timings, and whether it parses.
//
// Everything downstream is configured from what this reports, so nothing about
// the label format has to be assumed.

const GS = String.fromCharCode(29);

// Renders control characters visibly instead of letting them vanish.
const visualize = (s) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\x00-\x1F\x7F]/g, (c) => {
    if (c === GS) return "␝";
    return "␀".replace("␀", "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"));
  });

const KeyRow = ({ entry, prev }) => {
  const gap = prev ? Math.round(entry.timeStamp - prev.timeStamp) : 0;
  const printable = entry.key.length === 1;
  return (
    <Tr>
      <Td fontSize="xs">{entry.i}</Td>
      <Td fontSize="xs">
        <Code fontSize="xs">{printable ? visualize(entry.key) : entry.key}</Code>
      </Td>
      <Td fontSize="xs">{printable ? entry.key.charCodeAt(0) : "—"}</Td>
      <Td fontSize="xs">{entry.code || "—"}</Td>
      <Td fontSize="xs" color={gap > 100 ? "yellow.500" : "gray.500"}>
        {prev ? `${gap} ms` : "—"}
      </Td>
    </Tr>
  );
};

const ScannerDiagnostic = ({ isOpen, onClose }) => {
  const [keys, setKeys] = useState([]);
  const [capture, setCapture] = useState(null);
  const [listening, setListening] = useState(true);
  const bufferRef = useRef([]);
  const toast = useToast();

  const reset = useCallback(() => {
    bufferRef.current = [];
    setKeys([]);
    setCapture(null);
  }, []);

  const finalize = useCallback((terminator) => {
    const entries = bufferRef.current;
    bufferRef.current = [];
    if (entries.length === 0) return;

    const raw = entries.filter((e) => e.key.length === 1).map((e) => e.key).join("");
    const gaps = entries.slice(1).map((e, i) => e.timeStamp - entries[i].timeStamp);

    let parsed = null;
    let parseError = null;
    try {
      parsed = parseGs1(raw);
    } catch (err) {
      parseError = { code: err.code, message: err.message, partial: err.partial || null };
    }

    // Same payload with GS stripped, to tell "no separator sent" apart from
    // "separator sent but as some other character".
    let withoutGs = null;
    if (!raw.includes(GS)) {
      const suspects = raw.match(/[^\x20-\x7E]|[#|^~]/g);
      withoutGs = suspects ? Array.from(new Set(suspects)) : [];
    }

    setCapture({
      raw,
      length: raw.length,
      terminator,
      containsGs: raw.includes(GS),
      gsCandidates: withoutGs,
      leadingNonDigit: /^\D/.test(raw) ? raw[0] : null,
      timing: gaps.length
        ? { min: Math.round(Math.min(...gaps)), max: Math.round(Math.max(...gaps)),
            avg: Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) }
        : null,
      parsed,
      parseError,
    });
  }, []);

  useEffect(() => {
    if (!isOpen || !listening) return undefined;

    const onKeyDown = (e) => {
      // Let the operator still use the close button and copy shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        finalize(e.key);
        return;
      }
      const entry = {
        i: bufferRef.current.length,
        key: e.key,
        code: e.code,
        timeStamp: e.timeStamp || performance.now(),
      };
      bufferRef.current.push(entry);
      setKeys([...bufferRef.current]);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, listening, finalize]);

  const copyReport = () => {
    if (!capture) return;
    const report = [
      "SCANNER DIAGNOSTIC",
      `raw (visualized): ${visualize(capture.raw)}`,
      `length: ${capture.length}`,
      `terminator: ${capture.terminator}`,
      `contains GS (0x1D): ${capture.containsGs}`,
      `possible GS stand-ins: ${(capture.gsCandidates || []).join(" ") || "none seen"}`,
      `leading non-digit: ${capture.leadingNonDigit || "none"}`,
      capture.timing
        ? `inter-key ms: min ${capture.timing.min} / avg ${capture.timing.avg} / max ${capture.timing.max}`
        : "inter-key ms: n/a",
      capture.parsed
        ? `parsed: ${capture.parsed.weight.value} ${capture.parsed.weight.unit}, gtin ${capture.parsed.gtin}, serial ${capture.parsed.serial}, production ${capture.parsed.productionDate || "-"}, packaging ${capture.parsed.packagingDate || "-"}, lot ${capture.parsed.lot || "-"}`
        : `parse FAILED: ${capture.parseError.code} — ${capture.parseError.message}`,
    ].join("\n");
    navigator.clipboard?.writeText(report);
    toast({ title: "Report copied", status: "success", duration: 2000, position: "top" });
  };

  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title="Scanner Diagnostic — capture raw output"
      width={900}
      footer={
        <Flex gap={2} width="100%" justify="space-between" wrap="wrap">
          <Button size="sm" variant="outline" onClick={() => setListening((v) => !v)}>
            {listening ? "Pause capture" : "Resume capture"}
          </Button>
          <Flex gap={2}>
            <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>
            <Button size="sm" colorScheme="blue" onClick={copyReport} isDisabled={!capture}>
              Copy report
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Alert status="info" borderRadius="md" mb={4} fontSize="sm">
        <AlertIcon />
        Click inside this window, then trigger one scan. Nothing is saved — this only
        reports what the scanner transmits.
      </Alert>

      <Flex gap={2} mb={3} align="center" wrap="wrap">
        <Badge colorScheme={listening ? "green" : "gray"}>
          {listening ? "Listening" : "Paused"}
        </Badge>
        <Text fontSize="sm" color="gray.500">
          {keys.length} key{keys.length === 1 ? "" : "s"} buffered
        </Text>
      </Flex>

      {capture && (
        <Box mb={4} p={3} bg="gray.50" borderRadius="md" border="1px solid" borderColor="gray.200">
          <Text fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" mb={2}>
            Captured payload
          </Text>
          <Code display="block" whiteSpace="pre-wrap" wordBreak="break-all" p={2} mb={3} fontSize="sm">
            {visualize(capture.raw)}
          </Code>

          <Flex gap={4} wrap="wrap" fontSize="sm" mb={3}>
            <Text><strong>Length:</strong> {capture.length}</Text>
            <Text><strong>Terminator:</strong> {capture.terminator}</Text>
            <Text>
              <strong>GS (0x1D):</strong>{" "}
              <Badge colorScheme={capture.containsGs ? "green" : "yellow"}>
                {capture.containsGs ? "transmitted" : "not transmitted"}
              </Badge>
            </Text>
            {capture.leadingNonDigit && (
              <Text><strong>Leading prefix char:</strong> <Code>{capture.leadingNonDigit}</Code></Text>
            )}
          </Flex>

          {!capture.containsGs && (
            <Alert status="warning" borderRadius="md" fontSize="sm" mb={3}>
              <AlertIcon />
              <Box>
                No FNC1/GS separator came through. That is fine only if every label
                keeps its variable-length fields (lot, serial) last.
                {capture.gsCandidates && capture.gsCandidates.length > 0 && (
                  <> Possible stand-in characters seen:{" "}
                    {capture.gsCandidates.map((c) => <Code key={c} mx={1}>{c}</Code>)}</>
                )}
              </Box>
            </Alert>
          )}

          {capture.timing && (
            <Text fontSize="sm" mb={3}>
              <strong>Inter-key timing:</strong> min {capture.timing.min}ms / avg{" "}
              {capture.timing.avg}ms / max {capture.timing.max}ms
              {capture.timing.max > 50 && (
                <Badge ml={2} colorScheme="yellow">exceeds 50ms — timing heuristics unsafe</Badge>
              )}
            </Text>
          )}

          <Divider my={3} />

          {capture.parsed ? (
            <Box>
              <Badge colorScheme="green" mb={2}>Parsed successfully</Badge>
              <Flex gap={4} wrap="wrap" fontSize="sm">
                <Text><strong>Weight:</strong> {capture.parsed.weight.value} {capture.parsed.weight.unit}</Text>
                <Text><strong>GTIN:</strong> {capture.parsed.gtin || "—"}</Text>
                <Text><strong>Production date:</strong> {capture.parsed.productionDate || "—"}</Text>
                <Text><strong>Packaging date:</strong> {capture.parsed.packagingDate || "—"}</Text>
                <Text><strong>Lot:</strong> {capture.parsed.lot || "—"}</Text>
                <Text><strong>Serial:</strong> {capture.parsed.serial || "—"}</Text>
              </Flex>
            </Box>
          ) : (
            <Box>
              <Badge colorScheme="red" mb={2}>{capture.parseError.code}</Badge>
              <Text fontSize="sm" color="red.600">{capture.parseError.message}</Text>
              {capture.parseError.partial && (
                <Text fontSize="sm" color="gray.600" mt={1}>
                  Partial data recovered — GTIN {capture.parseError.partial.gtin || "—"},
                  lot {capture.parseError.partial.lot || "—"}
                </Text>
              )}
            </Box>
          )}
        </Box>
      )}

      {keys.length > 0 && (
        <Box overflowX="auto" maxH="40vh" overflowY="auto">
          <Table size="sm" variant="simple" style={{ minWidth: "520px" }}>
            <Thead position="sticky" top={0} bg="white" zIndex={1}>
              <Tr>
                <Th fontSize="xs">#</Th>
                <Th fontSize="xs">Key</Th>
                <Th fontSize="xs">Char code</Th>
                <Th fontSize="xs">event.code</Th>
                <Th fontSize="xs">Gap</Th>
              </Tr>
            </Thead>
            <Tbody>
              {keys.map((entry, i) => (
                <KeyRow key={entry.i} entry={entry} prev={i > 0 ? keys[i - 1] : null} />
              ))}
            </Tbody>
          </Table>
        </Box>
      )}
    </FloatingWindow>
  );
};

export default ScannerDiagnostic;
