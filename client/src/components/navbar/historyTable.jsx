import { useState, useEffect, useMemo, useRef } from "react";
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
  Tag,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, CloseIcon } from "@chakra-ui/icons";
import { useContext } from "react";
import { FormContext } from "../../utils/homescreen/formContext";
import printDetails from "../../utils/printDetails";
import getHistory from "../../utils/navbar/getHistory";

// ── Helpers ───────────────────────────────────────────────────────────────────

const getBadgeColor = (change = "") => {
  const c = change.toLowerCase();
  if (c === "before update") return "orange";
  if (c.includes("add")) return "green";
  if (c.includes("field updated") || c === "updated") return "blue";
  if (c.includes("remov") || c.includes("delet")) return "red";
  if (c.includes("noblesse") || c.includes("send")) return "purple";
  return "gray";
};

const getBadgeLabel = (change = "") => {
  const c = change.toLowerCase();
  if (c === "before update") return "Before";
  if (c.includes("field updated")) return "Field";
  if (c === "scanner add") return "Scan";
  if (c === "added") return "Added";
  if (c === "updated") return "Updated";
  if (c.includes("box removed")) return "Box Rmv";
  if (c.includes("removed")) return "Removed";
  return change.length > 10 ? change.slice(0, 10) + "…" : change;
};

const parseFieldUpdate = (change = "") => {
  const m = change.match(/^Field Updated: (\w+): "(.*)" → "(.*)"/s);
  if (!m) return null;
  return { field: m[1], oldVal: m[2], newVal: m[3] };
};

const isBefore = (change = "") => change.toLowerCase() === "before update";

// ── Card view components ──────────────────────────────────────────────────────

const DIFF_FIELDS = [
  { key: "location",    label: "Location" },
  { key: "lot",         label: "Lot" },
  { key: "brand",       label: "Brand" },
  { key: "grade",       label: "Grade" },
  { key: "quantity",    label: "Quantity" },
  { key: "weight",      label: "Weight" },
  { key: "species",     label: "Species" },
  { key: "vendor",      label: "Vendor" },
  { key: "packdate",    label: "Pack Date" },
  { key: "date_recvd",  label: "Date Received" },
  { key: "est",         label: "EST #" },
  { key: "description", label: "Description" },
];

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

const DiffField = ({ label, oldVal, newVal }) => {
  const changed = String(oldVal ?? "") !== String(newVal ?? "");
  return (
    <Box>
      <Text
        fontSize="xs"
        color={changed ? "orange.500" : "gray.400"}
        textTransform="uppercase"
        letterSpacing="wide"
        fontWeight="medium"
      >
        {label}
      </Text>
      {changed ? (
        <Flex direction="column" gap={0}>
          <Text fontSize="sm" color="red.400" textDecoration="line-through" fontWeight="medium" opacity={0.85}>
            {String(oldVal || "(empty)")}
          </Text>
          <Text fontSize="sm" color="green.600" fontWeight="semibold">
            {String(newVal || "(empty)")}
          </Text>
        </Flex>
      ) : (
        <Text fontSize="sm" color="gray.700" fontWeight="medium">
          {String(newVal || "—")}
        </Text>
      )}
    </Box>
  );
};

