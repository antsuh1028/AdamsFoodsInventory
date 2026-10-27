import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, AlertIcon, Badge, Box, Button, Flex, Input, Select, SimpleGrid, Spinner, Stack, Table, Tbody, Td, Text, Th, Thead, Tr,
} from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";
import useBarcodeKeys from "../boxScan/useBarcodeKeys";
import { primeAudio, beepSuccess, beepError } from "../../utils/scanFeedback";
import { sumWeights, toDisplay } from "../../utils/weight";
import upperInput from "../../utils/upperInput";
import ITEM_CODES from "../../utils/itemCodes";
import printOutgoingTag from "../../noblesse/outgoing/printOutgoingTag";
import { fmtDateOnly } from "../../noblesse/common/shared";

// Adams Foods lot registration: register a lot, add its items, then scan its boxes. Kept apart from inventory.

const EMPTY = { lotNumber: "", vendor: "", description: "", pricePerLb: "" };
const NO_ITEM = { description: "", pricePerLb: "" };

const dollars = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const errText = (err) => err.response?.data?.error || err.message || "Something went wrong.";

const LotList = ({ onOpen }) => {
  const [lots, setLots] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/af-lots");
      setLots(data || []);
    } catch (err) {
      setProblem(errText(err));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = form.lotNumber.trim() && form.description.trim();

  const register = async () => {
    setBusy(true);
    try {
      const { data } = await axiosInstance.post("/af-lots", form);
      setForm(EMPTY);
      setProblem(null);
      onOpen(data);
    } catch (err) {
      setProblem(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, upper = true, w) => (
    <Box>
      <Text fontSize="xs" color="gray.500" mb={1}>{label}</Text>
      <Input size="sm" bg="white" w={w} value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: upper ? upperInput(e) : e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter" && ready) register(); }} />
    </Box>
  );

  return (
    <Stack spacing={4}>
      <Box p={3} border="1px solid" borderColor="teal.200" borderRadius="md" bg="teal.50">
        <Text fontSize="sm" fontWeight="600" mb={2}>Register a lot</Text>
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          {field("lotNumber", "Lot #")}
          {field("vendor", "Vendor")}
          {field("description", "First item")}
          {field("pricePerLb", "Price / lb", false)}
        </SimpleGrid>
        <Button mt={3} size="sm" colorScheme="teal" onClick={register} isLoading={busy} isDisabled={!ready}>
          Register and scan
        </Button>
      </Box>

      {problem && <Alert status="error" borderRadius="md" py={2}><AlertIcon />{problem}</Alert>}

      {!lots ? <Spinner size="sm" /> : (
        <Box overflowX="auto">
          <Table size="sm" minW="640px">
            <Thead><Tr>
              <Th>Lot #</Th><Th>Vendor</Th><Th>Items</Th>
              <Th isNumeric>Pallets</Th><Th isNumeric>Boxes</Th><Th isNumeric>Lb</Th><Th isNumeric>Value</Th>
            </Tr></Thead>
            <Tbody>
              {lots.length === 0 && (
                <Tr><Td colSpan={7}><Text fontSize="sm" color="gray.500">No lots registered yet.</Text></Td></Tr>
              )}
              {lots.map((l) => (
                <Tr key={l.id} cursor="pointer" _hover={{ bg: "gray.50" }} onClick={() => onOpen(l)}>
                  <Td fontWeight="600">{l.lotNumber}</Td>
                  <Td>{l.vendor}</Td>
                  <Td>{l.items}</Td>
                  <Td isNumeric>{l.pallets}</Td>
                  <Td isNumeric>{l.boxCount}</Td>
                  <Td isNumeric>{toDisplay(l.totalLb || "0")}</Td>
                  <Td isNumeric>{l.value ? dollars(Number(l.value)) : ""}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}
    </Stack>
  );
};

const LotScan = ({ lot: start, active, onBack }) => {
  const [lot, setLot] = useState(start);
  const [items, setItems] = useState([]);
  const [boxes, setBoxes] = useState(null);
  const [problem, setProblem] = useState(null);
  const [pending, setPending] = useState(0);
  const chain = useRef(Promise.resolve());

  // The pallet new scans go onto; a ref so a scan uses the pallet selected when it was read.
  const [pallet, setPallet] = useState(1);
  const palletRef = useRef(1);
  const pickPallet = (n) => { palletRef.current = n; setPallet(n); };

  // The item new scans go onto, kept the same way.
  const [item, setItem] = useState(null);
  const itemRef = useRef(null);
  const pickItem = (id) => { itemRef.current = id; setItem(id); };

  // The add / edit item form; null while closed.
  const [itemForm, setItemForm] = useState(null);

  useEffect(() => {
    axiosInstance.get(`/af-lots/${start.id}`)
      .then(({ data }) => {
        setLot(data);
        setItems(data.items || []);
        setBoxes(data.boxes || []);
        pickPallet(Math.max(1, ...(data.boxes || []).map((b) => b.palletNo || 1)));
        const last = (data.boxes || []).filter((b) => b.itemId).pop();
        pickItem(last ? last.itemId : data.items?.[0]?.id ?? null);
        if (!data.items?.length) setItemForm({ ...NO_ITEM });
      })
      .catch((err) => setProblem(errText(err)));
  }, [start.id]);

  // One request at a time, in the order the boxes were scanned.
  const send = useCallback((raw) => {
    const itemId = itemRef.current;
    if (!itemId) {
      beepError();
      setProblem("Add an item before scanning.");
      return;
    }
    setPending((n) => n + 1);
    const palletNo = palletRef.current;
    chain.current = chain.current.then(async () => {
      try {
        const { data } = await axiosInstance.post(`/af-lots/${start.id}/boxes`, { rawBarcode: raw, palletNo, itemId });
        setBoxes((list) => [...(list || []), data]);
        setProblem(null);
        beepSuccess();
      } catch (err) {
        beepError();
        setProblem(errText(err));
      } finally {
        setPending((n) => n - 1);
      }
    });
  }, [start.id]);

  useBarcodeKeys(active, (result) => {
    if (result.type === "scan") send(result.raw);
    else { beepError(); setProblem(`Not read: ${result.reason || result.code}`); }
  });

  const saveItem = async () => {
    try {
      const body = { description: itemForm.description, pricePerLb: itemForm.pricePerLb };
      if (itemForm.id) {
        const { data } = await axiosInstance.patch(`/af-lots/${start.id}/items/${itemForm.id}`, body);
        setItems((list) => list.map((i) => (i.id === data.id ? data : i)));
      } else {
        const { data } = await axiosInstance.post(`/af-lots/${start.id}/items`, body);
        setItems((list) => [...list, data]);
        pickItem(data.id);
      }
      setItemForm(null);
      setProblem(null);
      // Hands the keyboard back to the scanner.
      if (document.activeElement) document.activeElement.blur();
    } catch (err) {
      setProblem(errText(err));
    }
  };

  const remove = async (box) => {
    try {
      await axiosInstance.delete(`/af-lots/${start.id}/boxes/${box.id}`);
      setBoxes((list) => list.filter((b) => b.id !== box.id));
    } catch (err) {
      setProblem(errText(err));
    }
  };

  // Moves a box to another pallet or item.
  const move = async (box, change) => {
    try {
      const { data } = await axiosInstance.patch(`/af-lots/${start.id}/boxes/${box.id}`, change);
      setBoxes((list) => list.map((b) => (b.id === box.id ? data : b)));
    } catch (err) {
      setProblem(errText(err));
    }
  };

  const lbOf = (list) => (list.length ? toDisplay(sumWeights(list.map((b) => b.weight))) : "0.00");
  const all = boxes || [];
  const total = lbOf(all);

  // Every pallet with boxes, plus the selected one even while it is still empty.
  const palletNos = [...new Set([...all.map((b) => b.palletNo || 1), pallet])].sort((a, b) => a - b);
  const onPallet = (n) => all.filter((b) => (b.palletNo || 1) === n);
  const ofItem = (list, id) => list.filter((b) => b.itemId === id);
  // Pallet by pallet, newest scan first within each.
  const rows = palletNos.flatMap((n) => [...onPallet(n)].reverse());

  const itemName = (id) => items.find((i) => i.id === id)?.description || "No item";
  // Dollar value of the given boxes, item by item.
  const valueOf = (list) => items.reduce((sum, i) => {
    const mine = ofItem(list, i.id);
    return i.pricePerLb && mine.length ? sum + Number(sumWeights(mine.map((b) => b.weight))) * Number(i.pricePerLb) : sum;
  }, 0);
  const value = valueOf(all);

  // The outgoing pallet tag for one pallet, boxes grouped by item.
  const printTag = (n) => {
    const list = onPallet(n);
    const filled = palletNos.filter((p) => onPallet(p).length > 0);
    const order = items.map((i) => i.id);
    const sorted = [...list].sort((a, b) => order.indexOf(a.itemId) - order.indexOf(b.itemId));
    const here = [...new Set(sorted.map((b) => b.itemId))];
    const ok = printOutgoingTag({
      company: "Adams Foods",
      lotNumber: lot.lotNumber,
      date: fmtDateOnly(list[0]?.scannedAt || lot.createdAt),
      itemDescription: [lot.vendor, here.map(itemName).join(", ")].filter(Boolean).join(" "),
      boxes: sorted.map((b) => ({ weight: b.weight })),
      weighedBy: [...new Set(list.map((b) => b.scannedBy).filter(Boolean))].join(", "),
      palletNo: `${n} of ${filled.length}`,
      memo: here.length > 1
        ? here.map((id) => `${itemName(id)} ${ofItem(list, id).length} BX ${lbOf(ofItem(list, id))} LB`).join("; ")
        : "",
    });
    if (!ok) setProblem("Allow pop-ups to print the tag.");
  };

  const quiet = { tabIndex: -1, onMouseDown: (e) => e.preventDefault() };

  return (
    <Stack spacing={3} onClick={() => primeAudio()}>
      <Flex justify="space-between" align="flex-start" wrap="wrap" gap={3}
        p={3} bg="blue.50" border="1px solid" borderColor="blue.200" borderRadius="md">
        <Box minW={0}>
          <Text fontSize="lg" fontWeight="700">{lot.lotNumber}</Text>
          <Text fontSize="sm" color="gray.600">
            {[lot.vendor, `${items.length} item${items.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
          </Text>
        </Box>
        <Box textAlign="right" style={{ fontVariantNumeric: "tabular-nums" }}>
          <Text fontSize="3xl" fontWeight="800" lineHeight="1">{boxes ? boxes.length : "…"}</Text>
          <Text fontSize="xs" color="gray.600">boxes · {total} lb{value ? ` · ${dollars(value)}` : ""}</Text>
          {pending > 0 && <Badge colorScheme="yellow" mt={1}>saving {pending}</Badge>}
        </Box>
      </Flex>

      {/* Items of this lot; new scans go onto the selected one. */}
      <Flex gap={2} wrap="wrap" align="center">
        {items.map((i) => (
          <Button key={i.id} size="sm" {...quiet}
            colorScheme={i.id === item ? "teal" : "gray"} variant={i.id === item ? "solid" : "outline"}
            onClick={() => pickItem(i.id)} style={{ fontVariantNumeric: "tabular-nums" }}>
            {i.description}{i.pricePerLb ? ` $${Number(i.pricePerLb).toFixed(2)}` : ""} · {ofItem(all, i.id).length} · {lbOf(ofItem(all, i.id))} lb
          </Button>
        ))}
        <Button size="sm" variant="ghost" colorScheme="teal" {...quiet} onClick={() => setItemForm({ ...NO_ITEM })}>
          + Add item
        </Button>
        {item && (
          <Button size="sm" variant="ghost" {...quiet}
            onClick={() => { const i = items.find((x) => x.id === item); setItemForm({ id: i.id, description: i.description, pricePerLb: i.pricePerLb || "" }); }}>
            Edit item
          </Button>
        )}
      </Flex>

      {itemForm && (
        <Flex gap={2} wrap="wrap" align="flex-end" p={3} bg="teal.50" border="1px solid" borderColor="teal.200" borderRadius="md">
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>{itemForm.id ? "Item" : "New item"}</Text>
            <Input size="sm" bg="white" autoFocus value={itemForm.description}
              onChange={(e) => setItemForm({ ...itemForm, description: upperInput(e) })}
              onKeyDown={(e) => { if (e.key === "Enter" && itemForm.description.trim()) saveItem(); }} />
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>Price / lb</Text>
            <Input size="sm" bg="white" w="110px" value={itemForm.pricePerLb}
              onChange={(e) => setItemForm({ ...itemForm, pricePerLb: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && itemForm.description.trim()) saveItem(); }} />
          </Box>
          <Button size="sm" colorScheme="teal" onClick={saveItem} isDisabled={!itemForm.description.trim()}>
            {itemForm.id ? "Save" : "Add"}
          </Button>
          {items.length > 0 && <Button size="sm" variant="ghost" onClick={() => setItemForm(null)}>Cancel</Button>}
        </Flex>
      )}

      {/* Pallets of this lot; new scans go onto the selected one. */}
      <Flex gap={2} wrap="wrap" align="center">
        {palletNos.map((n) => (
          <Button key={n} size="sm" {...quiet}
            colorScheme={n === pallet ? "blue" : "gray"} variant={n === pallet ? "solid" : "outline"}
            onClick={() => pickPallet(n)} style={{ fontVariantNumeric: "tabular-nums" }}>
            Pallet {n} · {onPallet(n).length} · {lbOf(onPallet(n))} lb
          </Button>
        ))}
        <Button size="sm" variant="ghost" colorScheme="teal" {...quiet}
          onClick={() => pickPallet(Math.max(...palletNos) + 1)}
          isDisabled={onPallet(Math.max(...palletNos)).length === 0}>
          + New pallet
        </Button>
        <Button size="sm" ml="auto" variant="outline" {...quiet}
          onClick={() => printTag(pallet)} isDisabled={pending > 0 || onPallet(pallet).length === 0}>
          Print Pallet {pallet} tag
        </Button>
      </Flex>

      {problem
        ? <Alert status="error" borderRadius="md" py={2}><AlertIcon />{problem}</Alert>
        : <Text fontSize="sm" color="gray.500">
            Click an empty spot, then scan each box label. Boxes go onto {item ? itemName(item) : "the selected item"}, Pallet {pallet}, and are saved as they are scanned.
          </Text>}

      {!boxes ? <Spinner size="sm" /> : (
        <Box overflowX="auto" maxH="380px" overflowY="auto">
          <Table size="sm" minW="940px">
            <Thead position="sticky" top={0} bg="white" zIndex={1}><Tr>
              <Th>Pallet</Th><Th>Item</Th><Th isNumeric>Lb</Th><Th>Pack date</Th><Th>Item code</Th><Th>Label lot</Th>
              <Th>GTIN / serial</Th><Th>Scanned</Th><Th />
            </Tr></Thead>
            <Tbody>
              {rows.map((b) => (
                <Tr key={b.id} style={{ fontVariantNumeric: "tabular-nums" }}>
                  <Td>
                    {/* Moves a box placed on the wrong pallet; blurs so scans are not swallowed. */}
                    <Select size="xs" w="64px" value={b.palletNo || 1} tabIndex={-1}
                      onChange={(e) => { e.target.blur(); move(b, { palletNo: Number(e.target.value) }); }}>
                      {palletNos.map((n) => <option key={n} value={n}>{n}</option>)}
                    </Select>
                  </Td>
                  <Td>
                    {/* Moves a box onto the right item; blurs the same way. */}
                    <Select size="xs" w="140px" value={b.itemId || ""} tabIndex={-1}
                      onChange={(e) => { e.target.blur(); if (e.target.value) move(b, { itemId: Number(e.target.value) }); }}>
                      {!b.itemId && <option value="">No item</option>}
                      {items.map((i) => <option key={i.id} value={i.id}>{i.description}</option>)}
                    </Select>
                  </Td>
                  <Td isNumeric fontWeight="600">
                    {b.weight}
                    {b.scannedUnit === "KG" && <Text as="span" fontSize="xs" color="gray.500"> ({b.scannedWeight} kg)</Text>}
                  </Td>
                  <Td>{b.packDate || ""}</Td>
                  <Td>
                    {b.itemCode || b.customerPart || ""}
                    {ITEM_CODES[b.itemCode] && (
                      <Text fontSize="xs" color="gray.500" noOfLines={1}>{ITEM_CODES[b.itemCode].description}</Text>
                    )}
                  </Td>
                  <Td>{b.labelLot || ""}</Td>
                  <Td fontSize="xs">{[b.gtin, b.serial].filter(Boolean).join(" / ")}</Td>
                  <Td fontSize="xs" color="gray.500">
                    {b.scannedBy || ""}<br />{b.scannedAt ? new Date(b.scannedAt).toLocaleString() : ""}
                  </Td>
                  <Td>
                    <Button size="xs" variant="ghost" colorScheme="red" tabIndex={-1} onClick={() => remove(b)}>Remove</Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}

      <Flex justify="flex-end">
        <Button size="sm" onClick={onBack} isDisabled={pending > 0}>Back to lots</Button>
      </Flex>
    </Stack>
  );
};

const AfLots = ({ isOpen, onClose }) => {
  const [open, setOpen] = useState(null); // the lot being scanned onto
  const close = () => { setOpen(null); onClose(); };
  return (
    <FloatingWindow isOpen={isOpen} onClose={close} title="Lot Registration" width={960}>
      {open
        ? <LotScan key={open.id} lot={open} active={isOpen} onBack={() => setOpen(null)} />
        : <LotList onOpen={setOpen} />}
    </FloatingWindow>
  );
};

export default AfLots;
