import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Input, Spinner, Alert, AlertIcon,
  Table, Thead, Tbody, Tr, Th, Td, Tooltip, IconButton,
} from "@chakra-ui/react";
import { RepeatIcon, ChevronLeftIcon, ChevronRightIcon } from "@chakra-ui/icons";
import FloatingWindow from "../../components/FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";
import { today, fmtWeight, fmtLongDate } from "./shared";

// The day, for whoever has to answer for it.
//
// Opened from the drawer rather than living as a tab: it is something you go
// and look at, not somewhere work happens. It therefore does not watch
// refreshSignal — nothing else on the screen moves it — so it stamps what it
// fetched and offers a refresh instead.

const num = (n) => Number(n || 0).toLocaleString("en-US");

// A day, shifted. Built from the string so no local timezone can move it.
const shiftDay = (day, by) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

// What each exception is called, and how loud it is. No orange, no purple.
const KINDS = {
  form_overdue:      { label: "Forms past due",            tone: "red" },
  shipped_unweighed: { label: "Shipped without weighing",  tone: "red" },
  unregistered:      { label: "Weighed, not registered",   tone: "yellow" },
  report_waiting:    { label: "Processing reports waiting", tone: "yellow" },
  session_open:      { label: "Sessions left open",        tone: "yellow" },
  draft_stale:       { label: "Drafts not shipped",        tone: "yellow" },
  lot_idle:          { label: "Lots gone quiet",           tone: "blue" },
  voided:            { label: "Boxes voided",              tone: "gray" },
};

// Loudest first, and within a kind the report already sorted by age.
const KIND_ORDER = Object.keys(KINDS);

// A weight, or nothing at all — never "0.00 lb" for a figure that was simply
// never recorded. The two read identically on a page and mean opposite things.
const lb = (v) => (v == null || v === "" ? null : `${fmtWeight(v)} lb`);

// One line of detail per kind. The shapes differ because the things do.
const detailOf = (item) => {
  const d = item.detail || {};
  const parts = (...xs) => xs.filter(Boolean).join(" · ");
  switch (item.kind) {
    case "unregistered":
      return parts(`${num(d.boxes)} boxes`, lb(d.lb));
    case "report_waiting":
      return parts(d.type, `${num(d.casesIn)} cases in`,
                   lb(d.outputLb) && `${lb(d.outputLb)} out`,
                   lb(d.inedibleLb) && `${lb(d.inedibleLb)} inedible`);
    case "session_open":
      return parts(`${num(d.boxes)} boxes`, lb(d.lb),
                   d.direction === "outgoing" ? "outgoing" : "incoming");
    case "draft_stale":
      return parts(`${num(d.lines)} line${d.lines === 1 ? "" : "s"}`,
                   Number(d.lb) > 0 ? lb(d.lb) : null,
                   `to ship ${d.shipDate || "—"}`);
    case "lot_idle":
      return parts(`${lb(d.inLb)} in`, `${lb(d.outLb)} out`,
                   `${num(d.boxesIn)} → ${num(d.boxesOut)} boxes`);
    case "form_overdue":
      return parts(d.vendor, lb(d.originalWeight), `due ${d.dueDate || "—"}`);
    case "shipped_unweighed":
      return parts(d.destination, lb(d.lb));
    case "voided":
      return parts(`${num(d.boxes)} box${d.boxes === 1 ? "" : "es"}`, lb(d.lb));
    default:
      return "";
  }
};

const Figure = ({ label, value, unit, sub, tone = "gray" }) => (
  <Box
    flex="1 1 150px"
    minW="150px"
    bg="white"
    border="1px solid"
    borderColor={`${tone}.200`}
    borderRadius="md"
    px={3}
    py={2}
  >
    <Text fontSize="xs" color="gray.600" fontWeight="600" textTransform="uppercase">
      {label}
    </Text>
    <Flex align="baseline" gap={1}>
      <Text fontSize="xl" fontWeight="700" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
      {unit && <Text fontSize="xs" color="gray.500">{unit}</Text>}
    </Flex>
    {sub && <Text fontSize="xs" color="gray.500">{sub}</Text>}
  </Box>
);

// A lot nothing has left yet is NOT 0% — it has not been measured. Rendering a
// zero there would be a claim the figures cannot defend.
const YieldCell = ({ y }) => {
  if (!y || !y.measured) {
    return <Text fontSize="xs" color="gray.400">not weighed out</Text>;
  }
  if (y.percent == null) {
    return <Text fontSize="xs" color="gray.400">no weight in</Text>;
  }
  return (
    <Flex align="center" gap={2}>
      <Text fontSize="sm" fontWeight="600" style={{ fontVariantNumeric: "tabular-nums" }}>
        {y.percent.toFixed(1)}%
      </Text>
      {/* A yield computed off a typed Original Weight is not the same claim as
          one off bench weights, so it never passes silently as one. */}
      {y.basis === "registered" && (
        <Tooltip label="Against the form's typed Original Weight, not a bench weight">
          <Badge colorScheme="yellow" fontSize="9px">registered</Badge>
        </Tooltip>
      )}
    </Flex>
  );
};

