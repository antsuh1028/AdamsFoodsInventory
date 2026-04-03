import { useState, useEffect } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  Box,
  Text,
  Flex,
  Spinner,
  SimpleGrid,
  Divider,
} from "@chakra-ui/react";
import { API_BASE_URL } from "../../config/api";

const authFetch = (url, options = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: token || "" },
  });
};

const StatCard = ({ label, value, sub }) => (
  <Box
    bg="white"
    border="1px"
    borderColor="gray.100"
    borderRadius="xl"
    px={5}
    py={4}
    flex={1}
    minW="120px"
  >
    <Text fontSize="xs" color="gray.400" textTransform="uppercase" letterSpacing="wide" fontWeight="medium" mb={1}>
      {label}
    </Text>
    <Text fontSize="2xl" fontWeight="bold" color="gray.800" lineHeight={1}>
      {value}
    </Text>
    {sub && (
      <Text fontSize="xs" color="gray.400" mt={1}>
        {sub}
      </Text>
    )}
  </Box>
);

const BreakdownRow = ({ label, count, weight, value, maxCount }) => {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <Box>
      <Flex justify="space-between" align="baseline" mb={1}>
        <Text fontSize="sm" color="gray.700" fontWeight="medium" noOfLines={1} maxW="45%">
          {label || "—"}
        </Text>
        <Flex gap={3} flexShrink={0}>
          <Text fontSize="xs" color="gray.500">{count} item{count !== 1 ? "s" : ""}</Text>
          {weight > 0 && (
            <Text fontSize="xs" color="gray.400">{weight.toLocaleString()} lb</Text>
          )}
          {value > 0 && (
            <Text fontSize="xs" color="green.500" fontWeight="medium">
              ${Math.round(value).toLocaleString()}
            </Text>
          )}
        </Flex>
      </Flex>
      <Box bg="gray.100" borderRadius="full" h="6px" w="100%">
        <Box
          bg="blue.400"
          borderRadius="full"
          h="6px"
          w={`${pct}%`}
          transition="width 0.4s ease"
        />
      </Box>
    </Box>
  );
};

const BreakdownSection = ({ title, data }) => {
  const maxCount = data[0]?.count ?? 1;
  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={3} textTransform="uppercase" letterSpacing="wide" >
        {title}
      </Text>
      {data.length === 0 ? (
        <Text fontSize="sm" color="gray.300">No data</Text>
      ) : (
        <Flex direction="column" gap={3}>
          {data.map((row) => (
            <BreakdownRow
              key={row._id}
              label={row._id}
              count={row.count}
              weight={Math.round(row.weight)}
              value={row.value}
              maxCount={maxCount}
            />
          ))}
        </Flex>
      )}
    </Box>
  );
};

const InventoryReport = ({ isOpen, onClose }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    authFetch(`${API_BASE_URL}/inventoryStats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent borderRadius="xl" maxH="85vh">
        <ModalHeader borderBottom="1px" borderColor="gray.100" py={3} fontSize="md" fontWeight="semibold">
          Inventory Report
        </ModalHeader>
        <ModalCloseButton top={3} />

        <ModalBody py={5} px={5}>
          {loading ? (
            <Flex justify="center" align="center" py={16}>
              <Spinner color="blue.400" />
            </Flex>
          ) : !stats || stats.error || stats.totalItems === undefined ? (
            <Flex justify="center" align="center" py={16}>
              <Text color="gray.400" fontSize="sm">Failed to load stats.</Text>
            </Flex>
          ) : (
            <Flex direction="column" gap={6}>
              {/* Summary cards */}
              <Flex gap={3} wrap="wrap">
                <StatCard
                  label="Total Items"
                  value={stats.totalItems.toLocaleString()}
                />
                <StatCard
                  label="Total Weight"
                  value={`${Math.round(stats.totalWeight).toLocaleString()} lb`}
                />
                <StatCard
                  label="Locations Used"
                  value={stats.occupiedLocations.toLocaleString()}
                />
                {stats.totalValue > 0 && (
                  <StatCard
                    label="Total Value"
                    value={`$${Math.round(stats.totalValue).toLocaleString()}`}
                    sub="based on price/lb"
                  />
                )}
              </Flex>

              <Divider />

              {/* Breakdowns */}
              <SimpleGrid columns={{ base: 1, md: 3 }} spacing={8}>
                <BreakdownSection title="By Species" data={stats.bySpecies} />
                <BreakdownSection title="By Grade" data={stats.byGrade} />
                <BreakdownSection title="By Vendor" data={stats.byVendor} />
              </SimpleGrid>
            </Flex>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default InventoryReport;
