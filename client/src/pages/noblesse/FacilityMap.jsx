import React from "react";
import { Box, Flex, Text, Badge } from "@chakra-ui/react";

// Processing Room 2, as a floor plan that shows what is on each station now.
//
// The stations are keyed on PROCESSING_LINES — the same strings the report's
// Line dropdown writes into line_no — so a station cannot exist on the map and
// not in the dropdown, or be spelled one way here and another there.
//
// Geometry traced from the room sketch. The freezer, the marinade table and the
// room outline are drawn for orientation only; nothing reads their state.

// Chakra's palette as hex, because SVG attributes take no theme tokens.
const C = {
  wall: "#2D3748",
  idleFill: "#EDF2F7", idleLine: "#A0AEC0",
  runFill: "#C6F6D5", runLine: "#38A169",
  waitFill: "#FEFCBF", waitLine: "#D69E2E",
  decorFill: "#FFFFFF", decorLine: "#CBD5E0",
  ink: "#1A202C", faint: "#718096",
};

// One drawn zone per physical station. `lines` are the PROCESSING_LINES values
// it covers — Line #2 and Slicer #2 share one enclosure on the floor, so they
// share one zone here and it lights up for either.
const STATIONS = [
  { id: "bandsaw1", label: "Bandsaw #1", lines: ["Bandsaw #1"],
    x: 35, y: 45, w: 140, h: 205, labelAt: "right" },
  { id: "line2slicer2", label: "Line #2 / Slicer #2", lines: ["Line #2", "Slicer #2"],
    x: 35, y: 288, w: 145, h: 320, labelAt: "right",
    units: [{ x: 72, y: 318, w: 55, h: 125 }, { x: 72, y: 452, w: 55, h: 125 }] },
  { id: "bandsaw2", label: "Bandsaw #2", lines: ["Bandsaw #2"],
    x: 35, y: 640, w: 142, h: 215, labelAt: "below",
    units: [{ x: 72, y: 665, w: 55, h: 140 }] },
  { id: "line1", label: "Line #1", lines: ["Line #1"],
    x: 320, y: 638, w: 318, h: 105, labelAt: "below",
    units: [{ x: 348, y: 668, w: 125, h: 52 }, { x: 482, y: 668, w: 122, h: 52 }] },
  { id: "slicer1", label: "Slicer #1", lines: ["Slicer #1"],
    x: 712, y: 750, w: 288, h: 105, labelAt: "below",
    units: [{ x: 740, y: 768, w: 125, h: 52 }, { x: 872, y: 768, w: 122, h: 52 }] },
];

// A run still on the line outranks one waiting on reception: the station is
// physically busy, which is what somebody looking at the map is asking.
const stateOf = (runs) => {
  if (runs.some((r) => r.status === "in_progress")) return "running";
  if (runs.some((r) => r.status === "submitted")) return "waiting";
  return "idle";
};

const FILL = { running: C.runFill, waiting: C.waitFill, idle: C.idleFill };
const LINE = { running: C.runLine, waiting: C.waitLine, idle: C.idleLine };

const Station = ({ station, runs, onPick }) => {
  const state = stateOf(runs);
  const first = runs[0] || null;
  const cx = station.x + station.w / 2;

  const title = runs.length
    ? runs.map((r) => `${r.lotNumber} — ${r.status === "in_progress"
        ? `running since ${r.startTime || "?"}` : "waiting on reception"}`).join("\n")
    : `${station.label} — nothing on it`;

  return (
    <g
      style={{ cursor: first ? "pointer" : "default" }}
      onClick={() => first && onPick && onPick(first)}
    >
      <title>{title}</title>
      <rect
        x={station.x} y={station.y} width={station.w} height={station.h}
        fill={FILL[state]} stroke={LINE[state]} strokeWidth={state === "idle" ? 2 : 3}
        rx="4"
      />
      {(station.units || []).map((u, i) => (
        <rect key={i} x={u.x} y={u.y} width={u.w} height={u.h}
          rx={Math.min(u.w, u.h) / 2}
          fill="none" stroke={LINE[state]} strokeWidth="2" />
      ))}

      {/* The label sits where it does on the paper sketch. */}
      <text
        x={station.labelAt === "right" ? station.x + station.w + 14 : cx}
        y={station.labelAt === "right" ? station.y + station.h / 2 : station.y + station.h + 26}
        textAnchor={station.labelAt === "right" ? "start" : "middle"}
        fontSize="19" fontWeight="600" fill={C.ink}
      >
        {station.label}
      </text>

      {/* What is on it, on the station itself — the point of the map. */}
      {first && (
        <text
          x={station.labelAt === "right" ? station.x + station.w + 14 : cx}
          y={station.labelAt === "right" ? station.y + station.h / 2 + 24 : station.y + station.h + 48}
          textAnchor={station.labelAt === "right" ? "start" : "middle"}
          fontSize="17" fill={state === "running" ? C.runLine : C.waitLine}
          fontWeight="700"
        >
          {first.lotNumber}
          {first.status === "in_progress" && first.startTime ? ` · ${first.startTime}` : ""}
          {runs.length > 1 ? ` (+${runs.length - 1})` : ""}
        </text>
      )}
    </g>
  );
};