const AttentionGroup = ({ kind, items }) => {
  const [open, setOpen] = useState(items.length <= 5);
  const meta = KINDS[kind] || { label: kind, tone: "gray" };
  const shown = open ? items : items.slice(0, 3);
  return (
    <Box mb={3}>
      <Flex align="center" gap={2} mb={1}>
        <Badge colorScheme={meta.tone}>{items.length}</Badge>
        <Text fontSize="sm" fontWeight="700">{meta.label}</Text>
        {items.length > 3 && (
          <Button size="xs" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "show less" : `show all ${items.length}`}
          </Button>
        )}
      </Flex>
      <Box borderLeft="3px solid" borderColor={`${meta.tone}.300`} pl={3}>
        {shown.map((item) => (
          <Flex
            key={`${item.kind}-${item.refId}`}
            align="baseline"
            gap={2}
            wrap="wrap"
            py={0.5}
          >
            <Text fontSize="sm" fontWeight="600" minW="110px">
              {item.label || <Text as="span" color="gray.400">no lot</Text>}
            </Text>
            <Text fontSize="xs" color="gray.600" flex="1 1 auto">
              {detailOf(item)}
            </Text>
            {item.who && (
              <Text fontSize="xs" color="gray.500">{item.who}</Text>
            )}
            <Text fontSize="xs" color={item.ageDays >= 7 ? "red.600" : "gray.500"} minW="60px" textAlign="right">
              {item.ageDays === 0 ? "today" : `${item.ageDays}d`}
            </Text>
          </Flex>
        ))}
      </Box>
    </Box>
  );
};

