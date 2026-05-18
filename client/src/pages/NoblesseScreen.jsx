import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Flex, Text, Spinner, Badge, IconButton, Tooltip,
  Tabs, TabList, TabPanels, Tab, TabPanel,
  Button, Input, Select, Grid, GridItem,
  Divider, useToast,
} from "@chakra-ui/react";
import { RepeatIcon, AddIcon, DeleteIcon, ArrowBackIcon, EditIcon, CheckIcon, CloseIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import getRole from "../utils/getRole";

const REFRESH_INTERVAL_MS = 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);

// "5/13/2026" for date-only, "5/13/2026 - 9:42 AM" for timestamps
const fmtDate = (val) => {
  if (!val) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(val))) {
    const [y, m, d] = String(val).split("-");
    return `${parseInt(m)}/${parseInt(d)}/${y}`;
  }
  const dt = new Date(val);
  if (isNaN(dt)) return String(val);
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  const y = dt.getFullYear();
  const h = dt.getHours() % 12 || 12;
  const min = String(dt.getMinutes()).padStart(2, "0");
  const ampm = dt.getHours() >= 12 ? "PM" : "AM";
  return `${m}/${d}/${y} - ${h}:${min} ${ampm}`;
};

// ── Shared table styles ───────────────────────────────────────────────────────

const Th = ({ children, ...props }) => (
  <Box
    as="th" px={3} py={2} textAlign="left"
    fontSize="xs" fontWeight="semibold" color="gray.500"
    textTransform="uppercase" letterSpacing="wide"
    bg="gray.50" borderBottom="2px" borderColor="gray.200"
    whiteSpace="nowrap" {...props}
  >
    {children}
  </Box>
);

const Td = ({ children, ...props }) => (
  <Box
    as="td" px={3} py={2}
    fontSize="sm" color="gray.700"
    borderBottom="1px" borderColor="gray.100"
    whiteSpace="nowrap" {...props}
  >
    {children}
  </Box>
);

// ── Pending Orders Tab ────────────────────────────────────────────────────────

const BoxWeights = ({ boxes }) => {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(boxes) || boxes.length === 0) return <Text fontSize="xs" color="gray.400">—</Text>;
  return (
    <Box>
      <Text fontSize="xs" color="blue.500" cursor="pointer" userSelect="none"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        {open ? "▾" : "▸"} {boxes.length} boxes
      </Text>
      {open && (
        <Flex flexWrap="wrap" gap={1} maxW="180px" mt={1}>
          {boxes.map((b, k) => (
            <Box key={k} fontSize="xs" color="gray.600" bg="gray.100" borderRadius="sm" px={1.5} py={0.5} minW="48px" textAlign="center">
              {b.weight} lb
            </Box>
          ))}
        </Flex>
      )}
    </Box>
  );
};

