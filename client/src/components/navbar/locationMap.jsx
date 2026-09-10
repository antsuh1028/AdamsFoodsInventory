import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  useBreakpointValue,
  useToast,
} from "@chakra-ui/react";
import FloatingWindow from "../FloatingWindow";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { locationRows } from "../../utils/navbar/exportRows";
import findItem from "../../utils/homescreen/findItem";
import InfoPopover from "./infoPopover";
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
    bg = "gray.100"; borderColor = "transparent"; color = "gray.300";
    border = "1px"; boxShadow = "none"; cursor = "default";
  } else if (isDragging) {
    bg = "blue.50"; borderColor = "blue.200"; color = "blue.300";
    border = "1px"; boxShadow = "none"; cursor = "grabbing";
  } else if (isHighlighted) {
    bg = "yellow.300"; borderColor = "yellow.500"; color = "yellow.900";
    border = "2px"; boxShadow = "0 0 0 2px #D69E2E"; cursor = moveMode && isOccupied ? "grab" : "pointer";
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
      p={1}
      textAlign="center"
      borderRadius="sm"
      bg={bg}
      border={border}
      borderColor={borderColor}
      color={color}
      fontWeight={isHighlighted ? "bold" : "normal"}
      boxShadow={boxShadow}
      opacity={isDragging ? 0.35 : 1}
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
      {isUnavailable ? "—" : seat}
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
        fontSize="xs"
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
            />
          );
        })}
      </Grid>
    </Box>
  );
};

// ─── Legend ──────────────────────────────────────────────────────────────────
const Legend = ({ showHighlight, moveMode }) => (
  <HStack spacing={4} justify="center" mb={3} fontSize="xs" color="gray.500" flexWrap="wrap">
    <HStack spacing={1}>
      <Box w={3} h={3} borderRadius="sm" bg="white" border="1px" borderColor="gray.200" />
      <Text>Empty</Text>
    </HStack>
    <HStack spacing={1}>
      <Box w={3} h={3} borderRadius="sm" bg="blue.100" border="1px" borderColor="blue.300" />
      <Text>Occupied</Text>
    </HStack>
    <HStack spacing={1}>
      <Box w={3} h={3} borderRadius="sm" bg="gray.100" />
      <Text>Unavailable</Text>
    </HStack>
    {showHighlight && (
      <HStack spacing={1}>
        <Box w={3} h={3} borderRadius="sm" bg="yellow.300" border="2px" borderColor="yellow.600" />
        <Text color="yellow.700" fontWeight="semibold">Located Item</Text>
      </HStack>
    )}
    {moveMode && (
      <>
        <HStack spacing={1}>
          <Box w={3} h={3} borderRadius="sm" bg="green.100" border="2px" borderColor="green.400" />
          <Text color="green.600">Drop here (empty)</Text>
        </HStack>
        <HStack spacing={1}>
          <Box w={3} h={3} borderRadius="sm" bg="yellow.100" border="2px" borderColor="yellow.400" />
          <Text color="yellow.700">Drop here (occupied)</Text>
        </HStack>
      </>
    )}
  </HStack>
);

// ─── generateMap ─────────────────────────────────────────────────────────────
const generateMap = (level, occupiedCells, onSeatClick, highlightLocation, moveMode, activeId) => {
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

  const blockProps = { occupiedCells, onSeatClick, highlightLocation, moveMode, activeId };

  return (
    <Box w="100%" maxW="100%" mx="auto" p={3}>
      <Box w="100%">
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
                />
              ))}
            </Flex>
          </>
        )}
      </Box>
    </Box>
  );
};

