import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Code, Select, Input,
  Table, Thead, Tbody, Tr, Th, Td, Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import FloatingWindow from "../FloatingWindow";
import { isSupported, connectScale, DEFAULT_PORT_OPTIONS } from "../../utils/scaleSerial";
import { parseScaleLine } from "../../utils/scaleParse";

// Answers the one question that cannot be answered without the hardware:
// what does THIS Defender 3000 actually transmit?
//
// Its print format is configured on the device — gross/net prefixes, stability
// flags, unit position, line endings — so every guess about the format is just
// a guess until a real reading lands here. This shows the exact bytes beside
// what the parser made of them, so the parser is corrected from evidence.
//
// Same purpose as scannerDiagnostic.jsx, which exists to configure the barcode
// scanner, and it is reached the same way: admin only, from the Noblesse menu.

// Control characters would otherwise vanish, and an unexpected STX or NUL is
// exactly the kind of thing that has to be visible here.
const visualize = (s) =>
  // eslint-disable-next-line no-control-regex
  String(s).replace(/[\x00-\x1F\x7F]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

// Ohaus ships at 9600. The rest are here because the unit is configurable and
// a wrong baud rate produces garbage rather than silence — which looks like a
// broken cable unless you can try another rate.
const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

// What the indicator is set to, used only when a line carries no unit itself.
// The Defender at this station prints a bare number, so without this every
// reading is refused — and defaulting silently would be a 2.2x error nobody
// could see. Stating it here makes it a visible setting instead.
const ASSUMED_UNITS = [
  ["LB", "lb — indicator set to pounds"],
  ["KG", "kg — indicator set to kilograms"],
  ["", "none — refuse lines with no unit"],
];

const LineRow = ({ entry }) => {
  const p = entry.parsed;
  return (
    <Tr>
      <Td fontSize="xs" color="gray.500" whiteSpace="nowrap">{entry.at}</Td>
      <Td>
        <Code fontSize="xs" wordBreak="break-all">{visualize(entry.raw) || "(empty)"}</Code>
      </Td>
      <Td>
        {p.ok ? (
          <Flex align="center" gap={2} wrap="wrap">
            <Badge colorScheme="green" fontSize="10px">OK</Badge>
            <Text fontSize="sm" fontWeight="600" style={{ fontVariantNumeric: "tabular-nums" }}>
              {p.weight}
            </Text>
            <Badge colorScheme={p.unit === "LB" ? "blue" : "yellow"} fontSize="10px">
              {p.unit}
            </Badge>
            {p.unitAssumed && (
              <Badge colorScheme="blue" fontSize="9px" title="The line carried no unit; this is the station setting">
                unit assumed
              </Badge>
            )}
            {p.stable === true && <Badge colorScheme="green" fontSize="9px">stable</Badge>}
            {p.stable === false && <Badge colorScheme="yellow" fontSize="9px">unstable</Badge>}
            {p.stable === null && <Text fontSize="9px" color="gray.400">stability not reported</Text>}
          </Flex>
        ) : (
          <Flex align="center" gap={2} wrap="wrap">
            <Badge colorScheme="red" fontSize="10px">{p.code}</Badge>
            <Text fontSize="xs" color="gray.600">{p.reason}</Text>
          </Flex>
        )}
      </Td>
    </Tr>
  );
};

const ScaleDiagnostic = ({ isOpen, onClose }) => {
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [baudRate, setBaudRate] = useState(DEFAULT_PORT_OPTIONS.baudRate);
  const [assumeUnit, setAssumeUnit] = useState("LB");
  const [command, setCommand] = useState("P");
  const [error, setError] = useState(null);
  const handleRef = useRef(null);

  const supported = isSupported();

  // Read through a ref so the live read loop always uses the CURRENT setting.
  // The loop is started once at connect and would otherwise close over whatever
  // the unit was at that moment, so changing it would appear to do nothing.
  const assumeUnitRef = useRef(assumeUnit);
  assumeUnitRef.current = assumeUnit;

  const append = useCallback((raw) => {
    setLines((prev) => [
      {
        raw,
        parsed: parseScaleLine(raw, { assumeUnit: assumeUnitRef.current || null }),
        at: new Date().toLocaleTimeString(),
      },
      // Newest first, capped: a scale left in continuous mode emits several a
      // second and an unbounded list would take the window down with it.
      ...prev,
    ].slice(0, 300));
  }, []);

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
      // requestPort() has to run inside the click. Called from an effect the
      // browser refuses it, which is why there is no auto-connect here.
      handleRef.current = await connectScale({
        portOptions: { baudRate: Number(baudRate) },
        onLine: append,
        onError: (err) => setError(err.message || String(err)),
        onDisconnect: () => setConnected(false),
      });
      setConnected(true);
    } catch (err) {
      // Cancelling the port chooser is a normal thing to do, not a failure.
      if (err && err.name === "NotFoundError") {
        setError("No port chosen.");
      } else {
        setError(err.message || String(err));
      }
    } finally {
      setConnecting(false);
    }
  };

  const sendCommand = async () => {
    try {
      await handleRef.current.send(command.trim().toUpperCase());
    } catch (err) {
      setError(err.message || String(err));
    }
  };

  // The port must be released when the window closes, or the next open cannot
  // claim it and the station looks broken until the tab is reloaded.
  useEffect(() => {
    if (!isOpen) disconnect();
  }, [isOpen, disconnect]);

  useEffect(() => () => { disconnect(); }, [disconnect]);

  // A port still held by a closed tab is what makes the NEXT session say
  // "access denied", and the fix then looks like "restart everything" because
  // nothing names the holder. Unmount alone does not cover it: closing the tab
  // or navigating away tears the page down without running React cleanup
  // reliably. pagehide does fire on both.
  useEffect(() => {
    const release = () => { handleRef.current?.disconnect?.(); };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, []);

  // The whole point of capturing this is being able to send it on, so it goes
  // to the clipboard as text rather than having to be read off the screen.
  const copyAll = async () => {
    const text = lines
      .slice()
      .reverse()
      .map((l) => {
        const p = l.parsed;
        const verdict = p.ok
          ? `OK ${p.weight} ${p.unit} stable=${p.stable}`
          : `${p.code} (${p.reason})`;
        return `${l.at}\t${JSON.stringify(l.raw)}\t${verdict}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(
        `# Ohaus scale output — baud ${baudRate}\n# time\traw\tparsed\n${text}`
      );
      toast({ status: "success", title: `Copied ${lines.length} lines`, duration: 2000 });
    } catch {
      toast({ status: "error", title: "Could not copy", duration: 2000 });
    }
  };

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title="Scale Diagnostic" width={980}>
      <Box>
        {!supported ? (
          <Alert status="warning" borderRadius="md" mb={3} alignItems="flex-start">
            <AlertIcon />
            <Box>
              <Text fontWeight="600" fontSize="sm">This browser cannot open a serial port.</Text>
              <Text fontSize="xs" color="gray.700">
                The Web Serial API is Chrome or Edge on a desktop. It does not exist on
                iPadOS or in Safari, which is why the weighing station is a desktop.
              </Text>
            </Box>
          </Alert>
        ) : (
          <>
            <Text fontSize="sm" color="gray.600" mb={3}>
              Connect the indicator, then press <b>Print</b> on it (or send a command
              below). Every line it sends is shown exactly as it arrives, beside what
              the parser made of it.
            </Text>

            <Flex gap={2} align="center" wrap="wrap" mb={3}>
              <Text fontSize="xs" color="gray.500" textTransform="uppercase">Baud</Text>
              <Select size="sm" width="110px" value={baudRate} isDisabled={connected}
                onChange={(e) => setBaudRate(e.target.value)}>
                {BAUD_RATES.map((b) => <option key={b} value={b}>{b}</option>)}
              </Select>

              {/* Changeable while connected on purpose: it only affects how
                  incoming lines are read, so its effect can be seen live. */}
              <Text fontSize="xs" color="gray.500" textTransform="uppercase">Unit</Text>
              <Select size="sm" width="220px" value={assumeUnit}
                onChange={(e) => setAssumeUnit(e.target.value)}>
                {ASSUMED_UNITS.map(([v, label]) => (
                  <option key={v || "none"} value={v}>{label}</option>
                ))}
              </Select>

              {!connected ? (
                <Button size="sm" colorScheme="blue" onClick={connect} isLoading={connecting}>
                  Connect scale
                </Button>
              ) : (
                <>
                  <Badge colorScheme="green" borderRadius="full" px={2}>connected</Badge>
                  <Input size="sm" width="90px" value={command} title="Command to send"
                    onChange={(e) => setCommand(e.target.value)} />
                  <Button size="sm" variant="outline" colorScheme="blue" onClick={sendCommand}>
                    Send
                  </Button>
                  <Button size="sm" variant="ghost" onClick={disconnect}>Disconnect</Button>
                </>
              )}

              <Box flex={1} />
              <Text fontSize="xs" color="gray.500">{lines.length} line{lines.length === 1 ? "" : "s"}</Text>
              <Button size="xs" variant="outline" onClick={copyAll} isDisabled={!lines.length}>
                Copy all
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setLines([])} isDisabled={!lines.length}>
                Clear
              </Button>
            </Flex>

            {connected && (
              <Text fontSize="xs" color="gray.500" mb={2}>
                Ohaus commands: <Code fontSize="xs">P</Code> print · <Code fontSize="xs">Z</Code> zero
                {" "}· <Code fontSize="xs">T</Code> tare. If nothing arrives, the baud rate is the
                first thing to change — a wrong rate gives garbage or silence, not an error.
              </Text>
            )}
          </>
        )}

        {error && (
          <Alert status="error" borderRadius="md" mb={3} fontSize="sm" py={2}>
            <AlertIcon />
            {error}
          </Alert>
        )}

        {/* A scroll container with no floor lets the table crush to nothing. */}
        <Box overflowX="auto" width="100%" maxH="440px" overflowY="auto"
          border="1px solid" borderColor="gray.200" borderRadius="md">
          <Table size="sm" style={{ minWidth: "760px" }}>
            <Thead position="sticky" top={0} bg="gray.50" zIndex={1}>
              <Tr>
                <Th width="90px">Time</Th>
                <Th width="300px">Raw line</Th>
                <Th>Parsed</Th>
              </Tr>
            </Thead>
            <Tbody>
              {lines.length === 0 ? (
                <Tr>
                  <Td colSpan={3}>
                    <Text fontSize="sm" color="gray.400" py={4} textAlign="center">
                      Nothing received yet.
                    </Text>
                  </Td>
                </Tr>
              ) : (
                lines.map((entry, i) => <LineRow key={i} entry={entry} />)
              )}
            </Tbody>
          </Table>
        </Box>
      </Box>
    </FloatingWindow>
  );
};

export default ScaleDiagnostic;