const FacilityMap = ({ runs = [], onPick }) => {
  // Only what is actually on the floor. Anything accepted or sent back is done.
  const live = runs.filter((r) => r.status === "in_progress" || r.status === "submitted");

  const forStation = (station) =>
    live.filter((r) => station.lines.includes(r.lineNo));

  // line_no was free text before the stations were named, so older runs carry
  // none. They are listed rather than dropped — the map is not the whole truth.
  const unplaced = live.filter(
    (r) => !STATIONS.some((s) => s.lines.includes(r.lineNo))
  );

  const running = live.filter((r) => r.status === "in_progress").length;

  return (
    <Box>
      <Flex align="center" gap={3} mb={2} wrap="wrap">
        <Text fontSize="sm" fontWeight="700">Processing Room 2</Text>
        <Badge colorScheme={running ? "green" : "gray"}>
          {running} running
        </Badge>
        <Flex align="center" gap={3} fontSize="xs" color="gray.600">
          <Flex align="center" gap={1}>
            <Box w="10px" h="10px" bg={C.runFill} border="2px solid" borderColor={C.runLine} />
            on the line
          </Flex>
          <Flex align="center" gap={1}>
            <Box w="10px" h="10px" bg={C.waitFill} border="2px solid" borderColor={C.waitLine} />
            waiting on reception
          </Flex>
          <Flex align="center" gap={1}>
            <Box w="10px" h="10px" bg={C.idleFill} border="2px solid" borderColor={C.idleLine} />
            idle
          </Flex>
        </Flex>
      </Flex>

      <Box overflowX="auto">
        <Box as="svg" viewBox="0 0 1040 950" width="100%" minWidth="520px"
          maxHeight="560px" style={{ display: "block" }}>
          {/* The room. Traced from the sketch: the right wall steps in above
              Slicer #1, which sits in the bay at the bottom right. */}
          <path
            d="M 28 22 L 770 22 L 770 620 L 1008 620 L 1008 935 L 28 935 Z"
            fill="none" stroke={C.wall} strokeWidth="4"
          />
          {/* The wall running back towards the vestibule, which is what makes
              the bottom-right a bay rather than open floor. */}
          <line x1="578" y1="620" x2="770" y2="620"
            stroke={C.wall} strokeWidth="4" />

          {/* Decoration — drawn to orient somebody reading the room, and
              deliberately carrying no state. */}
          <g>
            <rect x="660" y="22" width="110" height="152"
              fill={C.decorFill} stroke={C.wall} strokeWidth="3" />
            <text x="715" y="105" textAnchor="middle" fontSize="19" fill={C.ink}>
              freezer
            </text>

            <rect x="318" y="522" width="258" height="95"
              fill={C.decorFill} stroke={C.decorLine} strokeWidth="2" rx="3" />
            <rect x="348" y="558" width="122" height="45" rx="22"
              fill="none" stroke={C.decorLine} strokeWidth="2" />
            <text x="447" y="545" textAnchor="middle" fontSize="18" fill={C.faint}>
              marinade
            </text>

            {/* The table on the bottom wall, clipped by it on the sketch too. */}
            <rect x="660" y="888" width="270" height="44" rx="22"
              fill="none" stroke={C.decorLine} strokeWidth="2" />
          </g>

          {STATIONS.map((s) => (
            <Station key={s.id} station={s} runs={forStation(s)} onPick={onPick} />
          ))}
        </Box>
      </Box>

      {unplaced.length > 0 && (
        <Text fontSize="xs" color="gray.600" mt={2}>
          <b>{unplaced.length}</b> run{unplaced.length === 1 ? "" : "s"} on no
          station: {unplaced.map((r) => r.lotNumber).join(", ")} — set a Line on
          the report and it appears here.
        </Text>
      )}
    </Box>
  );
};

export default FacilityMap;
