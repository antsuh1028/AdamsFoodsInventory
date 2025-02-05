import { React, useContext, useState } from 'react';
import { Box, Button, HStack } from '@chakra-ui/react';
import { FormContext } from '../../utils/homescreen/formContext';
import printDetails from "../../utils/printDetails"; 
// import UploadTally from './uploadTally';

const PopoverHeader = ({ onClose }) => (
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
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      ✕
    </Button>
  </Box>
);

const EmptyLocationInfo = ({ location }) => (
  <Box mb={2}>
    <HStack>
      <Box mb={2}>
        Location: <strong>{location}</strong>
      </Box>
    </HStack>
    <Box mb={2}>Empty Location</Box>
  </Box>
);

const LocationDetails = ({ item, isLastItem }) => (
  <Box key={`item-${item.location}`}>
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
    {!isLastItem && (
      <Box borderBottom="1px" borderColor="gray.200" my={2} />
    )}
  </Box>
);

const PopoverContent = ({ info }) => (
  <Box overflowY="auto" maxHeight="calc(85vh - 110px)">
    {info[0]?.description === "Empty Location" ? (
      <EmptyLocationInfo location={info[0].location} />
    ) : (
      info.map((item, index) => (
        <LocationDetails
          key={`${item.location}-${index}`}
          item={item}
          isLastItem={index === info.length - 1}
        />
      ))
    )}
  </Box>
);

const PopoverFooter = ({ onSet, info }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Box
      display="flex"
      gap={2}
      mt={4}
      position="sticky"
      bottom={0}
      bg="white"
      pt={2}
    >
      <Button size="sm" colorScheme="blue" onClick={() => onSet(info[0])}>
        Set
      </Button>
      <Button size="sm" onClick={() => {
        console.log(selectedProduct);
        printDetails(selectedProduct);}}> Print
      </Button>
      <Button size="sm">Details</Button>
      {/* <Button size="sm" onClick={() => setIsOpen(true)}>Upload</Button> */}
        
      {/* <UploadTally isOpen={isOpen} onClose={() => setIsOpen(false)} /> */}

    </Box>
  )};

const InfoPopover = ({ info, position, onClose, onModalClose }) => {
  const { setFormData, setCurrentItem } = useContext(FormContext);

  if (!info || !info.length) return null;

  const handleSet = (item) => {
    setFormData({
      location: item.location || "",
      lot: item.lot || "",
      vendor: item.vendor || "",
      brand: item.brand || "",
      species: item.species || "",
      description: item.description === "Empty Location" ? "" : item.description || "",
      grade: item.grade || "",
      quantity: item.quantity || "",
      weight: item.weight || "",
      packdate: item.packdate || "",
      date_recvd: item.date_recvd || "",
      est: item.est || "",
    });

    setCurrentItem(item);
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
      maxHeight="50vh"
      width="20vw"
      maxWidth="500px"
      overflowY="auto"
      data-popover="true"
      transform={`translate(${
        position.x > window.innerWidth / 2 ? "-100%" : "0"
      }, ${position.y > window.innerHeight / 2 ? "-100%" : "0"})`}
    >
      <PopoverHeader onClose={onClose} />
      <PopoverContent info={info} />
      <PopoverFooter onSet={handleSet} info={info} />
    </Box>
  );
};

export default InfoPopover;