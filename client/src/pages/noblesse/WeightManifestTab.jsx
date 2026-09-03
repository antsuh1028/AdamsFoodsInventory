import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Spinner, IconButton, Input, Select, Checkbox,
  Alert, AlertIcon, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, CloseIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import ScanSheet from "../../components/navbar/ScanSheet";
import BoxScanner from "../../components/navbar/boxScanner";
import printWeightManifest from "./printWeightManifest";
import ImportTally from "./ImportTally";
import FloatingWindow from "../../components/FloatingWindow";
import { fmtDate, today } from "./shared";
import getRole from "../../utils/getRole";

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

// Restores are shown in the same trail, so the labels have to distinguish
// "gone for good" from "taken off but recoverable".
const REMOVAL_LABEL = {
  item_voided: "Voided",
  item_restored: "Restored",
  item_deleted: "Box erased",
  batch_deleted: "Session deleted",
  manifest_group_deleted: "Manifest removed",
};

const REMOVAL_COLOR = {
  item_voided: "orange",
  item_restored: "green",
  item_deleted: "red",
  batch_deleted: "red",
  manifest_group_deleted: "gray",
};

const totalsText = (totals) =>
  Array.isArray(totals) && totals.length
    ? totals.map((t) => `${t.total} ${t.unit}`).join("  ·  ")
    : "—";