const OrdersTable = ({ orders }) => {
  const [expandedId, setExpandedId] = useState(null);
  const [itemsMap, setItemsMap]     = useState({});
  const [loadingId, setLoadingId]   = useState(null);

  const toggle = async (order) => {
    if (expandedId === order.id) { setExpandedId(null); return; }
    setExpandedId(order.id);
    if (itemsMap[order.id]) return;
    setLoadingId(order.id);
    try {
      const res = await axiosInstance.get(`/production-orders/${order.id}`);
      setItemsMap((prev) => ({ ...prev, [order.id]: res.data.items || [] }));
    } catch {
      setItemsMap((prev) => ({ ...prev, [order.id]: [] }));
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <Box overflowX="auto">
      <Box as="table" width="100%" borderCollapse="collapse">
        <thead>
          <tr>
            <Th w="16px" />
            <Th>Sent Date</Th>
            <Th>Items</Th>
            <Th>Pallets</Th>
            <Th>Total Weight</Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order, i) => (
            <React.Fragment key={order.id}>
              <Box as="tr" bg={i % 2 === 0 ? "white" : "gray.50"}
                _hover={{ bg: "orange.50", cursor: "pointer" }} onClick={() => toggle(order)}>
                <Td color="gray.400" fontSize="xs">{expandedId === order.id ? "▾" : "▸"}</Td>
                <Td fontWeight="medium">{fmtDate(order.sentDate)}</Td>
                <Td fontSize="xs" color="gray.500" maxW="180px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                  {itemsMap[order.id]
                    ? itemsMap[order.id].map((it) => it.description).filter(Boolean).join(", ") || "—"
                    : <Text as="span" fontSize="xs" color="gray.300">expand to load</Text>
                  }
                </Td>
                <Td>{order.itemCount}</Td>
                <Td>{order.totalWeight ? `${parseFloat(order.totalWeight).toFixed(0)} lb` : "—"}</Td>
              </Box>
              {expandedId === order.id && (
                <Box as="tr">
                  <Box as="td" colSpan={6} bg="orange.50" px={6} py={3} borderBottom="1px" borderColor="gray.200">
                    {loadingId === order.id ? <Spinner size="xs" />
                      : (itemsMap[order.id] || []).length === 0
                        ? <Text fontSize="xs" color="gray.400">No items found.</Text>
                        : (
                          <Box as="table" width="100%" borderCollapse="collapse">
                            <thead>
                              <tr>
                                <Th bg="orange.100">Lot #</Th>
                                <Th bg="orange.100">Description</Th>
                                <Th bg="orange.100">Brand</Th>
                                <Th bg="orange.100">Species</Th>
                                <Th bg="orange.100">Total Weight</Th>
                                <Th bg="orange.100">Box Weights</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {(itemsMap[order.id] || []).map((item, j) => (
                                <Box as="tr" key={item.id || j} bg={j % 2 === 0 ? "white" : "orange.50"}>
                                  <Td color="orange.600" fontWeight="medium">{item.lot || "—"}</Td>
                                  <Td>{item.description || "—"}</Td>
                                  <Td>{item.brand || "—"}</Td>
                                  <Td>{item.species || "—"}</Td>
                                  <Td>{item.weightSent ? `${item.weightSent} lb` : "—"}</Td>
                                  <Td><BoxWeights boxes={item.boxesSent} /></Td>
                                </Box>
                              ))}
                            </tbody>
                          </Box>
                        )
                    }
                  </Box>
                </Box>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </Box>
    </Box>
  );
};

const PendingOrdersTab = ({ orders }) => {
  const todayStr    = today();
  const todayOrders = orders.filter((o) => o.sentDate === todayStr);
  const prevOrders  = orders.filter((o) => o.sentDate < todayStr);
  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="orange.500" textTransform="uppercase" letterSpacing="wide" mb={2}>Today</Text>
      {todayOrders.length === 0
        ? <Text fontSize="sm" color="gray.400" mb={4}>No orders sent today.</Text>
        : <OrdersTable orders={todayOrders} />
      }
      {prevOrders.length > 0 && (
        <>
          <Divider my={5} />
          <Text fontSize="xs" fontWeight="semibold" color="gray.400" textTransform="uppercase" letterSpacing="wide" mb={2}>
            Previous — Awaiting Processing
          </Text>
          <OrdersTable orders={prevOrders} />
        </>
      )}
    </Box>
  );
};

// ── Incoming Records Tab ──────────────────────────────────────────────────────

const STATUS_COLORS = { received: "blue", processing: "orange", completed: "green" };
const emptyLine = () => ({ lot: "", brand: "", grade: "", weight: "", qty: "", dateReceived: "" });

const ReceiptsTable = ({ receipts, onStatusChange }) => {
  const [hoveredId, setHoveredId] = useState(null);
  return (
  <Box overflowX="auto">
    <Box as="table" width="100%" borderCollapse="collapse">
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Lot #</Th>
          <Th>BOL #</Th>
          <Th>Driver</Th>
          <Th>Brand</Th>
          <Th>Grade</Th>
          <Th>Weight</Th>
          <Th>Qty</Th>
          <Th>Date Received</Th>
          <Th>Total Weight</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {receipts.map((r, i) => {
          const totalWeight = r.lines.reduce((sum, l) => sum + (parseFloat(l.weight) || 0), 0);
          const bg = i % 2 === 0 ? "white" : "gray.50";
          if (r.lines.length === 0) {
            return (
              <Box as="tr" key={r.id} bg={bg}>
                <Td fontWeight="medium">{fmtDate(r.shipmentDate)}</Td>
                <Td colSpan={1} color="gray.300" fontSize="xs">no items</Td>
                <Td>{r.bolNumber || "—"}</Td>
                <Td>{r.driver || "—"}</Td>
                <Td colSpan={5} />
                <Td>{totalWeight > 0 ? `${totalWeight.toFixed(1)} lb` : "—"}</Td>
                <Td>
                  <Select size="xs" value={r.status} borderRadius="md" w="130px"
                    bg={`${STATUS_COLORS[r.status]}.50`} color={`${STATUS_COLORS[r.status]}.700`}
                    borderColor={`${STATUS_COLORS[r.status]}.200`}
                    onChange={(e) => onStatusChange(r.id, e.target.value)}>
                    <option value="received">Received</option>
                    <option value="processing">Processing</option>
                    <option value="completed">Completed</option>
                  </Select>
                </Td>
              </Box>
            );
          }
          return r.lines.map((l, j) => (
            <Box as="tr" key={`${r.id}-${j}`}
              bg={hoveredId === r.id ? "orange.50" : bg}
              onMouseEnter={() => setHoveredId(r.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {j === 0 ? (
                <Td fontWeight="medium" rowSpan={r.lines.length} borderRight="1px" borderColor="gray.100" verticalAlign="top">
                  {fmtDate(r.shipmentDate)}
                </Td>
              ) : null}
              <Td color="orange.700" fontWeight="medium">{l.lot || "—"}</Td>
              {j === 0 ? (
                <>
                  <Td rowSpan={r.lines.length} borderLeft="1px" borderRight="1px" borderColor="gray.100" verticalAlign="top">
                    {r.bolNumber || "—"}
                  </Td>
                  <Td rowSpan={r.lines.length} borderRight="1px" borderColor="gray.100" verticalAlign="top">
                    {r.driver || "—"}
                  </Td>
                </>
              ) : null}
              <Td>{l.brand || "—"}</Td>
              <Td>{l.grade || "—"}</Td>
              <Td>{l.weight ? `${l.weight} lb` : "—"}</Td>
              <Td>{l.qty || "—"}</Td>
              <Td>{fmtDate(l.dateReceived)}</Td>
              {j === 0 ? (
                <>
                  <Td rowSpan={r.lines.length} borderLeft="1px" borderColor="gray.100" verticalAlign="top" fontWeight="medium">
                    {totalWeight > 0 ? `${totalWeight.toFixed(1)} lb` : "—"}
                  </Td>
                  <Td rowSpan={r.lines.length} borderLeft="1px" borderColor="gray.100" verticalAlign="top" onClick={(e) => e.stopPropagation()}>
                    <Select size="xs" value={r.status} borderRadius="md" w="130px"
                      bg={`${STATUS_COLORS[r.status]}.50`} color={`${STATUS_COLORS[r.status]}.700`}
                      borderColor={`${STATUS_COLORS[r.status]}.200`}
                      onChange={(e) => onStatusChange(r.id, e.target.value)}>
                      <option value="received">Received</option>
                      <option value="processing">Processing</option>
                      <option value="completed">Completed</option>
                    </Select>
                  </Td>
                </>
              ) : null}
            </Box>
          ));
        })}
      </tbody>
    </Box>
  </Box>
  );
};

const IncomingRecordsTab = ({ pendingOrders, receipts, onReceiptAdded, onStatusChange }) => {
  const toast = useToast();
  const [shipmentDate, setShipmentDate]   = useState(today());
  const [bolNumber, setBolNumber]         = useState("");
  const [driver, setDriver]               = useState("");
  const [linkedOrderId, setLinkedOrderId] = useState("");
  const [lines, setLines]                 = useState([emptyLine()]);
  const [submitting, setSubmitting]       = useState(false);
  const [showForm, setShowForm]           = useState(false);

  const updateLine = (i, field, value) =>
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  const addLine    = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const prefill = () => {
    setShipmentDate(today());
    setBolNumber("8256");
    setDriver("John Smith");
    setLinkedOrderId("");
    setLines([
      { lot: "26131-02", brand: "Creekstone", grade: "SL", weight: "1925.6", qty: "24", dateReceived: today() },
      { lot: "26131-03", brand: "Creekstone", grade: "CH", weight: "1863.5", qty: "36", dateReceived: today() },
    ]);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!shipmentDate || lines.every((l) => !l.lot && !l.description)) {
      toast({ title: "Fill in at least one item line", status: "warning", position: "top", duration: 2500, isClosable: true });
      return;
    }
    setSubmitting(true);
    try {
      const receipt = await axiosInstance.post("/noblesse-receipts", {
        shipmentDate, bolNumber, driver,
        linkedOrderId: linkedOrderId || null,
        lines: lines.filter((l) => l.lot || l.description),
      });
      toast({ title: "Shipment logged", status: "success", position: "top", duration: 2500, isClosable: true });
      onReceiptAdded(receipt.data);
      setShipmentDate(today()); setBolNumber(""); setDriver(""); setLinkedOrderId(""); setLines([emptyLine()]); setShowForm(false);
    } catch {
      toast({ title: "Failed to save shipment", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={4}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide">Logged Receipts</Text>
        <Button size="xs" leftIcon={<AddIcon />} colorScheme="orange" variant={showForm ? "solid" : "outline"} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Log Shipment"}
        </Button>
      </Flex>

      {showForm && (
        <Box bg="orange.50" border="1px" borderColor="orange.200" borderRadius="lg" p={4} mb={6}>
          <Flex align="center" justify="space-between" mb={4}>
            <Text fontSize="sm" fontWeight="semibold" color="orange.700">New BOL Entry</Text>
            <Button size="xs" variant="ghost" colorScheme="gray" onClick={prefill}>Prefill test data</Button>
          </Flex>
          <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={3} mb={4}>
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>Shipment Date</Text>
              <Input size="sm" type="date" value={shipmentDate} onChange={(e) => setShipmentDate(e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>BOL #</Text>
              <Input size="sm" placeholder="e.g. 8256" value={bolNumber} onChange={(e) => setBolNumber(e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>Driver / Delivered By</Text>
              <Input size="sm" placeholder="Name" value={driver} onChange={(e) => setDriver(e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
          </Grid>
          <Box mb={4}>
            <Text fontSize="xs" color="gray.500" mb={1}>Link to Pending Order (optional)</Text>
            <Select size="sm" placeholder="— select order —" value={linkedOrderId} onChange={(e) => setLinkedOrderId(e.target.value)} bg="white" borderRadius="md" maxW="360px">
              {pendingOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.sentDate} · {o.itemCount} pallets · {o.totalWeight ? `${parseFloat(o.totalWeight).toFixed(0)} lb` : "—"}
                </option>
              ))}
            </Select>
          </Box>
          <Divider mb={4} />
          <Flex align="center" justify="space-between" mb={3}>
            <Text fontSize="xs" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide">Line Items</Text>
            <Button size="xs" leftIcon={<AddIcon />} variant="ghost" colorScheme="orange" onClick={addLine}>Add Row</Button>
          </Flex>
          {lines.map((line, i) => (
            <Box key={i} bg="white" borderRadius="md" px={3} py={3} mb={2} border="1px" borderColor="orange.100">
              <Grid templateColumns={{ base: "1fr 1fr", md: "repeat(6, 1fr) auto" }} gap={2} alignItems="flex-end">
                <GridItem>
                  <Text fontSize="xs" color="gray.500" mb={1}>Lot #</Text>
                  <Input size="sm" placeholder="26086-01" value={line.lot} onChange={(e) => updateLine(i, "lot", e.target.value)} borderRadius="md" />
                </GridItem>
                <GridItem>
                  <Text fontSize="xs" color="gray.500" mb={1}>Brand</Text>
                  <Input size="sm" placeholder="IBP" value={line.brand} onChange={(e) => updateLine(i, "brand", e.target.value)} borderRadius="md" />
                </GridItem>
                <GridItem>
                  <Text fontSize="xs" color="gray.500" mb={1}>Grade</Text>
                  <Input size="sm" placeholder="CH / SL" value={line.grade} onChange={(e) => updateLine(i, "grade", e.target.value)} borderRadius="md" />
                </GridItem>
                <GridItem>
                  <Text fontSize="xs" color="gray.500" mb={1}>Weight (lb)</Text>
                  <Input size="sm" placeholder="1842" value={line.weight} onChange={(e) => updateLine(i, "weight", e.target.value)} borderRadius="md" />
                </GridItem>
                <GridItem>
                  <Text fontSize="xs" color="gray.500" mb={1}>Qty</Text>
                  <Input size="sm" placeholder="24" value={line.qty} onChange={(e) => updateLine(i, "qty", e.target.value)} borderRadius="md" />
                </GridItem>
                <GridItem>
                  <Text fontSize="xs" color="gray.500" mb={1}>Date Received</Text>
                  <Input size="sm" type="date" value={line.dateReceived} onChange={(e) => updateLine(i, "dateReceived", e.target.value)} borderRadius="md" />
                </GridItem>
                <GridItem>
                  <IconButton icon={<DeleteIcon />} size="sm" variant="ghost" colorScheme="red"
                    aria-label="Remove line" isDisabled={lines.length === 1} onClick={() => removeLine(i)} />
                </GridItem>
              </Grid>
            </Box>
          ))}
          <Button mt={2} colorScheme="orange" size="sm" borderRadius="lg" isLoading={submitting} onClick={handleSubmit}>
            Submit Shipment Log
          </Button>
        </Box>
      )}

      {receipts.length === 0
        ? <Text fontSize="sm" color="gray.400">No shipments logged yet.</Text>
        : (
          <ReceiptsTable receipts={receipts} onStatusChange={onStatusChange} />
        )
      }
    </Box>
  );
};

// ── NTI Inventory Tab ─────────────────────────────────────────────────────────

const emptyNtiItem = () => ({
  lot: "", description: "", brand: "", species: "", est: "",
  packDate: "", weight: "", qtyCases: "", qtyPallets: "", receivedDate: today(), notes: "",
});

const NtiInventoryTab = ({ ntiInventory, afItems, onAdd, onUpdate, onDelete }) => {
  const toast      = useToast();
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(emptyNtiItem());
  const [editId, setEditId]       = useState(null);
  const [editForm, setEditForm]   = useState({});
  const [saving, setSaving]       = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  const setField = (f, v) => setForm((p) => ({ ...p, [f]: v }));
  const setEditField = (f, v) => setEditForm((p) => ({ ...p, [f]: v }));

  const handleAdd = async () => {
    if (!form.lot && !form.description) {
      toast({ title: "Enter at least a lot # or description", status: "warning", position: "top", duration: 2500, isClosable: true });
      return;
    }
    setSaving(true);
    try {
      const res = await axiosInstance.post("/nti-inventory", form);
      onAdd(res.data);
      setForm(emptyNtiItem());
      setShowForm(false);
      toast({ title: "Item added", status: "success", position: "top", duration: 2000, isClosable: true });
    } catch {
      toast({ title: "Failed to add item", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item) => {
    setEditId(item.id);
    setEditForm({
      lot: item.lot || "", description: item.description || "", brand: item.brand || "",
      species: item.species || "", est: item.est || "", packDate: item.packDate || "",
      weight: item.weight != null ? String(item.weight) : "", qtyCases: item.qtyCases != null ? String(item.qtyCases) : "",
      qtyPallets: item.qtyPallets != null ? String(item.qtyPallets) : "",
      receivedDate: item.receivedDate || "", notes: item.notes || "",
    });
  };

  const saveEdit = async (id) => {
    setSaving(true);
    try {
      const res = await axiosInstance.put(`/nti-inventory/${id}`, editForm);
      onUpdate(res.data);
      setEditId(null);
      toast({ title: "Item updated", status: "success", position: "top", duration: 2000, isClosable: true });
    } catch {
      toast({ title: "Failed to update", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axiosInstance.delete(`/nti-inventory/${id}`);
      onDelete(id);
      toast({ title: "Item removed", status: "success", position: "top", duration: 2000, isClosable: true });
    } catch {
      toast({ title: "Failed to delete", status: "error", position: "top", duration: 3000, isClosable: true });
    }
  };

  // ── Discrepancy comparison ──
  // Match NTI inventory items to AF production order items by lot number.
  const buildDiscrepancies = () => {
    const afByLot = {};
    afItems.forEach((item) => {
      const key = (item.lot || "").trim().toLowerCase();
      if (key) afByLot[key] = item;
    });
    const ntiByLot = {};
    ntiInventory.forEach((item) => {
      const key = (item.lot || "").trim().toLowerCase();
      if (key) ntiByLot[key] = item;
    });

    const rows = [];
    // AF items — check if NTI has them
    afItems.forEach((af) => {
      const key = (af.lot || "").trim().toLowerCase();
      if (!key) return;
      const nti = ntiByLot[key];
      const weightDiff = nti && af.weight != null && nti.weight != null
        ? Math.abs(Number(af.weight) - Number(nti.weight)) > 0.5
        : false;
      const descMismatch = nti && af.description && nti.description
        ? af.description.trim().toLowerCase() !== nti.description.trim().toLowerCase()
        : false;
      const brandMismatch = nti && af.brand && nti.brand
        ? af.brand.trim().toLowerCase() !== nti.brand.trim().toLowerCase()
        : false;
      rows.push({
        lot: af.lot,
        afDesc: af.description, ntiDesc: nti?.description,
        afBrand: af.brand, ntiBrand: nti?.brand,
        afWeight: af.weight, ntiWeight: nti?.weight,
        afSentDate: af.sentDate,
        matched: !!nti,
        weightDiff, descMismatch, brandMismatch,
        hasIssue: !nti || weightDiff || descMismatch || brandMismatch,
      });
    });
    // NTI items not in any AF order
    ntiInventory.forEach((nti) => {
      const key = (nti.lot || "").trim().toLowerCase();
      if (!key || afByLot[key]) return;
      rows.push({
        lot: nti.lot,
        afDesc: null, ntiDesc: nti.description,
        afBrand: null, ntiBrand: nti.brand,
        afWeight: null, ntiWeight: nti.weight,
        afSentDate: null,
        matched: false, weightDiff: false, descMismatch: false, brandMismatch: false,
        ntiOnly: true,
        hasIssue: true,
      });
    });
    return rows;
  };

  const discrepancies = showCompare ? buildDiscrepancies() : [];
  const issueCount    = showCompare ? discrepancies.filter((r) => r.hasIssue).length : 0;

  const CellInput = ({ value, onChange, placeholder, type = "text", w = "90px" }) => (
    <Input size="xs" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} type={type} w={w} borderRadius="md" bg="white" />
  );

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={4} flexWrap="wrap" gap={2}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide">
          NTI Inventory
        </Text>
        <Flex gap={2}>
          <Button size="xs" variant="outline" colorScheme={showCompare ? "red" : "purple"}
            onClick={() => setShowCompare((v) => !v)}>
            {showCompare ? "Hide Compare" : "Compare with AF Orders"}
            {!showCompare && afItems.length > 0 && (
              <Badge ml={2} colorScheme="purple" borderRadius="full">{afItems.length}</Badge>
            )}
          </Button>
          <Button size="xs" leftIcon={<AddIcon />} colorScheme="blue" variant={showForm ? "solid" : "outline"}
            onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Add Item"}
          </Button>
        </Flex>
      </Flex>

      {/* Add form */}
      {showForm && (
        <Box bg="blue.50" border="1px" borderColor="blue.200" borderRadius="lg" p={4} mb={6}>
          <Text fontSize="sm" fontWeight="semibold" color="blue.700" mb={4}>New NTI Inventory Item</Text>
          <Grid templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }} gap={3} mb={3}>
            {[
              ["Lot #", "lot", "26086-01"],
              ["Description", "description", "BNLS Beef Brisket"],
              ["Brand", "brand", "IBP"],
              ["Species", "species", "Beef"],
              ["EST #", "est", "9268"],
              ["Pack Date", "packDate", "", "date"],
              ["Received Date", "receivedDate", "", "date"],
              ["Weight (lb)", "weight", "0"],
              ["Qty Cases", "qtyCases", "0"],
              ["Qty Pallets", "qtyPallets", "0"],
            ].map(([label, field, placeholder, type = "text"]) => (
              <GridItem key={field}>
                <Text fontSize="xs" color="gray.500" mb={1}>{label}</Text>
                <Input size="sm" type={type} placeholder={placeholder} value={form[field]}
                  onChange={(e) => setField(field, e.target.value)} bg="white" borderRadius="md" />
              </GridItem>
            ))}
          </Grid>
          <Box mb={3}>
            <Text fontSize="xs" color="gray.500" mb={1}>Notes</Text>
            <Input size="sm" placeholder="Optional notes" value={form.notes}
              onChange={(e) => setField("notes", e.target.value)} bg="white" borderRadius="md" />
          </Box>
          <Button colorScheme="blue" size="sm" borderRadius="lg" isLoading={saving} onClick={handleAdd}>
            Add to NTI Inventory
          </Button>
        </Box>
      )}

      {/* Discrepancy view */}
      {showCompare && (
        <Box mb={6}>
          <Flex align="center" gap={2} mb={3}>
            <Text fontSize="xs" fontWeight="semibold" color="purple.600" textTransform="uppercase" letterSpacing="wide">
              AF Orders vs NTI Inventory
            </Text>
            {issueCount > 0 && <Badge colorScheme="red" borderRadius="full">{issueCount} issue{issueCount !== 1 ? "s" : ""}</Badge>}
            {issueCount === 0 && discrepancies.length > 0 && <Badge colorScheme="green" borderRadius="full">All matched</Badge>}
          </Flex>
          {discrepancies.length === 0
            ? <Text fontSize="sm" color="gray.400" mb={4}>No AF pending order items to compare.</Text>
            : (
              <Box overflowX="auto" mb={4}>
                <Box as="table" width="100%" borderCollapse="collapse">
                  <thead>
                    <tr>
                      <Th bg="purple.50">Lot #</Th>
                      <Th bg="purple.50">AF Description</Th>
                      <Th bg="purple.50">NTI Description</Th>
                      <Th bg="purple.50">AF Brand</Th>
                      <Th bg="purple.50">NTI Brand</Th>
                      <Th bg="purple.50">AF Weight</Th>
                      <Th bg="purple.50">NTI Weight</Th>
                      <Th bg="purple.50">Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {discrepancies.map((row, i) => (
                      <Box as="tr" key={i} bg={row.hasIssue ? "red.50" : (i % 2 === 0 ? "white" : "gray.50")}>
                        <Td fontWeight="medium" color={row.hasIssue ? "red.700" : "gray.700"}>{row.lot || "—"}</Td>
                        <Td color={row.descMismatch ? "red.600" : "gray.700"}>{row.afDesc || "—"}</Td>
                        <Td color={row.descMismatch ? "red.600" : "gray.700"}>{row.ntiDesc || <Text as="span" color="gray.300">not entered</Text>}</Td>
                        <Td color={row.brandMismatch ? "red.600" : "gray.700"}>{row.afBrand || "—"}</Td>
                        <Td color={row.brandMismatch ? "red.600" : "gray.700"}>{row.ntiBrand || <Text as="span" color="gray.300">not entered</Text>}</Td>
                        <Td color={row.weightDiff ? "red.600" : "gray.700"}>{row.afWeight != null ? `${row.afWeight} lb` : "—"}</Td>
                        <Td color={row.weightDiff ? "red.600" : "gray.700"}>{row.ntiWeight != null ? `${row.ntiWeight} lb` : <Text as="span" color="gray.300">not entered</Text>}</Td>
                        <Td>
                          {row.ntiOnly
                            ? <Badge colorScheme="yellow">NTI Only</Badge>
                            : !row.matched
                              ? <Badge colorScheme="red">Missing in NTI</Badge>
                              : row.hasIssue
                                ? <Badge colorScheme="orange">Mismatch</Badge>
                                : <Badge colorScheme="green">Match</Badge>
                          }
                        </Td>
                      </Box>
                    ))}
                  </tbody>
                </Box>
              </Box>
            )
          }
          <Divider />
        </Box>
      )}

      {/* NTI inventory table */}
      {ntiInventory.length === 0
        ? <Text fontSize="sm" color="gray.400">No NTI inventory entered yet.</Text>
        : (
          <Box overflowX="auto">
            <Box as="table" width="100%" borderCollapse="collapse">
              <thead>
                <tr>
                  <Th>Lot #</Th>
                  <Th>Description</Th>
                  <Th>Brand</Th>
                  <Th>Species</Th>
                  <Th>EST #</Th>
                  <Th>Pack Date</Th>
                  <Th>Rcvd Date</Th>
                  <Th>Weight</Th>
                  <Th>Cases</Th>
                  <Th>Pallets</Th>
                  <Th>Notes</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {ntiInventory.map((item, i) => {
                  const isEditing = editId === item.id;
                  return (
                    <Box as="tr" key={item.id} bg={i % 2 === 0 ? "white" : "gray.50"} _hover={{ bg: "blue.50" }}>
                      {isEditing ? (
                        <>
                          <Td><CellInput value={editForm.lot} onChange={(v) => setEditField("lot", v)} placeholder="Lot #" /></Td>
                          <Td><CellInput value={editForm.description} onChange={(v) => setEditField("description", v)} placeholder="Description" w="160px" /></Td>
                          <Td><CellInput value={editForm.brand} onChange={(v) => setEditField("brand", v)} placeholder="Brand" /></Td>
                          <Td><CellInput value={editForm.species} onChange={(v) => setEditField("species", v)} placeholder="Species" /></Td>
                          <Td><CellInput value={editForm.est} onChange={(v) => setEditField("est", v)} placeholder="EST" /></Td>
                          <Td><CellInput value={editForm.packDate} onChange={(v) => setEditField("packDate", v)} type="date" w="120px" /></Td>
                          <Td><CellInput value={editForm.receivedDate} onChange={(v) => setEditField("receivedDate", v)} type="date" w="120px" /></Td>
                          <Td><CellInput value={editForm.weight} onChange={(v) => setEditField("weight", v)} placeholder="lb" w="70px" /></Td>
                          <Td><CellInput value={editForm.qtyCases} onChange={(v) => setEditField("qtyCases", v)} placeholder="0" w="60px" /></Td>
                          <Td><CellInput value={editForm.qtyPallets} onChange={(v) => setEditField("qtyPallets", v)} placeholder="0" w="60px" /></Td>
                          <Td><CellInput value={editForm.notes} onChange={(v) => setEditField("notes", v)} placeholder="Notes" w="120px" /></Td>
                          <Td>
                            <Flex gap={1}>
                              <IconButton icon={<CheckIcon />} size="xs" colorScheme="green" aria-label="Save" isLoading={saving} onClick={() => saveEdit(item.id)} />
                              <IconButton icon={<CloseIcon />} size="xs" variant="ghost" colorScheme="gray" aria-label="Cancel" onClick={() => setEditId(null)} />
                            </Flex>
                          </Td>
                        </>
                      ) : (
                        <>
                          <Td color="blue.600" fontWeight="medium">{item.lot || "—"}</Td>
                          <Td>{item.description || "—"}</Td>
                          <Td>{item.brand || "—"}</Td>
                          <Td>{item.species || "—"}</Td>
                          <Td>{item.est || "—"}</Td>
                          <Td>{fmtDate(item.packDate)}</Td>
                          <Td>{fmtDate(item.receivedDate)}</Td>
                          <Td>{item.weight != null ? `${item.weight} lb` : "—"}</Td>
                          <Td>{item.qtyCases != null ? item.qtyCases : "—"}</Td>
                          <Td>{item.qtyPallets != null ? item.qtyPallets : "—"}</Td>
                          <Td color="gray.400" fontSize="xs">{item.notes || "—"}</Td>
                          <Td>
                            <Flex gap={1}>
                              <IconButton icon={<EditIcon />} size="xs" variant="ghost" colorScheme="blue" aria-label="Edit" onClick={() => startEdit(item)} />
                              <IconButton icon={<DeleteIcon />} size="xs" variant="ghost" colorScheme="red" aria-label="Delete" onClick={() => handleDelete(item.id)} />
                            </Flex>
                          </Td>
                        </>
                      )}
                    </Box>
                  );
                })}
              </tbody>
            </Box>
          </Box>
        )
      }
    </Box>
  );
};

// ── Processing Report Tab ─────────────────────────────────────────────────────

const ProcessingReportTab = ({ receipts }) => {
  const active    = receipts.filter((r) => r.status === "processing");
  const received  = receipts.filter((r) => r.status === "received");
  const completed = receipts.filter((r) => r.status === "completed");

  const SectionHeader = ({ label, count, color }) => (
    <Flex align="center" gap={2} mb={3}>
      <Text fontSize="xs" fontWeight="semibold" color={`${color}.500`} textTransform="uppercase" letterSpacing="wide">{label}</Text>
      <Badge colorScheme={color} borderRadius="full">{count}</Badge>
    </Flex>
  );

  const ReceiptCard = ({ receipt, accentColor }) => (
    <Box border="1px" borderColor={`${accentColor}.200`} borderRadius="lg" mb={4} overflow="hidden">
      <Flex bg={`${accentColor}.50`} px={4} py={3} justify="space-between" align="center">
        <Flex gap={4} align="center">
          <Text fontSize="sm" fontWeight="semibold" color={`${accentColor}.700`}>{fmtDate(receipt.shipmentDate) || "No date"}</Text>
          {receipt.bolNumber && <Text fontSize="xs" color="gray.500">BOL #{receipt.bolNumber}</Text>}
          {receipt.driver    && <Text fontSize="xs" color="gray.500">Driver: {receipt.driver}</Text>}
        </Flex>
        <Text fontSize="xs" color="gray.400">{new Date(receipt.createdAt).toLocaleDateString()}</Text>
      </Flex>
      <Box p={4}>
        {receipt.lines.length === 0
          ? <Text fontSize="xs" color="gray.400">No line items recorded.</Text>
          : (
            <Box overflowX="auto">
              <Box as="table" width="100%" borderCollapse="collapse">
                <thead>
                  <tr>
                    <Th>Brand</Th><Th>Lot #</Th><Th>EST #</Th>
                    <Th>Description</Th><Th>Pack Date</Th><Th>Pallets</Th><Th>Cases</Th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.lines.map((l, j) => (
                    <Box as="tr" key={j} bg={j % 2 === 0 ? "white" : "gray.50"}>
                      <Td>{l.brand || "—"}</Td>
                      <Td fontWeight="medium">{l.lot || "—"}</Td>
                      <Td>{l.est || "—"}</Td>
                      <Td>{l.description || "—"}</Td>
                      <Td>{l.packdate || "—"}</Td>
                      <Td>{l.qtyPallets || "—"}</Td>
                      <Td>{l.qtyCases || "—"}</Td>
                    </Box>
                  ))}
                </tbody>
              </Box>
            </Box>
          )
        }
      </Box>
    </Box>
  );

  return (
    <Box>
      <SectionHeader label="Currently Processing" count={active.length} color="orange" />
      {active.length === 0
        ? <Text fontSize="sm" color="gray.400" mb={6}>No shipments marked as processing.</Text>
        : active.map((r) => <ReceiptCard key={r.id} receipt={r} accentColor="orange" />)
      }
      <Divider my={5} />
      <SectionHeader label="Received — Awaiting Processing" count={received.length} color="blue" />
      {received.length === 0
        ? <Text fontSize="sm" color="gray.400" mb={6}>No shipments pending.</Text>
        : received.map((r) => <ReceiptCard key={r.id} receipt={r} accentColor="blue" />)
      }
      <Divider my={5} />
      <SectionHeader label="Completed" count={completed.length} color="green" />
      {completed.length === 0
        ? <Text fontSize="sm" color="gray.400">No completed shipments.</Text>
        : completed.map((r) => <ReceiptCard key={r.id} receipt={r} accentColor="green" />)
      }
    </Box>
  );
};

// ── Main Screen ───────────────────────────────────────────────────────────────

const NoblesseScreen = () => {
  const navigate = useNavigate();
  const isAdmin  = getRole() === "admin";
  const toast    = useToast();

  const [pendingOrders, setPendingOrders]   = useState([]);
  const [ntiInventory, setNtiInventory]     = useState([]);
  const [receipts, setReceipts]             = useState([]);
  const [afItems, setAfItems]               = useState([]);
  const [loading, setLoading]               = useState(true);
  const [refreshing, setRefreshing]         = useState(false);
  const [lastRefreshed, setLastRefreshed]   = useState(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [ordersRes, ntiInvRes, receiptsRes, afItemsRes] = await Promise.all([
        axiosInstance.get("/production-orders?status=pending"),
        axiosInstance.get("/nti-inventory"),
        axiosInstance.get("/noblesse-receipts"),
        axiosInstance.get("/nti-production-items"),
      ]);
      setPendingOrders(ordersRes.data || []);
      setNtiInventory(ntiInvRes.data || []);
      setReceipts(receiptsRes.data || []);
      setAfItems(afItemsRes.data || []);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(() => fetchData(), REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  const handleReceiptAdded  = (r)  => setReceipts((prev) => [r, ...prev]);
  const handleStatusChange  = async (id, status) => {
    try {
      const res = await axiosInstance.patch(`/noblesse-receipts/${id}/status`, { status });
      setReceipts((prev) => prev.map((r) => r.id === id ? res.data : r));
    } catch {
      toast({ title: "Failed to update status", status: "error", position: "top", duration: 2500, isClosable: true });
    }
  };
  const handleNtiAdd    = (item) => setNtiInventory((prev) => [item, ...prev]);
  const handleNtiUpdate = (item) => setNtiInventory((prev) => prev.map((x) => x.id === item.id ? item : x));
  const handleNtiDelete = (id)   => setNtiInventory((prev) => prev.filter((x) => x.id !== id));

  if (loading) {
    return (
      <Flex h="100vh" align="center" justify="center" bg="gray.50">
        <Spinner size="xl" color="orange.400" />
      </Flex>
    );
  }

  const processingCount = receipts.filter((r) => r.status === "processing").length;

  return (
    <Flex direction="column" minH="100vh" bg="gray.50">
      <Box bg="white" borderBottom="1px" borderColor="gray.200" px={6} py={4}>
        <Flex align="center" justify="space-between">
          <Flex align="center" gap={3}>
            {isAdmin && (
              <Tooltip label="Back to Adams Foods">
                <IconButton icon={<ArrowBackIcon />} size="sm" variant="ghost"
                  colorScheme="gray" aria-label="Back" onClick={() => navigate("/home")} />
              </Tooltip>
            )}
            <Box>
              <Text fontSize="xl" fontWeight="bold" color="gray.800">Noblesse Trading Inc</Text>
              <Text fontSize="sm" color="gray.500">Processor Portal</Text>
            </Box>
          </Flex>
          <Flex align="center" gap={3}>
            {lastRefreshed && (
              <Text fontSize="xs" color="gray.400">
                Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </Text>
            )}
            <Tooltip label="Refresh now">
              <IconButton
                icon={refreshing ? <Spinner size="xs" /> : <RepeatIcon />}
                size="sm" variant="ghost" colorScheme="gray"
                aria-label="Refresh" onClick={() => fetchData(true)} isDisabled={refreshing}
              />
            </Tooltip>
          </Flex>
        </Flex>
      </Box>

      <Box flex={1} p={4}>
        <Tabs colorScheme="orange" variant="soft-rounded" size="sm">
          <TabList mb={4} gap={2} flexWrap="wrap">
            <Tab>
              Pending Orders
              {pendingOrders.length > 0 && <Badge ml={2} colorScheme="orange" borderRadius="full">{pendingOrders.length}</Badge>}
            </Tab>
            <Tab>
              Incoming Records
              {receipts.length > 0 && <Badge ml={2} colorScheme="blue" borderRadius="full">{receipts.length}</Badge>}
            </Tab>
            <Tab>
              Processing Report
              {processingCount > 0 && <Badge ml={2} colorScheme="orange" borderRadius="full">{processingCount}</Badge>}
            </Tab>
            <Tab>
              NTI Inventory
              {ntiInventory.length > 0 && <Badge ml={2} colorScheme="green" borderRadius="full">{ntiInventory.length}</Badge>}
            </Tab>
          </TabList>

          <Box bg="white" borderRadius="lg" boxShadow="sm" border="1px" borderColor="gray.200" p={5}>
            <TabPanels>
              <TabPanel p={0}><PendingOrdersTab orders={pendingOrders} /></TabPanel>
              <TabPanel p={0}>
                <IncomingRecordsTab
                  pendingOrders={pendingOrders} receipts={receipts}
                  onReceiptAdded={handleReceiptAdded} onStatusChange={handleStatusChange}
                />
              </TabPanel>
              <TabPanel p={0}><ProcessingReportTab receipts={receipts} /></TabPanel>
              <TabPanel p={0}>
                <NtiInventoryTab
                  ntiInventory={ntiInventory} afItems={afItems}
                  onAdd={handleNtiAdd} onUpdate={handleNtiUpdate} onDelete={handleNtiDelete}
                />
              </TabPanel>
            </TabPanels>
          </Box>
        </Tabs>
      </Box>
    </Flex>
  );
};

export default NoblesseScreen;
