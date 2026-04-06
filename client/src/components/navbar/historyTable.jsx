import { useState, useEffect } from "react";
import {
  Box,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Text,
  Flex,
  Badge,
  Divider,
  Collapse,
  Grid,
  Spinner,
  HStack,
  IconButton,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon } from "@chakra-ui/icons";
import { useContext } from "react";
import { FormContext } from "../../utils/homescreen/formContext";
import printDetails from "../../utils/printDetails";
import getHistory from "../../utils/navbar/getHistory";

const CHANGE_COLORS = {
  ADD: "green",
  UPDATE: "blue",
  REMOVE: "red",
};

const Field = ({ label, value }) => {
  if (!value) return null;
  return (
    <Box>
      <Text fontSize="xs" color="gray.400" textTransform="uppercase" letterSpacing="wide" fontWeight="medium">
        {label}
      </Text>
      <Text fontSize="sm" color="gray.700" fontWeight="medium">
        {value}
      </Text>
    </Box>
  );
};

const HistoryRow = ({ item, onSet }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box
      border="1px"
      borderColor={expanded ? "blue.200" : "gray.100"}
      borderRadius="lg"
      bg={expanded ? "blue.50" : "white"}
      overflow="hidden"
      transition="all 0.15s"
    >
      {/* Summary row */}
      <Flex
        px={4}
        py={3}
        align="center"
        gap={3}
        cursor="pointer"
        onClick={() => setExpanded((v) => !v)}
        _hover={{ bg: expanded ? "blue.100" : "gray.50" }}
      >
        <Badge
          colorScheme={CHANGE_COLORS[item.change] || "gray"}
          fontSize="xs"
          px={2}
          py={0.5}
          borderRadius="md"
          minW="60px"
          textAlign="center"
          flexShrink={0}
        >
          {item.change}
        </Badge>

        <Box flex={1} minW={0}>
          <HStack spacing={2}>
            <Text fontSize="sm" fontWeight="semibold" color="gray.800" noOfLines={1}>
              {item.location}
            </Text>
            {item.lot && (
              <Text fontSize="xs" color="gray.400">
                · Lot {item.lot}
              </Text>
            )}
          </HStack>
          <Text fontSize="xs" color="gray.500" noOfLines={1}>
            {item.description}
          </Text>
        </Box>

        <HStack spacing={3} flexShrink={0}>
          {item.quantity && (
            <Text fontSize="xs" color="gray.500">
              {item.quantity} bx
            </Text>
          )}
          <Text fontSize="xs" color="gray.400" textAlign="right">
            {item.time}
          </Text>
          <Text fontSize="xs" color="gray.300">
            {expanded ? "▲" : "▼"}
          </Text>
        </HStack>
      </Flex>

      {/* Expanded details */}
      <Collapse in={expanded} animateOpacity>
        <Divider borderColor="blue.100" />
        <Box px={4} py={3} bg="white">
          <Grid templateColumns="repeat(4, 1fr)" gap={4} mb={4}>
            <Field label="Location" value={item.location} />
            <Field label="Lot" value={item.lot} />
            <Field label="Brand" value={item.brand} />
            <Field label="Grade" value={item.grade} />
            <Field label="Quantity" value={item.quantity ? `${item.quantity} bx` : null} />
            <Field label="Weight" value={item.weight ? `${item.weight} lb` : null} />
            <Field label="Species" value={item.species} />
            <Field label="Vendor" value={item.vendor} />
            <Field label="Pack Date" value={item.packdate} />
            <Field label="Date Received" value={item.date_recvd} />
            <Field label="EST #" value={item.est} />
          </Grid>
          {item.description && (
            <Box mb={4}>
              <Text fontSize="xs" color="gray.400" textTransform="uppercase" letterSpacing="wide" fontWeight="medium">
                Description
              </Text>
              <Text fontSize="sm" color="gray.700" fontWeight="medium">
                {item.description}
              </Text>
            </Box>
          )}
          <Flex gap={2} justify="flex-end">
            <Button size="xs" variant="outline" onClick={() => printDetails(item)}>
              Print
            </Button>
            <Button size="xs" colorScheme="blue" onClick={() => onSet(item)}>
              Set
            </Button>
          </Flex>
        </Box>
      </Collapse>
    </Box>
  );
};

const PAGE_SIZE = 10;

function ShowHistory({ isOpen, onClose }) {
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [showBoxEvents, setShowBoxEvents] = useState(false);
  const { setFormData } = useContext(FormContext);

  useEffect(() => {
    if (!isOpen) return;
    setPage(0);
    setLoading(true);
    getHistory()
      .then((data) => setHistoryData(data || []))
      .catch(() => setHistoryData([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleSet = (item) => {
    setFormData({
      location: item.location || "",
      lot: item.lot || "",
      vendor: item.vendor || "",
      brand: item.brand || "",
      species: item.species || "",
      description: item.description || "",
      grade: item.grade || "",
      quantity: item.quantity || "",
      weight: item.weight || "",
      packdate: item.packdate || "",
      date_recvd: item.date_recvd || "",
      est: item.est || "",
    }); 
    onClose();
  };

  const filteredData = showBoxEvents ? historyData : historyData.filter((h) => h.category !== "box");
  const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
  const pageItems = filteredData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <ModalOverlay bg="blackAlpha.600" />
      <ModalContent maxW="780px" maxH="90vh" borderRadius="xl" overflow="hidden">
        <ModalHeader borderBottom="1px" borderColor="gray.100" py={3}>
          <Flex align="center" gap={3}>
            <Text fontSize="lg" fontWeight="semibold">History Log</Text>
            {!loading && filteredData.length > 0 && (
              <Badge colorScheme="gray" fontSize="xs">
                {filteredData.length} entries
              </Badge>
            )}
            {!loading && (
              <Button
                size="xs"
                variant={showBoxEvents ? "solid" : "outline"}
                colorScheme="gray"
                borderRadius="md"
                onClick={() => { setShowBoxEvents((v) => !v); setPage(0); }}
              >
                {showBoxEvents ? "Hide box events" : "Show box events"}
              </Button>
            )}
          </Flex>
        </ModalHeader>
        <ModalCloseButton top={3} />

        <ModalBody overflowY="auto" p={4}>
          {loading ? (
            <Flex justify="center" align="center" py={12}>
              <Spinner color="blue.400" />
            </Flex>
          ) : filteredData.length === 0 ? (
            <Flex justify="center" align="center" py={12}>
              <Text color="gray.400" fontSize="sm">{historyData.length === 0 ? "No history yet." : "No pallet events yet."}</Text>
            </Flex>
          ) : (
            <Flex direction="column" gap={2}>
              {pageItems.map((item, index) => (
                <HistoryRow key={page * PAGE_SIZE + index} item={item} onSet={handleSet} />
              ))}
            </Flex>
          )}
        </ModalBody>

        {totalPages > 1 && (
          <ModalFooter borderTop="1px" borderColor="gray.100" py={3} justifyContent="center">
            <Flex align="center" gap={2}>
              <IconButton
                icon={<ChevronLeftIcon />}
                size="xs"
                variant="outline"
                borderRadius="md"
                isDisabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              />
              <Text fontSize="xs" color="gray.500" minW="100px" textAlign="center">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, historyData.length)} of {historyData.length}
              </Text>
              <IconButton
                icon={<ChevronRightIcon />}
                size="xs"
                variant="outline"
                borderRadius="md"
                isDisabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              />
            </Flex>
          </ModalFooter>
        )}
      </ModalContent>
    </Modal>
  );
}

export default ShowHistory;
