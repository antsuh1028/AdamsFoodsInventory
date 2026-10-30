import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import {
  AlertDialog,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogBody,
  AlertDialogFooter,
  Box,
  Grid,
  Text,
  Flex,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  HStack,
  Button,
  Divider,
  IconButton,
  Input,
  Tooltip,
  useBreakpointValue,
  useToast,
} from "@chakra-ui/react";
import { ExternalLinkIcon } from "@chakra-ui/icons";
import PopInIcon from "../../components/PopInIcon";
import FloatingWindow from "../../components/FloatingWindow";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { locationRows } from "../../utils/freezerLayout";
import findItem from "../../utils/homescreen/findItem";
import MapCellPanel from "./mapCellPanel";
import axiosInstance from "../../utils/axiosInstance";

// ─── SeatCell ────────────────────────────────────────────────────────────────
const SeatCell = ({
  locationKey,
  seat,
  isUnavailable,
  isOccupied,
  isHighlighted,
  moveMode,
  activeId,
  onSeatClick,
  count = 0,
  isMatch = false,
  isDimmed = false,
}) => {
  const isSelf = locationKey === activeId;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: locationKey,
    disabled: !moveMode || !isOccupied || isUnavailable,
  });

  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `drop-${locationKey}`,
    disabled: isUnavailable || isSelf,
  });

  const ref = useCallback(
    (node) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef]
  );

  // ── Colours ──────────────────────────────────────────────────────────────
  let bg, borderColor, color, border, boxShadow, cursor;

  if (isUnavailable) {
    bg = "gray.200"; borderColor = "transparent"; color = "gray.400";
    border = "1px"; boxShadow = "none"; cursor = "default";
  } else if (isDragging) {
    bg = "blue.50"; borderColor = "blue.200"; color = "blue.300";
    border = "1px"; boxShadow = "none"; cursor = "grabbing";
  } else if (isHighlighted) {
    bg = "yellow.300"; borderColor = "yellow.500"; color = "yellow.900";
    border = "2px"; boxShadow = "0 0 0 2px #D69E2E"; cursor = moveMode && isOccupied ? "grab" : "pointer";
  } else if (isMatch) {
    bg = "teal.400"; borderColor = "teal.600"; color = "white";
    border = "2px"; boxShadow = "none"; cursor = moveMode && isOccupied ? "grab" : "pointer";
  } else if (moveMode && isOver && !isSelf && activeId) {
    // Valid drop target while dragging
    bg = isOccupied ? "yellow.100" : "green.100";
    borderColor = isOccupied ? "yellow.400" : "green.400";
    color = isOccupied ? "yellow.800" : "green.800";
    border = "2px"; boxShadow = "none"; cursor = "default";
  } else if (isOccupied) {
    bg = "blue.100"; borderColor = "blue.300"; color = "blue.700";
    border = "1px"; boxShadow = "none";
    cursor = moveMode ? "grab" : "pointer";
  } else {
    bg = "white"; borderColor = "gray.100"; color = "gray.700";
    border = "1px"; boxShadow = "none";
    cursor = moveMode ? "default" : "pointer";
  }

  const hoverStyle = isUnavailable
    ? {}
    : moveMode && isOccupied
    ? { bg: "blue.200", borderColor: "blue.400" }
    : moveMode
    ? {}
    : { bg: isHighlighted ? "yellow.400" : isOccupied ? "blue.200" : "teal.50", cursor: "pointer" };

  return (
    <Box
      ref={ref}
      p={{ base: 2, xl: 1 }}
      textAlign="center"
      borderRadius="sm"
      bg={bg}
      border={border}
      borderColor={borderColor}
      color={color}
      fontWeight={isHighlighted ? "bold" : "normal"}
      boxShadow={boxShadow}
      opacity={isDragging || isDimmed ? 0.35 : 1}
      cursor={cursor}
      _hover={hoverStyle}
      onClick={
        isUnavailable || moveMode
          ? undefined
          : (e) => onSeatClick(e, locationKey)
      }
      userSelect="none"
      transition="background 0.1s, border-color 0.1s"
      {...(moveMode && isOccupied && !isUnavailable
        ? { ...attributes, ...listeners }
        : {})}
    >
      {isUnavailable ? "—" : (
        <>
          <Box lineHeight="1.1">{seat}</Box>
          {count > 0 && <Box fontSize="10px" lineHeight="1" opacity={0.8}>{count}</Box>}
        </>
      )}
    </Box>
  );
};

