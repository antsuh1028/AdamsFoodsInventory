import { useState, useEffect, useRef, useCallback } from "react";
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
  Tabs, TabList, Tab, TabPanels, TabPanel,
  Box, Flex, Text, Badge, Button, Checkbox, Input, FormControl, FormLabel,
  Spinner, Divider, Collapse, SimpleGrid, Image, IconButton, useToast,
} from "@chakra-ui/react";
import { AddIcon, MinusIcon, ChevronDownIcon, ChevronRightIcon, RepeatIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";

const PROCESSOR = "Noblesse Trading";
const today = () => new Date().toISOString().split("T")[0];

// Module-level cache: { [query]: { data, ts } }
const invCache = new Map();
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// Stub values applied when user uploads a photo (OCR placeholder)
const OCR_STUB_RETURN = {
  location: "N303",
  lot: "NB-STUB-001",
  species: "Beef",
  description: "Short Ribs Processed",
  grade: "Choice",
  brand: "Adams Foods",
  packdate: today(),
  date_recvd: today(),
};
const OCR_STUB_BOXES = [{ weight: "45" }, { weight: "48" }, { weight: "47" }];

// ── Photo upload placeholder ──────────────────────────────────────────────────
const PhotoUpload = ({ label, onStubApply }) => {
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
  };

  return (
    <Box border="1px dashed" borderColor="gray.300" borderRadius="md" p={3} mb={4}>
      <Flex align="center" gap={3} mb={preview ? 2 : 0}>
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          {preview ? "Change Photo" : "Upload Photo"}
        </Button>
        <Text fontSize="xs" color="gray.400">{label} · OCR coming soon</Text>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />
        {preview && onStubApply && (
          <Button size="sm" colorScheme="orange" variant="outline" onClick={onStubApply}>
            Use Test Values
          </Button>
        )}
      </Flex>
      {preview && (
        <Image src={preview} maxH="120px" objectFit="contain" borderRadius="sm" mt={2} />
      )}
    </Box>
  );
};

// ── Inventory item row (Step 2 selector) ─────────────────────────────────────
const InventoryRow = ({ item, selectedIndices, onToggleBox, onToggleAll }) => {
  const [open, setOpen] = useState(false);
  const boxes = Array.isArray(item.boxes) ? item.boxes : [];
  const allSelected = boxes.length > 0 && selectedIndices.length === boxes.length;
  const someSelected = selectedIndices.length > 0 && !allSelected;
  const selectedWeight = selectedIndices.reduce((s, i) => s + parseFloat(boxes[i]?.weight || 0), 0);

  return (
    <Box border="1px solid" borderColor={someSelected || allSelected ? "blue.200" : "gray.100"} borderRadius="md" mb={2}>
      <Flex
        align="center"
        px={3}
        py={2}
        cursor="pointer"
        _hover={{ bg: "gray.50" }}
        onClick={() => setOpen((v) => !v)}
        gap={2}
      >
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <Checkbox
          isChecked={allSelected}
          isIndeterminate={someSelected}
          onChange={(e) => { e.stopPropagation(); onToggleAll(item._id, boxes); }}
          onClick={(e) => e.stopPropagation()}
          size="sm"
        />
        <Box flex={1}>
          <Text fontWeight="semibold" fontSize="sm">{item.location}</Text>
          <Text fontSize="xs" color="gray.500">
            {[item.species, item.description, item.lot].filter(Boolean).join(" · ")}
          </Text>
        </Box>
        <Box textAlign="right">
          <Text fontSize="sm" fontWeight="medium">{parseFloat(item.weight || 0).toFixed(0)} lb</Text>
          <Text fontSize="xs" color="gray.400">{boxes.length} boxes</Text>
        </Box>
        {selectedIndices.length > 0 && (
          <Badge colorScheme="blue" fontSize="xs">{selectedIndices.length} · {selectedWeight.toFixed(0)} lb</Badge>
        )}
      </Flex>

      <Collapse in={open} animateOpacity>
        <Divider />
        <SimpleGrid columns={4} gap={2} p={3}>
          {boxes.map((box, idx) => (
            <Flex
              key={idx}
              align="center"
              gap={1}
              bg={selectedIndices.includes(idx) ? "blue.50" : "gray.50"}
              borderRadius="sm"
              px={2}
              py={1}
              cursor="pointer"
              onClick={() => onToggleBox(item._id, idx)}
            >
              <Checkbox
                isChecked={selectedIndices.includes(idx)}
                onChange={() => onToggleBox(item._id, idx)}
                size="sm"
                onClick={(e) => e.stopPropagation()}
              />
              <Text fontSize="xs">{parseFloat(box.weight).toFixed(1)} lb</Text>
            </Flex>
          ))}
        </SimpleGrid>
      </Collapse>
    </Box>
  );
};