const HistoryRow = ({ item, onSet }) => {
  const [expanded, setExpanded] = useState(false);
  const fieldDiff = parseFieldUpdate(item.change);
  const before = isBefore(item.change);
  const color = getBadgeColor(item.change);
  const label = getBadgeLabel(item.change);
  const oldData = item.oldData || null;

  const changedFields = oldData
    ? DIFF_FIELDS.filter(({ key }) => String(oldData[key] ?? "") !== String(item[key] ?? ""))
    : [];

  return (
    <Box
      border="1px"
      borderColor={expanded ? `${color}.200` : before ? "orange.100" : "gray.100"}
      borderRadius="lg"
      bg={expanded ? `${color}.50` : before ? "orange.50" : "white"}
      opacity={before ? 0.72 : 1}
      overflow="hidden"
      transition="all 0.15s"
    >
      <Flex
        px={4}
        py={3}
        align="center"
        gap={3}
        cursor="pointer"
        onClick={() => setExpanded((v) => !v)}
        _hover={{ bg: expanded ? `${color}.100` : before ? "orange.100" : "gray.50" }}
      >
        <Badge
          colorScheme={color}
          fontSize="xs"
          px={2}
          py={0.5}
          borderRadius="md"
          minW="52px"
          textAlign="center"
          flexShrink={0}
        >
          {label}
        </Badge>

        {fieldDiff ? (
          <HStack spacing={1} flex={1} minW={0} flexWrap="nowrap" overflow="hidden">
            <Text fontSize="xs" color="gray.500" fontWeight="semibold" flexShrink={0}>
              {fieldDiff.field}:
            </Text>
            <Tag size="sm" colorScheme="red" variant="subtle" fontFamily="mono" flexShrink={0}>
              {fieldDiff.oldVal || "(empty)"}
            </Tag>
            <Text fontSize="xs" color="gray.400" flexShrink={0}>→</Text>
            <Tag size="sm" colorScheme="green" variant="subtle" fontFamily="mono" flexShrink={0}>
              {fieldDiff.newVal || "(empty)"}
            </Tag>
            <Text fontSize="xs" color="gray.400" ml={1} noOfLines={1} flexShrink={1}>
              · {item.location}
            </Text>
          </HStack>
        ) : (
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
        )}

        <HStack spacing={3} flexShrink={0}>
          {item.weight && !fieldDiff && (
            <Text fontSize="xs" color="gray.500">
              {item.weight} lb
            </Text>
          )}
          {oldData && changedFields.length > 0 && (
            <Badge colorScheme="orange" variant="subtle" fontSize="xs">
              {changedFields.length} changed
            </Badge>
          )}
          {item.changedBy && (
            <Text fontSize="xs" color="purple.400" fontWeight="medium">
              {item.changedBy}
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

      <Collapse in={expanded} animateOpacity>
        <Divider borderColor={`${color}.100`} />
        <Box px={4} py={3} bg="white">
          {fieldDiff && (
            <Box mb={4} p={3} bg="gray.50" borderRadius="md">
              <Text fontSize="xs" color="gray.400" textTransform="uppercase" letterSpacing="wide" fontWeight="medium" mb={2}>
                Change
              </Text>
              <HStack spacing={3} flexWrap="wrap">
                <Text fontSize="sm" fontWeight="semibold" color="gray.700">{fieldDiff.field}</Text>
                <Tag colorScheme="red" variant="subtle" fontFamily="mono" size="md">
                  {fieldDiff.oldVal || "(empty)"}
                </Tag>
                <Text color="gray.500">→</Text>
                <Tag colorScheme="green" variant="subtle" fontFamily="mono" size="md">
                  {fieldDiff.newVal || "(empty)"}
                </Tag>
              </HStack>
            </Box>
          )}
          {before && (
            <Box mb={3} px={3} py={2} bg="orange.50" border="1px" borderColor="orange.200" borderRadius="md">
              <Text fontSize="xs" color="orange.600" fontWeight="medium">
                Snapshot of item state before the update above it
              </Text>
            </Box>
          )}

          {/* Diff grid — shown when this Updated entry has oldData */}
          {oldData ? (
            <>
              {changedFields.length > 0 && (
                <Box mb={3} px={3} py={2} bg="orange.50" border="1px" borderColor="orange.200" borderRadius="md">
                  <Text fontSize="xs" color="orange.600" fontWeight="medium">
                    Changed: {changedFields.map(f => f.label).join(", ")}
                  </Text>
                </Box>
              )}
              <Grid templateColumns="repeat(4, 1fr)" gap={4} mb={4}>
                {DIFF_FIELDS.filter(f => f.key !== "description").map(({ key, label }) => (
                  <DiffField key={key} label={label} oldVal={oldData[key]} newVal={item[key]} />
                ))}
              </Grid>
              <DiffField label="Description" oldVal={oldData.description} newVal={item.description} />
            </>
          ) : (
            <>
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
                <Field label="Changed By" value={item.changedBy} />
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
            </>
          )}

          <Flex gap={2} justify="flex-end" mt={4}>
            <Button size="xs" variant="outline" onClick={() => printDetails(item)}>
              Print
            </Button>
            {!before && (
              <Button size="xs" colorScheme="blue" onClick={() => onSet(item)}>
                Set
              </Button>
            )}
          </Flex>
        </Box>
      </Collapse>
    </Box>
  );
};

// ── Spreadsheet view ──────────────────────────────────────────────────────────

const TABLE_COLS = [
  { key: "change",      label: "Change" },
  { key: "time",        label: "Time" },
  { key: "location",    label: "Location" },
  { key: "lot",         label: "Lot" },
  { key: "brand",       label: "Brand" },
  { key: "species",     label: "Species" },
  { key: "description", label: "Description" },
  { key: "weight",      label: "Weight" },
  { key: "quantity",    label: "Qty" },
  { key: "packdate",    label: "Pack Date" },
  { key: "changedBy",   label: "Changed By" },
];

const SortIndicator = ({ colKey, sortKey, sortDir }) => (
  <Box as="span" ml={1} opacity={sortKey === colKey ? 1 : 0.2} fontSize="9px">
    {sortKey === colKey ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
  </Box>
);

const HistorySpreadsheet = ({ items, onSet, hasMore, loadingMore, onLoadMore, total }) => {
  const [sortKey, setSortKey] = useState("time");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedIdx, setSelectedIdx] = useState(null);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, sortKey, sortDir]);

  return (
    <Box>
      <TableContainer overflowX="auto">
        <Table size="sm" variant="simple">
          <Thead bg="gray.50" position="sticky" top={0} zIndex={1}>
            <Tr>
              {TABLE_COLS.map((col) => (
                <Th
                  key={col.key}
                  fontSize="xs"
                  whiteSpace="nowrap"
                  py={3}
                  cursor="pointer"
                  userSelect="none"
                  color={sortKey === col.key ? "blue.600" : "gray.500"}
                  _hover={{ bg: "gray.100", color: "gray.700" }}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  <SortIndicator colKey={col.key} sortKey={sortKey} sortDir={sortDir} />
                </Th>
              ))}
              <Th w="50px" />
            </Tr>
          </Thead>
          <Tbody>
            {sorted.map((item, i) => {
              const fieldDiff = parseFieldUpdate(item.change);
              const before = isBefore(item.change);
              const color = getBadgeColor(item.change);
              const label = getBadgeLabel(item.change);
              const isSelected = selectedIdx === i;

              return (
                <Tr
                  key={i}
                  bg={isSelected ? `${color}.50` : before ? "orange.50" : undefined}
                  opacity={before ? 0.72 : 1}
                  _hover={{ bg: isSelected ? `${color}.100` : "gray.50", cursor: "pointer" }}
                  onClick={() => setSelectedIdx(isSelected ? null : i)}
                >
                  {/* Change */}
                  <Td py={1.5} px={2} whiteSpace="nowrap">
                    <Badge colorScheme={color} fontSize="xs" px={1.5} borderRadius="sm">
                      {label}
                    </Badge>
                  </Td>

                  {/* Time */}
                  <Td py={1.5} px={2} fontSize="xs" color="gray.500" whiteSpace="nowrap">
                    {item.time}
                  </Td>

                  {/* Location */}
                  <Td py={1.5} px={2} fontSize="xs" fontWeight="semibold" color="gray.700" whiteSpace="nowrap">
                    {item.location}
                  </Td>

                  {/* Lot */}
                  <Td py={1.5} px={2} fontSize="xs" color="gray.600" whiteSpace="nowrap">
                    {fieldDiff ? (
                      <HStack spacing={1}>
                        <Tag size="sm" colorScheme="red" variant="subtle" fontFamily="mono" fontSize="10px">
                          {fieldDiff.oldVal || "—"}
                        </Tag>
                        <Text fontSize="10px" color="gray.400">→</Text>
                        <Tag size="sm" colorScheme="green" variant="subtle" fontFamily="mono" fontSize="10px">
                          {fieldDiff.newVal || "—"}
                        </Tag>
                      </HStack>
                    ) : (
                      item.lot
                    )}
                  </Td>

                  {/* Brand */}
                  <Td py={1.5} px={2} fontSize="xs" color="gray.600" whiteSpace="nowrap">
                    {item.brand}
                  </Td>

                  {/* Species */}
                  <Td py={1.5} px={2} fontSize="xs" color="gray.600" whiteSpace="nowrap">
                    {item.species}
                  </Td>

                  {/* Description */}
                  <Td py={1.5} px={2} fontSize="xs" color="gray.600" maxW="200px">
                    <Text noOfLines={1}>{item.description}</Text>
                  </Td>

                  {/* Weight */}
                  <Td py={1.5} px={2} fontSize="xs" color="gray.600" whiteSpace="nowrap" isNumeric>
                    {item.weight ? `${item.weight} lb` : ""}
                  </Td>

                  {/* Qty */}
                  <Td py={1.5} px={2} fontSize="xs" color="gray.600" whiteSpace="nowrap" isNumeric>
                    {item.quantity ? `${item.quantity} bx` : ""}
                  </Td>

                  {/* Pack Date */}
                  <Td py={1.5} px={2} fontSize="xs" color="gray.500" whiteSpace="nowrap">
                    {item.packdate}
                  </Td>

                  {/* Changed By */}
                  <Td py={1.5} px={2} fontSize="xs" color="purple.500" fontWeight="medium" whiteSpace="nowrap">
                    {item.changedBy}
                  </Td>

                  {/* Set button — only on selected non-before rows */}
                  <Td py={1} px={1}>
                    {isSelected && !before && (
                      <Button size="xs" colorScheme="blue" variant="ghost" onClick={(e) => { e.stopPropagation(); onSet(item); }}>
                        Set
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </TableContainer>

      {hasMore && (
        <Flex justify="center" pt={3}>
          <Button
            size="sm"
            variant="outline"
            colorScheme="gray"
            isLoading={loadingMore}
            onClick={onLoadMore}
          >
            Load more ({total - items.length} remaining)
          </Button>
        </Flex>
      )}
    </Box>
  );
};

// ── Modal ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

function ShowHistory({ isOpen, onClose }) {
  const [historyData, setHistoryData] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [showBoxEvents, setShowBoxEvents] = useState(false);
  const [viewMode, setViewMode] = useState("cards"); // "cards" | "table"
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const debounceRef = useRef(null);
  const { setFormData } = useContext(FormContext);

  // Initial load / search change
  useEffect(() => {
    if (!isOpen) return;
    setPage(0);
    setHistoryData([]);
    setLoading(true);
    getHistory(0, activeSearch)
      .then(({ items, total, hasMore }) => {
        setHistoryData(items || []);
        setTotal(total || 0);
        setHasMore(hasMore || false);
      })
      .catch(() => setHistoryData([]))
      .finally(() => setLoading(false));
  }, [isOpen, activeSearch]);

  // Debounce search input → activeSearch (min 2 chars, or empty to reset)
  const handleSearchChange = (val) => {
    setSearchInput(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (val.length === 0 || val.length >= 2) {
        setPage(0);
        setActiveSearch(val);
      }
    }, 400);
  };

  const clearSearch = () => {
    setSearchInput("");
    setActiveSearch("");
    clearTimeout(debounceRef.current);
  };

  const handleLoadMore = () => {
    setLoadingMore(true);
    getHistory(historyData.length, activeSearch)
      .then(({ items, total, hasMore }) => {
        setHistoryData((prev) => [...prev, ...(items || [])]);
        setTotal(total || 0);
        setHasMore(hasMore || false);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

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
      <ModalContent
        maxW={viewMode === "table" ? "min(98vw, 1200px)" : "780px"}
        maxH="90vh"
        borderRadius="xl"
        overflow="hidden"
        transition="max-width 0.2s"
      >
        <ModalHeader borderBottom="1px" borderColor="gray.100" py={3}>
          <Flex align="center" gap={3} flexWrap="wrap">
            <Text fontSize="lg" fontWeight="semibold" flexShrink={0}>History Log</Text>

            {/* Search */}
            <InputGroup size="xs" maxW="200px">
              <InputLeftElement pointerEvents="none">
                <SearchIcon color="gray.400" boxSize={3} />
              </InputLeftElement>
              <Input
                placeholder="Search anything…"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                borderRadius="md"
                bg="gray.50"
                _focus={{ bg: "white", borderColor: "blue.300" }}
                pr={searchInput ? 7 : undefined}
              />
              {searchInput && (
                <InputRightElement cursor="pointer" onClick={clearSearch}>
                  <CloseIcon boxSize={2} color="gray.400" />
                </InputRightElement>
              )}
            </InputGroup>

            {!loading && (
              <Badge colorScheme={activeSearch ? "blue" : "gray"} fontSize="xs" flexShrink={0}>
                {historyData.length} of {total}
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

            {/* View toggle */}
            {!loading && filteredData.length > 0 && (
              <HStack spacing={0} border="1px" borderColor="gray.200" borderRadius="md" overflow="hidden" flexShrink={0}>
                <Button
                  size="xs"
                  variant={viewMode === "cards" ? "solid" : "ghost"}
                  colorScheme={viewMode === "cards" ? "blue" : "gray"}
                  borderRadius={0}
                  px={3}
                  onClick={() => setViewMode("cards")}
                  title="Card view"
                >
                  ☰ Cards
                </Button>
                <Box w="1px" bg="gray.200" />
                <Button
                  size="xs"
                  variant={viewMode === "table" ? "solid" : "ghost"}
                  colorScheme={viewMode === "table" ? "blue" : "gray"}
                  borderRadius={0}
                  px={3}
                  onClick={() => setViewMode("table")}
                  title="Spreadsheet view"
                >
                  ⊞ Table
                </Button>
              </HStack>
            )}
          </Flex>
        </ModalHeader>
        <ModalCloseButton top={3} />

        <ModalBody overflowY="auto" p={viewMode === "table" ? 0 : 4}>
          {loading ? (
            <Flex justify="center" align="center" py={12}>
              <Spinner color="blue.400" />
            </Flex>
          ) : filteredData.length === 0 ? (
            <Flex justify="center" align="center" py={12}>
              <Text color="gray.400" fontSize="sm">
                {historyData.length === 0 ? "No history yet." : "No pallet events yet."}
              </Text>
            </Flex>
          ) : viewMode === "table" ? (
            <HistorySpreadsheet
              items={filteredData}
              onSet={handleSet}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={handleLoadMore}
              total={total}
            />
          ) : (
            <Flex direction="column" gap={2}>
              {pageItems.map((item, index) => (
                <HistoryRow key={page * PAGE_SIZE + index} item={item} onSet={handleSet} />
              ))}
              {page >= totalPages - 1 && hasMore && (
                <Button
                  size="sm"
                  variant="outline"
                  colorScheme="gray"
                  isLoading={loadingMore}
                  onClick={handleLoadMore}
                  mt={1}
                >
                  Load more ({total - historyData.length} remaining)
                </Button>
              )}
            </Flex>
          )}
        </ModalBody>

        {viewMode === "cards" && totalPages > 1 && (
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
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredData.length)} of {filteredData.length}
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
