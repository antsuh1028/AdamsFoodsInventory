import { useState, useEffect } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
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
} from "@chakra-ui/react";

import { locationRows } from "../../utils/navbar/exportRows.js";

import findItem from "../../utils/homescreen/findItem.js";
import getLocations from "../../utils/navbar/getLocations.js";

import InfoPopover from "./infoPopover.js";

const SeatBlock = ({ id, seats, occupiedCells, onSeatClick, highlightLocation }) => {
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
            <Box
              key={index}
              p={1}
              textAlign="center"
              borderRadius="sm"
              bg={
                isUnavailable
                  ? "gray.100"
                  : isHighlighted
                  ? "orange.300"
                  : isOccupied
                  ? "blue.100"
                  : "white"
              }
              border={isHighlighted ? "2px" : "1px"}
              borderColor={
                isUnavailable
                  ? "transparent"
                  : isHighlighted
                  ? "orange.500"
                  : isOccupied
                  ? "blue.300"
                  : "gray.100"
              }
              color={
                isUnavailable
                  ? "gray.300"
                  : isHighlighted
                  ? "orange.900"
                  : isOccupied
                  ? "blue.700"
                  : "gray.700"
              }
              fontWeight={isHighlighted ? "bold" : "normal"}
              boxShadow={isHighlighted ? "0 0 0 2px orange" : "none"}
              _hover={
                isUnavailable
                  ? {}
                  : { bg: isHighlighted ? "orange.400" : isOccupied ? "blue.200" : "teal.50", cursor: "pointer" }
              }
              onClick={isUnavailable ? undefined : (e) => onSeatClick(e, id, seat)}
            >
              {isUnavailable ? "—" : seat}
            </Box>
          );
        })}
      </Grid>
    </Box>
  );
};

const Legend = ({ showHighlight }) => (
  <HStack spacing={4} justify="center" mb={3} fontSize="xs" color="gray.500">
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
        <Box w={3} h={3} borderRadius="sm" bg="orange.300" border="2px" borderColor="orange.500" />
        <Text color="orange.600" fontWeight="semibold">Located Item</Text>
      </HStack>
    )}
  </HStack>
);

const generateMap = (level, occupiedCells, onSeatClick, highlightLocation) => {
  const topRowData =
    level === 1
      ? locationRows.topRow1
      : level === 2
      ? locationRows.topRow2
      : locationRows.topRow3;
  const rightRowData =
    level === 1
      ? locationRows.rightRow1
      : level === 2
      ? locationRows.rightRow2
      : locationRows.rightRow3;
  const bottomRowData =
    level === 1
      ? locationRows.bottomRow1
      : level === 2
      ? locationRows.bottomRow2
      : locationRows.bottomRow3;

  return (
    <Box w="100%" maxW="100%" mx="auto" p={3}>
      <Box w="100%">
        <Flex justify="space-between" mb={6}>
          <Grid templateColumns="repeat(4, 1fr)" gap={2} w="31%">
            {Object.entries(topRowData).map(([id, seats]) => (
              <SeatBlock
                key={id}
                id={id}
                seats={seats}
                occupiedCells={occupiedCells}
                onSeatClick={onSeatClick}
                highlightLocation={highlightLocation}
              />
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
              <SeatBlock
                key={id}
                id={id}
                seats={seats}
                occupiedCells={occupiedCells}
                onSeatClick={onSeatClick}
                highlightLocation={highlightLocation}
              />
            ))}
          </Grid>
        </Flex>

        <Flex gap={1.5} w="100%" flexWrap="wrap" justifyContent="center">
          {Object.entries(bottomRowData).map(([id, seats]) => (
            <Box key={id} flex={1} flexGrow={1} minWidth={0}>
              <SeatBlock
                id={id}
                seats={seats}
                occupiedCells={occupiedCells}
                onSeatClick={onSeatClick}
                highlightLocation={highlightLocation}
              />
            </Box>
          ))}
        </Flex>
      </Box>
    </Box>
  );
};