// ── Return box list editor ────────────────────────────────────────────────────
const BoxEditor = ({ boxes, onChange }) => {
  const add = () => onChange([...boxes, { weight: "" }]);
  const remove = (i) => onChange(boxes.filter((_, idx) => idx !== i));
  const set = (i, val) => onChange(boxes.map((b, idx) => idx === i ? { weight: val } : b));
  const total = boxes.reduce((s, b) => s + (parseFloat(b.weight) || 0), 0);

  return (
    <Box>
      <Flex align="center" justify="space-between" mb={2}>
        <Text fontSize="sm" fontWeight="medium">Boxes ({boxes.length})</Text>
        <Flex align="center" gap={2}>
          {total > 0 && <Text fontSize="xs" color="gray.500">{total.toFixed(1)} lb total</Text>}
          <IconButton icon={<AddIcon />} size="xs" onClick={add} aria-label="add box" />
        </Flex>
      </Flex>
      <SimpleGrid columns={3} gap={2}>
        {boxes.map((b, i) => (
          <Flex key={i} gap={1} align="center">
            <Input
              size="xs"
              type="number"
              placeholder="lb"
              value={b.weight}
              onChange={(e) => set(i, e.target.value)}
            />
            <IconButton icon={<MinusIcon />} size="xs" variant="ghost" onClick={() => remove(i)} aria-label="remove" />
          </Flex>
        ))}
      </SimpleGrid>
    </Box>
  );
};

