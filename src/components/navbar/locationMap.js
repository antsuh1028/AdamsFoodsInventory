import { React, useState, useEffect } from "react";
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
} from "@chakra-ui/react";

import { locationRows } from "../../utils/navbar/exportRows.js";

import findItem from "../../utils/homescreen/findItem.js";
import getLocations from "../../utils/navbar/getLocations.js";

import InfoPopover from "./infoPopover.js";

const SeatBlock = ({ id, seats, occupiedCells, onSeatClick }) => {
  const hasSixSeats = seats.length >= 6;

  const handleClick = (e, seat) => {
    onSeatClick(e, id, seat);
  };

  return (
    <Box
      border="1px"
      borderColor="gray.300"
      h="100%"
      p={2}
      minH="100%"
      overflow="hidden"
    >
      <Text
        textAlign="center"
        fontWeight="bold"
        borderBottom="1px"
        borderColor="gray.300"
        mb={1}
      >
        {id}
      </Text>
      <Grid
        templateColumns={hasSixSeats ? "repeat(2, 1fr)" : "1fr"}
        fontSize="md"
        gap={1}
      >
        {seats.map((seat, index) => (
          <Text
            key={index}
            p={1}
            textAlign="center"
            borderColor="gray.200"
            bg={occupiedCells?.includes(`${id}${seat}`) ? "gray.300" : "white"}
            _hover={{ bg: "blue.100", cursor: "pointer" }}
            onClick={(e) => handleClick(e, seat)}
          >
            {seat}
          </Text>
        ))}
      </Grid>
    </Box>
  );
};

const generateMap = (level, occupiedCells, onSeatClick) => {
  const generateRowData = (baseData, level) => {
    return Object.entries(baseData).reduce((acc, [key, value]) => {
      acc[`${key}`] = value;
      return acc;
    }, {});
  };

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

  const mappedTopRow = generateRowData(topRowData, level);
  const mappedRightRow = generateRowData(rightRowData, level);
  const mappedBottomRow = generateRowData(bottomRowData, level);

  return (
    <Box w="100%" maxW="100%" mx="auto" p={4}>
      <Text textAlign="center" fontSize="xl" fontWeight="bold" mb={4}>
        [LEVEL {level}]
      </Text>

      <Box w="100%">
        <Flex justify="space-between" mb={8}>
          <Grid templateColumns="repeat(4, 1fr)" gap={2} w="31%">
            {Object.entries(mappedTopRow).map(([id, seats]) => (
              <SeatBlock
                key={id}
                id={id}
                seats={seats}
                occupiedCells={occupiedCells}
                onSeatClick={onSeatClick}
              />
            ))}
          </Grid>

          <Box textAlign="center" px={8}>
            <Box
              border="1px"
              borderColor="gray.300"
              px={100}
              py={3}
              fontWeight="bold"
            >
              DOOR
            </Box>
          </Box>

          <Grid templateColumns="repeat(6, 1fr)" gap={2} w="48%">
            {Object.entries(mappedRightRow).map(([id, seats]) => (
              <SeatBlock
                key={id}
                id={id}
                seats={seats}
                occupiedCells={occupiedCells}
                onSeatClick={onSeatClick}
              />
            ))}
          </Grid>
        </Flex>

        <Flex gap={2} w="100%" flexWrap="wrap" justifyContent="center">
          {Object.entries(mappedBottomRow).map(([id, seats]) => (
            <Box key={id} flex={1} flexGrow={1} minWidth={0}>
              <SeatBlock
                key={id}
                id={id}
                seats={seats}
                occupiedCells={occupiedCells}
                onSeatClick={onSeatClick}
              />
            </Box>
          ))}
        </Flex>
      </Box>
    </Box>
  );
};

function ShowMap({ isOpen, onClose }) {
  const [popoverInfo, setPopoverInfo] = useState([]);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const [occCells, setOccCells] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null); 

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
          setSelectedItem(result[0]);
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
    handleClosePopover();
    onClose();
  };

  useEffect(() => {
    if (isOpen === true) {
      function initializeMap() {
        findItem(
          { location: "" },
          (newCells) => {
            setOccCells(getLocations(newCells));
          },
          null,
          null
        );
      }

      initializeMap();
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={handleModalClose} size="xl">
      <ModalOverlay />
      <ModalContent maxW="90vw" height="90vh">
        <ModalHeader>Freezer Map</ModalHeader>
        <ModalCloseButton />
        <ModalBody display="flex" justifyContent="center">
          <InfoPopover
            info={popoverInfo}
            position={popoverPosition}
            onClose={handleClosePopover}
            onModalClose={handleModalClose}
            selectedItem={selectedItem} 
            setSelectedItem={setSelectedItem} 
          />

          <Tabs isFitted>
            <TabList mb={4}>
              <Tab onClick={handleClosePopover}>Level 1</Tab>
              <Tab onClick={handleClosePopover}>Level 2</Tab>
              <Tab onClick={handleClosePopover}>Level 3</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>{generateMap(1, occCells, handleSeatClick)}</TabPanel>
              <TabPanel>{generateMap(2, occCells, handleSeatClick)}</TabPanel>
              <TabPanel>{generateMap(3, occCells, handleSeatClick)}</TabPanel>
            </TabPanels>
          </Tabs>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default ShowMap;