// ─── SeatBlock ───────────────────────────────────────────────────────────────
const SeatBlock = ({
  id,
  seats,
  occupiedCells,
  onSeatClick,
  highlightLocation,
  moveMode,
  activeId,
  counts,
  matchCells,
}) => {
  const hasSixSeats = seats.length >= 6;

  return (
    <Box
      border="1px"
      borderColor="gray.200"
      borderRadius="md"
      h="100%"
      p={1.5}
      minH="100%"
      overflow="hidden"
      bg="white"
    >
      <Text
        textAlign="center"
        fontWeight="semibold"
        fontSize="xs"
        color="gray.600"
        borderBottom="1px"
        borderColor="gray.100"
        mb={1}
        pb={0.5}
      >
        {id}
      </Text>
      <Grid
        templateColumns={hasSixSeats ? "repeat(2, 1fr)" : "1fr"}
        fontSize={{ base: "sm", xl: "xs" }}
        gap={0.5}
      >
        {seats.map((seat, index) => {
          const isUnavailable = seat === "-";
          const locationKey = `${id}${seat}`;
          const isOccupied = !isUnavailable && occupiedCells?.includes(locationKey);
          const isHighlighted = !isUnavailable && locationKey === highlightLocation;

          return (
            <SeatCell
              key={index}
              locationKey={locationKey}
              seat={seat}
              isUnavailable={isUnavailable}
              isOccupied={isOccupied}
              isHighlighted={isHighlighted}
              moveMode={moveMode}
              activeId={activeId}
              onSeatClick={onSeatClick}
              count={counts?.[locationKey] || 0}
              isMatch={Boolean(matchCells && matchCells.has(locationKey))}
              isDimmed={Boolean(matchCells && !isUnavailable && !matchCells.has(locationKey))}
            />
          );
        })}
      </Grid>
    </Box>
  );
};

// ─── Legend ──────────────────────────────────────────────────────────────────
const Swatch = ({ bg, borderColor = "transparent", label, color = "gray.600", children }) => (
  <HStack spacing={1.5}>
    <Box w={4} h={4} borderRadius="sm" bg={bg} border="1px solid" borderColor={borderColor}
      fontSize="9px" color="gray.400" textAlign="center" lineHeight="14px">{children}</Box>
    <Text color={color}>{label}</Text>
  </HStack>
);
const Legend = ({ showHighlight, moveMode, searching }) => (
  <HStack spacing={4} justify="center" mb={3} fontSize="xs" flexWrap="wrap">
    <Swatch bg="white" borderColor="gray.300" label="Empty" />
    <Swatch bg="blue.100" borderColor="blue.300" label="Occupied (number = boxes)" />
    <Swatch bg="gray.200" label="Unavailable">—</Swatch>
    {searching && <Swatch bg="teal.400" borderColor="teal.600" label="Matches search" color="teal.700" />}
    {showHighlight && <Swatch bg="yellow.300" borderColor="yellow.600" label="Located item" color="yellow.700" />}
    {moveMode && <Swatch bg="green.100" borderColor="green.400" label="Drop here (empty)" color="green.600" />}
    {moveMode && <Swatch bg="yellow.100" borderColor="yellow.400" label="Drop here (occupied)" color="yellow.700" />}
  </HStack>
);

