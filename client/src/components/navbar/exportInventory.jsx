import { useState, useEffect, useRef, useContext } from "react";
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
  Button, Text, Flex, Box, useToast, Spinner, Table, Thead, Tbody, Tr, Th, Td,
  TableContainer, Badge, IconButton, Input, InputGroup, InputLeftElement, InputRightElement,
  Tabs, TabList, TabPanels, Tab, TabPanel, Wrap, WrapItem,
} from "@chakra-ui/react";
import { DownloadIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, CloseIcon, ArrowForwardIcon } from "@chakra-ui/icons";
import * as XLSX from "xlsx";
import { API_BASE_URL } from "../../config/api";
import { FormContext } from "../../utils/homescreen/formContext";

const authFetch = (url, options = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: token || "" } });
};

const getLevel = (loc) => {
  if (!loc || loc.length < 2) return 3;
  const c = loc[1];
  if (c === "1") return 1;
  if (c === "2") return 2;
  return 3;
};

const COLUMNS = [
  { key: "location", label: "Location" },
  { key: "lot", label: "Lot" },
  { key: "vendor", label: "Vendor" },
  { key: "brand", label: "Brand" },
  { key: "species", label: "Species" },
  { key: "description", label: "Description" },
  { key: "grade", label: "Grade" },
  { key: "quantity", label: "Qty" },
  { key: "weight", label: "Weight" },
  { key: "packdate", label: "Pack Date" },
  { key: "date_recvd", label: "Recv Date" },
  { key: "est", label: "EST#" },
  { key: "price", label: "Price/lb" },
  { key: "type", label: "Type" },
];

const PAGE_SIZE = 100;

