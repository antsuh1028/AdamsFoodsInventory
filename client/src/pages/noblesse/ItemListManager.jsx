import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Flex, Text, Input, Button, Badge, Spinner, useToast,
} from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";
import { matchDescription, normaliseName } from "../../utils/descriptionMatch";

// A managed name list (items or customers). Every new name and correction is checked.

export const ITEM_LIST = {
  endpoint: "/item-descriptions", title: "Item List", noun: "product", add: "Add an item",
  intro: "What the dock picks from when weighing outgoing boxes. Correct a misspelling with Edit; retire a name that should no longer be offered.",
};

export const CUSTOMER_LIST = {
  endpoint: "/customers", title: "Customer List", noun: "customer", add: "Add a customer",
  intro: "Where outgoing pallets go. The dock picks from it, and shipments are grouped by it. Correct a misspelling with Edit; retire a customer that should no longer be offered.",
};

// What a proposed name would collide with, against every other entry.
const checkName = (typed, items, exceptId = null) => {
  const others = items.filter((i) => i.id !== exceptId);
  const m = matchDescription(typed, others.map((i) => i.name));
  const hit = others.find((i) => i.name === m.name);
  return { ...m, retired: hit ? !hit.active : false };
};

// A sentence for a name that should not go in as typed, or null.
const warning = (check, noun) => {
  if (check.kind === "exact" || check.kind === "spelling") {
    return { block: true, text: `Already on the list as ${check.name}${check.retired ? " (retired)" : ""}.` };
  }
  if (check.kind === "near") {
    return { block: false, text: `Very close to ${check.name}. Only add it if it is a different ${noun}.` };
  }
  return null;
};

const ItemListManager = ({ isOpen, onClose, list = ITEM_LIST }) => {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null); // { id, name }
  const [busyId, setBusyId] = useState(null);

  const fail = (title) => (err) => toast({ title,
    description: err.response?.data?.error || err.message, status: "error", duration: 5000, position: "top" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axiosInstance.get(list.endpoint, { params: { all: "1" } });
      setItems(data || []);
    } catch (err) {
      fail(`Could not load the ${list.title.toLowerCase()}`)(err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.endpoint]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const shown = useMemo(() => {
    const needle = normaliseName(q);
    return needle ? items.filter((i) => i.name.includes(needle)) : items;
  }, [items, q]);

  const addWarn = newName.trim() ? warning(checkName(newName, items), list.noun) : null;
  const editWarn = editing && normaliseName(editing.name)
    ? warning(checkName(editing.name, items, editing.id), list.noun) : null;

  const add = async () => {
    const name = normaliseName(newName);
    if (!name || addWarn?.block) return;
    setBusyId("new");
    try {
      const { data } = await axiosInstance.post(list.endpoint, { name });
      toast({ title: `Added ${data.name}`, status: "success", duration: 2500, position: "top" });
      setNewName("");
      await load();
    } catch (err) {
      fail("Could not add it")(err);
    } finally {
      setBusyId(null);
    }
  };

  const patch = async (id, body, title) => {
    setBusyId(id);
    try {
      await axiosInstance.patch(`${list.endpoint}/${id}`, body);
      setEditing(null);
      await load();
    } catch (err) {
      fail(title)(err);
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = () => {
    const name = normaliseName(editing.name);
    if (!name || editWarn?.block) return;
    patch(editing.id, { name }, "Could not correct it");
  };

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title={list.title} width={560}>
      <Text fontSize="xs" color="gray.500" mb={3}>{list.intro}</Text>

      <Flex gap={2}>
        <Input size="sm" bg="white" placeholder={list.add} value={newName}
          textTransform="uppercase" autoComplete="off"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <Button size="sm" colorScheme={addWarn && !addWarn.block ? "yellow" : "blue"}
          onClick={add} isLoading={busyId === "new"}
          isDisabled={!newName.trim() || Boolean(addWarn?.block)}>
          {addWarn && !addWarn.block ? "Add anyway" : "Add"}
        </Button>
      </Flex>
      {addWarn && (
        <Text fontSize="xs" mt={1} color={addWarn.block ? "red.600" : "yellow.800"}>{addWarn.text}</Text>
      )}

      <Input size="sm" bg="white" placeholder="Search" mt={4} mb={2}
        value={q} onChange={(e) => setQ(e.target.value)} />

      {loading && items.length === 0 ? (
        <Flex justify="center" py={6}><Spinner size="sm" color="blue.500" /></Flex>
      ) : (
        <Box maxH="50vh" overflowY="auto" border="1px solid" borderColor="gray.200" borderRadius="md">
          {shown.length === 0 && <Text fontSize="sm" color="gray.500" p={3}>Nothing matches.</Text>}
          {shown.map((i) => (editing?.id === i.id ? (
            <Box key={i.id} px={3} py={2} bg="blue.50" borderBottom="1px solid" borderColor="gray.100">
              <Flex gap={2}>
                <Input size="sm" bg="white" autoFocus value={editing.name} textTransform="uppercase"
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") setEditing(null);
                  }} />
                <Button size="sm" colorScheme="blue" onClick={saveEdit} isLoading={busyId === i.id}
                  isDisabled={!normaliseName(editing.name) || Boolean(editWarn?.block)
                    || normaliseName(editing.name) === i.name}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              </Flex>
              {editWarn && (
                <Text fontSize="xs" mt={1} color={editWarn.block ? "red.600" : "yellow.800"}>{editWarn.text}</Text>
              )}
              {i.uses > 0 && (
                <Text fontSize="xs" color="gray.500" mt={1}>
                  Sessions already weighed keep the old spelling; only new ones pick this up.
                </Text>
              )}
            </Box>
          ) : (
            <Flex key={i.id} align="center" gap={2} px={3} py={1.5}
              borderBottom="1px solid" borderColor="gray.100" opacity={i.active ? 1 : 0.55}>
              <Text fontSize="sm" flex="1" minW={0} textDecoration={i.active ? "none" : "line-through"}>
                {i.name}
              </Text>
              <Text fontSize="xs" color="gray.500" whiteSpace="nowrap"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {i.uses} {i.uses === 1 ? "use" : "uses"}
              </Text>
              {!i.active && <Badge colorScheme="gray" fontSize="9px">retired</Badge>}
              <Button size="xs" variant="ghost" colorScheme="blue"
                onClick={() => setEditing({ id: i.id, name: i.name })}>
                Edit
              </Button>
              <Button size="xs" variant="ghost" colorScheme={i.active ? "red" : "blue"}
                isLoading={busyId === i.id && !editing}
                onClick={() => patch(i.id, { active: !i.active }, "Could not update it")}>
                {i.active ? "Retire" : "Restore"}
              </Button>
            </Flex>
          )))}
        </Box>
      )}
    </FloatingWindow>
  );
};

export default ItemListManager;