// ─── FitToWidth ──────────────────────────────────────────────────────────────
// Draws the plan at one width and scales it to fit, so cells keep their shape at any size.
// The nearest ancestor that scrolls: the window body the map has to fit inside.
const scrollParent = (el) => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
};
const DESIGN_WIDTH = 1100;
const MIN_SCALE = 0.5;
// fillHeight: in a window, grow until the width or the height runs out.
const FitToWidth = ({ children, fillHeight = false }) => {
  const outer = useRef(null);
  const inner = useRef(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(null);

  useLayoutEffect(() => {
    const fit = () => {
      const w = outer.current ? outer.current.clientWidth : 0;
      // A hidden tab measures 0 wide; it is refitted when shown.
      if (!w) return;
      let s = w / DESIGN_WIDTH;
      const box = fillHeight && outer.current ? scrollParent(outer.current) : null;
      if (box && inner.current && inner.current.offsetHeight) {
        const room = box.getBoundingClientRect().bottom - outer.current.getBoundingClientRect().top - 16;
        if (room > 200) s = Math.min(s, room / inner.current.offsetHeight);
      }
      s = Math.min(fillHeight ? 2 : 1.3, Math.max(MIN_SCALE, s));
      setScale(s);
      setHeight(inner.current ? inner.current.offsetHeight * s : null);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [fillHeight]);

  // Below the smallest scale (a phone) the scaled plan scrolls sideways.
  return (
    <Box ref={outer} w="100%" overflowX="auto">
      <Box w={`${DESIGN_WIDTH * scale}px`} h={height ? `${height}px` : "auto"} overflow="hidden" mx="auto">
        <Box ref={inner} w={`${DESIGN_WIDTH}px`} transform={`scale(${scale})`} transformOrigin="top left">
          {children}
        </Box>
      </Box>
    </Box>
  );
};

// ─── generateMap ─────────────────────────────────────────────────────────────
const generateMap = (level, occupiedCells, onSeatClick, highlightLocation, moveMode, activeId, extras = {}) => {
  const topRowData =
    level === 1 ? locationRows.topRow1 :
    level === 2 ? locationRows.topRow2 :
    locationRows.topRow3;
  const rightRowData =
    level === 1 ? locationRows.rightRow1 :
    level === 2 ? locationRows.rightRow2 :
    locationRows.rightRow3;
  const bottomRowData =
    level === 1 ? locationRows.bottomRow1 :
    level === 2 ? locationRows.bottomRow2 :
    locationRows.bottomRow3;

  const { counts, matchCells, fillHeight } = extras;
  const blockProps = { occupiedCells, onSeatClick, highlightLocation, moveMode, activeId, counts, matchCells };

  return (
    <FitToWidth fillHeight={fillHeight}>
      <Box p={3}>
        <Flex justify="space-between" mb={6}>
          <Grid templateColumns="repeat(4, 1fr)" gap={2} w="31%">
            {Object.entries(topRowData).map(([id, seats]) => (
              <SeatBlock key={id} id={id} seats={seats} {...blockProps} />
            ))}
          </Grid>

          <Flex align="center" justify="center" px={4}>
            <Box
              border="1px"
              borderColor="gray.300"
              borderRadius="md"
              px={8}
              py={2}
              fontWeight="semibold"
              fontSize="sm"
              color="gray.500"
              bg="gray.50"
              letterSpacing="widest"
            >
              DOOR
            </Box>
          </Flex>

          <Grid templateColumns="repeat(6, 1fr)" gap={2} w="48%">
            {Object.entries(rightRowData).map(([id, seats]) => (
              <SeatBlock key={id} id={id} seats={seats} {...blockProps} />
            ))}
          </Grid>
        </Flex>

        <Flex gap={1.5} w="100%" flexWrap="wrap" justifyContent="center">
          {Object.entries(bottomRowData).map(([id, seats]) => (
            <Box key={id} flex={1} flexGrow={1} minWidth={0}>
              <SeatBlock id={id} seats={seats} {...blockProps} />
            </Box>
          ))}
        </Flex>

        {level === 1 && (
          <>
            <Divider my={4} borderColor="gray.200" />
            <Text fontSize="xs" fontWeight="semibold" color="gray.400" textTransform="uppercase" letterSpacing="wider" mb={2}>
              Floor Areas
            </Text>
            <Flex gap={3}>
              {["FLOOR", "CHILLING"].map((loc) => (
                <FloorCell
                  key={loc}
                  loc={loc}
                  isOccupied={occupiedCells?.includes(loc)}
                  isHighlighted={loc === highlightLocation}
                  moveMode={moveMode}
                  activeId={activeId}
                  onSeatClick={onSeatClick}
                  count={counts?.[loc] || 0}
                  isMatch={Boolean(matchCells && matchCells.has(loc))}
                  isDimmed={Boolean(matchCells && !matchCells.has(loc))}
                />
              ))}
            </Flex>
          </>
        )}
      </Box>
    </FitToWidth>
  );
};

// ─── FloorCell — droppable+draggable for FLOOR / CHILLING ────────────────────
const FloorCell = ({ loc, isOccupied, isHighlighted, moveMode, activeId, onSeatClick, count = 0, isMatch = false, isDimmed = false }) => {
  const isSelf = loc === activeId;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: loc,
    disabled: !moveMode || !isOccupied,
  });

  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `drop-${loc}`,
    disabled: isSelf,
  });

  const ref = useCallback(
    (node) => { setDragRef(node); setDropRef(node); },
    [setDragRef, setDropRef]
  );

  let bg, borderColor, color, border;
  if (isDragging) {
    bg = "blue.50"; borderColor = "blue.200"; color = "blue.300"; border = "1px";
  } else if (isHighlighted) {
    bg = "yellow.300"; borderColor = "yellow.500"; color = "yellow.900"; border = "2px";
  } else if (isMatch) {
    bg = "teal.400"; borderColor = "teal.600"; color = "white"; border = "2px";
  } else if (moveMode && isOver && !isSelf && activeId) {
    bg = isOccupied ? "yellow.100" : "green.100";
    borderColor = isOccupied ? "yellow.400" : "green.400";
    color = isOccupied ? "yellow.800" : "green.800";
    border = "2px";
  } else if (isOccupied) {
    bg = "blue.100"; borderColor = "blue.300"; color = "blue.700"; border = "1px";
  } else {
    bg = "white"; borderColor = "gray.200"; color = "gray.500"; border = "1px";
  }

  return (
    <Box
      ref={ref}
      flex={1}
      px={4}
      py={3}
      borderRadius="md"
      border={border}
      borderColor={borderColor}
      bg={bg}
      color={color}
      fontWeight={isHighlighted ? "bold" : "semibold"}
      fontSize="sm"
      textAlign="center"
      opacity={isDragging || isDimmed ? 0.35 : 1}
      cursor={moveMode && isOccupied ? "grab" : moveMode ? "default" : "pointer"}
      _hover={
        moveMode
          ? {}
          : { bg: isHighlighted ? "yellow.400" : isOccupied ? "blue.200" : "teal.50", borderColor: isHighlighted ? "yellow.500" : "blue.200" }
      }
      transition="all 0.1s"
      onClick={moveMode ? undefined : (e) => onSeatClick(e, loc)}
      {...(moveMode && isOccupied ? { ...attributes, ...listeners } : {})}
    >
      {loc}{count > 0 ? ` · ${count} bx` : ""}
    </Box>
  );
};

