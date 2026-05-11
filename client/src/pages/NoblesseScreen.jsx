import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Flex, Text, Spinner, Badge, IconButton, Tooltip,
  Tabs, TabList, TabPanels, Tab, TabPanel,
  Button, Input, Select, Grid, GridItem,
  Divider, useToast,
} from "@chakra-ui/react";
import { RepeatIcon, AddIcon, DeleteIcon, ArrowBackIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import getRole from "../utils/getRole";

const REFRESH_INTERVAL_MS = 60 * 1000;

const today = () => new Date().toISOString().slice(0, 10);

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

// ── Incoming Orders Tab ───────────────────────────────────────────────────────

const BoxWeights = ({ boxes }) => {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(boxes) || boxes.length === 0) return <Text fontSize="xs" color="gray.400">—</Text>;
  return (
    <Box>
      <Text
        fontSize="xs" color="blue.500" cursor="pointer" userSelect="none"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        {open ? "▾" : "▸"} {boxes.length} boxes
      </Text>
      {open && (
        <Flex flexWrap="wrap" gap={1} maxW="180px" mt={1}>
          {boxes.map((b, k) => (
            <Box
              key={k} fontSize="xs" color="gray.600"
              bg="gray.100" borderRadius="sm" px={1.5} py={0.5}
              minW="48px" textAlign="center"
            >
              {b.weight} lb
            </Box>
          ))}
        </Flex>
      )}
    </Box>
  );
};

const OrdersTable = ({ orders, accentColor }) => {
  const [expandedId, setExpandedId]   = useState(null);
  const [itemsMap, setItemsMap]       = useState({});
  const [loadingId, setLoadingId]     = useState(null);

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
              <Box
                as="tr"
                bg={i % 2 === 0 ? "white" : "gray.50"}
                _hover={{ bg: "orange.50", cursor: "pointer" }}
                onClick={() => toggle(order)}
              >
                <Td color="gray.400" fontSize="xs">{expandedId === order.id ? "▾" : "▸"}</Td>
                <Td fontWeight="medium">{order.sentDate}</Td>
                <Td fontSize="xs" color="gray.500" maxW="100px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                  {itemsMap[order.id]
                    ? itemsMap[order.id].map((i) => i.description).filter(Boolean).join(", ") || "—"
                    : <Text fontSize="xs" color="gray.300">expand to load</Text>
                  }
                </Td>
                <Td>{order.itemCount}</Td>
                <Td>{order.totalWeight ? `${parseFloat(order.totalWeight).toFixed(0)} lb` : "—"}</Td>
              </Box>

              {expandedId === order.id && (
                <Box as="tr">
                  <Box as="td" colSpan={6} bg="orange.50" px={6} py={3} borderBottom="1px" borderColor="gray.200">
                    {loadingId === order.id
                      ? <Spinner size="xs" />
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
                                  <Td>
                                    <BoxWeights boxes={item.boxesSent} />
                                  </Td>
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

const IncomingTab = ({ orders }) => {
  const todayStr    = today();
  const todayOrders = orders.filter((o) => o.sentDate === todayStr);
  const prevOrders  = orders.filter((o) => o.sentDate <  todayStr);

  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="orange.500" textTransform="uppercase" letterSpacing="wide" mb={2}>
        Today
      </Text>
      {todayOrders.length === 0
        ? <Text fontSize="sm" color="gray.400" mb={4}>No orders sent today.</Text>
        : <OrdersTable orders={todayOrders} accentColor="orange" />
      }

      {prevOrders.length > 0 && (
        <>
          <Divider my={5} />
          <Text fontSize="xs" fontWeight="semibold" color="gray.400" textTransform="uppercase" letterSpacing="wide" mb={2}>
            Previous — Awaiting Processing
          </Text>
          <OrdersTable orders={prevOrders} accentColor="yellow" />
        </>
      )}
    </Box>
  );
};

// ── On-Hand Inventory Tab ─────────────────────────────────────────────────────

const InventoryTab = ({ inventory }) => (
  <Box>
    {inventory.length === 0
      ? <Text fontSize="sm" color="gray.400">No inventory on hand.</Text>
      : (
        <Box overflowX="auto">
          <Box as="table" width="100%" borderCollapse="collapse">
            <thead>
              <tr>
                <Th>Lot #</Th>
                <Th>Description</Th>
                <Th>Species</Th>
                <Th>Brand</Th>
                <Th>Grade</Th>
                <Th>Weight</Th>
                <Th>Boxes</Th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item, i) => (
                <Box as="tr" key={item._id} bg={i % 2 === 0 ? "white" : "gray.50"} _hover={{ bg: "blue.50" }}>
                  <Td color="blue.600" fontWeight="medium">{item.lot || "—"}</Td>
                  <Td>{item.description || "—"}</Td>
                  <Td>{item.species || "—"}</Td>
                  <Td>{item.brand || "—"}</Td>
                  <Td>{item.grade || "—"}</Td>
                  <Td>{item.weight ? `${item.weight} lb` : "—"}</Td>
                  <Td>{item.quantity ? `${item.quantity} bx` : "—"}</Td>
                </Box>
              ))}
            </tbody>
          </Box>
        </Box>
      )
    }
  </Box>
);

