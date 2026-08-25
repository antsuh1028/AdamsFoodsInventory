import React, { useState } from "react";
import {
  Box, Flex, Text, Button, IconButton, Badge, useToast,
} from "@chakra-ui/react";
import { CheckIcon, CloseIcon, DeleteIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import { fmtDate, today, cellInputStyle, Th, Td } from "./shared";
import FloatingWindow from "../../components/FloatingWindow";

export const ProcessingReportTab = ({ ntiInventory = [], procOrders, onProcOrderAdded, onProcOrderUpdate, onProcOrderDelete, canDelete = false }) => {
  const toast = useToast();
  const [view, setView]                 = useState("pending");
  const [displayMode, setDisplayMode]   = useState("card");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderDate, setOrderDate]       = useState(today());
  const [orderNotes, setOrderNotes]     = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [searchQuery, setSearchQuery]   = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [weightIn, setWeightIn]         = useState("");
  const [casesIn, setCasesIn]           = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const [editingOutputId, setEditingOutputId] = useState(null);
  const [outputWeightDraft, setOutputWeightDraft] = useState("");
  const [outputCasesDraft, setOutputCasesDraft]   = useState("");
  const [savingOutput, setSavingOutput] = useState(false);

  const [deletingOrderId, setDeletingOrderId] = useState(null);
  const [editingMemoId, setEditingMemoId] = useState(null);
  const [memoDraft, setMemoDraft]         = useState("");
  const [savingMemo, setSavingMemo]       = useState(false);

  const [partialOrderId, setPartialOrderId]         = useState(null);
  const [partialActuals, setPartialActuals]         = useState({});
  const [partialOutputWeight, setPartialOutputWeight] = useState("");
  const [partialOutputCases, setPartialOutputCases]   = useState("");
  const [partialSubmitting, setPartialSubmitting]   = useState(false);

  const partialOrder = partialOrderId != null ? procOrders.find((o) => o.id === partialOrderId) : null;

  const openPartial = (order) => {
    const actuals = {};
    order.items.forEach((it) => { actuals[it.id] = String(it.weightIn ?? ""); });
    setPartialActuals(actuals);
    setPartialOutputWeight(order.outputWeight != null ? String(order.outputWeight) : "");
    setPartialOutputCases(order.outputCases   != null ? String(order.outputCases)  : "");
    setPartialOrderId(order.id);
  };

  const submitPartial = async () => {
    if (!partialOrder) return;
    setPartialSubmitting(true);
    try {
      const items = partialOrder.items.map((it) => ({
        id: it.id,
        actualWeightIn: parseFloat(partialActuals[it.id] ?? it.weightIn) || 0,
      }));
      const res = await axiosInstance.patch(`/noblesse-proc-orders/${partialOrder.id}/partial-complete`, {
        items,
        outputWeight: partialOutputWeight !== "" ? partialOutputWeight : null,
        outputCases:  partialOutputCases  !== "" ? partialOutputCases  : null,
      });
      onProcOrderUpdate(res.data.order);
      if (res.data.newOrder) onProcOrderAdded(res.data.newOrder);
      setPartialOrderId(null);
      setPartialOutputWeight(""); setPartialOutputCases("");
      const remainLb = res.data.newOrder
        ? res.data.newOrder.items.reduce((s, it) => s + (parseFloat(it.weightIn) || 0), 0)
        : 0;
      toast({
        title: res.data.newOrder
          ? `Partial complete — ${remainLb} lb kept as new pending order`
          : "Marked as complete",
        status: "success", position: "top", duration: 3000, isClosable: true,
      });
    } catch {
      toast({ title: "Failed to save partial completion", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setPartialSubmitting(false);
    }
  };

  const pending   = procOrders.filter((o) => o.status === "pending");
  const completed = procOrders.filter((o) => o.status === "completed");
  const shown     = view === "pending" ? pending : completed;

  const inStyle = (w) => ({ ...cellInputStyle, width: w });

  // Group shown orders by lot
  const lotGroups = (() => {
    const map = new Map();
    for (const order of shown) {
      const lot = order.items[0]?.lot || "";
      if (!map.has(lot)) map.set(lot, []);
      map.get(lot).push(order);
    }
    return Array.from(map.entries()).map(([lot, orders]) => {
      const totalWeightIn  = orders.reduce((s, o) => s + o.items.reduce((ss, it) => ss + (parseFloat(it.actualWeightIn ?? it.weightIn) || 0), 0), 0);
      const totalCasesIn   = orders.reduce((s, o) => s + o.items.reduce((ss, it) => ss + (parseInt(it.casesIn)  || 0), 0), 0);
      const allComplete    = orders.every((o) => o.status === "completed");
      const hasAllOutput   = orders.every((o) => o.outputWeight != null);
      const totalWeightOut = hasAllOutput ? orders.reduce((s, o) => s + (parseFloat(o.outputWeight) || 0), 0) : null;
      const hasSomeCases   = orders.some((o) => o.outputCases != null);
      const totalCasesOut  = hasSomeCases ? orders.reduce((s, o) => s + (parseInt(o.outputCases) || 0), 0) : null;
      // Yield only shows when NTI inventory for this lot is fully consumed (no remaining weight)
      const ntiItem        = ntiInventory.find((n) => n.lot === lot);
      const hasRemaining   = ntiItem && (parseFloat(ntiItem.weight) || 0) > 0;
      const yieldPct       = allComplete && !hasRemaining && totalWeightOut != null && totalWeightIn > 0
        ? (totalWeightOut / totalWeightIn) * 100 : null;
      const description    = orders[0]?.items[0]?.description || "";
      const brand          = orders[0]?.items[0]?.brand || "";
      return { lot, orders, totalWeightIn, totalCasesIn, totalWeightOut, totalCasesOut, allComplete, yieldPct, description, brand };
    });
  })();

  const availableItems  = ntiInventory;
  const selectedNtiItem = availableItems.find((n) => String(n.id) === String(selectedItemId)) || null;

  const weightNum   = parseFloat(weightIn);
  const maxWeight   = parseFloat(selectedNtiItem?.weight) || 0;
  const selectedItemZeroWeight = selectedNtiItem != null && (selectedNtiItem.weight == null || selectedNtiItem.weight <= 0);
  const weightError = selectedItemZeroWeight
    ? "This item has 0 lb remaining — it is fully committed to another order"
    : weightIn !== "" && (
        isNaN(weightNum) || weightNum <= 0
          ? "Must be greater than 0"
          : selectedNtiItem && selectedNtiItem.weight != null && weightNum > maxWeight
            ? `Only ${maxWeight} lb available`
            : null
      );

  const editingOrder         = editingOutputId != null ? procOrders.find((o) => o.id === editingOutputId) : null;
  const editingOrderWeightIn = editingOrder
    ? editingOrder.items.reduce((s, it) => s + (parseFloat(it.actualWeightIn ?? it.weightIn) || 0), 0)
    : null;

  const outputWeightNum   = parseFloat(outputWeightDraft);
  const outputCasesNum    = parseInt(outputCasesDraft, 10);
  const outputWeightError = outputWeightDraft !== ""
    ? isNaN(outputWeightNum) || outputWeightNum < 0
        ? "Must be 0 or greater"
        : editingOrderWeightIn != null && outputWeightNum > editingOrderWeightIn
            ? `Cannot exceed input (${editingOrderWeightIn} lb)`
            : null
    : null;
  const outputCasesError  = outputCasesDraft  !== "" && (isNaN(outputCasesNum)  || outputCasesNum  < 0);
  const outputHasError    = !!outputWeightError || outputCasesError;

  const cancelOrder = () => {
    setCreatingOrder(false);
    setOrderDate(today()); setOrderNotes(""); setSelectedItemId(""); setSearchQuery(""); setWeightIn(""); setCasesIn("");
  };

  const selectItem = (item) => {
    setSelectedItemId(String(item.id));
    setSearchQuery([item.lot, item.description, item.brand].filter(Boolean).join(" · "));
    setWeightIn(item.weight != null ? String(item.weight) : "");
    setDropdownOpen(false);
  };

  const filteredItems = availableItems
    .filter((n) => {
      const q = searchQuery.toLowerCase();
      return !q || (n.lot || "").toLowerCase().includes(q)
        || (n.description || "").toLowerCase().includes(q)
        || (n.brand || "").toLowerCase().includes(q);
    })
    .sort((a, b) => (a.lot || "").localeCompare(b.lot || ""));

  const submitOrder = async () => {
    if (!selectedNtiItem) return;
    setSubmitting(true);
    try {
      const res = await axiosInstance.post("/noblesse-proc-orders", {
        orderDate, notes: orderNotes,
        items: [{
          ntiItemId:   selectedNtiItem.id,
          lot:         selectedNtiItem.lot,
          description: selectedNtiItem.description,
          brand:       selectedNtiItem.brand,
          species:     selectedNtiItem.species,
          grade:       null,
          receiptId:   null,
          weightIn,
          casesIn:     casesIn || null,
        }],
      });
      toast({ title: "Processing order created", status: "success", position: "top", duration: 2000, isClosable: true });
      onProcOrderAdded(res.data);
      cancelOrder();
    } catch {
      toast({ title: "Failed to create order", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLotStatus = async (group) => {
    const newStatus = group.allComplete ? "pending" : "completed";
    try {
      await Promise.all(
        group.orders.map((order) =>
          axiosInstance.patch(`/noblesse-proc-orders/${order.id}/status`, { status: newStatus })
            .then((res) => onProcOrderUpdate(res.data))
        )
      );
    } catch {
      toast({ title: "Failed to update status", status: "error", position: "top", duration: 3000, isClosable: true });
    }
  };

  const saveOutput = async (order) => {
    setSavingOutput(true);
    try {
      const res = await axiosInstance.patch(`/noblesse-proc-orders/${order.id}/output`, {
        outputWeight: outputWeightDraft || null,
        outputCases:  outputCasesDraft  || null,
      });
      onProcOrderUpdate(res.data);
      setEditingOutputId(null); setOutputWeightDraft(""); setOutputCasesDraft("");
    } catch {
      toast({ title: "Failed to save output", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSavingOutput(false);
    }
  };

  const cancelOutput = () => {
    setEditingOutputId(null); setOutputWeightDraft(""); setOutputCasesDraft("");
  };

  const deleteOrder = async (order) => {
    setDeletingOrderId(order.id);
    try {
      await axiosInstance.delete(`/noblesse-proc-orders/${order.id}`);
      onProcOrderDelete(order.id);
      toast({ title: "Processing order deleted", status: "success", position: "top", duration: 2000, isClosable: true });
    } catch {
      toast({ title: "Failed to delete order", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setDeletingOrderId(null);
    }
  };

  const saveMemo = async (order) => {
    setSavingMemo(true);
    try {
      const res = await axiosInstance.patch(`/noblesse-proc-orders/${order.id}/notes`, { notes: memoDraft });
      onProcOrderUpdate(res.data);
      setEditingMemoId(null);
    } catch {
      toast({ title: "Failed to save memo", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSavingMemo(false);
    }
  };

  const startEditOutput = (order) => {
    setEditingOutputId(order.id);
    setOutputWeightDraft(order.outputWeight != null ? String(order.outputWeight) : "");
    setOutputCasesDraft(order.outputCases   != null ? String(order.outputCases)  : "");
  };

  return (
    <Box>
      {/* Toggles */}
      <Flex align="center" justify="space-between" mb={4} flexWrap="wrap" gap={2}>
        <Flex gap={1} bg="gray.100" borderRadius="md" p="2px">
          {["pending", "completed"].map((v) => {
            const count  = v === "pending" ? pending.length : completed.length;
            const active = view === v;
            return (
              <Button key={v} size="xs" borderRadius="md"
                bg={active ? "white" : "transparent"}
                color={active ? "gray.700" : "gray.400"}
                boxShadow={active ? "sm" : "none"}
                fontWeight={active ? "semibold" : "normal"}
                _hover={{ bg: active ? "white" : "gray.200" }}
                onClick={() => setView(v)}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
                {count > 0 && (
                  <Badge ml={1.5} colorScheme={v === "completed" ? "green" : "gray"} borderRadius="full" fontSize="sm">
                    {count}
                  </Badge>
                )}
              </Button>
            );
          })}
        </Flex>
        <Flex gap={1} bg="gray.100" borderRadius="md" p="2px">
          {[["card", "▦ Card"], ["sheet", "▤ Sheet"]].map(([mode, label]) => (
            <Button key={mode} size="xs" borderRadius="md"
              bg={displayMode === mode ? "white" : "transparent"}
              color={displayMode === mode ? "gray.700" : "gray.400"}
              boxShadow={displayMode === mode ? "sm" : "none"}
              fontWeight={displayMode === mode ? "semibold" : "normal"}
              _hover={{ bg: displayMode === mode ? "white" : "gray.200" }}
              onClick={() => setDisplayMode(mode)}>
              {label}
            </Button>
          ))}
        </Flex>
      </Flex>

      {/* Create order — only in pending view */}
      {view === "pending" && (
        !creatingOrder ? (
          <Box border="2px dashed" borderColor="gray.200" borderRadius="lg" mb={4} px={4} py={3}
            cursor="pointer" _hover={{ borderColor: "blue.200", bg: "blue.50" }}
            onClick={() => setCreatingOrder(true)}>
            <Text fontSize="sm" color="gray.300" fontStyle="italic">+ new processing order</Text>
          </Box>
        ) : (
          <Box border="2px" borderColor="blue.300" borderRadius="lg" mb={4}>
            <Box bg="blue.50" px={4} py={3} borderBottom="2px" borderColor="blue.300" borderTopRadius="lg">
              <Text fontSize="sm" fontWeight="semibold" color="blue.600" textTransform="uppercase" letterSpacing="wide" mb={2}>
                New Processing Order
              </Text>
              <Flex gap={4} align="flex-end" flexWrap="wrap">
                <Box>
                  <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Date</Text>
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)}
                    style={inStyle("140px")} autoFocus />
                </Box>
                <Box>
                  <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Notes</Text>
                  <input placeholder="Optional" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)}
                    style={inStyle("200px")} />
                </Box>
                <Flex gap={1} ml="auto">
                  <IconButton icon={<CheckIcon />} size="xs" colorScheme="blue" aria-label="Save"
                    isLoading={submitting} isDisabled={!selectedNtiItem || !weightIn || !!weightError} onClick={submitOrder} />
                  <IconButton icon={<CloseIcon />} size="xs" variant="ghost" colorScheme="gray"
                    aria-label="Cancel" onClick={cancelOrder} />
                </Flex>
              </Flex>
            </Box>

            <Box px={4} py={3}>
              {availableItems.length === 0 ? (
                <Text fontSize="sm" color="gray.400">No inventory available to process.</Text>
              ) : (
                <Flex gap={4} align="flex-end" flexWrap="wrap">
                  <Box flex={1} minW="200px" position="relative">
                    <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Item</Text>
                    <input
                      value={dropdownOpen
                        ? searchQuery
                        : selectedNtiItem
                          ? [selectedNtiItem.lot, selectedNtiItem.description, selectedNtiItem.brand].filter(Boolean).join(" · ")
                          : searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setSelectedItemId(""); }}
                      onFocus={() => { setSearchQuery(""); setDropdownOpen(true); }}
                      onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                      placeholder="Search by lot, description, brand…"
                      style={{ ...cellInputStyle, width: "100%" }}
                    />
                    {dropdownOpen && (
                      <Box position="absolute" top="100%" left={0} right={0} zIndex={10}
                        bg="white" border="1px solid" borderColor="gray.200"
                        borderRadius="md" boxShadow="md" maxH="220px" overflowY="auto" mt="2px">
                        {filteredItems.length === 0 ? (
                          <Box px={3} py={2}><Text fontSize="sm" color="gray.400">No matches.</Text></Box>
                        ) : filteredItems.map((item) => {
                          const noWeight = item.weight == null || item.weight <= 0;
                          return (
                            <Box key={item.id} px={3} py={2} fontSize="sm" cursor="pointer"
                              bg={String(item.id) === selectedItemId ? "blue.50" : "white"}
                              _hover={{ bg: "blue.50" }}
                              onMouseDown={() => selectItem(item)}>
                              <Flex align="center" gap={2}>
                                <Text fontWeight="medium" color={noWeight ? "gray.400" : "blue.700"}>{item.lot}</Text>
                                {noWeight && <Text fontSize="xs" color="orange.500" fontWeight="semibold">0 lb</Text>}
                              </Flex>
                              <Text color="gray.500" fontSize="xs">
                                {[item.description, item.brand].filter(Boolean).join(" · ")}
                                {!noWeight && <Text as="span" color="gray.400" ml={2}>{item.weight} lb avail.</Text>}
                              </Text>
                            </Box>
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                  <Box>
                    <Text fontSize="sm" color={weightError ? "red.500" : "gray.500"} mb="2px"
                      textTransform="uppercase" letterSpacing="wide">Weight (lb)</Text>
                      {selectedItemZeroWeight ? (
                      <Box mt={2} p={2} py={1} bg="orange.50" border="1px" borderColor="orange.300" borderRadius="md" mb={2}>
                        <Text fontSize="sm" color="orange.700" fontWeight="semibold" >
                          Weight is 0
                        </Text>
                      </Box>
                    ) : weightError && (
                      <Text fontSize="sm" color="red.500" mt="2px">{weightError}</Text>
                    )}
                    <input type="number" value={weightIn} onChange={(e) => setWeightIn(e.target.value)}
                      style={{ ...inStyle("90px"), ...(weightError ? { borderColor: "#E53E3E", outline: "none" } : {}) }}
                      placeholder="0" />
                    
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb="2px" textTransform="uppercase" letterSpacing="wide">Cases</Text>
                    <input type="number" value={casesIn} onChange={(e) => setCasesIn(e.target.value)}
                      style={inStyle("70px")} placeholder="0" />
                  </Box>
                </Flex>
              )}
            </Box>
          </Box>
        )
      )}

      {/* Empty state */}
      {shown.length === 0 && (
        <Text fontSize="md" color="gray.400">
          {view === "pending" ? "No pending processing orders." : "No completed processing orders."}
        </Text>
      )}

      {/* ── Card view ── */}
      {shown.length > 0 && displayMode === "card" && lotGroups.map((group) => {
        const done = group.allComplete;
        return (
          <Box key={group.lot} border="1px" borderColor={done ? "green.200" : "gray.200"}
            borderRadius="lg" mb={4} overflow="hidden">

            {/* Lot group header */}
            <Flex bg={done ? "green.50" : "gray.50"} px={4} py={3}
              justify="space-between" align="center" flexWrap="wrap" gap={2}
              borderBottom="1px" borderColor={done ? "green.100" : "gray.100"}>
              <Box>
                <Text fontSize="md" fontWeight="bold" color={done ? "green.700" : "blue.700"}>
                  {group.lot || "No lot #"}
                </Text>
                {(group.description || group.brand) && (
                  <Text fontSize="sm" color="gray.500">
                    {[group.description, group.brand].filter(Boolean).join(" · ")}
                  </Text>
                )}
                {/* Weight totals — prominent */}
                <Flex align="baseline" gap={3} mt={1} flexWrap="wrap">
                  <Flex align="baseline" gap={1}>
                    <Text fontSize="2xl" fontWeight="bold" lineHeight={1}
                      color={done ? "green.600" : "blue.600"}>
                      {group.totalWeightIn.toFixed(1)}
                    </Text>
                    <Text fontSize="sm" color="gray.400">lb in</Text>
                    {group.totalCasesIn > 0 && (
                      <Text fontSize="sm" color="gray.400">· {group.totalCasesIn} cs</Text>
                    )}
                  </Flex>
                  {group.totalWeightOut != null && (
                    <Flex align="baseline" gap={1}>
                      <Text fontSize="2xl" fontWeight="bold" lineHeight={1} color="gray.600">
                        {group.totalWeightOut.toFixed(1)}
                      </Text>
                      <Text fontSize="sm" color="gray.400">lb out</Text>
                      {group.totalCasesOut != null && (
                        <Text fontSize="sm" color="gray.400">· {group.totalCasesOut} cs</Text>
                      )}
                    </Flex>
                  )}
                </Flex>
              </Box>
              <Flex align="center" gap={2} flexWrap="wrap">
                {group.yieldPct != null && (
                  <Badge colorScheme="green" fontSize="sm" px={2} py={0.5} borderRadius="md">
                    {group.yieldPct.toFixed(1)}% yield
                  </Badge>
                )}
                <Button size="xs"
                  colorScheme={done ? "gray" : "blue"}
                  variant={done ? "outline" : "solid"}
                  onClick={() => toggleLotStatus(group)}>
                  {done ? "Undo Complete" : "Mark Complete"}
                </Button>
              </Flex>
            </Flex>

            {/* Individual orders */}
            {group.orders.map((order, idx) => {
              const orderWeightIn   = order.items.reduce((s, it) => s + (parseFloat(it.actualWeightIn ?? it.weightIn) || 0), 0);
              const plannedWeightIn = order.items.reduce((s, it) => s + (parseFloat(it.weightIn) || 0), 0);
              const orderCasesIn    = order.items.reduce((s, it) => s + (parseInt(it.casesIn)  || 0), 0);
              const isEditingOutput = editingOutputId === order.id;
              const isPartial       = order.items.some((it) => it.actualWeightIn != null);
              const outParts        = [
                order.outputWeight != null ? `${order.outputWeight} lb` : null,
                order.outputCases  != null ? `${order.outputCases} cs`  : null,
              ].filter(Boolean);

              return (
                <Box key={order.id} px={4} py={2}
                  borderBottom={idx < group.orders.length - 1 ? "1px" : "none"}
                  borderColor="gray.100"
                  bg={idx % 2 === 0 ? "white" : "gray.50"}>
                  <Flex align="center" justify="space-between" flexWrap="wrap" gap={2}>
                    <Box>
                      <Flex align="center" gap={2}>
                        <Text fontSize="sm" fontWeight="medium" color="gray.700">
                          {fmtDate(order.orderDate) || "No date"}
                          {group.orders.length > 1 && (
                            <Text as="span" color="gray.400" ml={2} fontWeight="normal">order {idx + 1}</Text>
                          )}
                        </Text>
                        {isPartial && (
                          <Badge colorScheme="orange" variant="subtle" fontSize="sm" px={2} borderRadius="md">
                            Partial
                          </Badge>
                        )}
                      </Flex>
                      <Flex align="baseline" gap={1} flexWrap="wrap">
                        <Text fontSize="xl" fontWeight="bold" lineHeight={1} color="gray.700">
                          {orderWeightIn.toFixed(1)}
                        </Text>
                        <Text fontSize="sm" color="gray.400">lb</Text>
                        {isPartial && (
                          <Text fontSize="xs" color="gray.300">/ {plannedWeightIn.toFixed(1)} planned</Text>
                        )}
                        {orderCasesIn > 0 && (
                          <Text fontSize="sm" color="gray.400">· {orderCasesIn} cs</Text>
                        )}
                      </Flex>
                    </Box>
                    <Flex align="center" gap={1} flexWrap="wrap">
                      <Text fontSize="sm" color="gray.400">Out:</Text>
                      {isEditingOutput ? (
                        <>
                          <Box>
                            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                            <input type="number" value={outputWeightDraft}
                              onChange={(e) => setOutputWeightDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && !outputHasError) saveOutput(order); if (e.key === "Escape") cancelOutput(); }}
                              style={{ ...inStyle("80px"), ...(outputWeightError ? { borderColor: "#E53E3E" } : {}) }}
                              placeholder="weight" autoFocus />
                            {outputWeightError && (
                              <Text fontSize="sm" color="red.500" mt="2px">{outputWeightError}</Text>
                            )}
                          </Box>
                          <Text fontSize="sm" color="gray.400">lb</Text>
                          <input type="number" value={outputCasesDraft}
                            onChange={(e) => setOutputCasesDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !outputHasError) saveOutput(order); if (e.key === "Escape") cancelOutput(); }}
                            style={{ ...inStyle("60px"), ...(outputCasesError ? { borderColor: "#E53E3E" } : {}) }}
                            placeholder="cases" />
                          <Text fontSize="sm" color="gray.400">cs</Text>
                          <IconButton icon={<CheckIcon />} size="xs" colorScheme="blue" aria-label="Save"
                            isLoading={savingOutput} isDisabled={outputHasError} onClick={() => saveOutput(order)} />
                          <IconButton icon={<CloseIcon />} size="xs" variant="ghost" colorScheme="gray"
                            aria-label="Cancel" onClick={cancelOutput} />
                        </>
                      ) : (
                        <>
                          <Text fontSize="sm" cursor="pointer"
                            color={outParts.length > 0 ? "gray.700" : "gray.300"}
                            fontStyle={outParts.length > 0 ? "normal" : "italic"}
                            onClick={() => startEditOutput(order)}>
                            {outParts.length > 0 ? outParts.join(" · ") : "click to enter"}
                          </Text>
                          {order.status === "pending" && !isPartial && (
                            <Button size="xs" variant="outline" colorScheme="orange"
                              ml={2} onClick={() => openPartial(order)}>
                              Partial
                            </Button>
                          )}
                          {canDelete && (
                            <IconButton icon={<DeleteIcon />} size="xs" variant="ghost"
                              colorScheme="red" aria-label="Delete order" ml={1}
                              isLoading={deletingOrderId === order.id}
                              onClick={() => deleteOrder(order)} />
                          )}
                        </>
                      )}
                    </Flex>
                  </Flex>
                  {/* Memo — click to edit */}
                  {editingMemoId === order.id ? (
                    <Flex align="center" gap={1} mt={1}>
                      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                      <input
                        value={memoDraft}
                        onChange={(e) => setMemoDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveMemo(order); if (e.key === "Escape") setEditingMemoId(null); }}
                        placeholder="Add memo..."
                        style={{ ...inStyle("240px"), flex: 1 }}
                        autoFocus
                      />
                      <IconButton icon={<CheckIcon />} size="xs" colorScheme="blue" aria-label="Save memo"
                        isLoading={savingMemo} onClick={() => saveMemo(order)} />
                      <IconButton icon={<CloseIcon />} size="xs" variant="ghost" colorScheme="gray"
                        aria-label="Cancel" onClick={() => setEditingMemoId(null)} />
                    </Flex>
                  ) : (
                    <Text fontSize="sm" mt={1} cursor="pointer"
                      color={order.notes ? "gray.500" : "gray.300"}
                      fontStyle={order.notes ? "normal" : "italic"}
                      onClick={() => { setEditingMemoId(order.id); setMemoDraft(order.notes || ""); }}>
                      {order.notes || "Add memo..."}
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>
        );
      })}

      {/* ── Sheet view ── */}
      {shown.length > 0 && displayMode === "sheet" && (
        <Box overflowX="auto">
          <Box as="table" width="100%" borderCollapse="collapse" fontSize="md">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Lot</Th>
                <Th>Description</Th>
                <Th>Brand</Th>
                <Th>Wt In (lb)</Th>
                <Th>Cases In</Th>
                <Th>Wt Out (lb)</Th>
                <Th>Cases Out</Th>
                <Th>Yield %</Th>
                <Th>Notes</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {lotGroups.map((group) => {
                const done = group.allComplete;
                return (
                  <React.Fragment key={group.lot}>
                    {/* Lot group header row */}
                    <Box as="tr" bg={done ? "green.50" : "blue.50"}>
                      <Td fontWeight="semibold" color="gray.500" fontSize="sm">
                        {group.orders.length > 1 ? `${group.orders.length} orders` : ""}
                      </Td>
                      <Td fontWeight="bold" color={done ? "green.700" : "blue.700"}>
                        {group.lot || "—"}
                      </Td>
                      <Td fontWeight="medium" color="gray.700">{group.description || "—"}</Td>
                      <Td>{group.brand || "—"}</Td>
                      <Td fontWeight="semibold">{group.totalWeightIn > 0 ? group.totalWeightIn.toFixed(1) : "—"}</Td>
                      <Td fontWeight="semibold">{group.totalCasesIn > 0 ? group.totalCasesIn : "—"}</Td>
                      <Td fontWeight="semibold" color={group.totalWeightOut != null ? "gray.700" : "gray.300"}>
                        {group.totalWeightOut != null ? group.totalWeightOut.toFixed(1) : "—"}
                      </Td>
                      <Td fontWeight="semibold" color={group.totalCasesOut != null ? "gray.700" : "gray.300"}>
                        {group.totalCasesOut != null ? group.totalCasesOut : "—"}
                      </Td>
                      <Td>
                        {group.yieldPct != null
                          ? <Badge colorScheme="green" fontSize="sm">{group.yieldPct.toFixed(1)}%</Badge>
                          : <Text as="span" color="gray.300">—</Text>}
                      </Td>
                      <Td />
                      <Td>
                        <Button size="xs"
                          colorScheme={done ? "gray" : "blue"}
                          variant={done ? "outline" : "solid"}
                          onClick={() => toggleLotStatus(group)}>
                          {done ? "Undo" : "Complete"}
                        </Button>
                      </Td>
                    </Box>

                    {/* Individual order rows */}
                    {group.orders.map((order, idx) => {
                      const orderWeightIn   = order.items.reduce((s, it) => s + (parseFloat(it.actualWeightIn ?? it.weightIn) || 0), 0);
                      const orderCasesIn    = order.items.reduce((s, it) => s + (parseInt(it.casesIn)  || 0), 0);
                      const isEditingOutput = editingOutputId === order.id;

                      return (
                        <Box as="tr" key={order.id}
                          bg={idx % 2 === 0 ? "white" : "gray.50"}
                          _hover={{ bg: "blue.50" }}>
                          <Td fontSize="sm" color="gray.500" whiteSpace="nowrap" pl="24px">
                            {fmtDate(order.orderDate) || "—"}
                          </Td>
                          <Td color="gray.300" fontSize="sm">↳</Td>
                          <Td />
                          <Td />
                          <Td fontSize="sm" color="gray.600">{orderWeightIn > 0 ? orderWeightIn.toFixed(1) : "—"}</Td>
                          <Td fontSize="sm" color="gray.600">{orderCasesIn > 0 ? orderCasesIn : "—"}</Td>
                          <Td>
                            {isEditingOutput ? (
                              <input type="number" value={outputWeightDraft}
                                onChange={(e) => setOutputWeightDraft(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && !outputHasError) saveOutput(order); if (e.key === "Escape") cancelOutput(); }}
                                // eslint-disable-next-line jsx-a11y/no-autofocus
                                style={{ ...inStyle("80px"), ...(outputWeightError ? { borderColor: "#E53E3E" } : {}) }} autoFocus />
                            ) : (
                              <Text fontSize="sm" cursor="pointer"
                                color={order.outputWeight != null ? "gray.700" : "gray.300"}
                                fontStyle={order.outputWeight != null ? "normal" : "italic"}
                                onClick={() => startEditOutput(order)}>
                                {order.outputWeight != null ? order.outputWeight : "—"}
                              </Text>
                            )}
                          </Td>
                          <Td>
                            {isEditingOutput ? (
                              <Flex align="center" gap={1}>
                                <input type="number" value={outputCasesDraft}
                                  onChange={(e) => setOutputCasesDraft(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter" && !outputHasError) saveOutput(order); if (e.key === "Escape") cancelOutput(); }}
                                  style={{ ...inStyle("60px"), ...(outputCasesError ? { borderColor: "#E53E3E" } : {}) }} />
                                <IconButton icon={<CheckIcon />} size="xs" colorScheme="blue" aria-label="Save"
                                  isLoading={savingOutput} isDisabled={outputHasError} onClick={() => saveOutput(order)} />
                                <IconButton icon={<CloseIcon />} size="xs" variant="ghost" colorScheme="gray"
                                  aria-label="Cancel" onClick={cancelOutput} />
                              </Flex>
                            ) : (
                              <Text fontSize="sm" cursor="pointer"
                                color={order.outputCases != null ? "gray.700" : "gray.300"}
                                fontStyle={order.outputCases != null ? "normal" : "italic"}
                                onClick={() => startEditOutput(order)}>
                                {order.outputCases != null ? order.outputCases : "—"}
                              </Text>
                            )}
                          </Td>
                          <Td />
                          <Td>
                            {editingMemoId === order.id ? (
                              <Flex align="center" gap={1}>
                                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                                <input
                                  value={memoDraft}
                                  onChange={(e) => setMemoDraft(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") saveMemo(order); if (e.key === "Escape") setEditingMemoId(null); }}
                                  placeholder="Add memo..."
                                  style={{ ...inStyle("180px") }}
                                  autoFocus
                                />
                                <IconButton icon={<CheckIcon />} size="xs" colorScheme="blue" aria-label="Save memo"
                                  isLoading={savingMemo} onClick={() => saveMemo(order)} />
                                <IconButton icon={<CloseIcon />} size="xs" variant="ghost" colorScheme="gray"
                                  aria-label="Cancel" onClick={() => setEditingMemoId(null)} />
                              </Flex>
                            ) : (
                              <Text fontSize="sm" cursor="pointer"
                                color={order.notes ? "gray.500" : "gray.300"}
                                fontStyle={order.notes ? "normal" : "italic"}
                                onClick={() => { setEditingMemoId(order.id); setMemoDraft(order.notes || ""); }}>
                                {order.notes || "Add memo..."}
                              </Text>
                            )}
                          </Td>
                          <Td />
                        </Box>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </Box>
        </Box>
      )}

      {/* ── Partial completion modal ── */}
      {partialOrder && (
        <FloatingWindow
          isOpen={!!partialOrderId}
          onClose={() => setPartialOrderId(null)}
          title="Partial Completion"
          width={620}
          footer={<>
            <Button size="sm" variant="ghost" onClick={() => setPartialOrderId(null)}>Cancel</Button>
            <Button size="sm" colorScheme="orange" isLoading={partialSubmitting} onClick={submitPartial}>
              Confirm — Mark Partial Complete
            </Button>
          </>}
        >
              <Text fontSize="sm" color="gray.500" mb={4}>
                Enter how much was actually processed. Any remainder becomes a new pending order.
              </Text>
              <Box overflowX="auto">
                <Box as="table" width="100%" borderCollapse="collapse">
                  <thead>
                    <tr>
                      <Box as="th" textAlign="left" px={3} py={2} bg="gray.50"
                        borderBottom="2px" borderColor="gray.200"
                        fontSize="sm" fontWeight="semibold" color="gray.500">Item</Box>
                      <Box as="th" textAlign="right" px={3} py={2} bg="gray.50"
                        borderBottom="2px" borderColor="gray.200"
                        fontSize="sm" fontWeight="semibold" color="gray.500" whiteSpace="nowrap">Planned</Box>
                      <Box as="th" textAlign="right" px={3} py={2} bg="gray.50"
                        borderBottom="2px" borderColor="gray.200"
                        fontSize="sm" fontWeight="semibold" color="blue.600" whiteSpace="nowrap">Actual Used</Box>
                      <Box as="th" textAlign="right" px={3} py={2} bg="gray.50"
                        borderBottom="2px" borderColor="gray.200"
                        fontSize="sm" fontWeight="semibold" color="orange.500" whiteSpace="nowrap">Remaining</Box>
                    </tr>
                  </thead>
                  <tbody>
                    {partialOrder.items.map((it) => {
                      const actual    = parseFloat(partialActuals[it.id] ?? it.weightIn) || 0;
                      const planned   = parseFloat(it.weightIn) || 0;
                      const remaining = Math.max(0, planned - actual);
                      return (
                        <Box as="tr" key={it.id}>
                          <Box as="td" px={3} py={3} borderBottom="1px" borderColor="gray.100">
                            <Text fontWeight="medium" color="blue.700" fontSize="sm">{it.lot}</Text>
                            <Text color="gray.500" fontSize="sm">{it.description}</Text>
                          </Box>
                          {/* Planned */}
                          <Box as="td" px={3} py={3} textAlign="right" borderBottom="1px" borderColor="gray.100">
                            <Text fontSize="xl" fontWeight="bold" color="gray.400" lineHeight={1}>
                              {planned.toFixed(1)}
                            </Text>
                            <Text fontSize="xs" color="gray.300">lb</Text>
                          </Box>
                          {/* Actual used input */}
                          <Box as="td" px={3} py={3} textAlign="right" borderBottom="1px" borderColor="gray.100">
                            <Flex justify="flex-end" align="baseline" gap={1}>
                              <input
                                type="number" min={0} max={it.weightIn} step="0.1"
                                value={partialActuals[it.id] ?? ""}
                                onChange={(e) => setPartialActuals((prev) => ({ ...prev, [it.id]: e.target.value }))}
                                style={{ ...inStyle("90px"), textAlign: "right", fontSize: "18px", fontWeight: "bold" }}
                              />
                              <Text fontSize="sm" color="gray.400">lb</Text>
                            </Flex>
                          </Box>
                          {/* Remaining → new pending order */}
                          <Box as="td" px={3} py={3} textAlign="right" borderBottom="1px" borderColor="gray.100">
                            {remaining > 0 ? (
                              <>
                                <Text fontSize="xl" fontWeight="bold" color="orange.500" lineHeight={1}>
                                  {remaining.toFixed(1)}
                                </Text>
                                <Text fontSize="xs" color="orange.300">lb pending</Text>
                              </>
                            ) : (
                              <Text fontSize="sm" color="gray.300">—</Text>
                            )}
                          </Box>
                        </Box>
                      );
                    })}
                  </tbody>
                </Box>
              </Box>
              {/* Output section */}
              <Box mt={5} pt={4} borderTop="1px" borderColor="gray.200">
                <Text fontSize="sm" fontWeight="semibold" color="gray.600" mb={3}>Output from this run</Text>
                <Flex gap={4} align="flex-end" flexWrap="wrap">
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb="3px">Weight Out (lb)</Text>
                    <input
                      type="number" min={0} step="0.1"
                      value={partialOutputWeight}
                      onChange={(e) => setPartialOutputWeight(e.target.value)}
                      placeholder="0"
                      style={inStyle("110px")}
                    />
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb="3px">Cases Out</Text>
                    <input
                      type="number" min={0}
                      value={partialOutputCases}
                      onChange={(e) => setPartialOutputCases(e.target.value)}
                      placeholder="0"
                      style={inStyle("80px")}
                    />
                  </Box>
                  <Text fontSize="sm" color="gray.400" pb="6px">(optional — can be entered later)</Text>
                </Flex>
              </Box>
        </FloatingWindow>
      )}
    </Box>
  );
};