// ─── Item mini-card used in move modal ───────────────────────────────────────
const ItemCard = ({ item, selected, onClick }) => (
  <Box
    px={3}
    py={2}
    borderRadius="md"
    border="1px"
    borderColor={selected ? "blue.400" : "gray.200"}
    bg={selected ? "blue.50" : "white"}
    cursor={onClick ? "pointer" : "default"}
    onClick={onClick}
    _hover={onClick ? { borderColor: "blue.300", bg: "blue.50" } : {}}
    transition="all 0.1s"
  >
    <Flex justify="space-between" align="baseline" mb={0.5}>
      <Text fontSize="sm" fontWeight="semibold" color="gray.800" noOfLines={1}>
        {item.kind === "new" && <Text as="span" mr={1.5} px={1} borderRadius="sm" fontSize="xs" bg="teal.100" color="teal.800">new</Text>}
        {item.description}
      </Text>
      <Text fontSize="xs" color="gray.400" flexShrink={0} ml={2}>
        {item.quantity} bx
      </Text>
    </Flex>
    <HStack spacing={2}>
      {item.brand && <Text fontSize="xs" color="gray.500">{item.brand}</Text>}
      {item.lot   && <Text fontSize="xs" color="gray.400">· Lot {item.lot}</Text>}
      {item.grade && <Text fontSize="xs" color="gray.400">· {item.grade}</Text>}
    </HStack>
  </Box>
);

// Every usable location on each level, for the "full" counts on the level tabs.
const LEVEL_KEYS = [1, 2, 3].map((l) =>
  [locationRows[`topRow${l}`], locationRows[`rightRow${l}`], locationRows[`bottomRow${l}`]]
    .flatMap((row) => Object.entries(row || {}))
    .flatMap(([id, seats]) => seats.filter((seat) => seat !== "-").map((seat) => `${id}${seat}`))
);
const levelOf = (loc) => (/^[A-Z][123]/.test(loc) ? Number(loc[1]) : 1);

// ─── Parse location string → tab index ───────────────────────────────────────
const getTabIndexFromLocation = (location) => {
  if (!location || location.length < 2) return 0;
  const level = parseInt(location[1]);
  if (level >= 1 && level <= 3) return level - 1;
  return 0;
};