// Parse location string (e.g. "W101") to get 0-based tab index from level digit
const getTabIndexFromLocation = (location) => {
  if (!location || location.length < 2) return 0;
  const level = parseInt(location[1]);
  if (level >= 1 && level <= 3) return level - 1;
  return 0;
};

function ShowMap({ isOpen, onClose, highlightLocation }) {
  const [popoverInfo, setPopoverInfo] = useState([]);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const [occCells, setOccCells] = useState([]);
  const [tabIndex, setTabIndex] = useState(0);

  const handleSeatClick = (e, id, seat) => {
    setPopoverPosition({ x: e.clientX, y: e.clientY });

    findItem(
      { location: `${id}${seat}` },
      (result) => {
        if (!result || result.length === 0) {
          setPopoverInfo([
            {
              location: `${id}${seat}`,
              description: "Empty Location",
              quantity: "",
              lot: "",
              brand: "",
              grade: "",
            },
          ]);
        } else {
          setPopoverInfo(result);
        }
      },
      null,
      null
    );
  };

  const handleClosePopover = () => {
    setPopoverInfo([]);
  };

  const handleModalClose = () => {
    setPopoverInfo([]);
    setPopoverPosition({ x: 0, y: 0 });
    onClose();
  };

  useEffect(() => {
    if (isOpen === true) {
      findItem(
        { location: "" },
        (newCells) => {
          setOccCells(getLocations(newCells));
        },
        null,
        null
      );

      // Auto-jump to the level tab that contains the highlighted location
      if (highlightLocation) {
        setTabIndex(getTabIndexFromLocation(highlightLocation));
      } else {
        setTabIndex(0);
      }
    }
  }, [isOpen, highlightLocation]);

  return (
    <Modal isOpen={isOpen} onClose={handleModalClose} size="xl">
      <ModalOverlay bg="blackAlpha.600" />
      <ModalContent maxW="90vw" height="90vh" borderRadius="xl" overflow="hidden">
        <ModalHeader
          borderBottom="1px"
          borderColor="gray.100"
          py={3}
          fontSize="lg"
          fontWeight="semibold"
        >
          Freezer Map
          {highlightLocation && (
            <Text as="span" fontSize="sm" fontWeight="normal" color="orange.500" ml={2}>
              — Locating {highlightLocation}
            </Text>
          )}
        </ModalHeader>
        <ModalCloseButton top={3} />
        <ModalBody display="flex" flexDirection="column" overflowY="auto" p={4}>
          <Legend showHighlight={!!highlightLocation} />
          <Tabs isFitted colorScheme="blue" flex={1} index={tabIndex} onChange={setTabIndex}>
            <TabList mb={3} borderBottom="2px" borderColor="gray.100">
              <Tab
                onClick={handleClosePopover}
                fontWeight="semibold"
                fontSize="sm"
                _selected={{ color: "blue.600", borderColor: "blue.500" }}
              >
                Level 1
              </Tab>
              <Tab
                onClick={handleClosePopover}
                fontWeight="semibold"
                fontSize="sm"
                _selected={{ color: "blue.600", borderColor: "blue.500" }}
              >
                Level 2
              </Tab>
              <Tab
                onClick={handleClosePopover}
                fontWeight="semibold"
                fontSize="sm"
                _selected={{ color: "blue.600", borderColor: "blue.500" }}
              >
                Level 3
              </Tab>
            </TabList>
            <TabPanels>
              <TabPanel p={0}>{generateMap(1, occCells, handleSeatClick, highlightLocation)}</TabPanel>
              <TabPanel p={0}>{generateMap(2, occCells, handleSeatClick, highlightLocation)}</TabPanel>
              <TabPanel p={0}>{generateMap(3, occCells, handleSeatClick, highlightLocation)}</TabPanel>
            </TabPanels>
          </Tabs>

          <InfoPopover
            info={popoverInfo}
            position={popoverPosition}
            onClose={handleClosePopover}
            onModalClose={handleModalClose}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default ShowMap;
