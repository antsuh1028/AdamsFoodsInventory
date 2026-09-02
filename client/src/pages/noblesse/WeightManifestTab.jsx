import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Spinner, IconButton, Input, Select,
  Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, CloseIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import ScanSheet from "../../components/navbar/ScanSheet";
import BoxScanner from "../../components/navbar/boxScanner";
import printWeightManifest from "./printWeightManifest";
import { fmtDate, today } from "./shared";

// Past weighing sessions, one row per session. Expanding a row pulls its boxes
// and shows them in the same sheet they were scanned into, so a manifest can be
// checked or reprinted without leaving the tab.

const COLUMNS = [
  { key: "lot_number",       label: "Lot",     filter: "text",   width: "130px" },
  { key: "vendor",           label: "Vendor",  filter: "select", width: "150px" },
  { key: "item_description", label: "Item",    filter: "text",   width: "200px" },
  { key: "created_at",       label: "Opened",  filter: "none",   width: "170px" },
  { key: "box_count",        label: "Boxes",   filter: "none",   width: "80px", align: "right" },
  { key: "totals",           label: "Total",   filter: "none",   width: "150px", align: "right" },
  { key: "status",           label: "Status",  filter: "none",   width: "90px" },
];

const totalsText = (totals) =>
  Array.isArray(totals) && totals.length
    ? totals.map((t) => `${t.total} ${t.unit}`).join("  ·  ")
    : "—";