const SortIndicator = ({ colKey, sortKey, sortDir }) => (
  <span style={{ marginLeft: 4, opacity: sortKey === colKey ? 1 : 0.25, fontSize: "10px" }}>
    {sortKey === colKey ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
  </span>
);

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const InventoryTable = ({ items, sortKey, sortDir, handleSort, page, editCell, editValue, setEditValue, inputRef, startEdit, commitEdit, handleKeyDown, onExportSelect, onClose, visibleCols }) => {
  const cols = COLUMNS.filter((c) => visibleCols.has(c.key));
  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <Box overflowX="auto">
      <TableContainer>
        <Table size="sm" variant="simple">
          <Thead bg="gray.50">
            <Tr>
              <Th w="28px" />
              {cols.map((col) => (
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
            </Tr>
          </Thead>
          <Tbody>
            {pageItems.map((item, i) => (
              <Tr key={item._id || item.id || i} _hover={{ bg: "gray.50" }}>
                <Td py={1} px={1}>
                  {onExportSelect && (
                    <IconButton
                      icon={<ArrowForwardIcon />}
                      size="xs"
                      variant="ghost"
                      colorScheme="gray"
                      color="gray.500"
                      borderRadius="md"
                      aria-label="View in inventory"
                      title="View in inventory"
                      _hover={{ color: "blue.400", bg: "blue.50" }}
                      onClick={() => { onExportSelect(item); onClose(); }}
                    />
                  )}
                </Td>
                {cols.map((col) => {
                  const isEditing = editCell?.id === (item._id || item.id) && editCell?.key === col.key;
                  return (
                    <Td
                      key={col.key}
                      fontSize="xs"
                      color="gray.700"
                      whiteSpace="nowrap"
                      py={1}
                      px={2}
                      bg={isEditing ? "blue.50" : undefined}
                      onDoubleClick={() => startEdit(item._id || item.id, col.key, item[col.key])}
                      title="Double-click to edit"
                    >
                      {isEditing ? (
                        <Input
                          ref={inputRef}
                          size="xs"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleKeyDown}
                          bg="white"
                          borderRadius="sm"
                          minW="80px"
                          px={1}
                        />
                      ) : (
                        item[col.key] ?? ""
                      )}
                    </Td>
                  );
                })}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </TableContainer>
    </Box>
  );
};

const ExportInventory = ({ isOpen, onClose }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [search, setSearch] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tabIndex, setTabIndex] = useState(0);
  const [visibleCols, setVisibleCols] = useState(() => new Set(COLUMNS.map((c) => c.key)));
  const [colPickerOpen, setColPickerOpen] = useState(false);

  // Past exports state
  const [snapshots, setSnapshots] = useState([]);
  const [snapsLoading, setSnapsLoading] = useState(false);
  const [activeSnap, setActiveSnap] = useState(null); // { meta, data }
  const [snapLoading, setSnapLoading] = useState(false);

  const inputRef = useRef(null);
  const toast = useToast();
  const { onExportSelect } = useContext(FormContext);

  useEffect(() => {
    if (!isOpen) return;
    setPage(0);
    setSortKey(null);
    setEditCell(null);
    setSearch("");
    setTabIndex(0);
    setActiveSnap(null);
    setLoading(true);
    authFetch(`${API_BASE_URL}/inventoryAll`)
      .then((r) => r.json())
      .then((data) => {
        const sorted = [...data].sort((a, b) => {
          const levelDiff = getLevel(a.location) - getLevel(b.location);
          if (levelDiff !== 0) return levelDiff;
          return (a.location || "").localeCompare(b.location || "");
        });
        setItems(sorted);
      })
      .catch(() => {
        toast({ title: "Failed to load inventory", position: "top", status: "error", duration: 3000, isClosable: true });
      })
      .finally(() => setLoading(false));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSnapshots = () => {
    setSnapsLoading(true);
    authFetch(`${API_BASE_URL}/inventorySnapshots`)
      .then((r) => r.json())
      .then(setSnapshots)
      .catch(() => toast({ title: "Failed to load past exports", position: "top", status: "error", duration: 3000, isClosable: true }))
      .finally(() => setSnapsLoading(false));
  };

  const handleTabChange = (idx) => {
    setTabIndex(idx);
    if (idx === 1 && snapshots.length === 0 && !snapsLoading) loadSnapshots();
  };

  const handleLoadSnapshot = (meta) => {
    setSnapLoading(true);
    authFetch(`${API_BASE_URL}/inventorySnapshot/${meta.id}`)
      .then((r) => r.json())
      .then((res) => setActiveSnap({ meta, data: res.snapshot }))
      .catch(() => toast({ title: "Failed to load snapshot", position: "top", status: "error", duration: 3000, isClosable: true }))
      .finally(() => setSnapLoading(false));
  };

  useEffect(() => {
    if (editCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editCell]);

  const filteredItems = search.trim()
    ? items.filter((item) => {
        const q = search.toLowerCase();
        return COLUMNS.some((col) => String(item[col.key] ?? "").toLowerCase().includes(q));
      })
    : items;

  const sortedItems = sortKey
    ? [...filteredItems].sort((a, b) => {
        const av = String(a[sortKey] ?? "").toLowerCase();
        const bv = String(b[sortKey] ?? "").toLowerCase();
        const numA = parseFloat(av);
        const numB = parseFloat(bv);
        const isNumeric = !isNaN(numA) && !isNaN(numB);
        const cmp = isNumeric ? numA - numB : av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filteredItems;

  const totalPages = Math.ceil(sortedItems.length / PAGE_SIZE);

  const snapSorted = activeSnap
    ? sortKey
      ? [...activeSnap.data].sort((a, b) => {
          const av = String(a[sortKey] ?? "").toLowerCase();
          const bv = String(b[sortKey] ?? "").toLowerCase();
          const numA = parseFloat(av); const numB = parseFloat(bv);
          const isNumeric = !isNaN(numA) && !isNaN(numB);
          const cmp = isNumeric ? numA - numB : av.localeCompare(bv);
          return sortDir === "asc" ? cmp : -cmp;
        })
      : activeSnap.data
    : [];
  const snapTotalPages = Math.ceil(snapSorted.length / PAGE_SIZE);

  const handleSearch = (val) => {
    setSearch(val);
    setPage(0);
    setEditCell(null);
  };

  const handleSort = (key) => {
    setPage(0);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const NON_EDITABLE = new Set(["weight", "quantity"]);

  const startEdit = (id, key, value) => {
    if (NON_EDITABLE.has(key) || tabIndex === 1) return;
    setEditCell({ id, key });
    setEditValue(value ?? "");
  };

  const commitEdit = () => {
    if (!editCell) return;
    setItems((prev) =>
      prev.map((item) =>
        item._id === editCell.id ? { ...item, [editCell.key]: editValue } : item
      )
    );
    setEditCell(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditCell(null);
  };

  const saveSnapshot = async (exportItems) => {
    try {
      await authFetch(`${API_BASE_URL}/inventorySnapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: exportItems, label: "Full Export" }),
      });
    } catch (_) {
      // non-fatal
    }
  };

  const totalWeight = (list) =>
    list.reduce((sum, item) => sum + (parseFloat(item.weight) || 0), 0);

  const downloadExcel = (exportItems, filename) => {
    const cols = COLUMNS.filter((c) => visibleCols.has(c.key));
    const rows = exportItems.map((item) =>
      cols.reduce((obj, col) => { obj[col.label] = item[col.key] ?? ""; return obj; }, {})
    );
    // Append total weight row only if weight column is visible
    if (visibleCols.has("weight")) {
      const totalRow = cols.reduce((obj, col) => { obj[col.label] = ""; return obj; }, {});
      totalRow["Weight"] = totalWeight(exportItems).toFixed(2);
      rows.push({});
      rows.push(totalRow);
    }

    const ws = XLSX.utils.json_to_sheet(rows, { header: cols.map((c) => c.label) });
    ws["!cols"] = cols.map((col) => ({
      wch: Math.max(col.label.length, ...exportItems.map((item) => String(item[col.key] ?? "").length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, filename);
  };

  const handleDownload = () => {
    setDownloading(true);
    try {
      const date = new Date().toISOString().split("T")[0];
      downloadExcel(items, `inventory_${date}.xlsx`);
      saveSnapshot(items);
      toast({ title: "Downloaded", description: `${items.length} items`, position: "top", status: "success", duration: 2000, isClosable: true });
      onClose();
    } catch (err) {
      toast({ title: "Export failed", description: err.message, position: "top", status: "error", duration: 3000, isClosable: true });
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadSnapshot = () => {
    if (!activeSnap) return;
    try {
      const date = new Date(activeSnap.meta.created_at).toISOString().split("T")[0];
      downloadExcel(activeSnap.data, `inventory_snapshot_${date}.xlsx`);
      toast({ title: "Downloaded", description: `${activeSnap.data.length} items from ${fmtDate(activeSnap.meta.created_at)}`, position: "top", status: "success", duration: 2000, isClosable: true });
    } catch (err) {
      toast({ title: "Export failed", description: err.message, position: "top", status: "error", duration: 3000, isClosable: true });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size={isFullscreen ? "full" : "5xl"} scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent borderRadius={isFullscreen ? "none" : "xl"} maxH={isFullscreen ? "100vh" : "85vh"}>
        <ModalHeader fontSize="md" fontWeight="semibold" pb={1} borderBottom="1px" borderColor="gray.100">
          <Flex align="center" gap={3} flexWrap="wrap">
            Export Inventory
            {tabIndex === 0 && !loading && items.length > 0 && (
              <Badge colorScheme="gray" fontSize="xs" px={2} py={1} borderRadius="md">
                {search.trim() ? `${filteredItems.length} of ${items.length}` : `${items.length} item${items.length !== 1 ? "s" : ""}`}
              </Badge>
            )}
            {tabIndex === 0 && !loading && items.length > 0 && (
              <InputGroup size="xs" maxW="200px">
                <InputLeftElement pointerEvents="none">
                  <SearchIcon color="gray.400" />
                </InputLeftElement>
                <Input
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  borderRadius="md"
                  bg="gray.50"
                  _focus={{ bg: "white", borderColor: "blue.300" }}
                />
                {search && (
                  <InputRightElement cursor="pointer" onClick={() => handleSearch("")}>
                    <CloseIcon boxSize={2} color="gray.400" />
                  </InputRightElement>
                )}
              </InputGroup>
            )}
            {tabIndex === 1 && activeSnap && (
              <Badge colorScheme="blue" fontSize="xs" px={2} py={1} borderRadius="md">
                {activeSnap.data.length} items · {fmtDate(activeSnap.meta.created_at)}
              </Badge>
            )}
          </Flex>
        </ModalHeader>
        <ModalCloseButton top={2} right={2} />
        <IconButton
          icon={<Text fontSize="md">{isFullscreen ? "⊡" : "⊞"}</Text>}
          size="sm"
          variant="ghost"
          position="absolute"
          top={2}
          right={10}
          aria-label="Toggle fullscreen"
          onClick={() => setIsFullscreen((v) => !v)}
        />

        <ModalBody p={0}>
          <Tabs index={tabIndex} onChange={handleTabChange} variant="line" size="sm">
            <TabList px={4} borderBottom="1px" borderColor="gray.100">
              <Tab fontSize="xs" fontWeight="medium">Current</Tab>
              <Tab fontSize="xs" fontWeight="medium">Past Exports</Tab>
            </TabList>

            {/* Column picker */}
            <Box px={4} py={1.5} borderBottom="1px" borderColor="gray.100">
              <Flex align="center" gap={2}>
                <Flex
                  as="button"
                  align="center"
                  gap={1.5}
                  px={2} py={0.5}
                  borderRadius="md"
                  border="1px solid"
                  borderColor="gray.200"
                  bg="white"
                  cursor="pointer"
                  userSelect="none"
                  _hover={{ bg: "gray.50", borderColor: "gray.300" }}
                  onClick={() => setColPickerOpen((v) => !v)}
                >
                  <Text fontSize="10px" color="gray.500" fontWeight="medium">Columns</Text>
                  {visibleCols.size < COLUMNS.length && (
                    <Badge colorScheme="blue" fontSize="9px" px={1} borderRadius="full" lineHeight="1.4">
                      {visibleCols.size}/{COLUMNS.length}
                    </Badge>
                  )}
                  <Text fontSize="9px" color="gray.400">{colPickerOpen ? "▲" : "▼"}</Text>
                </Flex>
              </Flex>

              {colPickerOpen && (
                <Wrap spacing={1} mt={2}>
                  {COLUMNS.map((col) => {
                    const on = visibleCols.has(col.key);
                    return (
                      <WrapItem key={col.key}>
                        <Badge
                          cursor="pointer"
                          fontSize="10px"
                          px={2} py={0.5}
                          borderRadius="full"
                          colorScheme={on ? "blue" : "gray"}
                          variant={on ? "solid" : "outline"}
                          opacity={on ? 1 : 0.5}
                          userSelect="none"
                          onClick={() => setVisibleCols((prev) => {
                            const next = new Set(prev);
                            if (next.has(col.key)) { if (next.size > 1) next.delete(col.key); }
                            else next.add(col.key);
                            return next;
                          })}
                        >
                          {col.label}
                        </Badge>
                      </WrapItem>
                    );
                  })}
                </Wrap>
              )}
            </Box>

            <TabPanels>
              {/* ── Current inventory ── */}
              <TabPanel p={0}>
                {loading ? (
                  <Flex justify="center" align="center" py={16}>
                    <Spinner color="blue.400" />
                  </Flex>
                ) : items.length === 0 ? (
                  <Flex justify="center" align="center" py={16}>
                    <Text color="gray.400" fontSize="sm">No inventory items found.</Text>
                  </Flex>
                ) : (
                  <InventoryTable
                    items={sortedItems}
                    sortKey={sortKey} sortDir={sortDir} handleSort={handleSort}
                    page={page}
                    editCell={editCell} editValue={editValue} setEditValue={setEditValue}
                    inputRef={inputRef} startEdit={startEdit} commitEdit={commitEdit} handleKeyDown={handleKeyDown}
                    onExportSelect={onExportSelect} onClose={onClose}
                    visibleCols={visibleCols}
                  />
                )}
              </TabPanel>

              {/* ── Past exports ── */}
              <TabPanel p={0}>
                {snapsLoading ? (
                  <Flex justify="center" align="center" py={16} w="100%">
                    <Spinner color="blue.400" />
                  </Flex>
                ) : (
                  <Flex w="100%">
                    {/* Sidebar */}
                    <Box w="200px" minW="200px" borderRight="1px" borderColor="gray.100" bg="gray.50">
                      {snapshots.length === 0 ? (
                        <Text fontSize="xs" color="gray.400" p={4} textAlign="center">No past exports yet</Text>
                      ) : (
                        snapshots.map((s) => (
                          <Box
                            key={s.id}
                            px={3} py={2}
                            cursor="pointer"
                            bg={activeSnap?.meta.id === s.id ? "blue.50" : "transparent"}
                            borderLeft="2px solid"
                            borderLeftColor={activeSnap?.meta.id === s.id ? "blue.400" : "transparent"}
                            _hover={{ bg: "blue.50" }}
                            onClick={() => handleLoadSnapshot(s)}
                          >
                            <Text fontSize="xs" fontWeight="medium" color="gray.700" noOfLines={1}>{s.label || "Export"}</Text>
                            <Text fontSize="10px" color="gray.400">{fmtDate(s.created_at)}</Text>
                            <Text fontSize="10px" color="gray.400">{s.item_count} items · {s.created_by}</Text>
                          </Box>
                        ))
                      )}
                    </Box>

                    {/* Snapshot data */}
                    <Box flex={1} minW={0}>
                      {snapLoading ? (
                        <Flex justify="center" align="center" py={16}>
                          <Spinner color="blue.400" />
                        </Flex>
                      ) : !activeSnap ? (
                        <Flex justify="center" align="center" py={16}>
                          <Text fontSize="sm" color="gray.400">Select a past export to preview</Text>
                        </Flex>
                      ) : (
                        <InventoryTable
                          items={snapSorted}
                          sortKey={sortKey} sortDir={sortDir} handleSort={handleSort}
                          page={page}
                          editCell={null} editValue="" setEditValue={() => {}}
                          inputRef={inputRef} startEdit={() => {}} commitEdit={() => {}} handleKeyDown={() => {}}
                          onExportSelect={null} onClose={onClose}
                          visibleCols={visibleCols}
                        />
                      )}
                    </Box>
                  </Flex>
                )}
              </TabPanel>
            </TabPanels>
          </Tabs>
        </ModalBody>

        <ModalFooter borderTop="1px" borderColor="gray.100" gap={3} justifyContent="space-between">
          {tabIndex === 0 ? (
            totalPages > 1 ? (
              <Flex align="center" gap={2}>
                <IconButton icon={<ChevronLeftIcon />} size="xs" variant="outline" borderRadius="md" isDisabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" />
                <Text fontSize="xs" color="gray.500" minW="80px" textAlign="center">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedItems.length)} of {sortedItems.length}
                </Text>
                <IconButton icon={<ChevronRightIcon />} size="xs" variant="outline" borderRadius="md" isDisabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page" />
              </Flex>
            ) : <Box />
          ) : (
            activeSnap && snapTotalPages > 1 ? (
              <Flex align="center" gap={2}>
                <IconButton icon={<ChevronLeftIcon />} size="xs" variant="outline" borderRadius="md" isDisabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" />
                <Text fontSize="xs" color="gray.500" minW="80px" textAlign="center">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, activeSnap.data.length)} of {activeSnap.data.length}
                </Text>
                <IconButton icon={<ChevronRightIcon />} size="xs" variant="outline" borderRadius="md" isDisabled={page >= snapTotalPages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page" />
              </Flex>
            ) : <Box />
          )}

          {!loading && items.length > 0 && (
            <Text fontSize="xs" color="gray.500" fontWeight="medium">
              Total weight: <Text as="span" color="gray.700" fontWeight="semibold">
                {(tabIndex === 0 ? totalWeight(sortedItems) : activeSnap ? totalWeight(activeSnap.data) : 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} lbs
              </Text>
            </Text>
          )}

          <Flex gap={3}>
            <Button variant="outline" borderRadius="lg" onClick={onClose} size="sm">Cancel</Button>
            {tabIndex === 0 ? (
              <Button
                colorScheme="green"
                borderRadius="lg"
                size="sm"
                leftIcon={downloading ? <Spinner size="xs" /> : <DownloadIcon />}
                onClick={handleDownload}
                isDisabled={loading || downloading || items.length === 0}
              >
                {downloading ? "Downloading..." : "Download Excel"}
              </Button>
            ) : (
              <Button
                colorScheme="blue"
                borderRadius="lg"
                size="sm"
                leftIcon={<DownloadIcon />}
                onClick={handleDownloadSnapshot}
                isDisabled={!activeSnap}
              >
                Download Snapshot
              </Button>
            )}
          </Flex>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ExportInventory;