export const WeightManifestTab = ({ refreshSignal = 0 }) => {
  // An open session can be corrected by whoever is running it; a closed one is
  // an admin act. The server enforces both — this only decides what to draw.
  const isAdmin = getRole() === "admin";
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({});   // batch_id -> full batch
  const [loadingId, setLoadingId] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  // A lot weighed across several sessions ships on one manifest.
  const [selected, setSelected] = useState(() => new Set());
  const [groups, setGroups] = useState([]);
  const [confirmMerge, setConfirmMerge] = useState(false);
  // The whole session, not one box inside it.
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(null);
  // Removing a merged manifest destroys a saved, filed form — it gets the same
  // confirmation the session delete does.
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(null);
  const cancelDeleteGroupRef = useRef(null);
  const [removals, setRemovals] = useState(null);
  const [showRemovals, setShowRemovals] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const cancelDeleteBatchRef = useRef(null);
  const [merging, setMerging] = useState(false);
  const cancelMergeRef = useRef(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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

  const fetchGroups = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/manifest-groups");
      setGroups(data || []);
    } catch {
      // A merged-manifest listing failing must not blank the sessions table,
      // which is the part people actually need to keep working.
    }
  }, []);

  useEffect(() => { fetchBatches(); fetchGroups(); }, [fetchBatches, fetchGroups]);

  // Re-fetch on the parent's auto-refresh, compared against a ref so the
  // initial value does not cause a duplicate load alongside the mount effect.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    fetchBatches();
    fetchGroups();
  }, [refreshSignal, fetchBatches, fetchGroups]);

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

  // Re-reads the batch after a correction rather than patching state by hand,
  // so what is displayed is always what the server actually holds.
  const afterRowChange = async (batch) => {
    const { data } = await axiosInstance.get(`/box-batches/${batch.batch_id}`);
    setDetails((prev) => ({ ...prev, [batch.batch_id]: data }));
    fetchBatches();   // counts and totals on the summary row have moved
  };

  // Extra arguments are forwarded: onEditWeight is called as (row, newWeight),
  // while onVoid and onRestore take the row alone.
  const rowAction = (batch, run, successTitle) => async (row, ...rest) => {
    setRowBusy(row.localId);
    try {
      await run(row, ...rest);
      await afterRowChange(batch);
      if (successTitle) {
        toast({ title: successTitle, status: "success", duration: 2500, position: "top" });
      }
    } catch (err) {
      toast({
        title: "Could not change that row",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 5000, position: "top",
      });
    } finally {
      setRowBusy(null);
    }
  };

  const handlersFor = (batch) => {
    // A closed session is only editable by an admin. Handing back no handlers
    // renders the grid read-only, exactly as it was before.
    if (batch.status !== "open" && !isAdmin) return {};
    const base = `/box-batches/${batch.batch_id}/items`;
    return {
      // The unit goes up as the operator typed it; the server converts it
      // itself rather than trusting a client-converted figure.
      onEditWeight: rowAction(batch,
        (row, weight, weightUnit = "LB") => axiosInstance.patch(`${base}/${row.localId}`,
          { weight, weightUnit }), "Weight corrected"),
      onVoid: rowAction(batch,
        (row) => axiosInstance.delete(`${base}/${row.localId}`), "Box taken off the tally"),
      onRestore: rowAction(batch,
        (row) => axiosInstance.post(`${base}/${row.localId}/restore`), "Box put back"),
    };
  };

  const toggleSelected = (batchId) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
    return next;
  });

  const createGroup = async () => {
    setMerging(true);
    try {
      const batchIds = visible.filter((b) => selected.has(b.batch_id)).map((b) => b.batch_id);
      const { data } = await axiosInstance.post("/manifest-groups", { batchIds });
      toast({
        title: "Merged manifest created",
        description: `${batchIds.length} sessions on one form`,
        status: "success", duration: 3500, position: "top",
      });
      setSelected(new Set());
      setConfirmMerge(false);
      await fetchGroups();
      return data;
    } catch (err) {
      toast({
        title: "Could not merge those sessions",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 5000, position: "top",
      });
      setConfirmMerge(false);
      return null;
    } finally {
      setMerging(false);
    }
  };

  // Pulled fresh every time rather than cached: the group references its
  // sessions, so a weight corrected since the last print has to appear.
  const printGroup = async (group) => {
    try {
      const { data } = await axiosInstance.get(`/manifest-groups/${group.group_id}`);
      printWeightManifest({
        lotNumber: data.lot_number,
        vendor: data.vendor,
        shipTo: data.ship_to,
        billOfLading: data.bill_of_lading,
        itemDescription: data.item_description,
        date: fmtDate(String(data.created_at).slice(0, 10)),
        scans: data.items,
      });
    } catch (err) {
      toast({
        title: "Could not load that manifest",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top",
      });
    }
  };

  const loadRemovals = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/box-removals", { params: { limit: 100 } });
      setRemovals(data || []);
    } catch (err) {
      toast({
        title: "Could not load the removal history",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top",
      });
    }
  }, [toast]);

  const deleteGroup = async (group) => {
    setConfirmDeleteGroup(null);
    try {
      await axiosInstance.delete(`/manifest-groups/${group.group_id}`);
      toast({ title: "Merged manifest removed",
        description: "The sessions and their boxes are untouched.",
        status: "info", duration: 3000, position: "top" });
      fetchGroups();
      if (showRemovals) loadRemovals();
    } catch (err) {
      toast({ title: "Could not remove it",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    }
  };

  // Deletes the session and every box in it. The server refuses when the
  // session belongs to a merged manifest and says which one, so that message is
  // surfaced verbatim rather than flattened into a generic failure.
  const deleteBatch = async () => {
    const batch = confirmDeleteBatch;
    if (!batch) return;
    setDeletingBatch(true);
    try {
      const { data } = await axiosInstance.delete(`/box-batches/${batch.batch_id}`);
      toast({
        title: "Session deleted",
        description: `${batch.lot_number || `Batch ${batch.batch_id}`} and its ${data.boxesDeleted} box(es) are gone.`,
        status: "success", duration: 4000, position: "top",
      });
      setConfirmDeleteBatch(null);
      if (expandedId === batch.batch_id) setExpandedId(null);
      setDetails((prev) => {
        const next = { ...prev };
        delete next[batch.batch_id];
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(batch.batch_id);
        return next;
      });
      fetchBatches();
      if (showRemovals) loadRemovals();
    } catch (err) {
      toast({
        title: "Could not delete that session",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 8000, position: "top", isClosable: true,
      });
      setConfirmDeleteBatch(null);
    } finally {
      setDeletingBatch(false);
    }
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

        <Flex gap={2} wrap="wrap">
          {selected.size >= 2 && (
            <Button size="xs" colorScheme="teal" onClick={() => setConfirmMerge(true)}>
              Combine {selected.size} sessions
            </Button>
          )}
          {selected.size === 1 && (
            <Text fontSize="xs" color="gray.500" alignSelf="center">
              Pick one more to combine
            </Text>
          )}
          <Button size="xs" variant="outline" colorScheme="teal" onClick={() => setImportOpen(true)}>
            Import tally sheet
          </Button>
          <Button size="xs" colorScheme="teal" onClick={() => setScannerOpen(true)}>
            + New Box Weighing Session
          </Button>
        </Flex>
      </Flex>

      {error && (
        <Alert status="error" borderRadius="md" mb={3} fontSize="sm">
          <AlertIcon />{error}
        </Alert>
      )}

      <Flex mb={4}>
        <Button size="xs" variant="outline" colorScheme="gray"
          onClick={() => {
            setShowRemovals(true);
            if (removals === null) loadRemovals();
          }}>
          Removal history
        </Button>
      </Flex>

      {/* Saved merges. Each one is a reference to its sessions, so reprinting
          picks up any correction made since — it is not a frozen copy. */}
      {groups.length > 0 && (
        <Box mb={5}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.600" mb={2}
            textTransform="uppercase" letterSpacing="wide">
            Merged manifests
          </Text>
          <Flex direction="column" gap={2}>
            {groups.map((g) => (
              <Flex key={g.group_id} align="center" gap={3} wrap="wrap"
                px={3} py={2} bg="teal.50" borderRadius="md"
                border="1px solid" borderColor="teal.200">
                <Text fontSize="sm" fontWeight="bold" color="teal.800">
                  {g.name || g.lot_number || `Manifest ${g.group_id}`}
                </Text>
                <Badge colorScheme="teal" fontSize="10px">
                  {g.session_count} session{g.session_count === 1 ? "" : "s"}
                </Badge>
                <Text fontSize="sm" color="gray.600">
                  {g.box_count} boxes
                </Text>
                <Text fontSize="sm" color="gray.700" fontWeight="600"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {g.total} LB
                </Text>
                {g.vendor && <Text fontSize="sm" color="gray.500">{g.vendor}</Text>}
                <Flex gap={2} ml="auto">
                  <Button size="xs" variant="outline" colorScheme="blue"
                    onClick={() => printGroup(g)}>
                    Print
                  </Button>
                  {isAdmin && (
                    <Button size="xs" variant="ghost" colorScheme="red"
                      onClick={() => setConfirmDeleteGroup(g)}>
                      Remove
                    </Button>
                  )}
                </Flex>
              </Flex>
            ))}
          </Flex>
        </Box>
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
                <Box as="th" bg="gray.100" borderBottom="1px solid" borderColor="gray.300"
                  px={2} py={2} style={{ width: "40px" }} />
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
                  <Box as="th" bg="gray.50" borderBottom="1px solid" borderColor="gray.200" />
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
                      <Box as="td" px={2} py={2} borderBottom="1px solid" borderColor="gray.100"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}>
                        <Checkbox size="sm" isChecked={selected.has(b.batch_id)}
                          onChange={() => toggleSelected(b.batch_id)}
                          aria-label={`Select ${b.lot_number || b.batch_id}`} />
                      </Box>
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
                        <Flex gap={1} wrap="wrap">
                          <Badge colorScheme={b.status === "closed" ? "green" : "orange"} fontSize="10px">
                            {b.status === "closed" ? "Closed" : "Open"}
                          </Badge>
                          {/* A barcode-verified lot and one keyed in by hand
                              carry different confidence. */}
                          {b.source === "imported" && (
                            <Badge colorScheme="teal" fontSize="10px">Imported</Badge>
                          )}
                        </Flex>
                      </Box>
                      <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100" textAlign="right">
                        <Flex gap={2} justify="flex-end">
                          <Button size="xs" variant="outline" colorScheme="blue"
                            isDisabled={!b.box_count}
                            onClick={(e) => { e.stopPropagation(); print(b); }}>
                            Print
                          </Button>
                          {/* Deletes the whole session, boxes and all. Admin
                              only, and gated server-side too. */}
                          {isAdmin && (
                            <Button size="xs" variant="ghost" colorScheme="red"
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteBatch(b); }}>
                              Delete
                            </Button>
                          )}
                        </Flex>
                      </Box>
                    </Box>

                    {open && (
                      <Box as="tr">
                        <Box as="td" colSpan={COLUMNS.length + 2} style={{ padding: 0 }}
                          bg="blue.50" borderTop="2px solid" borderColor="blue.300">
                          <Box p={4}>
                            {loadingId === b.batch_id ? (
                              <Flex justify="center" py={6}><Spinner size="sm" color="blue.500" /></Flex>
                            ) : detail ? (
                              <ScanSheet scans={detail.items}
                                busyId={rowBusy} {...handlersFor(b)} />
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

      <AlertDialog isOpen={confirmMerge} leastDestructiveRef={cancelMergeRef}
        onClose={() => setConfirmMerge(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Combine these into one manifest
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={3}>
                These sessions will print as a single tally sheet. The heading is
                taken from the first one. Nothing is copied — correcting a box in
                a session afterwards will show on the next print of this manifest.
              </Text>
              <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden">
                {visible.filter((b) => selected.has(b.batch_id)).map((b, i) => (
                  <Flex key={b.batch_id} px={3} py={2} gap={3} align="baseline"
                    bg={i % 2 ? "gray.50" : "white"} wrap="wrap">
                    <Text fontSize="sm" fontWeight="bold" color="red.800">
                      {b.lot_number || `Batch ${b.batch_id}`}
                    </Text>
                    <Text fontSize="sm" color="gray.600">{b.vendor || "—"}</Text>
                    <Text fontSize="sm" color="gray.700" ml="auto">
                      {b.box_count} boxes · {totalsText(b.totals)}
                    </Text>
                  </Flex>
                ))}
              </Box>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelMergeRef} onClick={() => setConfirmMerge(false)}>
                Go back
              </Button>
              <Button colorScheme="teal" onClick={createGroup} isLoading={merging}>
                Combine
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Deleting a whole session destroys every weight in it, so the dialog
          states the count rather than asking "are you sure". leastDestructiveRef
          keeps focus on the safe button. */}
      <AlertDialog
        isOpen={Boolean(confirmDeleteBatch)}
        leastDestructiveRef={cancelDeleteBatchRef}
        onClose={() => setConfirmDeleteBatch(null)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete this whole session?
            </AlertDialogHeader>
            <AlertDialogBody>
              {confirmDeleteBatch && (
                <>
                  <Text fontSize="sm" mb={3}>
                    This removes the session and every box weighed in it. It cannot
                    be undone.
                  </Text>
                  <Box px={3} py={2} bg="gray.50" borderRadius="md"
                    border="1px solid" borderColor="gray.200">
                    <Flex gap={3} align="baseline" wrap="wrap">
                      <Text fontSize="sm" fontWeight="bold" color="red.800">
                        {confirmDeleteBatch.lot_number || `Batch ${confirmDeleteBatch.batch_id}`}
                      </Text>
                      {confirmDeleteBatch.vendor && (
                        <Text fontSize="sm" color="gray.600">{confirmDeleteBatch.vendor}</Text>
                      )}
                    </Flex>
                    <Text fontSize="sm" color="gray.700" mt={1}>
                      {confirmDeleteBatch.box_count} box
                      {confirmDeleteBatch.box_count === 1 ? "" : "es"}
                      {" · "}{totalsText(confirmDeleteBatch.totals)}
                    </Text>
                  </Box>
                  {confirmDeleteBatch.status === "open" && (
                    <Text fontSize="sm" color="orange.700" mt={3}>
                      This session is still open. If someone is scanning into it
                      right now, their work goes too.
                    </Text>
                  )}
                </>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelDeleteBatchRef} onClick={() => setConfirmDeleteBatch(null)}>
                Go back
              </Button>
              <Button colorScheme="red" onClick={deleteBatch} isLoading={deletingBatch}>
                Delete session
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Removing a merged manifest destroys a saved form somebody may have
          printed and filed. The sessions survive, and the dialog says so, since
          that is the thing a person is actually worried about here. */}
      <AlertDialog
        isOpen={Boolean(confirmDeleteGroup)}
        leastDestructiveRef={cancelDeleteGroupRef}
        onClose={() => setConfirmDeleteGroup(null)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Remove this merged manifest?
            </AlertDialogHeader>
            <AlertDialogBody>
              {confirmDeleteGroup && (
                <>
                  <Text fontSize="sm" mb={3}>
                    The merged form goes. The weighing sessions it covered, and every
                    box in them, are left untouched — only the grouping is removed.
                  </Text>
                  <Box px={3} py={2} bg="gray.50" borderRadius="md"
                    border="1px solid" borderColor="gray.200">
                    <Text fontSize="sm" fontWeight="bold" color="red.800">
                      {confirmDeleteGroup.name || confirmDeleteGroup.lot_number
                        || `Manifest ${confirmDeleteGroup.group_id}`}
                    </Text>
                    <Text fontSize="sm" color="gray.700" mt={1}>
                      {confirmDeleteGroup.session_count} session
                      {confirmDeleteGroup.session_count === 1 ? "" : "s"}
                      {" · "}{confirmDeleteGroup.box_count} boxes
                    </Text>
                  </Box>
                </>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelDeleteGroupRef} onClick={() => setConfirmDeleteGroup(null)}>
                Go back
              </Button>
              <Button colorScheme="red" onClick={() => deleteGroup(confirmDeleteGroup)}>
                Remove manifest
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Everything taken off a tally. Voids and restores sit alongside the
          permanent deletions on purpose: a trail showing only removals, and
          not the ones that were undone, overstates what actually left. */}
      <FloatingWindow
        isOpen={showRemovals}
        onClose={() => setShowRemovals(false)}
        title="Removal history"
        width={860}
        footer={
          <Flex justify="space-between" width="100%" gap={2} wrap="wrap">
            <Button size="sm" variant="outline" onClick={loadRemovals}>Refresh</Button>
            <Button size="sm" onClick={() => setShowRemovals(false)}>Close</Button>
          </Flex>
        }
      >
        {removals === null ? (
          <Flex justify="center" py={8}><Spinner size="md" color="blue.500" /></Flex>
        ) : removals.length === 0 ? (
          <Box p={4} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
            <Text fontSize="sm" color="gray.600">
              Nothing has been removed yet. From here on, every void, erased box,
              deleted session and removed manifest is recorded here.
            </Text>
          </Box>
        ) : (
          <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden">
            {removals.map((r, i) => (
              <Flex key={r.id} px={3} py={2} gap={3} align="baseline" wrap="wrap"
                bg={i % 2 ? "gray.50" : "white"}
                borderBottom={i === removals.length - 1 ? "none" : "1px solid"}
                borderColor="gray.100">
                <Badge fontSize="9px" colorScheme={REMOVAL_COLOR[r.action] || "gray"}>
                  {REMOVAL_LABEL[r.action] || r.action}
                </Badge>
                {r.lot_number && (
                  <Text fontSize="sm" fontWeight="600" color="gray.700">{r.lot_number}</Text>
                )}
                <Text fontSize="sm" color="gray.700">{r.summary}</Text>
                {r.reason && (
                  <Text fontSize="xs" color="gray.500" fontStyle="italic">“{r.reason}”</Text>
                )}
                <Text fontSize="xs" color="gray.500" ml="auto" whiteSpace="nowrap">
                  {r.performed_by ? `${r.performed_by} · ` : ""}
                  {new Date(r.created_at).toLocaleString()}
                </Text>
              </Flex>
            ))}
          </Box>
        )}
      </FloatingWindow>

      <BoxScanner isOpen={scannerOpen} onClose={onScannerClose} />
      <ImportTally isOpen={importOpen} onClose={() => setImportOpen(false)} onImported={fetchBatches} />
    </Box>
  );
};

export default WeightManifestTab;