// ─── ShowMap ─────────────────────────────────────────────────────────────────
// inline: drawn on the page (the homescreen's Map tab) instead of in a window; isOpen then means the tab is showing.
// onPopIn: in a window, shows an icon that puts the map back on the page.
function ShowMap({ isOpen, onClose = () => {}, highlightLocation, inline = false, onPopOut, onPopIn }) {
  // The location whose detail panel is open.
  const [panelLoc, setPanelLoc]             = useState(null);
  const [mapQuery, setMapQuery]             = useState("");
  const [itemsByLocation, setItemsByLocation] = useState({});
  // Pallets received through Lot Registration, by location.
  const [newByLocation, setNewByLocation]   = useState({});
  const [tabIndex, setTabIndex]             = useState(0);
  const [moveMode, setMoveMode]             = useState(false);
  const [activeId, setActiveId]             = useState(null);
  const [pendingMove, setPendingMove]       = useState(null);
  // Picked from the cell panel and waiting for a tap on where it goes.
  const [moving, setMoving]                 = useState(null);
  const [fullScreen, setFullScreen]         = useState(false);
  const cancelMoveRef                       = useRef();
  const toast                               = useToast();
  const isDesktop = useBreakpointValue({ base: false, md: true });

  // Derived: occupied cells from itemsByLocation keys
  const occCells = useMemo(
    () => [...new Set([...Object.keys(itemsByLocation), ...Object.keys(newByLocation)])],
    [itemsByLocation, newByLocation]
  );

  // Boxes at each location, old rows and new pallets together.
  const counts = useMemo(() => {
    const c = {};
    Object.entries(itemsByLocation).forEach(([loc, rows]) => {
      c[loc] = (c[loc] || 0) + rows.reduce((n, r) => n + (Number(r.quantity) || (r.boxes || []).length), 0);
    });
    Object.entries(newByLocation).forEach(([loc, pallets]) => {
      c[loc] = (c[loc] || 0) + pallets.reduce((n, p) => n + p.boxes, 0);
    });
    return c;
  }, [itemsByLocation, newByLocation]);

  // Locations holding anything that matches the map search; null when not searching.
  const matchCells = useMemo(() => {
    const q = mapQuery.trim().toUpperCase();
    if (!q) return null;
    const hit = new Set();
    Object.entries(itemsByLocation).forEach(([loc, rows]) => {
      if (loc.includes(q) || rows.some((r) => [r.lot, r.vendor, r.brand, r.species, r.description, r.grade].join(" ").toUpperCase().includes(q))) hit.add(loc);
    });
    Object.entries(newByLocation).forEach(([loc, pallets]) => {
      if (loc.includes(q) || pallets.some((p) => [p.lotNumber, p.item, p.vendor].join(" ").toUpperCase().includes(q))) hit.add(loc);
    });
    return hit;
  }, [mapQuery, itemsByLocation, newByLocation]);

  // Per level: locations full, locations in all, and search matches.
  const levelStats = useMemo(() => {
    const occ = new Set(occCells);
    return LEVEL_KEYS.map((keys, i) => ({
      full: keys.filter((k) => occ.has(k)).length,
      total: keys.length,
      matches: matchCells ? [...matchCells].filter((loc) => levelOf(loc) === i + 1).length : 0,
    }));
  }, [occCells, matchCells]);

  // What can be moved out of a location: each new pallet whole, and each old row.
  const entriesAt = useCallback((loc) => {
    const pallets = {};
    (newByLocation[loc] || []).forEach((p) => {
      const key = `${p.lotId}-${p.palletNo}`;
      const e = pallets[key] || (pallets[key] = { kind: "new", key, lotId: p.lotId, palletNo: p.palletNo, lot: p.lotNumber, items: [], quantity: 0 });
      e.items.push(p.item);
      e.quantity += p.boxes;
    });
    const news = Object.values(pallets).map(({ items, ...e }) => ({ ...e, description: `Pallet ${e.palletNo}: ${items.join(", ")}` }));
    const olds = (itemsByLocation[loc] || []).map((r) => ({ ...r, kind: "old", key: r._id }));
    return [...news, ...olds];
  }, [newByLocation, itemsByLocation]);

  // Reset move mode on mobile
  useEffect(() => {
    if (!isDesktop) setMoveMode(false);
  }, [isDesktop]);

  // Load items on open
  useEffect(() => {
    if (!isOpen) return;

    findItem(
      { location: "" },
      (items) => {
        const byLoc = {};
        (items || []).forEach((item) => {
          if (!byLoc[item.location]) byLoc[item.location] = [];
          byLoc[item.location].push(item);
        });
        setItemsByLocation(byLoc);
      },
      null,
      null
    );
    axiosInstance.get("/af-stock/locations")
      .then(({ data }) => setNewByLocation(data || {}))
      .catch(() => setNewByLocation({}));

    if (highlightLocation) {
      setTabIndex(getTabIndexFromLocation(highlightLocation));
    } else {
      setTabIndex(0);
    }
  }, [isOpen, highlightLocation]);

  // ── Drag sensors ───────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = useCallback(({ active }) => {
    setActiveId(active.id);
    setPanelLoc(null);
  }, []);

  const handleDragEnd = useCallback(({ active, over }) => {
    setActiveId(null);
    if (!over) return;
    const fromLocation = active.id;
    const toLocation = over.id.startsWith("drop-") ? over.id.slice(5) : over.id;
    if (fromLocation === toLocation) return;

    const items = entriesAt(fromLocation);
    if (items.length === 0) return;
    setPendingMove({ fromLocation, toLocation, items, selectedItem: null });
  }, [entriesAt]);

  // ── Seat click (inspect mode) ───────────────────────────────────────────────
  const handleSeatClick = useCallback((e, locationKey) => {
    if (!moving) return setPanelLoc(locationKey);
    // Tapping where it already is cancels the move.
    if (locationKey !== moving.from) {
      setPendingMove({ fromLocation: moving.from, toLocation: locationKey, items: [moving.entry], selectedItem: moving.entry });
    }
    setMoving(null);
  }, [moving]);

  // Starts a tap-to-move from the cell panel.
  const startMove = useCallback((thing, kind) => {
    const key = kind === "new" ? `${thing.lotId}-${thing.palletNo}` : thing._id;
    const entry = entriesAt(panelLoc).find((e) => e.key === key);
    if (!entry) return;
    setMoving({ from: panelLoc, entry });
    setPanelLoc(null);
  }, [entriesAt, panelLoc]);

  const handleClosePopover = useCallback(() => setPanelLoc(null), []);

  const handleModalClose = useCallback(() => {
    setPanelLoc(null);
    setMoveMode(false);
    setMoving(null);
    setPendingMove(null);
    onClose();
  }, [onClose]);

  // ── Confirm move ────────────────────────────────────────────────────────────
  const confirmMove = useCallback(async () => {
    const item = pendingMove.selectedItem || pendingMove.items[0];
    const { fromLocation, toLocation } = pendingMove;
    setPendingMove(null);

    try {
      if (item.kind === "new") {
        // A new pallet is put away again; every item line on it moves together.
        await axiosInstance.put(`/af-lots/${item.lotId}/pallets/${item.palletNo}`, { location: toLocation });
        setNewByLocation((prev) => {
          const next = { ...prev };
          const onIt = (p) => `${p.lotId}-${p.palletNo}` === item.key;
          const left = (next[fromLocation] || []).filter((p) => !onIt(p));
          const moved = (next[fromLocation] || []).filter(onIt);
          if (left.length === 0) delete next[fromLocation];
          else next[fromLocation] = left;
          next[toLocation] = [...(next[toLocation] || []), ...moved];
          return next;
        });
      } else {
        const { data: updated } = await axiosInstance.post("/inventoryMove", {
          itemId: item._id,
          destLocation: toLocation,
        });

        setItemsByLocation((prev) => {
          const next = { ...prev };

          // Remove from source
          const srcRemaining = (next[fromLocation] || []).filter((i) => i._id !== item._id);
          if (srcRemaining.length === 0) delete next[fromLocation];
          else next[fromLocation] = srcRemaining;

          // Add to destination
          next[toLocation] = [...(next[toLocation] || []), updated];
          return next;
        });
      }
      // Show where it landed.
      setPanelLoc(toLocation);

      toast({
        title: `Moved to ${toLocation}`,
        description: item.description,
        position: "top",
        status: "success",
        duration: 2000,
        isClosable: true,
      });
    } catch (err) {
      toast({
        title: "Move failed",
        description: err.response?.data?.error,
        position: "top",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  }, [pendingMove, toast]);

  // ── Move modal state ────────────────────────────────────────────────────────
  const showPicker   = pendingMove && pendingMove.items.length > 1 && !pendingMove.selectedItem;
  const showConfirm  = pendingMove && (pendingMove.items.length === 1 || !!pendingMove.selectedItem);
  const moveItem     = pendingMove?.selectedItem || pendingMove?.items?.[0];
  const dragging     = activeId ? entriesAt(activeId) : [];

  // The header and body, shown in a floating window or, inline, straight on the page.
  const header = (
          <Flex align="center" justify="space-between" width="100%">
            <Flex align="center" gap={2}>
              Freezer Map
              {highlightLocation && (
                <Text as="span" fontSize="sm" fontWeight="normal" color="yellow.600">
                  — Locating {highlightLocation}
                </Text>
              )}
            </Flex>

            <Flex align="center" gap={2}>
            {/* Inline on the homescreen: move the map into its own window. */}
            {inline && onPopOut && (
              <Tooltip label="Pop out into a window">
                <IconButton size="sm" variant="ghost" aria-label="Pop out into a window" icon={<ExternalLinkIcon />} onClick={onPopOut} />
              </Tooltip>
            )}
            {/* Move mode toggle — desktop only */}
            {isDesktop && (
              <Flex gap={1} bg="gray.100" borderRadius="lg" p={0.5}>
                <Button
                  size="xs"
                  borderRadius="md"
                  bg={!moveMode ? "white" : "transparent"}
                  color={!moveMode ? "gray.700" : "gray.400"}
                  boxShadow={!moveMode ? "sm" : "none"}
                  fontWeight={!moveMode ? "semibold" : "normal"}
                  onClick={() => { setMoveMode(false); setPanelLoc(null); setMoving(null); }}
                  _hover={{}}
                >
                  Inspect
                </Button>
                <Button
                  size="xs"
                  borderRadius="md"
                  bg={moveMode ? "white" : "transparent"}
                  color={moveMode ? "blue.600" : "gray.400"}
                  boxShadow={moveMode ? "sm" : "none"}
                  fontWeight={moveMode ? "semibold" : "normal"}
                  onClick={() => { setMoveMode(true); setPanelLoc(null); setMoving(null); }}
                  _hover={{}}
                >
                  Move
                </Button>
              </Flex>
            )}
            </Flex>
          </Flex>
  );
  const body = (
    <>
            <Flex gap={3} align="center" justify="center" wrap="wrap" mb={2}>
              <Input size="sm" maxW="320px" bg="white" placeholder="Search the map: lot, item, vendor, location"
                value={mapQuery} onChange={(e) => setMapQuery(e.target.value)} />
              {matchCells && (
                <Text fontSize="sm" color={matchCells.size ? "teal.700" : "gray.500"}>
                  {matchCells.size} location{matchCells.size === 1 ? "" : "s"}
                </Text>
              )}
              {mapQuery && <Button size="xs" variant="ghost" onClick={() => setMapQuery("")}>Clear</Button>}
            </Flex>
            <Legend showHighlight={!!highlightLocation} moveMode={moveMode} searching={Boolean(matchCells)} />

            {moving && (
              <Flex align="center" justify="center" gap={3} wrap="wrap" mb={3} px={3} py={2} borderRadius="md"
                bg="yellow.50" border="1px solid" borderColor="yellow.300">
                <Text fontSize="sm" color="yellow.900">
                  Moving <b>{moving.entry.description}</b> from <b>{moving.from}</b>. Tap where it goes; switch levels if you need to.
                </Text>
                <Button size="xs" variant="outline" onClick={() => setMoving(null)}>Cancel</Button>
              </Flex>
            )}

            <Flex direction={{ base: "column", lg: "row" }} gap={3} align="stretch">
            <Box flex={1} minW={0}>
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <Tabs
                isFitted
                colorScheme="blue"
                flex={1}
                index={tabIndex}
                onChange={setTabIndex}
              >
                <TabList mb={3} borderBottom="2px" borderColor="gray.100">
                  {["Level 1", "Level 2", "Level 3"].map((label, i) => (
                    <Tab
                      key={label}
                      onClick={handleClosePopover}
                      fontWeight="semibold"
                      fontSize="sm"
                      _selected={{ color: "blue.600", borderColor: "blue.500" }}
                    >
                      {label}
                      <Text as="span" ml={2} fontSize="xs" fontWeight="normal" color="gray.500">
                        {levelStats[i].full}/{levelStats[i].total} full
                      </Text>
                      {matchCells && levelStats[i].matches > 0 && (
                        <Text as="span" ml={2} px={1.5} borderRadius="full" fontSize="xs" bg="teal.400" color="white">
                          {levelStats[i].matches}
                        </Text>
                      )}
                    </Tab>
                  ))}
                </TabList>
                <TabPanels>
                  {[1, 2, 3].map((level) => (
                    <TabPanel key={level} p={0}>
                      {generateMap(level, occCells, handleSeatClick, highlightLocation, moveMode, activeId,
                        { counts, matchCells, fillHeight: !inline })}
                    </TabPanel>
                  ))}
                </TabPanels>
              </Tabs>

              <DragOverlay dropAnimation={null}>
                {activeId ? (
                  ["FLOOR", "CHILLING"].includes(activeId) ? (
                    <Box
                      bg="blue.600"
                      color="white"
                      borderRadius="md"
                      w="56px"
                      h="56px"
                      display="flex"
                      flexDirection="column"
                      alignItems="center"
                      justifyContent="center"
                      boxShadow="lg"
                      opacity={0.92}
                      pointerEvents="none"
                    >
                      <Text fontSize="xs" fontWeight="bold" lineHeight={1}>{activeId}</Text>
                      {dragging?.length > 0 && (
                        <Text fontSize="9px" fontWeight="normal" opacity={0.85} mt={0.5}>
                          {dragging.length > 1
                            ? `${dragging.length} items`
                            : "1 item"}
                        </Text>
                      )}
                    </Box>
                  ) : (
                    <Box
                      bg="blue.600"
                      color="white"
                      borderRadius="md"
                      px={2}
                      py={1.5}
                      fontSize="xs"
                      fontWeight="bold"
                      boxShadow="lg"
                      minW="44px"
                      textAlign="center"
                      opacity={0.92}
                      pointerEvents="none"
                    >
                      {activeId}
                      {dragging?.length > 0 && (
                        <Text fontSize="10px" fontWeight="normal" opacity={0.85} noOfLines={1} mt={0.5}>
                          {dragging.length > 1
                            ? `${dragging.length} items`
                            : dragging[0].description}
                        </Text>
                      )}
                    </Box>
                  )
                ) : null}
              </DragOverlay>
            </DndContext>
            </Box>

            <MapCellPanel
              location={panelLoc}
              news={panelLoc ? newByLocation[panelLoc] : []}
              olds={panelLoc ? itemsByLocation[panelLoc] : []}
              onClose={handleClosePopover}
              onCloseMap={handleModalClose}
              onMove={startMove}
            />
            </Flex>
    </>
  );

  return (
    <>
      {inline ? (
        <Box p={3}>
          <Box mb={2} fontWeight="semibold">{header}</Box>
          {body}
        </Box>
      ) : (
      <FloatingWindow
        isOpen={isOpen}
        onClose={handleModalClose}
        width={1100}
        height={760}
        bodyProps={{ display: "flex", flexDirection: "column", overflowY: "auto", p: 4 }}
        title={header}
        isFullScreen={fullScreen}
        onToggleFullScreen={() => setFullScreen((f) => !f)}
        headerActions={onPopIn && (
          <Tooltip label="Bring it back here">
            <IconButton size="xs" variant="ghost" aria-label="Bring it back here" icon={<PopInIcon />} onClick={onPopIn} />
          </Tooltip>
        )}
      >
        {body}
      </FloatingWindow>
      )}

      {/* ── Move confirmation / picker ─────────────────────────────────────── */}
      <AlertDialog
        isOpen={!!pendingMove}
        leastDestructiveRef={cancelMoveRef}
        onClose={() => setPendingMove(null)}
        isCentered
      >
        <AlertDialogOverlay backdropFilter="blur(2px)" />
        <AlertDialogContent borderRadius="xl" maxW="400px">

          {/* Header */}
          <Box px={6} pt={5} pb={3} borderBottom="1px" borderColor="gray.100">
            <Text fontWeight="bold" fontSize="md" color="gray.800">
              {showPicker ? "Which item?" : "Confirm Move"}
            </Text>
            {pendingMove && (
              <Flex align="center" gap={2} mt={0.5}>
                <Text fontSize="xs" color="gray.500" fontWeight="semibold">
                  {pendingMove.fromLocation}
                </Text>
                <Text fontSize="xs" color="gray.400">→</Text>
                <Text fontSize="xs" color="blue.500" fontWeight="semibold">
                  {pendingMove.toLocation}
                </Text>
              </Flex>
            )}
          </Box>

          <AlertDialogBody px={6} py={4}>
            {showPicker && (
              <Flex direction="column" gap={2}>
                <Text fontSize="xs" color="gray.400" mb={1}>
                  Select the item to move to {pendingMove.toLocation}
                </Text>
                <Flex direction="column" gap={2} maxH="300px" overflowY="auto" pr={1}>
                {pendingMove.items.map((item) => (
                  <ItemCard
                    key={item.key}
                    item={item}
                    selected={pendingMove.selectedItem?.key === item.key}
                    onClick={() =>
                      setPendingMove((prev) => ({ ...prev, selectedItem: item }))
                    }
                  />
                ))}
                </Flex>
              </Flex>
            )}

            {showConfirm && moveItem && (
              <Box>
                <Text fontSize="xs" color="gray.400" mb={2}>
                  Moving the following item to{" "}
                  <Text as="span" fontWeight="semibold" color="blue.500">
                    {pendingMove.toLocation}
                  </Text>
                  {occCells.includes(pendingMove.toLocation) && (
                    <Text as="span" color="yellow.600"> (occupied)</Text>
                  )}
                </Text>
                <ItemCard item={moveItem} />
              </Box>
            )}
          </AlertDialogBody>

          <AlertDialogFooter px={6} pb={5} gap={3}>
            <Button
              ref={cancelMoveRef}
              onClick={() =>
                showConfirm && pendingMove?.items.length > 1
                  ? setPendingMove((prev) => ({ ...prev, selectedItem: null }))
                  : setPendingMove(null)
              }
              variant="outline"
              borderRadius="lg"
              w="full"
            >
              {showConfirm && pendingMove?.items.length > 1 ? "Back" : "Cancel"}
            </Button>
            {showConfirm && (
              <Button
                colorScheme="blue"
                borderRadius="lg"
                w="full"
                onClick={confirmMove}
              >
                Move
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ShowMap;
