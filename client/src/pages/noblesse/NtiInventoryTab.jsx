import React, { useState } from "react";
import {
  Box, Flex, Text, Button, IconButton, Spinner, useToast, Badge,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
} from "@chakra-ui/react";
import { CheckIcon, CloseIcon, DeleteIcon, ChevronDownIcon, ChevronRightIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import { fmtDate, today, cellInputStyle, Th, Td } from "./shared";

const fmtTime = (ts) => {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d) ? null : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
};

const LEFT_COLS = [
  { key: "receivedDate", label: "Rcvd Date",  type: "date", w: "115px", placeholder: "" },
  { key: "brand",        label: "Brand",       type: "text", w: "85px",  placeholder: "IBP" },
  { key: "description",  label: "Product",     type: "text", w: "150px", placeholder: "BNLS Beef Brisket" },
  { key: "grade",        label: "Grade",       type: "text", w: "65px",  placeholder: "Choice" },
  { key: "lot",          label: "Lot #",       type: "text", w: "105px", placeholder: "N26086-01" },
  { key: "qtyCases",     label: "Cases",       type: "text", w: "55px",  placeholder: "0" },
  { key: "weight",       label: "Raw Wt (lb)", type: "text", w: "95px",  placeholder: "1842" },
];

// expand(1) + LEFT_COLS(7) + computed(6) + actions(1) = 15
const TOTAL_COLS = 15;

const emptyNtiItem = () => ({
  lot: "", description: "", brand: "", grade: "", species: "", est: "",
  packDate: "", weight: "", qtyCases: "", qtyPallets: "", receivedDate: today(), notes: "",
});

