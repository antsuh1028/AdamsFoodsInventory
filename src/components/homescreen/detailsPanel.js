import { useState } from "react";
import { Box, Text, Flex, Button, Divider, Collapse, Grid, GridItem } from "@chakra-ui/react";
import printDetails from "../../utils/printDetails";

const Field = ({ label, value }) => {
  if (!value) return null;
  return (
    <GridItem>
      <Text fontSize="xs" color="gray.400" fontWeight="medium" textTransform="uppercase" letterSpacing="wide">
        {label}
      </Text>
      <Text fontSize="sm" color="gray.700" fontWeight="medium">
        {value}
      </Text>
    </GridItem>
  );
};

const DetailsPanel = ({ item, showDetails, onClose, onSet, onLocate }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Collapse in={showDetails && !!item} animateOpacity onAnimationComplete={() => { if (!showDetails) setExpanded(false); }}>
      <Box borderTop="2px" borderColor="blue.100" bg="white" px={4} pt={3} pb={4}>
        <Flex justify="space-between" align="flex-start" mb={2}>
          <Box>
            <Text fontWeight="bold" fontSize="sm" color="gray.800">
              {item?.location}
            </Text>
            <Text fontSize="xs" color="gray.500" noOfLines={1}>
              {item?.description}
            </Text>
          </Box>
          <Button
            size="xs"
            variant="ghost"
            color="gray.400"
            _hover={{ color: "gray.700" }}
            onClick={onClose}
            minW="auto"
            p={1}
          >
            ✕
          </Button>
        </Flex>

        <Divider mb={3} />

        {/* Summary row — always visible */}
        <Grid templateColumns="repeat(3, 1fr)" gap={3} mb={3}>
          <Field label="Lot" value={item?.lot} />
          <Field label="Brand" value={item?.brand} />
          <Field label="Grade" value={item?.grade} />
          <Field label="Quantity" value={item?.quantity ? `${item.quantity} bx` : null} />
          <Field label="Weight" value={item?.weight ? `${item.weight} lb` : null} />
          <Field label="Species" value={item?.species} />
          <Field label="Price / lb" value={item?.price ? `$${item.price}` : null} />
          <Field label="Total Value" value={item?.price && item?.weight ? `$${(parseFloat(item.price) * parseFloat(item.weight)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null} />
        </Grid>

        {/* Expanded details */}
        <Collapse in={expanded} animateOpacity>
          <Divider mb={3} />
          <Grid templateColumns="repeat(3, 1fr)" gap={3} mb={3}>
            <Field label="Vendor" value={item?.vendor} />
            <Field label="EST #" value={item?.est} />
            <Field label="Pack Date" value={item?.packdate} />
            <Field label="Date Received" value={item?.date_recvd} />
          </Grid>
        </Collapse>

        <Flex gap={2} justify="space-between" align="center">
          <Button
            size="xs"
            variant="ghost"
            color="gray.400"
            _hover={{ color: "gray.600" }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Less" : "Full Details"}
          </Button>
          <Flex gap={2}>
            <Button size="xs" variant="outline" onClick={() => printDetails(item)}>
              Print
            </Button>
            <Button size="xs" colorScheme="orange" onClick={() => onLocate(item)}>
              Locate
            </Button>
            <Button size="xs" colorScheme="blue" onClick={() => onSet(item)}>
              Set
            </Button>
          </Flex>
        </Flex>
      </Box>
    </Collapse>
  );
};

export default DetailsPanel;