// ── Log Shipment (BOL Entry) Tab ──────────────────────────────────────────────

const emptyLine = () => ({
  brand: "", lot: "", est: "", packdate: "", description: "", qtyPallets: "", qtyCases: "",
});

const LogShipmentTab = ({ pendingOrders }) => {
  const toast = useToast();
  const [shipmentDate, setShipmentDate] = useState(today());
  const [bolNumber, setBolNumber]       = useState("");
  const [driver, setDriver]             = useState("");
  const [linkedOrderId, setLinkedOrderId] = useState("");
  const [lines, setLines]               = useState([emptyLine()]);
  const [submitting, setSubmitting]     = useState(false);

  const updateLine = (i, field, value) => {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  };

  const addLine    = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!shipmentDate || lines.every((l) => !l.lot && !l.description)) {
      toast({ title: "Fill in at least one item line", status: "warning", position: "top", duration: 2500, isClosable: true });
      return;
    }
    setSubmitting(true);
    try {
      await axiosInstance.post("/noblesse-receipts", {
        shipmentDate,
        bolNumber,
        driver,
        linkedOrderId: linkedOrderId || null,
        lines: lines.filter((l) => l.lot || l.description),
      });
      toast({ title: "Shipment logged", status: "success", position: "top", duration: 2500, isClosable: true });
      setShipmentDate(today());
      setBolNumber("");
      setDriver("");
      setLinkedOrderId("");
      setLines([emptyLine()]);
    } catch {
      toast({ title: "Failed to save — endpoint not yet connected", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box>
      {/* Header fields */}
      <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={3} mb={5}>
        <GridItem>
          <Text fontSize="xs" color="gray.500" mb={1}>Shipment Date</Text>
          <Input size="sm" type="date" value={shipmentDate} onChange={(e) => setShipmentDate(e.target.value)} borderRadius="md" />
        </GridItem>
        <GridItem>
          <Text fontSize="xs" color="gray.500" mb={1}>BOL #</Text>
          <Input size="sm" placeholder="e.g. 8256" value={bolNumber} onChange={(e) => setBolNumber(e.target.value)} borderRadius="md" />
        </GridItem>
        <GridItem>
          <Text fontSize="xs" color="gray.500" mb={1}>Driver / Delivered By</Text>
          <Input size="sm" placeholder="Name" value={driver} onChange={(e) => setDriver(e.target.value)} borderRadius="md" />
        </GridItem>
      </Grid>

      <Box mb={5}>
        <Text fontSize="xs" color="gray.500" mb={1}>Link to Pending Order (optional)</Text>
        <Select size="sm" placeholder="— select order —" value={linkedOrderId} onChange={(e) => setLinkedOrderId(e.target.value)} borderRadius="md" maxW="360px">
          {pendingOrders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.sentDate} · {o.itemCount} pallets · {o.totalWeight ? `${parseFloat(o.totalWeight).toFixed(0)} lb` : "—"}
            </option>
          ))}
        </Select>
      </Box>

      <Divider mb={4} />

      {/* Line items */}
      <Flex align="center" justify="space-between" mb={3}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide">
          Line Items
        </Text>
        <Button size="xs" leftIcon={<AddIcon />} variant="ghost" colorScheme="orange" onClick={addLine}>
          Add Row
        </Button>
      </Flex>

      {lines.map((line, i) => (
        <Box key={i} bg="gray.50" borderRadius="md" px={3} py={3} mb={3} border="1px" borderColor="gray.100">
          <Grid templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }} gap={2} mb={2}>
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>Brand</Text>
              <Input size="sm" placeholder="IBP" value={line.brand} onChange={(e) => updateLine(i, "brand", e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>Lot #</Text>
              <Input size="sm" placeholder="26086-01" value={line.lot} onChange={(e) => updateLine(i, "lot", e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>EST #</Text>
              <Input size="sm" placeholder="9268" value={line.est} onChange={(e) => updateLine(i, "est", e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>Pack Date</Text>
              <Input size="sm" type="date" value={line.packdate} onChange={(e) => updateLine(i, "packdate", e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
          </Grid>
          <Grid templateColumns={{ base: "1fr", md: "2fr 1fr 1fr auto" }} gap={2} alignItems="flex-end">
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>Description</Text>
              <Input size="sm" placeholder="BNLS Beef Brisket CH Any" value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>Qty (Pallets)</Text>
              <Input size="sm" placeholder="3" value={line.qtyPallets} onChange={(e) => updateLine(i, "qtyPallets", e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
            <GridItem>
              <Text fontSize="xs" color="gray.500" mb={1}>Qty (Cases)</Text>
              <Input size="sm" placeholder="75" value={line.qtyCases} onChange={(e) => updateLine(i, "qtyCases", e.target.value)} bg="white" borderRadius="md" />
            </GridItem>
            <GridItem>
              <IconButton
                icon={<DeleteIcon />} size="sm" variant="ghost" colorScheme="red"
                aria-label="Remove line" isDisabled={lines.length === 1}
                onClick={() => removeLine(i)}
              />
            </GridItem>
          </Grid>
        </Box>
      ))}

      <Button
        mt={2} colorScheme="orange" size="sm" borderRadius="lg"
        isLoading={submitting} onClick={handleSubmit}
      >
        Submit Shipment Log
      </Button>
    </Box>
  );
};

// ── Main Screen ───────────────────────────────────────────────────────────────

const NoblesseScreen = () => {
  const navigate = useNavigate();
  const isAdmin = getRole() === "admin";
  const [pendingOrders, setPendingOrders]     = useState([]);
  const [currentInventory, setCurrentInventory] = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [refreshing, setRefreshing]           = useState(false);
  const [lastRefreshed, setLastRefreshed]     = useState(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [ordersRes, invRes] = await Promise.all([
        axiosInstance.get("/production-orders?status=pending"),
        axiosInstance.post("/inventoryFind", { inputs: { location: "NOBLESSE TRADING" } }),
      ]);
      setPendingOrders(ordersRes.data || []);
      setCurrentInventory(invRes.data !== "INVALID" ? invRes.data : []);
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

  if (loading) {
    return (
      <Flex h="100vh" align="center" justify="center" bg="gray.50">
        <Spinner size="xl" color="orange.400" />
      </Flex>
    );
  }

  return (
    <Flex direction="column" minH="100vh" bg="gray.50">
      {/* Header */}
      <Box bg="white" borderBottom="1px" borderColor="gray.200" px={6} py={4}>
        <Flex align="center" justify="space-between">
          <Flex align="center" gap={3}>
            {isAdmin && (
              <Tooltip label="Back to Adams Foods">
                <IconButton
                  icon={<ArrowBackIcon />} size="sm" variant="ghost"
                  colorScheme="gray" aria-label="Back" onClick={() => navigate("/home")}
                />
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

      {/* Tabs */}
      <Box flex={1} p={4}>
        <Tabs colorScheme="orange" variant="soft-rounded" size="sm">
          <TabList mb={4} gap={2}>
            <Tab>
              Pending Orders
              {pendingOrders.length > 0 && (
                <Badge ml={2} colorScheme="orange" borderRadius="full">{pendingOrders.length}</Badge>
              )}
            </Tab>
            <Tab>
              On-Hand
              {currentInventory.length > 0 && (
                <Badge ml={2} colorScheme="blue" borderRadius="full">{currentInventory.length}</Badge>
              )}
            </Tab>
            <Tab>Log Shipment</Tab>
          </TabList>

          <Box bg="white" borderRadius="lg" boxShadow="sm" border="1px" borderColor="gray.200" p={5}>
            <TabPanels>
              <TabPanel p={0}>
                <IncomingTab orders={pendingOrders} />
              </TabPanel>
              <TabPanel p={0}>
                <InventoryTab inventory={currentInventory} />
              </TabPanel>
              <TabPanel p={0}>
                <LogShipmentTab pendingOrders={pendingOrders} />
              </TabPanel>
            </TabPanels>
          </Box>
        </Tabs>
      </Box>
    </Flex>
  );
};

export default NoblesseScreen;