export const NtiInventoryTab = ({ ntiInventory, procOrders = [], afItems, onAdd, onUpdate, onDelete, isAdmin, canDelete = false }) => {
  const toast = useToast();
  const [activeId, setActiveId]         = useState(null);
  const [selectedId, setSelectedId]     = useState(null);
  const [expandedIds, setExpandedIds]   = useState(new Set());
  const [drafts, setDrafts]             = useState({});
  const [saving, setSaving]             = useState(false);
  const [sortCol, setSortCol]           = useState("receivedDate");
  const [sortDir, setSortDir]           = useState("desc");
  const [history, setHistory]           = useState([]);
  const [historyOpen, setHistoryOpen]         = useState(false);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [deletingId, setDeletingId]           = useState(null);
  const [statusFilter, setStatusFilter]       = useState("all");

  const toggleExpand = (id) =>
    setExpandedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const itemData = ntiInventory.map((item) => {
    const events = procOrders
      .filter((o) => o.items.some((it) => it.ntiItemId === item.id))
      .map((o) => {
        const oi = o.items.find((it) => it.ntiItemId === item.id);
        return {
          date:           o.orderDate,
          status:         o.status,
          casesIn:        oi?.casesIn        != null ? Number(oi.casesIn)        : null,
          weightIn:       oi?.weightIn       != null ? Number(oi.weightIn)       : null,
          actualWeightIn: oi?.actualWeightIn != null ? Number(oi.actualWeightIn) : null,
          outputWeight:   o.outputWeight,
          outputCases:    o.outputCases,
          createdAt:      o.createdAt,
          completedAt:    o.completedAt,
        };
      })
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    const completedEvents  = events.filter((e) => e.status === "completed");
    const pendingEvents    = events.filter((e) => e.status === "pending");
    // Processed weight = actual weight consumed by completed orders
    const totalWeightIn    = completedEvents.reduce((s, e) => s + (parseFloat(e.actualWeightIn ?? e.weightIn) || 0), 0);
    // Weight still committed to pending orders (deducted from inventory but not yet processed)
    const pendingWeightIn  = pendingEvents.reduce((s, e) => s + (parseFloat(e.weightIn) || 0), 0);
    const allComplete      = events.length > 0 && events.every((e) => e.status === "completed");
    const hasAllOut        = completedEvents.length > 0 && completedEvents.every((e) => e.outputWeight != null);
    const totalOut         = hasAllOut ? completedEvents.reduce((s, e) => s + (parseFloat(e.outputWeight) || 0), 0) : null;
    const hasSomeOutCases  = completedEvents.some((e) => e.outputCases != null);
    const totalCasesOut    = hasSomeOutCases ? completedEvents.reduce((s, e) => s + (parseInt(e.outputCases) || 0), 0) : null;
    const noRemainingWt    = (parseFloat(item.weight) || 0) <= 0;
    const fullyDone        = allComplete && events.length > 0 && noRemainingWt && pendingWeightIn === 0;
    const gainLoss         = fullyDone && totalOut != null ? totalOut - totalWeightIn : null;
    const yieldPct         = fullyDone && totalOut != null && totalWeightIn > 0
      ? (totalOut / totalWeightIn) * 100 : null;

    return { item, events, totalCasesOut, totalWeightIn, pendingWeightIn, totalOut, gainLoss, yieldPct,
             status: fullyDone ? "Complete" : "Pending" };
  });

  const sortedData = [...itemData]
    .filter((d) => statusFilter === "all" || d.status.toLowerCase() === statusFilter)
    .sort((a, b) => {
      const av = String(a.item[sortCol] ?? "").toLowerCase();
      const bv = String(b.item[sortCol] ?? "").toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await axiosInstance.get("/nti-inventory-history");
      setHistory(res.data);
    } catch { /* silent */ }
    finally { setHistoryLoading(false); }
  };

  const openHistory = () => { fetchHistory(); setHistoryOpen(true); };

  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const setField = (id, field, val) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: val } }));

  const activate = (id, item) => {
    if (activeId === id) return;
    setActiveId(id);
    if (id === "new") {
      setDrafts((p) => ({ ...p, new: p.new || emptyNtiItem() }));
    } else {
      setDrafts((p) => ({
        ...p,
        [id]: p[id] || {
          lot:          item.lot          || "",
          description:  item.description  || "",
          brand:        item.brand        || "",
          grade:        item.grade        || "",
          species:      item.species      || "",
          est:          item.est          || "",
          packDate:     item.packDate     || "",
          receivedDate: item.receivedDate || today(),
          weight:       item.weight       != null ? String(item.weight)     : "",
          qtyCases:     item.qtyCases     != null ? String(item.qtyCases)   : "",
          qtyPallets:   item.qtyPallets   != null ? String(item.qtyPallets) : "",
          notes:        item.notes        || "",
        },
      }));
    }
  };

  const cancel = (id) => {
    setActiveId(null);
    setDrafts((p) => { const n = { ...p }; delete n[id]; return n; });
  };

  const saveExisting = async (id) => {
    const draft = drafts[id];
    if (!draft) return;
    setSaving(true);
    try {
      const res = await axiosInstance.put(`/nti-inventory/${id}`, draft);
      onUpdate(res.data);
      setActiveId(null);
      setDrafts((p) => { const n = { ...p }; delete n[id]; return n; });
      if (historyOpen) fetchHistory();
    } catch {
      toast({ title: "Failed to update", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSaving(false);
    }
  };

  const saveNew = async () => {
    const draft = drafts.new;
    if (!draft || (!draft.lot && !draft.description)) { cancel("new"); return; }
    setSaving(true);
    try {
      const res = await axiosInstance.post("/nti-inventory", draft);
      onAdd(res.data);
      setDrafts((p) => ({ ...p, new: emptyNtiItem() }));
      if (historyOpen) fetchHistory();
    } catch {
      toast({ title: "Failed to add", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (deletingId === id) return;
    setDeletingId(id);
    try {
      await axiosInstance.delete(`/nti-inventory/${id}`);
      onDelete(id);
      if (activeId === id) setActiveId(null);
      if (historyOpen) fetchHistory();
    } catch (err) {
      if (err.response?.status === 404) {
        // Already deleted on the server — clean up UI silently
        onDelete(id);
        if (activeId === id) setActiveId(null);
      } else {
        toast({ title: "Failed to delete", status: "error", position: "top", duration: 3000, isClosable: true });
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleKeyDown = (e, id) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(id); }
    if (e.key === "Enter")  { e.preventDefault(); id === "new" ? saveNew() : saveExisting(id); }
  };

  const cellDisplay = (item, col) => {
    const v = item[col.key];
    if (v == null || v === "") return <Text as="span" color="gray.300" fontSize="xs">—</Text>;
    if (col.type === "date") return fmtDate(v);
    if (col.key === "weight") return `${v} lb`;
    return String(v);
  };

  const renderInput = (id, col, autoFocus) => (
    <input
      key={col.key}
      value={(drafts[id] || {})[col.key] ?? ""}
      onChange={(e) => setField(id, col.key, e.target.value)}
      type={col.type}
      placeholder={col.placeholder}
      onKeyDown={(e) => handleKeyDown(e, id)}
      onClick={(e) => e.stopPropagation()}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      style={{ ...cellInputStyle, width: col.w }}
    />
  );

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={4} flexWrap="wrap" gap={2}>
        <Flex align="center" gap={3}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide">
            NTI Inventory
          </Text>
          {/* Status filter */}
          <Flex gap={1} bg="gray.100" borderRadius="md" p="2px">
            {[
              { key: "all",      label: "All",       count: itemData.length },
              { key: "pending",  label: "Pending",   count: itemData.filter((d) => d.status === "Pending").length },
              { key: "complete", label: "Complete",  count: itemData.filter((d) => d.status === "Complete").length },
            ].map(({ key, label, count }) => {
              const active = statusFilter === key;
              return (
                <Button key={key} size="xs" borderRadius="md"
                  bg={active ? "white" : "transparent"}
                  color={active ? "gray.700" : "gray.400"}
                  boxShadow={active ? "sm" : "none"}
                  fontWeight={active ? "semibold" : "normal"}
                  _hover={{ bg: active ? "white" : "gray.200" }}
                  onClick={() => setStatusFilter(key)}>
                  {label}
                  {count > 0 && (
                    <Badge ml={1.5} borderRadius="full" fontSize="xs"
                      colorScheme={key === "complete" ? "green" : key === "pending" ? "yellow" : "gray"}>
                      {count}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </Flex>
        </Flex>
        {isAdmin && (
          <Button size="xs" variant="outline" colorScheme="gray" onClick={openHistory}>
            History
          </Button>
        )}
      </Flex>

      <Box overflowX="auto">
        <Box as="table" width="100%" borderCollapse="collapse" fontSize="sm">
          <thead>
            <tr>
              <Th w="28px" />
              {LEFT_COLS.map((c) => (
                <Th key={c.key} cursor="pointer" userSelect="none" onClick={() => handleSort(c.key)}
                  _hover={{ bg: "gray.100" }} whiteSpace="nowrap">
                  {c.label}{" "}
                  <Text as="span" color={sortCol === c.key ? "blue.500" : "gray.300"} fontSize="xs">
                    {sortCol === c.key ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                  </Text>
                </Th>
              ))}
              <Th bg="gray.50" whiteSpace="nowrap"
                borderLeft="2px solid" borderLeftColor="gray.200">Rem. Wt (lb)</Th>
              <Th bg="gray.50" whiteSpace="nowrap">Processed Wt</Th>
              <Th bg="gray.50" whiteSpace="nowrap">Total Cases Out</Th>
              <Th bg="gray.50" whiteSpace="nowrap">Gain/Loss (lb)</Th>
              <Th bg="gray.50" whiteSpace="nowrap">Yield %</Th>
              <Th bg="gray.50" whiteSpace="nowrap">Status</Th>
              <Th w="52px" />
            </tr>
          </thead>
          <tbody>
            {sortedData.map(({ item, events, totalCasesOut, totalWeightIn, pendingWeightIn, gainLoss, yieldPct, status }, i) => {
              const isActive   = activeId === item.id;
              const isExpanded = expandedIds.has(item.id);
              const rawWeight  = (parseFloat(item.weight) || 0) + totalWeightIn;
              return (
                <React.Fragment key={item.id}>
                  <Box as="tr"
                    bg={isActive ? "blue.50" : selectedId === item.id ? "blue.100" : i % 2 === 0 ? "white" : "gray.50"}
                    cursor="default"
                    onClick={() => isAdmin ? setSelectedId(item.id) : toggleExpand(item.id)}
                    onDoubleClick={isAdmin ? () => { setSelectedId(null); activate(item.id, item); } : undefined}
                    _hover={{ bg: isActive ? "blue.50" : selectedId === item.id ? "blue.100" : "blue.50" }}
                    role="group">

                    {/* Expand toggle */}
                    <Td px={1} w="28px">
                      {events.length > 0 && (
                        <IconButton
                          icon={isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                          size="xs" variant="ghost" colorScheme="gray"
                          aria-label={isExpanded ? "Collapse" : "Expand"}
                          onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
                        />
                      )}
                    </Td>

                    {/* Editable left columns — weight shows reconstructed raw weight in read mode */}
                    {LEFT_COLS.map((col, ci) => (
                      <Td key={col.key} px={isActive ? 1 : 3} style={{ minWidth: col.w }}>
                        {isActive
                          ? renderInput(item.id, col, ci === 0)
                          : col.key === "weight"
                            ? (rawWeight > 0
                                ? `${rawWeight % 1 === 0 ? rawWeight : rawWeight.toFixed(2)} lb`
                                : <Text as="span" color="gray.300" fontSize="xs">—</Text>)
                            : cellDisplay(item, col)}
                      </Td>
                    ))}

                    {/* Remaining weight */}
                    <Td bg="gray.50"
                      fontWeight={(parseFloat(item.weight) || 0) > 0 ? "semibold" : "normal"}
                      color={(parseFloat(item.weight) || 0) > 0 ? "gray.800" : "gray.400"}
                      borderLeft="2px solid" borderLeftColor="gray.200">
                      {(parseFloat(item.weight) || 0) > 0
                        ? `${item.weight % 1 === 0 ? item.weight : Number(item.weight).toFixed(2)} lb`
                        : <Text as="span" color="gray.300" fontSize="xs">0 lb</Text>}
                    </Td>

                    {/* Total Proc Wt */}
                    <Td bg="gray.50" fontWeight="semibold" color="gray.700">
                      {totalWeightIn > 0
                        ? `${totalWeightIn % 1 === 0 ? totalWeightIn : totalWeightIn.toFixed(2)} lb`
                        : <Text as="span" color="gray.300" fontSize="xs">—</Text>}
                    </Td>

                    {/* Total Cases Out */}
                    <Td bg="gray.50"
                      fontWeight={totalCasesOut > 0 ? "semibold" : "normal"}
                      color={totalCasesOut > 0 ? "gray.800" : "gray.400"}>
                      {totalCasesOut != null
                        ? totalCasesOut
                        : <Text as="span" color="gray.300" fontSize="xs">—</Text>}
                    </Td>

                    {/* Gain/Loss */}
                    <Td bg="gray.50"
                      color={gainLoss != null ? (gainLoss >= 0 ? "green.600" : "red.600") : undefined}
                      fontWeight={gainLoss != null ? "medium" : "normal"}>
                      {gainLoss != null
                        ? `${gainLoss >= 0 ? "+" : ""}${gainLoss.toFixed(2)}`
                        : <Text as="span" color="gray.300" fontSize="xs">—</Text>}
                    </Td>

                    {/* Yield % */}
                    <Td bg="gray.50">
                      {yieldPct != null
                        ? <Text fontSize="xs" fontWeight="semibold" color="gray.700">{yieldPct.toFixed(2)}%</Text>
                        : <Text as="span" color="gray.300" fontSize="xs">—</Text>}
                    </Td>

                    {/* Status */}
                    <Td bg="gray.50">
                      <Flex direction="column" gap={1} align="flex-start">
                        <Badge colorScheme={status === "Complete" ? "green" : "gray"}
                          variant="subtle" px={2} py={0.5} borderRadius="md" fontSize="xs">
                          {status}
                        </Badge>
                        {pendingWeightIn > 0 && (
                          <Badge colorScheme="orange" variant="subtle"
                            px={2} py={0.5} borderRadius="md" fontSize="xs" whiteSpace="nowrap">
                            {pendingWeightIn % 1 === 0 ? pendingWeightIn : pendingWeightIn.toFixed(1)} lb pending
                          </Badge>
                        )}
                      </Flex>
                    </Td>

                    {/* Edit / Delete — admin only */}
                    <Td px={1}>
                      {isAdmin && (
                        <Flex gap={1} justify="flex-end">
                          {isActive ? (
                            <>
                              <IconButton icon={<CheckIcon />} size="xs" colorScheme="green" aria-label="Save"
                                isLoading={saving} onClick={(e) => { e.stopPropagation(); saveExisting(item.id); }} />
                              <IconButton icon={<CloseIcon />} size="xs" variant="ghost" colorScheme="gray" aria-label="Cancel"
                                onClick={(e) => { e.stopPropagation(); cancel(item.id); }} />
                            </>
                          ) : (
                            canDelete ? (
                              <IconButton icon={<DeleteIcon />} size="xs" variant="ghost" colorScheme="red" aria-label="Delete"
                                opacity={0} _groupHover={{ opacity: 1 }}
                                isLoading={deletingId === item.id}
                                onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} />
                            ) : null
                          )}
                        </Flex>
                      )}
                    </Td>
                  </Box>

                  {/* Expanded processing events */}
                  {isExpanded && events.length > 0 && (
                    <Box as="tr">
                      <Box as="td" colSpan={TOTAL_COLS}
                        bg="gray.50" px={8} py={3}
                        borderBottom="2px solid" borderBottomColor="gray.200">
                        <Box as="table" borderCollapse="collapse" fontSize="sm">
                          <thead>
                            <tr>
                              <Th>Date</Th>
                              <Th>Wt Used (lb)</Th>
                              <Th>Wt Out (lb)</Th>
                              <Th>Cases Out</Th>
                              <Th>Started</Th>
                              <Th>Completed</Th>
                              <Th>Status</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {events.map((ev, ei) => {
                              const isPartialEv = ev.actualWeightIn != null && ev.actualWeightIn !== ev.weightIn;
                              return (
                              <Box as="tr" key={ei} bg={ei % 2 === 0 ? "white" : "gray.50"}>
                                <Td whiteSpace="nowrap">{ev.date ? fmtDate(ev.date) : "—"}</Td>
                                <Td fontWeight="medium" whiteSpace="nowrap">
                                  {ev.actualWeightIn != null
                                    ? <>
                                        {ev.actualWeightIn} lb
                                        {isPartialEv && (
                                          <Text as="span" color="gray.400" fontWeight="normal" ml={1}
                                            fontSize="xs">
                                            /{ev.weightIn} planned
                                          </Text>
                                        )}
                                      </>
                                    : ev.weightIn != null ? `${ev.weightIn} lb` : "—"}
                                </Td>
                                <Td
                                  color={ev.outputWeight != null ? "gray.800" : "gray.300"}
                                  fontWeight={ev.outputWeight != null ? "medium" : "normal"}>
                                  {ev.outputWeight != null ? `${ev.outputWeight} lb` : "—"}
                                </Td>
                                <Td color={ev.outputCases != null ? "gray.800" : "gray.300"}>
                                  {ev.outputCases != null ? ev.outputCases : "—"}
                                </Td>
                                <Td color="gray.600" whiteSpace="nowrap">
                                  {fmtTime(ev.createdAt) || "—"}
                                </Td>
                                <Td color={ev.completedAt ? "green.700" : "gray.300"} whiteSpace="nowrap">
                                  {fmtTime(ev.completedAt) || "—"}
                                </Td>
                                <Td>
                                  <Badge
                                    colorScheme={ev.status === "completed" ? "green" : "yellow"}
                                    variant="subtle" fontSize="xs" textTransform="capitalize">
                                    {ev.status}
                                  </Badge>
                                </Td>
                              </Box>
                              );
                            })}
                          </tbody>
                        </Box>
                      </Box>
                    </Box>
                  )}
                </React.Fragment>
              );
            })}

            {/* New row — admin only */}
            {isAdmin && <Box as="tr"
              bg={activeId === "new" ? "green.50" : "transparent"}
              cursor="cell"
              onClick={() => { setSelectedId(null); activate("new", null); }}
              _hover={{ bg: activeId === "new" ? "green.50" : "gray.50" }}>
              <Td borderBottom="1px dashed" borderColor="gray.200" />
              {LEFT_COLS.map((col, ci) => (
                <Td key={col.key} px={activeId === "new" ? 1 : 3}
                  borderBottom="1px dashed" borderColor="gray.200" style={{ minWidth: col.w }}>
                  {activeId === "new"
                    ? renderInput("new", col, ci === 0)
                    : ci === 0
                      ? <Text fontSize="xs" color="gray.300" fontStyle="italic">+ new row</Text>
                      : null}
                </Td>
              ))}
              {/* Rem Wt + Total Proc Wt + Total Cases Out + Gain/Loss + Yield + Status = 6 */}
              {Array.from({ length: 6 }, (_, k) => (
                <Td key={`pad-${k}`} borderBottom="1px dashed" borderColor="gray.200" />
              ))}
              <Td px={1} borderBottom="1px dashed" borderColor="gray.200">
                {activeId === "new" && (
                  <IconButton icon={<CheckIcon />} size="xs" colorScheme="green" aria-label="Save"
                    isLoading={saving} onClick={(e) => { e.stopPropagation(); saveNew(); }} />
                )}
              </Td>
            </Box>}
          </tbody>
        </Box>
      </Box>

      {/* History modal */}
      <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} size="4xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader fontSize="md" pb={2}>
            <Flex align="center" gap={3}>
              <Text>NTI Inventory — Change History</Text>
              <Button size="xs" variant="ghost" colorScheme="gray" onClick={fetchHistory} isLoading={historyLoading}>
                Refresh
              </Button>
            </Flex>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            {historyLoading && history.length === 0 ? (
              <Flex justify="center" py={8}><Spinner color="blue.500" /></Flex>
            ) : history.length === 0 ? (
              <Text fontSize="sm" color="gray.400">No changes recorded yet.</Text>
            ) : (
              <Box overflowX="auto">
                <Box as="table" width="100%" borderCollapse="collapse">
                  <thead>
                    <tr>
                      <Th>Time</Th>
                      <Th>By</Th>
                      <Th>Action</Th>
                      <Th>Lot #</Th>
                      <Th>Details</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => {
                      const snap   = h.snapshot || {};
                      const before = snap.before || {};
                      const ACTION_COLOR = { added: "green", updated: "blue", deleted: "red", processed: "orange", received: "teal", returned: "purple" };
                      const color  = ACTION_COLOR[h.action] || "gray";
                      const changedFields = h.action === "updated"
                        ? LEFT_COLS.filter((c) => String(snap[c.key] ?? "") !== String(before[c.key] ?? ""))
                            .map((c) => `${c.label}: ${before[c.key] || "—"} → ${snap[c.key] || "—"}`)
                        : [];
                      return (
                        <Box as="tr" key={h.id} bg={i % 2 === 0 ? "white" : "gray.50"}>
                          <Td fontSize="sm" color="gray.500" whiteSpace="nowrap">{fmtDate(h.createdAt)}</Td>
                          <Td fontSize="sm" color="gray.500" whiteSpace="nowrap">{h.performedBy || "—"}</Td>
                          <Td><Badge colorScheme={color} fontSize="xs" textTransform="capitalize">{h.action}</Badge></Td>
                          <Td fontWeight="medium" color="blue.700">{h.lot || "—"}</Td>
                          <Td fontSize="sm" color="gray.600" whiteSpace="normal">
                            {h.action === "added"     && (`${snap.description || ""} ${snap.brand || ""}`.trim() || "—")}
                            {h.action === "deleted"   && (`${snap.description || ""} ${snap.brand || ""}`.trim() || "—")}
                            {h.action === "received"  && `From receipt #${snap.sourceReceiptId} — ${`${snap.description || ""} ${snap.brand || ""}`.trim() || "—"}`}
                            {h.action === "processed" && `−${snap.weightDeducted} lb (processing order #${snap.processingOrderId})`}
                            {h.action === "returned"  && `+${snap.returnedWeight} lb returned — processed ${snap.actualWeight}/${snap.plannedWeight} lb (PO #${snap.processingOrderId})`}
                            {h.action === "updated"   && (
                              changedFields.length > 0
                                ? changedFields.join(" · ")
                                : <Text as="span" color="gray.300">no field changes</Text>
                            )}
                          </Td>
                        </Box>
                      );
                    })}
                  </tbody>
                </Box>
              </Box>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  );
};
