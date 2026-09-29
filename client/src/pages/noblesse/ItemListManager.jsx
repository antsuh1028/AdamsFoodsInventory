import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Flex, Text, Input, Button, Badge, Select, Spinner, useToast,
} from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";
import { normaliseName } from "../../utils/descriptionMatch";

// The standard item descriptions, per side. Retire rather than delete, so a
// name already on a session keeps meaning something; there is no rename.
const ItemListManager = ({ isOpen, onClose }) => {
  const toast = useToast();
  const [direction, setDirection] = useState("outgoing");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axiosInstance.get("/item-descriptions", { params: { direction, all: "1" } });
      setItems(data || []);
    } catch (err) {
      toast({ title: "Could not load the item list", description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    } finally {
      setLoading(false);
    }
  }, [direction, toast]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const shown = useMemo(() => {
    const needle = normaliseName(q);
    return needle ? items.filter((i) => i.name.includes(needle)) : items;
  }, [items, q]);

  const add = async () => {
    const name = normaliseName(newName);
    if (!name) return;
    setBusyId("new");
    try {
      const { data } = await axiosInstance.post("/item-descriptions", { direction, name });
      toast({ title: data.created ? `Added ${data.name}` : `${data.name} is on the list`,
        status: "success", duration: 2500, position: "top" });
      setNewName("");
      await load();
    } catch (err) {
      toast({ title: "Could not add it", description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    } finally {
      setBusyId(null);
    }
  };

  const setActive = async (item, active) => {
    setBusyId(item.id);
    try {
      await axiosInstance.patch(`/item-descriptions/${item.id}`, { active });
      await load();
    } catch (err) {
      toast({ title: "Could not update it", description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title="Item List" width={560}>
      <Flex gap={2} mb={3} wrap="wrap">
        <Select size="sm" width="150px" bg="white" value={direction}
          onChange={(e) => setDirection(e.target.value)}>
          <option value="outgoing">Outgoing</option>
          <option value="incoming">Incoming</option>
        </Select>
        <Input size="sm" flex="1 1 180px" bg="white" placeholder="Search"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </Flex>

      <Flex gap={2} mb={3}>
        <Input size="sm" bg="white" placeholder="Add an item" value={newName}
          textTransform="uppercase" autoComplete="off"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <Button size="sm" colorScheme="blue" onClick={add}
          isLoading={busyId === "new"} isDisabled={!newName.trim()}>
          Add
        </Button>
      </Flex>

      {loading && items.length === 0 ? (
        <Flex justify="center" py={6}><Spinner size="sm" color="blue.500" /></Flex>
      ) : (
        <Box maxH="55vh" overflowY="auto" border="1px solid" borderColor="gray.200" borderRadius="md">
          {shown.length === 0 && (
            <Text fontSize="sm" color="gray.500" p={3}>Nothing matches.</Text>
          )}
          {shown.map((i) => (
            <Flex key={i.id} align="center" gap={2} px={3} py={1.5}
              borderBottom="1px solid" borderColor="gray.100"
              opacity={i.active ? 1 : 0.55}>
              <Text fontSize="sm" flex="1" minW={0}
                textDecoration={i.active ? "none" : "line-through"}>
                {i.name}
              </Text>
              <Text fontSize="xs" color="gray.500" whiteSpace="nowrap"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {i.uses} {i.uses === 1 ? "use" : "uses"}
              </Text>
              {!i.active && <Badge colorScheme="gray" fontSize="9px">retired</Badge>}
              <Button size="xs" variant="ghost" colorScheme={i.active ? "red" : "blue"}
                isLoading={busyId === i.id} onClick={() => setActive(i, !i.active)}>
                {i.active ? "Retire" : "Restore"}
              </Button>
            </Flex>
          ))}
        </Box>
      )}
    </FloatingWindow>
  );
};

export default ItemListManager;