// ─── FloorCell — droppable+draggable for FLOOR / CHILLING ────────────────────
const FloorCell = ({ loc, isOccupied, isHighlighted, moveMode, activeId, onSeatClick }) => {
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
      opacity={isDragging ? 0.35 : 1}
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
      {loc}
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

// ─── Parse location string → tab index ───────────────────────────────────────
const getTabIndexFromLocation = (location) => {
  if (!location || location.length < 2) return 0;
  const level = parseInt(location[1]);
  if (level >= 1 && level <= 3) return level - 1;
  return 0;
};

// ─── ShowMap ─────────────────────────────────────────────────────────────────
function ShowMap({ isOpen, onClose, highlightLocation }) {
  const [popoverInfo, setPopoverInfo]       = useState([]);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const [itemsByLocation, setItemsByLocation] = useState({});
  const [tabIndex, setTabIndex]             = useState(0);
  const [moveMode, setMoveMode]             = useState(false);
  const [activeId, setActiveId]             = useState(null);
  const [pendingMove, setPendingMove]       = useState(null);
  const cancelMoveRef                       = useRef();
  const toast                               = useToast();
  const isDesktop = useBreakpointValue({ base: false, md: true });

  // Derived: occupied cells from itemsByLocation keys
  const occCells = useMemo(() => Object.keys(itemsByLocation), [itemsByLocation]);

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
    setPopoverInfo([]); // close any open popover
  }, []);

  const handleDragEnd = useCallback(({ active, over }) => {
    setActiveId(null);
    if (!over) return;
    const fromLocation = active.id;
    const toLocation = over.id.startsWith("drop-") ? over.id.slice(5) : over.id;
    if (fromLocation === toLocation) return;

    const items = itemsByLocation[fromLocation] || [];
    if (items.length === 0) return;
    setPendingMove({ fromLocation, toLocation, items, selectedItem: null });
  }, [itemsByLocation]);

  // ── Seat click (inspect mode) ───────────────────────────────────────────────
  const handleSeatClick = useCallback((e, locationKey) => {
    setPopoverPosition({ x: e.clientX, y: e.clientY });
    findItem(
      { location: locationKey },
      (result) => {
        if (!result || result.length === 0) {
          setPopoverInfo([{ location: locationKey, description: "Empty Location", quantity: "", lot: "", brand: "", grade: "" }]);
        } else {
          setPopoverInfo(result);
        }
      },
      null,
      null
    );
  }, []);

  const handleClosePopover = useCallback(() => setPopoverInfo([]), []);

  const handleModalClose = useCallback(() => {
    setPopoverInfo([]);
    setPopoverPosition({ x: 0, y: 0 });
    setMoveMode(false);
    setPendingMove(null);
    onClose();
  }, [onClose]);

  // ── Confirm move ────────────────────────────────────────────────────────────
  const confirmMove = useCallback(async () => {
    const item = pendingMove.selectedItem || pendingMove.items[0];
    const { fromLocation, toLocation } = pendingMove;
    setPendingMove(null);

    try {
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

      toast({
        title: `Moved to ${toLocation}`,
        description: item.description,
        position: "top",
        status: "success",
        duration: 2000,
        isClosable: true,
      });
    } catch {
      toast({
        title: "Move failed",
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

  return (
    <>
      <FloatingWindow
        isOpen={isOpen}
        onClose={handleModalClose}
        width={1100}
        height={760}
        bodyProps={{ display: "flex", flexDirection: "column", overflowY: "auto", p: 4 }}
        title={
          <Flex align="center" justify="space-between" width="100%">
            <Flex align="center" gap={2}>
              Freezer Map
              {highlightLocation && (
                <Text as="span" fontSize="sm" fontWeight="normal" color="yellow.600">
                  — Locating {highlightLocation}
                </Text>
              )}
            </Flex>

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
                  onClick={() => { setMoveMode(false); setPopoverInfo([]); }}
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
                  onClick={() => { setMoveMode(true); setPopoverInfo([]); }}
                  _hover={{}}
                >
                  Move
                </Button>
              </Flex>
            )}
          </Flex>
        }
      >
            <Legend showHighlight={!!highlightLocation} moveMode={moveMode} />

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
                    </Tab>
                  ))}
                </TabList>
                <TabPanels>
                  {[1, 2, 3].map((level) => (
                    <TabPanel key={level} p={0}>
                      {generateMap(level, occCells, handleSeatClick, highlightLocation, moveMode, activeId)}
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
                      {itemsByLocation[activeId]?.length > 0 && (
                        <Text fontSize="9px" fontWeight="normal" opacity={0.85} mt={0.5}>
                          {itemsByLocation[activeId].length > 1
                            ? `${itemsByLocation[activeId].length} items`
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
                      {itemsByLocation[activeId]?.length > 0 && (
                        <Text fontSize="10px" fontWeight="normal" opacity={0.85} noOfLines={1} mt={0.5}>
                          {itemsByLocation[activeId].length > 1
                            ? `${itemsByLocation[activeId].length} items`
                            : itemsByLocation[activeId][0].description}
                        </Text>
                      )}
                    </Box>
                  )
                ) : null}
              </DragOverlay>
            </DndContext>

            <InfoPopover
              info={popoverInfo}
              position={popoverPosition}
              onClose={handleClosePopover}
              onModalClose={handleModalClose}
            />
      </FloatingWindow>

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
                    key={item._id}
                    item={item}
                    selected={pendingMove.selectedItem?._id === item._id}
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
                  {itemsByLocation[pendingMove.toLocation]?.length > 0 && (
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
