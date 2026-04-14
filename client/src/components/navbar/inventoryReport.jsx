import { useState, useEffect } from "react";
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody,
  Box, Text, Flex, Spinner, SimpleGrid, Divider, Button, Badge, IconButton,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon } from "@chakra-ui/icons";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { API_BASE_URL } from "../../config/api";

const authFetch = (url, options = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: token || "" } });
};

const getDaysAgo = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
};

const ageBadgeColor = (days) => {
  if (days < 30) return "green";
  if (days < 60) return "yellow";
  if (days < 90) return "orange";
  return "red";
};

const StatCard = ({ label, value, sub }) => (
  <Box bg="white" border="1px" borderColor="gray.100" borderRadius="xl" px={5} py={4} flex={1} minW="120px">
    <Text fontSize="xs" color="gray.400" textTransform="uppercase" letterSpacing="wide" fontWeight="medium" mb={1}>{label}</Text>
    <Text fontSize="2xl" fontWeight="bold" color="gray.800" lineHeight={1}>{value}</Text>
    {sub && <Text fontSize="xs" color="gray.400" mt={1}>{sub}</Text>}
  </Box>
);

const BreakdownRow = ({ label, count, weight, value, maxCount }) => {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <Box overflow="hidden">
      <Flex justify="space-between" align="baseline" mb={1} gap={2} overflow="hidden">
        <Text fontSize="sm" color="gray.700" fontWeight="medium" noOfLines={1} minW={0} flex={1} overflow="hidden" textOverflow="ellipsis">{label || "—"}</Text>
        <Flex gap={2} flexShrink={0} align="baseline" wrap="nowrap">
          <Text fontSize="xs" color="gray.500" whiteSpace="nowrap">{count} item{count !== 1 ? "s" : ""}</Text>
          {weight > 0 && <Text fontSize="xs" color="gray.400" whiteSpace="nowrap">{weight.toLocaleString()} lb</Text>}
          {value > 0 && <Text fontSize="xs" color="green.500" fontWeight="medium" whiteSpace="nowrap">${Math.round(value).toLocaleString()}</Text>}
        </Flex>
      </Flex>
      <Box bg="gray.100" borderRadius="full" h="6px" w="100%">
        <Box bg="blue.400" borderRadius="full" h="6px" w={`${pct}%`} transition="width 0.4s ease" />
      </Box>
    </Box>
  );
};

const PAGE_SIZE = 10;

const BreakdownSection = ({ title, data }) => {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(data.length / PAGE_SIZE);
  const pageData = data.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const maxCount = data[0]?.count ?? 1;
  return (
    <Box>
      <Flex justify="space-between" align="center" mb={3}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide">{title}</Text>
        {totalPages > 1 && (
          <Flex align="center" gap={1}>
            <IconButton icon={<ChevronLeftIcon />} size="xs" variant="ghost" isDisabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="prev" />
            <Text fontSize="xs" color="gray.400">{page + 1}/{totalPages}</Text>
            <IconButton icon={<ChevronRightIcon />} size="xs" variant="ghost" isDisabled={page === totalPages - 1} onClick={() => setPage((p) => p + 1)} aria-label="next" />
          </Flex>
        )}
      </Flex>
      {data.length === 0 ? (
        <Text fontSize="sm" color="gray.300">No data</Text>
      ) : (
        <Flex direction="column" gap={3}>
          {pageData.map((row) => (
            <BreakdownRow key={row._id} label={row._id} count={row.count} weight={Math.round(row.weight)} value={row.value} maxCount={maxCount} />
          ))}
        </Flex>
      )}
    </Box>
  );
};

const OldestPallets = ({ pallets }) => {
  if (!pallets || pallets.length === 0) return <Text fontSize="sm" color="gray.300">No date data available</Text>;
  return (
    <Flex direction="column" gap={2}>
      {pallets.map((p) => {
        const days = getDaysAgo(p._dateStr);
        return (
          <Flex key={p._id} align="center" justify="space-between" px={3} py={2} bg="gray.50" borderRadius="md" border="1px" borderColor="gray.100">
            <Box flex={1} minW={0}>
              <Flex align="center" gap={2}>
                <Text fontSize="sm" fontWeight="semibold" color="gray.700" flexShrink={0}>{p.location}</Text>
                <Text fontSize="xs" color="gray.400" noOfLines={1}>{p.description || p.species}</Text>
              </Flex>
              {p.lot && <Text fontSize="xs" color="gray.400">Lot {p.lot}</Text>}
            </Box>
            <Flex align="center" gap={2} flexShrink={0}>
              <Text fontSize="xs" color="gray.400">{p._dateStr}</Text>
              {days !== null && (
                <Badge colorScheme={ageBadgeColor(days)} fontSize="xs">{days}d</Badge>
              )}
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
};

const WeeklyThroughput = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    setLoading(true);
    authFetch(`${API_BASE_URL}/inventoryWeeklyThroughput`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoaded(true); })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  };

  if (!loaded) {
    return (
      <Flex align="center" gap={3}>
        <Button size="sm" variant="outline" colorScheme="blue" borderRadius="md" onClick={load} isLoading={loading}>
          Load Weekly Throughput
        </Button>
        <Text fontSize="xs" color="gray.400">Items added per week (last 8 weeks)</Text>
      </Flex>
    );
  }

  if (!data || data.length === 0) return <Text fontSize="sm" color="gray.300">No throughput data yet</Text>;

  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={3} textTransform="uppercase" letterSpacing="wide">
        Items Added Per Week
      </Text>
      <Box sx={{ "& .recharts-rectangle:focus": { outline: "none" } }}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#a0aec0" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#a0aec0" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "12px" }}
            labelStyle={{ fontWeight: 600, color: "#2d3748" }}
          />
          <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
          <Bar dataKey="added"   fill="#4299e1" radius={[4, 4, 0, 0]} name="Manual" />
          <Bar dataKey="scanner" fill="#48bb78" radius={[4, 4, 0, 0]} name="OCR Scanner" />
        </BarChart>
      </ResponsiveContainer>
      </Box>
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

  const capacityPct = stats && stats.totalLocations > 0
    ? Math.round((stats.occupiedLocations / stats.totalLocations) * 100)
    : null;

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
            <Flex justify="center" align="center" py={16}><Spinner color="blue.400" /></Flex>
          ) : !stats || stats.error || stats.totalItems === undefined ? (
            <Flex justify="center" align="center" py={16}><Text color="gray.400" fontSize="sm">Failed to load stats.</Text></Flex>
          ) : (
            <Flex direction="column" gap={6}>

              {/* Summary cards */}
              <Flex gap={3} wrap="wrap">
                <StatCard label="Total Items" value={stats.totalItems.toLocaleString()} />
                <StatCard label="Total Weight" value={`${Math.round(stats.totalWeight).toLocaleString()} lb`} />
                <StatCard
                  label="Capacity Used"
                  value={capacityPct !== null ? `${capacityPct}%` : "—"}
                  sub={`${stats.occupiedLocations} / ${stats.totalLocations} locations`}
                />
                {stats.totalValue > 0 && (
                  <StatCard label="Total Value" value={`$${Math.round(stats.totalValue).toLocaleString()}`} sub="based on price/lb" />
                )}
              </Flex>

              <Divider />

              {/* Oldest pallets */}
              <Box>
                <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={3} textTransform="uppercase" letterSpacing="wide">
                  Oldest Pallets
                </Text>
                <OldestPallets pallets={stats.oldestPallets} />
              </Box>

              <Divider />

              {/* Weekly throughput — load on demand */}
              <WeeklyThroughput />

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
