import React from "react";
import { Box, Text, Flex, Button } from "@chakra-ui/react";

const DetailsPanel = ({ item, showDetails, onClose, onSet }) => {
  // console.log(item);
  if (!showDetails || !item) return null;

  return (
    <Box
      p={4}
      bg="white"
      borderWidth="1px"
      borderRadius="md"
      mt={4}
      width="90%"
    >
      <Text fontWeight="bold">Location: {item.location}</Text>
      <Text>Lot: {item.lot}</Text>
      <Text>Vendor: {item.vendor}</Text>
      <Text>Brand: {item.brand}</Text>
      <Text>Species: {item.species}</Text>
      <Text>Description: {item.description}</Text>
      <Text>Grade: {item.grade}</Text>
      <Text>Quantity: {item.quantity}</Text>
      <Text>Weight: {item.weight} lb</Text>
      <Text>Pack Date: {item.packdate}</Text>
      <Text>Date Recieved: {item.date_recvd}</Text>
      <Text>EST#: {item.est}</Text>

      <Flex width="100%" justifyContent="center" mt={4}>
        <Button marginRight="10px" onClick={() => onSet(item)}>
          Set
        </Button>
        <Button>Print</Button>
        <Button marginLeft="10px" onClick={onClose}>
          Close
        </Button>
      </Flex>
    </Box>
  );
};

export default DetailsPanel;
