import React, { useState } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import { fmtDate, Th, Td } from "./shared";

const decodeLotDate = (lot) => {
  if (!lot || !lot.toUpperCase().startsWith("N")) return null;
  const body = lot.slice(1).split("-")[0];
  if (body.length < 5) return null;
  const year   = 2000 + parseInt(body.slice(0, 2), 10);
  const julian = parseInt(body.slice(2), 10);
  if (isNaN(year) || isNaN(julian)) return null;
  const d = new Date(year, 0, julian);
  return isNaN(d) ? null : d;
};

const fmtLotDate = (lot) => {
  const d = decodeLotDate(lot);
  if (!d) return null;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

const BoxWeights = ({ boxes }) => {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(boxes) || boxes.length === 0)
    return <Text fontSize="xs" color="gray.400">—</Text>;
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
                _hover={{ bg: "gray.100", cursor: "pointer" }} onClick={() => toggle(order)}>
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
                  <Box as="td" colSpan={6} bg="gray.50" px={6} py={3} borderBottom="1px" borderColor="gray.200">
                    {loadingId === order.id ? <Spinner size="xs" />
                      : (itemsMap[order.id] || []).length === 0
                        ? <Text fontSize="xs" color="gray.400">No items found.</Text>
                        : (
                          <Box as="table" width="100%" borderCollapse="collapse">
                            <thead>
                              <tr>
                                <Th bg="gray.100">Lot #</Th>
                                <Th bg="gray.100">Description</Th>
                                <Th bg="gray.100">Brand</Th>
                                <Th bg="gray.100">Species</Th>
                                <Th bg="gray.100">Total Weight</Th>
                                <Th bg="gray.100">Box Weights</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {(itemsMap[order.id] || []).map((item, j) => (
                                <Box as="tr" key={item.id || j} bg={j % 2 === 0 ? "white" : "gray.50"}>
                                  <Td color="blue.700" fontWeight="medium">{item.lot || "—"}</Td>
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

const PendingOrdersTab = ({ ntiInventory }) => {
  const [expandedLot, setExpandedLot] = useState(null);

  const groups = Object.entries(
    ntiInventory.reduce((acc, item) => {
      const key = item.lot || "(no lot)";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {})
  ).sort(([a], [b]) => a.localeCompare(b));

  if (groups.length === 0)
    return <Text fontSize="sm" color="gray.400">No NTI inventory entered yet.</Text>;

  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wide" mb={3}>
        On Hand — by Lot
      </Text>
      <Box as="table" width="100%" borderCollapse="collapse">
        <thead>
          <tr>
            <Th w="16px" />
            <Th>Lot #</Th>
            <Th>Date</Th>
            <Th>Items</Th>
            <Th>Total Weight</Th>
            <Th>Cases</Th>
            <Th>Pallets</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([lot, items], i) => {
            const isExpanded   = expandedLot === lot;
            const totalWeight  = items.reduce((s, x) => s + (parseFloat(x.weight) || 0), 0);
            const totalCases   = items.reduce((s, x) => s + (parseInt(x.qtyCases) || 0), 0);
            const totalPallets = items.reduce((s, x) => s + (parseInt(x.qtyPallets) || 0), 0);
            const lotDate      = fmtLotDate(lot);
            return (
              <React.Fragment key={lot}>
                <Box as="tr" bg={i % 2 === 0 ? "white" : "gray.50"}
                  _hover={{ bg: "gray.100", cursor: "pointer" }}
                  onClick={() => setExpandedLot(isExpanded ? null : lot)}>
                  <Td color="gray.400" fontSize="xs">{isExpanded ? "▾" : "▸"}</Td>
                  <Td fontWeight="semibold" color="blue.700">{lot}</Td>
                  <Td fontSize="xs" color="gray.500">{lotDate || "—"}</Td>
                  <Td>{items.length}</Td>
                  <Td>{totalWeight > 0 ? `${totalWeight.toFixed(1)} lb` : "—"}</Td>
                  <Td>{totalCases > 0 ? totalCases : "—"}</Td>
                  <Td>{totalPallets > 0 ? totalPallets : "—"}</Td>
                </Box>
                {isExpanded && (
                  <Box as="tr">
                    <Box as="td" colSpan={7} bg="gray.50" px={6} py={3} borderBottom="1px" borderColor="gray.200">
                      <Box as="table" width="100%" borderCollapse="collapse">
                        <thead>
                          <tr>
                            <Th bg="gray.100">Description</Th>
                            <Th bg="gray.100">Brand</Th>
                            <Th bg="gray.100">Species</Th>
                            <Th bg="gray.100">Weight</Th>
                            <Th bg="gray.100">Cases</Th>
                            <Th bg="gray.100">Pallets</Th>
                            <Th bg="gray.100">Notes</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, j) => (
                            <Box as="tr" key={item.id || j} bg={j % 2 === 0 ? "white" : "gray.50"}>
                              <Td>{item.description || "—"}</Td>
                              <Td>{item.brand || "—"}</Td>
                              <Td>{item.species || "—"}</Td>
                              <Td>{item.weight != null ? `${item.weight} lb` : "—"}</Td>
                              <Td>{item.qtyCases ?? "—"}</Td>
                              <Td>{item.qtyPallets ?? "—"}</Td>
                              <Td fontSize="xs" color="gray.400">{item.notes || "—"}</Td>
                            </Box>
                          ))}
                        </tbody>
                      </Box>
                    </Box>
                  </Box>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </Box>
    </Box>
  );
};

export { PendingOrdersTab, OrdersTable };