const DailyReport = ({ isOpen, onClose }) => {
  const [day, setDay] = useState(() => today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Survives a re-render mid-flight so a slow day cannot overwrite a newer one.
  const wanted = useRef(day);

  const load = useCallback(async (d) => {
    wanted.current = d;
    setLoading(true);
    setError("");
    try {
      const { data: body } = await axiosInstance.get("/noblesse-report", {
        params: { from: d, to: d },
      });
      if (wanted.current !== d) return;
      setData(body);
    } catch (e) {
      if (wanted.current !== d) return;
      setError(e?.response?.data?.error || "Could not build the report.");
      setData(null);
    } finally {
      if (wanted.current === d) setLoading(false);
    }
  }, []);

  // Fetches on open, and whenever the day changes while open.
  useEffect(() => {
    if (!isOpen) return;
    load(day);
  }, [isOpen, day, load]);

  const m = data?.movement;
  const items = data?.attention?.items || [];
  const grouped = KIND_ORDER
    .map((kind) => [kind, items.filter((i) => i.kind === kind)])
    .filter(([, list]) => list.length > 0);

  const isToday = day === today();

  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title="Daily Report"
      width="78%"
      headerActions={
        <Flex align="center" gap={1}>
          <IconButton
            aria-label="Previous day"
            icon={<ChevronLeftIcon />}
            size="xs"
            onClick={() => setDay((d) => shiftDay(d, -1))}
          />
          <Input
            type="date"
            size="xs"
            value={day}
            max={today()}
            width="140px"
            bg="white"
            onChange={(e) => e.target.value && setDay(e.target.value)}
          />
          <IconButton
            aria-label="Next day"
            icon={<ChevronRightIcon />}
            size="xs"
            isDisabled={isToday}
            onClick={() => setDay((d) => shiftDay(d, 1))}
          />
          <IconButton
            aria-label="Refresh"
            icon={<RepeatIcon />}
            size="xs"
            isLoading={loading}
            onClick={() => load(day)}
          />
        </Flex>
      }
    >
      <Box px={1} pb={2}>
        <Flex align="baseline" gap={3} wrap="wrap" mb={3}>
          <Text fontSize="lg" fontWeight="700">
            {fmtLongDate(new Date(`${day}T12:00:00Z`))}
          </Text>
          {isToday && <Badge colorScheme="green">still filling</Badge>}
          {data?.meta?.generatedAt && (
            <Text fontSize="xs" color="gray.500">
              as of {new Date(data.meta.generatedAt).toLocaleTimeString("en-US")}
            </Text>
          )}
        </Flex>

        {error && (
          <Alert status="error" borderRadius="md" mb={3}>
            <AlertIcon />
            {error}
          </Alert>
        )}

        {loading && !data && (
          <Flex justify="center" py={10}><Spinner /></Flex>
        )}

        {m && (
          <>
            <Flex gap={2} wrap="wrap" mb={2}>
              <Figure
                label="Weighed in" tone="blue"
                value={fmtWeight(m.weighedIn.lb)} unit="lb"
                sub={`${num(m.weighedIn.boxes)} boxes · ${num(m.weighedIn.lots)} lots`}
              />
              <Figure
                label="Weighed out" tone="teal"
                value={fmtWeight(m.weighedOut.lb)} unit="lb"
                sub={`${num(m.weighedOut.boxes)} boxes · ${num(m.weighedOut.lots)} lots`}
              />
              <Figure
                label="Shipped" tone="green"
                value={fmtWeight(m.shipped.lb)} unit="lb"
                sub={`${num(m.shipped.loads)} load${m.shipped.loads === 1 ? "" : "s"} · ${num(m.shipped.destinations)} destination${m.shipped.destinations === 1 ? "" : "s"}`}
              />
              {/* Cases lead because cases are what an accepted report moves;
                  the pounds are recorded off the floor and create no stock. */}
              <Figure
                label="Processed" tone="gray"
                value={num(m.processed.casesOut)} unit="cases out"
                sub={[
                  `${num(m.processed.casesIn)} in`,
                  Number(m.processed.outputLb) > 0 && `${fmtWeight(m.processed.outputLb)} lb out`,
                  Number(m.processed.inedibleLb) > 0 && `${fmtWeight(m.processed.inedibleLb)} lb inedible`,
                ].filter(Boolean).join(" · ")}
              />
              <Figure
                label="Lots issued" tone="gray"
                value={num(m.lotsIssued)}
                sub={`${num(m.forms.received)} forms received · ${num(m.forms.open)} open`}
              />
            </Flex>

            {/* Late entry, stated rather than silently absent. */}
            {data.backdated?.sessions > 0 && (
              <Alert status="info" borderRadius="md" mb={3} fontSize="sm" py={2}>
                <AlertIcon />
                <Text>
                  {num(data.backdated.sessions)} session
                  {data.backdated.sessions === 1 ? "" : "s"} entered today for an
                  earlier day — counted on {data.backdated.days.join(", ")}.
                </Text>
              </Alert>
            )}

            <Text fontSize="sm" fontWeight="700" mt={4} mb={2}>
              Needs attention
              {data.attention?.truncated && (
                <Badge colorScheme="red" ml={2}>list capped</Badge>
              )}
            </Text>
            {grouped.length === 0 ? (
              <Text fontSize="sm" color="gray.500" mb={3}>Nothing waiting.</Text>
            ) : (
              grouped.map(([kind, list]) => (
                <AttentionGroup key={kind} kind={kind} items={list} />
              ))
            )}

            <Text fontSize="sm" fontWeight="700" mt={4} mb={2}>
              Lots touched
            </Text>
            {data.lots.length === 0 ? (
              <Text fontSize="sm" color="gray.500">No lot moved on this day.</Text>
            ) : (
              <Box overflowX="auto">
                <Table size="sm" minWidth="720px">
                  <Thead>
                    <Tr>
                      <Th>Lot</Th>
                      <Th isNumeric>In</Th>
                      <Th isNumeric>Out</Th>
                      <Th isNumeric>Shipped</Th>
                      <Th isNumeric>Cases</Th>
                      <Th>Yield to date</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {data.lots.map((lot) => (
                      <Tr key={lot.lotId}>
                        <Td fontWeight="600">
                          {lot.lotNumber}
                          {lot.status === "closed" && (
                            <Badge ml={2} colorScheme="gray" fontSize="9px">closed</Badge>
                          )}
                        </Td>
                        <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}>
                          {lot.day.boxesIn ? `${fmtWeight(lot.day.lbIn)}` : "—"}
                        </Td>
                        <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}>
                          {lot.day.boxesOut ? `${fmtWeight(lot.day.lbOut)}` : "—"}
                        </Td>
                        <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}>
                          {lot.day.loads ? `${fmtWeight(lot.day.shippedLb)}` : "—"}
                        </Td>
                        <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}>
                          {lot.day.reports ? `${num(lot.day.casesIn)} → ${num(lot.day.casesOut)}` : "—"}
                        </Td>
                        <Td><YieldCell y={lot.yield} /></Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            )}
          </>
        )}
      </Box>
    </FloatingWindow>
  );
};

export default DailyReport;
