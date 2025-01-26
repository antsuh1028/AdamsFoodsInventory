import { React, useContext, useState, useEffect } from "react";
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
  Button,
  HStack,
} from "@chakra-ui/react";

import {
  topRow1,
  topRow2,
  topRow3,
  rightRow1,
  rightRow2,
  rightRow3,
  bottomRow1,
  bottomRow2,
  bottomRow3,
} from "./exportRows";

import findItem from "../homescreen/findItem";
import getLocations from "./getLocations";
import { FormContext } from "../homescreen/formContext.js";

const InfoPopover = ({ info, position, onClose, onModalClose }) => {
  const formSetters = useContext(FormContext);
  if (!info.length) return null;

  const handleSet = (item) => {
    formSetters.setLocation(item.location || "");
    formSetters.setLot(item.lot || "");
    formSetters.setVendor(item.vendor || "");
    formSetters.setBrand(item.brand || "");
    formSetters.setSpecies(item.species || "");
    formSetters.setDescription(item.description || "");
    formSetters.setGrade(item.grade || "");
    formSetters.setQuantity(item.quantity || "");
    formSetters.setWeight(item.weight || "");
    formSetters.setPackdate(item.packdate || "");
    formSetters.setTemp(item.temp || "");
    formSetters.setEst(item.est || "");
    formSetters.setCurrentItem(item);
    onClose();
    onModalClose();
  };

  return (
    <Box
      position="fixed"
      left={position.x}
      top={position.y}
      bg="white"
      boxShadow="lg"
      border="1px"
      borderColor="gray.200"
      borderRadius="md"
      p={4}
      zIndex={1400}
      maxHeight="80vh"
      width="20vw"
      maxWidth="500px"
    >
      <Box
        fontWeight="bold"
        mb={2}
        position="sticky"
        top={0}
        bg="white"
        zIndex={10}
      >
        Product Info
        <Button
          size="sm"
          position="absolute"
          right={2}
          top={2}
          onClick={onClose}
        >
          ✕
        </Button>
      </Box>
      <Box overflowY="auto" maxHeight="calc(85vh - 110px)">
        {info.map((item, index) => (
          <Box key={index}>
            <HStack>
              <Box mb={2}>
                Location: <strong>{item.location}</strong>
              </Box>
              <Box mb={2}>
                Quantity: <strong>{item.quantity}</strong>
              </Box>
            </HStack>
            <Box mb={2}>
              Lot #: <strong>{item.lot}</strong>
            </Box>
            <HStack>
              <Box mb={2}>
                Brand: <strong>{item.brand}</strong>
              </Box>
              <Box mb={2} mr={2}>
                Grade: <strong>{item.grade}</strong>
              </Box>
            </HStack>
            <Box mb={2}>
              Description: <strong>{item.description}</strong>
            </Box>
            {index < info.length - 1 && (
              <Box borderBottom="1px" borderColor="gray.200" my={2} />
            )}
          </Box>
        ))}
      </Box>
      <Box
        display="flex"
        gap={2}
        mt={4}
        position="sticky"
        bottom={0}
        bg="white"
        pt={2}
      >
        <Button size="sm" colorScheme="blue" onClick={() => handleSet(info[0])}>
          Set
        </Button>
        <Button size="sm">Print</Button>
      </Box>
    </Box>
  );
};

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

  const topRowData = level === 1 ? topRow1 : level === 2 ? topRow2 : topRow3;
  const rightRowData =
    level === 1 ? rightRow1 : level === 2 ? rightRow2 : rightRow3;
  const bottomRowData =
    level === 1 ? bottomRow1 : level === 2 ? bottomRow2 : bottomRow3;

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

function ShowMap({ isOpen, onClose, occupiedCells }) {
  const [popoverInfo, setPopoverInfo] = useState([]);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const [occCells, setOccCells] = useState([]);

  const handleSeatClick = (e, id, seat) => {
    setPopoverInfo([]);

    setPopoverPosition({ x: e.clientX, y: e.clientY });
    findItem({ location: `${id}${seat}` }, setPopoverInfo, null, null);
  };

  const handleClosePopover = () => {
    setPopoverInfo([]);
  };

  const handleModalClose = () => {
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
          />
          <Tabs isFitted>
            <TabList mb={4}>
              <Tab>Level 1</Tab>
              <Tab>Level 2</Tab>
              <Tab>Level 3</Tab>
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