export const WeightManifestTab = ({ refreshSignal = 0 }) => {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({});   // batch_id -> full batch
  const [loadingId, setLoadingId] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const toast = useToast();

  const fetchBatches = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/box-batches");
      setBatches(data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Could not load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  // Re-fetch on the parent's auto-refresh, compared against a ref so the
  // initial value does not cause a duplicate load alongside the mount effect.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    fetchBatches();
  }, [refreshSignal, fetchBatches]);

  // Closing the scanner means a session may have been opened or closed.
  const onScannerClose = () => { setScannerOpen(false); fetchBatches(); };

  const toggleExpand = async (batch) => {
    if (expandedId === batch.batch_id) { setExpandedId(null); return; }
    setExpandedId(batch.batch_id);
    if (details[batch.batch_id]) return;      // already loaded
    setLoadingId(batch.batch_id);
    try {
      const { data } = await axiosInstance.get(`/box-batches/${batch.batch_id}`);
      setDetails((prev) => ({ ...prev, [batch.batch_id]: data }));
    } catch (err) {
      toast({ title: "Could not load that session", status: "error", duration: 3000, position: "top" });
      setExpandedId(null);
    } finally {
      setLoadingId(null);
    }
  };

  const print = async (batch) => {
    let full = details[batch.batch_id];
    if (!full) {
      try {
        const { data } = await axiosInstance.get(`/box-batches/${batch.batch_id}`);
        full = data;
        setDetails((prev) => ({ ...prev, [batch.batch_id]: data }));
      } catch {
        toast({ title: "Could not load that session", status: "error", duration: 3000, position: "top" });
        return;
      }
    }
    printWeightManifest({
      lotNumber: full.lot_number,
      vendor: full.vendor,
      shipTo: full.ship_to,
      billOfLading: full.bill_of_lading,
      itemDescription: full.item_description,
      date: fmtDate(String(full.created_at).slice(0, 10)),
      scans: full.items,
    });
  };

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const clearFilters = () => setFilters({});
  const activeFilters = Object.entries(filters).filter(([, v]) => v);

  const toggleFilters = () => {
    setShowFilters((open) => {
      if (open) clearFilters();   // hiding must not leave the list silently narrowed
      return !open;
    });
  };

  const vendorOptions = useMemo(
    () => [...new Set(batches.map((b) => b.vendor).filter(Boolean))].sort(),
    [batches]
  );

  const visible = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v);
    return batches.filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      return active.every(([key, value]) => {
        const col = COLUMNS.find((c) => c.key === key);
        const cell = String(b[key] ?? "");
        return col.filter === "select"
          ? cell === value
          : cell.toLowerCase().includes(value.toLowerCase());
      });
    });
  }, [batches, filters, statusFilter]);

  const todayStr = today();
  const isToday = (b) => String(b.created_at).slice(0, 10) === todayStr;

  if (loading) {
    return <Flex justify="center" py={10}><Spinner size="lg" color="blue.500" /></Flex>;
  }

  return (
    <Box>
      <Flex justify="space-between" align={{ base: "stretch", md: "center" }} mb={4}
        direction={{ base: "column", md: "row" }} gap={{ base: 3, md: 0 }}>
        <Flex align="center" gap={3} wrap="wrap" flex={1}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.600"
            textTransform="uppercase" letterSpacing="wide">
            Sessions
          </Text>
          <Flex gap={1}>
            {[["", "All"], ["open", "Open"], ["closed", "Closed"]].map(([value, label]) => (
              <Button key={label} size="xs"
                variant={statusFilter === value ? "solid" : "outline"}
                colorScheme={statusFilter === value ? (value === "open" ? "orange" : "blue") : "gray"}
                onClick={() => setStatusFilter(value)}>
                {label}
              </Button>
            ))}
          </Flex>
          <Button size="xs"
            variant={showFilters ? "solid" : "outline"}
            colorScheme={activeFilters.length ? "blue" : "gray"}
            leftIcon={<SearchIcon boxSize={3} />}
            rightIcon={showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
            onClick={toggleFilters}>
            Filters{activeFilters.length > 0 && ` (${activeFilters.length})`}
          </Button>
          {activeFilters.length > 0 && (
            <Button size="xs" variant="ghost" leftIcon={<CloseIcon boxSize={2} />} onClick={clearFilters}>
              Clear
            </Button>
          )}
          <Text fontSize="sm" color="gray.500">
            {visible.length}{visible.length !== batches.length && ` of ${batches.length}`}
          </Text>
        </Flex>

        <Button size="xs" colorScheme="teal" onClick={() => setScannerOpen(true)}>
          + New Box Weighing Session
        </Button>
      </Flex>

      {error && (
        <Alert status="error" borderRadius="md" mb={3} fontSize="sm">
          <AlertIcon />{error}
        </Alert>
      )}

      {visible.length === 0 ? (
        <Text fontSize="sm" color="gray.400">
          {batches.length === 0
            ? "No weighing sessions yet. Start one to begin scanning boxes."
            : "Nothing matches these filters."}
        </Text>
      ) : (
        <Box overflowX="auto" width="100%">
          <Box as="table" width="100%" style={{ minWidth: "980px", borderCollapse: "collapse" }}>
            <Box as="thead">
              <Box as="tr">
                {COLUMNS.map((c) => (
                  <Box as="th" key={c.key} bg="gray.100" borderBottom="1px solid" borderColor="gray.300"
                    px={3} py={2} textAlign={c.align || "left"} style={{ width: c.width }}
                    fontSize="xs" fontWeight="bold" color="gray.600"
                    textTransform="uppercase" letterSpacing="wide">
                    {c.label}
                  </Box>
                ))}
                <Box as="th" bg="gray.100" borderBottom="1px solid" borderColor="gray.300"
                  px={3} py={2} style={{ width: "120px" }} />
              </Box>

              {showFilters && (
                <Box as="tr">
                  {COLUMNS.map((c) => (
                    <Box as="th" key={c.key} bg="gray.50" borderBottom="1px solid"
                      borderColor="gray.200" px={2} py={1}>
                      {c.filter === "text" && (
                        <Input size="xs" bg="white" placeholder="Filter…"
                          value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)} />
                      )}
                      {c.filter === "select" && (
                        <Select size="xs" bg="white"
                          value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)}>
                          <option value="">All</option>
                          {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                        </Select>
                      )}
                    </Box>
                  ))}
                  <Box as="th" bg="gray.50" borderBottom="1px solid" borderColor="gray.200" />
                </Box>
              )}
            </Box>

            <Box as="tbody">
              {visible.map((b, i) => {
                const open = expandedId === b.batch_id;
                const detail = details[b.batch_id];
                return (
                  <React.Fragment key={b.batch_id}>
                    <Box as="tr"
                      bg={isToday(b) ? "green.50" : i % 2 ? "gray.50" : "white"}
                      _hover={{ bg: isToday(b) ? "green.100" : "blue.50" }}
                      cursor="pointer" onDoubleClick={() => toggleExpand(b)}>
                      <Box as="td" px={3} py={2} fontSize="sm" fontWeight="600" color="blue.700"
                        borderBottom="1px solid" borderColor="gray.100"
                        borderLeft={isToday(b) ? "4px solid" : undefined}
                        borderLeftColor={isToday(b) ? "green.500" : undefined}>
                        <Flex align="center" gap={2}>
                          <IconButton
                            aria-label={open ? "Collapse" : "Expand"}
                            title={open ? "Collapse" : "Expand"}
                            icon={open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                            size="xs" variant="ghost"
                            colorScheme={open ? "blue" : "gray"}
                            onClick={(e) => { e.stopPropagation(); toggleExpand(b); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                          />
                          <Text as="span">{b.lot_number || `Batch ${b.batch_id}`}</Text>
                        </Flex>
                      </Box>
                      <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
                        borderBottom="1px solid" borderColor="gray.100">{b.vendor || "—"}</Box>
                      <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
                        borderBottom="1px solid" borderColor="gray.100">{b.item_description || "—"}</Box>
                      <Box as="td" px={3} py={2} fontSize="sm" color="gray.700" whiteSpace="nowrap"
                        borderBottom="1px solid" borderColor="gray.100">
                        {new Date(b.created_at).toLocaleString()}
                        {isToday(b) && (
                          <Badge ml={2} colorScheme="green" fontSize="9px" px={1.5} borderRadius="full">TODAY</Badge>
                        )}
                      </Box>
                      <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
                        borderBottom="1px solid" borderColor="gray.100">{b.box_count}</Box>
                      <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
                        whiteSpace="nowrap" style={{ fontVariantNumeric: "tabular-nums" }}
                        borderBottom="1px solid" borderColor="gray.100">{totalsText(b.totals)}</Box>
                      <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100">
                        <Badge colorScheme={b.status === "closed" ? "green" : "orange"} fontSize="10px">
                          {b.status === "closed" ? "Closed" : "Open"}
                        </Badge>
                      </Box>
                      <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100" textAlign="right">
                        <Button size="xs" variant="outline" colorScheme="blue"
                          isDisabled={!b.box_count}
                          onClick={(e) => { e.stopPropagation(); print(b); }}>
                          Print
                        </Button>
                      </Box>
                    </Box>

                    {open && (
                      <Box as="tr">
                        <Box as="td" colSpan={COLUMNS.length + 1} style={{ padding: 0 }}
                          bg="blue.50" borderTop="2px solid" borderColor="blue.300">
                          <Box p={4}>
                            {loadingId === b.batch_id ? (
                              <Flex justify="center" py={6}><Spinner size="sm" color="blue.500" /></Flex>
                            ) : detail ? (
                              <ScanSheet scans={detail.items} totals={b.totals || []} />
                            ) : null}
                          </Box>
                        </Box>
                      </Box>
                    )}
                  </React.Fragment>
                );
              })}
            </Box>
          </Box>
          <Text fontSize="xs" color="gray.400" mt={2}>
            Double-click a session, or use the chevron, to see its box weights.
          </Text>
        </Box>
      )}

      <BoxScanner isOpen={scannerOpen} onClose={onScannerClose} />
    </Box>
  );
};

export default WeightManifestTab;