// ── Return pallet form (Step 3) ───────────────────────────────────────────────
const ReturnForm = ({ orderId, onSubmit, onCancel, submitting }) => {
  const [form, setForm] = useState({ location: "", lot: "", species: "", description: "", grade: "", brand: "", packdate: "", date_recvd: today() });
  const [boxes, setBoxes] = useState([{ weight: "" }]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const applyStub = () => {
    setForm(OCR_STUB_RETURN);
    setBoxes(OCR_STUB_BOXES.map((b) => ({ ...b })));
  };

  const handleSubmit = () => {
    const validBoxes = boxes.filter((b) => b.weight && !isNaN(parseFloat(b.weight)));
    onSubmit(orderId, { ...form, boxes: validBoxes.map((b) => ({ weight: String(b.weight) })) });
  };

  const field = (key, label, type = "text", transform) => (
    <FormControl>
      <FormLabel fontSize="xs" mb={0}>{label}</FormLabel>
      <Input size="sm" type={type} value={form[key]} onChange={(e) => set(key, transform ? transform(e.target.value) : e.target.value)} />
    </FormControl>
  );

  return (
    <Box bg="blue.50" borderRadius="md" p={3} mt={2}>
      <Text fontWeight="semibold" fontSize="sm" mb={3}>Add Return Pallet</Text>
      <PhotoUpload label="Scan return form" onStubApply={applyStub} />
      <SimpleGrid columns={2} gap={2} mb={3}>
        {field("location", "Location *", "text", (v) => v.toUpperCase())}
        {field("lot", "Lot # *")}
        {field("species", "Species")}
        {field("description", "Description")}
        {field("grade", "Grade")}
        {field("brand", "Brand")}
        {field("packdate", "Pack Date", "date")}
        {field("date_recvd", "Date Received", "date")}
      </SimpleGrid>
      <BoxEditor boxes={boxes} onChange={setBoxes} />
      <Flex gap={2} mt={3} justify="flex-end">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" colorScheme="blue" isLoading={submitting} onClick={handleSubmit}>
          Add Pallet
        </Button>
      </Flex>
    </Box>
  );
};

// ── Order row (Orders tab) ────────────────────────────────────────────────────
const OrderRow = ({ order, detail, onToggle, isExpanded, onOpenReturn, activeReturnId, onSubmitReturn, onCancelReturn, returningId, onCloseOrder }) => {
  const isPending = order.status === "pending";

  return (
    <Box border="1px solid" borderColor="gray.100" borderRadius="md" mb={2}>
      <Flex
        align="center"
        px={3}
        py={2}
        cursor="pointer"
        _hover={{ bg: "gray.50" }}
        onClick={() => onToggle(order.id)}
        gap={2}
      >
        {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <Box flex={1}>
          <Text fontWeight="semibold" fontSize="sm">{order.processorName}</Text>
          <Text fontSize="xs" color="gray.500">Sent {order.sentDate}</Text>
        </Box>
        <Badge colorScheme={isPending ? "yellow" : "green"} fontSize="xs">
          {order.status}
        </Badge>
        {order.yield && (
          <Badge  fontSize="xs">Yield {order.yield}%</Badge>
        )}
      </Flex>

      <Collapse in={isExpanded} animateOpacity>
        <Divider />
        <Box px={3} py={2}>
          {!detail && <Spinner size="sm" />}
          {detail && (
            <>
              {detail.items.length > 0 && (
                <Box mb={3}>
                  <Text fontSize="xs" fontWeight="semibold" color="gray.500" mb={1}>SENT</Text>
                  {detail.items.map((item) => (
                    <Flex key={item._id} fontSize="xs" gap={3} py={1} borderBottom="1px solid" borderColor="gray.50">
                      <Text color="gray.600">{item.location}</Text>
                      <Text>{item.species} — {item.description}</Text>
                      <Text ml="auto" fontWeight="medium">{parseFloat(item.weightSent).toFixed(1)} lb · {item.boxesSent.length} boxes</Text>
                    </Flex>
                  ))}
                </Box>
              )}

              {detail.returns.length > 0 && (
                <Box mb={3}>
                  <Text fontSize="xs" fontWeight="semibold" color="gray.500" mb={1}>RETURNED</Text>
                  {detail.returns.map((ret) => (
                    <Flex key={ret.id} fontSize="xs" gap={3} py={1} borderBottom="1px solid" borderColor="gray.50">
                      <Text color="gray.600">{ret.location}</Text>
                      <Text>{ret.species} — {ret.description}</Text>
                      <Text ml="auto" fontWeight="medium">
                        {ret.weight ? `${parseFloat(ret.weight).toFixed(1)} lb` : "—"}
                      </Text>
                    </Flex>
                  ))}
                </Box>
              )}

              {isPending && (
                <>
                  {activeReturnId === order.id ? (
                    <ReturnForm
                      orderId={order.id}
                      onSubmit={onSubmitReturn}
                      onCancel={onCancelReturn}
                      submitting={returningId === order.id}
                    />
                  ) : (
                    <Flex gap={2} mt={2}>
                      <Button size="sm" colorScheme="blue" variant="outline" onClick={() => onOpenReturn(order.id)}>
                        + Return Pallet
                      </Button>
                      {detail.returns.length > 0 && (
                        <Button size="sm" colorScheme="green" onClick={() => onCloseOrder(order.id)}>
                          Close Order
                        </Button>
                      )}
                    </Flex>
                  )}
                </>
              )}
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

// ── Main modal ────────────────────────────────────────────────────────────────
const ProductionOrders = ({ isOpen, onClose }) => {
  const [tabIndex, setTabIndex] = useState(0);
  const toast = useToast();

  // New order state
  const [sentDate, setSentDate] = useState(today());
  const [inventory, setInventory] = useState([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [selected, setSelected] = useState({});
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [invSearch, setInvSearch] = useState("");
  const debounceRef = useRef(null);

  // Orders state
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [orderDetails, setOrderDetails] = useState({});
  const [activeReturnId, setActiveReturnId] = useState(null);
  const [returningId, setReturningId] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    if (tabIndex === 1) fetchOrders();
  }, [isOpen, tabIndex]);

  const searchInventory = useCallback(async (q) => {
    if (!q || q.length < 2) { setInventory([]); return; }
    const key = q.toLowerCase();
    const cached = invCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setInventory(cached.data);
      return;
    }
    setLoadingInv(true);
    try {
      const res = await axiosInstance.get(`/inventorySearch?q=${encodeURIComponent(q)}&type=raw`);
      invCache.set(key, { data: res.data, ts: Date.now() });
      setInventory(res.data);
    } catch {
      toast({ title: "Search failed", status: "error", duration: 3000 });
    } finally {
      setLoadingInv(false);
    }
  }, [toast]);

  const fetchOrders = async () => {
    setLoadingOrders(true);
    try {
      const res = await axiosInstance.get("/production-orders");
      setOrders(res.data);
    } catch {
      toast({ title: "Failed to load orders", status: "error", duration: 3000 });
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadOrderDetail = async (orderId) => {
    try {
      const res = await axiosInstance.get(`/production-orders/${orderId}`);
      setOrderDetails((prev) => ({ ...prev, [orderId]: res.data }));
    } catch {
      toast({ title: "Failed to load order detail", status: "error", duration: 3000 });
    }
  };

  const toggleOrder = (orderId) => {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
    } else {
      setExpandedOrderId(orderId);
      setActiveReturnId(null);
      if (!orderDetails[orderId]) loadOrderDetail(orderId);
    }
  };

  const toggleBox = (invId, boxIdx) => {
    setSelected((prev) => {
      const current = prev[invId] || [];
      const has = current.includes(boxIdx);
      return { ...prev, [invId]: has ? current.filter((i) => i !== boxIdx) : [...current, boxIdx] };
    });
  };

  const toggleAll = (invId, boxes) => {
    setSelected((prev) => {
      const current = prev[invId] || [];
      const allSelected = current.length === boxes.length;
      return { ...prev, [invId]: allSelected ? [] : boxes.map((_, i) => i) };
    });
  };

  const totalWeight = Object.entries(selected).reduce((total, [invId, indices]) => {
    const inv = inventory.find((i) => i._id === invId);
    if (!inv) return total;
    return total + indices.reduce((s, idx) => s + parseFloat(inv.boxes[idx]?.weight || 0), 0);
  }, 0);

  const submitOrder = async () => {
    const items = Object.entries(selected)
      .filter(([, indices]) => indices.length > 0)
      .map(([invId, indices]) => {
        const inv = inventory.find((i) => i._id === invId);
        const boxesSent = indices.map((i) => inv.boxes[i]);
        const weightSent = boxesSent.reduce((s, b) => s + parseFloat(b.weight), 0);
        return { inventoryId: invId, weightSent, boxesSent };
      });

    if (items.length === 0) {
      toast({ title: "Select at least one box", status: "warning", duration: 2000 });
      return;
    }

    setSubmittingOrder(true);
    try {
      await axiosInstance.post("/production-orders", { sentDate, processorName: PROCESSOR, items });
      toast({ title: "Order created", status: "success", duration: 3000 });
      setSelected({});
      setSentDate(today());
      setTabIndex(1);
      fetchOrders();
      invCache.clear();
      setInventory([]);
      setInvSearch("");
    } catch (e) {
      toast({ title: e.response?.data?.error || "Failed to create order", status: "error", duration: 4000 });
    } finally {
      setSubmittingOrder(false);
    }
  };

  const submitReturn = async (orderId, body) => {
    if (!body.location || !body.lot) {
      toast({ title: "Location and Lot are required", status: "warning", duration: 2000 });
      return;
    }
    setReturningId(orderId);
    try {
      await axiosInstance.post(`/production-orders/${orderId}/returns`, body);
      toast({ title: "Return pallet added", status: "success", duration: 3000 });
      setActiveReturnId(null);
      setOrderDetails((prev) => { const n = { ...prev }; delete n[orderId]; return n; });
      loadOrderDetail(orderId);
    } catch (e) {
      toast({ title: e.response?.data?.error || "Failed to add return", status: "error", duration: 4000 });
    } finally {
      setReturningId(null);
    }
  };

  const closeOrder = async (orderId) => {
    try {
      const res = await axiosInstance.patch(`/production-orders/${orderId}/close`, {});
      toast({ title: `Order closed · Yield: ${res.data.yieldPct}%`, status: "success", duration: 4000 });
      setExpandedOrderId(null);
      setOrderDetails((prev) => { const n = { ...prev }; delete n[orderId]; return n; });
      fetchOrders();
    } catch (e) {
      toast({ title: e.response?.data?.error || "Failed to close order", status: "error", duration: 4000 });
    }
  };

  const handleInvSearch = (val) => {
    const upper = val.toUpperCase();
    setInvSearch(upper);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchInventory(upper), 300);
  };

  const filteredInv = inventory;

  const handleClose = () => {
    setSelected({});
    setSentDate(today());
    setExpandedOrderId(null);
    setActiveReturnId(null);
    setInvSearch("");
    setInventory([]);
    clearTimeout(debounceRef.current);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} isCentered size="xl">
      <ModalOverlay bg="blackAlpha.600" />
      <ModalContent maxH="85vh" borderRadius="xl" overflow="hidden">
        <ModalHeader borderBottom="1px" borderColor="gray.100" py={3}>
          <Flex align="center" gap={2}>
            <Text fontSize="md" fontWeight="semibold">Production Orders</Text>
            <Badge colorScheme="orange" fontSize="xs">Noblesse Trading</Badge>
          </Flex>
        </ModalHeader>
        <ModalCloseButton top={3} onClick={handleClose} />

        <ModalBody p={0} overflowY="auto">
          <Tabs index={tabIndex} onChange={setTabIndex} colorScheme="blue">
            <TabList px={4} pt={2} borderBottom="2px" borderColor="gray.100">
              <Tab fontSize="sm" fontWeight="semibold" _selected={{ color: "blue.600", borderColor: "blue.500" }}>
                New Order
              </Tab>
              <Tab fontSize="sm" fontWeight="semibold" _selected={{ color: "blue.600", borderColor: "blue.500" }}>
                Orders
              </Tab>
            </TabList>

            <TabPanels>
              {/* ── Tab 1: New Order (Step 2) ─────────────────────────────── */}
              <TabPanel px={4} pb={4}>
                <PhotoUpload label="Scan production order sheet" />

                <SimpleGrid columns={2} gap={3} mb={4}>
                  <FormControl>
                    <FormLabel fontSize="xs" mb={0}>Sent Date</FormLabel>
                    <Input size="sm" type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="xs" mb={0}>Processor</FormLabel>
                    <Input size="sm" value={PROCESSOR} isReadOnly bg="gray.50" />
                  </FormControl>
                </SimpleGrid>

                <FormControl mb={3}>
                  <FormLabel fontSize="xs" mb={0}>Search Pallets</FormLabel>
                  <Flex gap={2}>
                    <Input
                      size="sm"
                      placeholder="Location, lot, species, description…"
                      value={invSearch}
                      onChange={(e) => handleInvSearch(e.target.value)}
                    />
                    <IconButton
                      icon={<RepeatIcon />}
                      size="sm"
                      variant="outline"
                      aria-label="Refresh"
                      isDisabled={invSearch.length < 2}
                      onClick={() => {
                        invCache.delete(invSearch.toLowerCase());
                        searchInventory(invSearch);
                      }}
                    />
                  </Flex>
                </FormControl>

                {loadingInv ? (
                  <Flex justify="center" py={6}><Spinner /></Flex>
                ) : invSearch.length < 2 ? (
                  <Text fontSize="sm" color="gray.400" textAlign="center" py={6}>
                    Type at least 2 characters to search
                  </Text>
                ) : filteredInv.length === 0 ? (
                  <Text fontSize="sm" color="gray.400" textAlign="center" py={6}>No results</Text>
                ) : (
                  filteredInv.map((item) => (
                    <InventoryRow
                      key={item._id}
                      item={item}
                      selectedIndices={selected[item._id] || []}
                      onToggleBox={toggleBox}
                      onToggleAll={toggleAll}
                    />
                  ))
                )}
              </TabPanel>

              {/* ── Tab 2: Orders ─────────────────────────────────────────── */}
              <TabPanel px={4} pb={4}>
                {loadingOrders ? (
                  <Flex justify="center" py={6}><Spinner /></Flex>
                ) : orders.length === 0 ? (
                  <Text fontSize="sm" color="gray.400" textAlign="center" py={6}>No orders yet</Text>
                ) : (
                  orders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      detail={orderDetails[order.id]}
                      isExpanded={expandedOrderId === order.id}
                      onToggle={toggleOrder}
                      activeReturnId={activeReturnId}
                      onOpenReturn={(id) => { setActiveReturnId(id); }}
                      onSubmitReturn={submitReturn}
                      onCancelReturn={() => setActiveReturnId(null)}
                      returningId={returningId}
                      onCloseOrder={closeOrder}
                    />
                  ))
                )}
              </TabPanel>
            </TabPanels>
          </Tabs>
        </ModalBody>

        {tabIndex === 0 && (
          <ModalFooter borderTop="1px" borderColor="gray.100" py={3}>
            <Flex align="center" gap={4} w="100%">
              <Text fontSize="sm" color="gray.600">
                {Object.values(selected).reduce((s, arr) => s + arr.length, 0)} boxes · {totalWeight.toFixed(1)} lb selected
              </Text>
              <Button
                ml="auto"
                colorScheme="blue"
                size="sm"
                isLoading={submittingOrder}
                onClick={submitOrder}
              >
                Send to Noblesse
              </Button>
            </Flex>
          </ModalFooter>
        )}
      </ModalContent>
    </Modal>
  );
};

export default ProductionOrders;
