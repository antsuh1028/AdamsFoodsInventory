// Choosing boxes from a pallet NTI already weighed. Read only.

import { useState } from "react";
import { Box, Button, Checkbox, Flex, Select, Spinner, Stack, Text } from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import { toPounds } from "../../utils/weight";

const dayOf = (b) => String(b.weighed_on || b.created_at || "").slice(0, 10);

const NtiBoxPicker = ({ sessions = [], groups = [], taken, onAdd }) => {
  const [source, setSource] = useState("");
  const [rows, setRows] = useState(null);
  const [lot, setLot] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const choose = async (value) => {
    setSource(value); setRows(null); setError(null); setPicked(new Set());
    if (!value) return;
    const [kind, id] = value.split(":");
    setLoading(true);
    try {
      const { data } = await axiosInstance.get(kind === "g" ? `/manifest-groups/${id}` : `/box-batches/${id}`);
      const list = (data.items || []).filter((i) => !i.voidedAt).map((i) => ({
        key: `nti:${i.localId}`,
        weight: toPounds(i.weight, i.weightUnit || "LB").weight,
        packDate: i.productionDate || null,
      }));
      setRows(list);
      setLot(data.lot_number || "");
      setPicked(new Set(list.filter((r) => !taken.has(r.key)).map((r) => r.key)));
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Could not load that pallet");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const free = (rows || []).filter((r) => !taken.has(r.key));

  const add = () => {
    onAdd(free.filter((r) => picked.has(r.key)), lot);
    setPicked(new Set());
  };

  return (
    <Stack spacing={2} p={3} border="1px solid" borderColor="gray.200" borderRadius="md">
      <Select size="sm" value={source} onChange={(e) => choose(e.target.value)}
        placeholder="Choose a pallet NTI weighed…">
        {groups.map((g) => (
          <option key={`g${g.group_id}`} value={`g:${g.group_id}`}>
            Merged · {g.lot_number} · {g.box_count} boxes · {g.total} lb
          </option>
        ))}
        {sessions.map((b) => (
          <option key={`b${b.batch_id}`} value={`b:${b.batch_id}`}>
            {b.lot_number} · {b.item_description || "No description"} · {b.box_count} boxes · {dayOf(b)}
          </option>
        ))}
      </Select>

      {loading && <Spinner size="sm" />}
      {error && <Text fontSize="sm" color="red.600">{error}</Text>}

      {rows && (
        <>
          <Flex gap={2} align="center">
            <Text fontSize="xs" color="gray.600" flex={1}>
              {rows.length} boxes on {lot || "this pallet"}{rows.length - free.length ? `, ${rows.length - free.length} already added` : ""}
            </Text>
            <Button size="xs" variant="ghost" onClick={() => setPicked(new Set(free.map((r) => r.key)))}>All</Button>
            <Button size="xs" variant="ghost" onClick={() => setPicked(new Set())}>None</Button>
          </Flex>
          <Box maxH="200px" overflowY="auto">
            <Flex wrap="wrap" gap={1}>
              {rows.map((r) => (
                <Checkbox key={r.key} size="sm" w="140px" isChecked={picked.has(r.key)}
                  isDisabled={taken.has(r.key)} onChange={() => toggle(r.key)}
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  <Text as="span" fontSize="sm">{r.weight} lb</Text>
                </Checkbox>
              ))}
            </Flex>
          </Box>
          <Button size="sm" colorScheme="blue" alignSelf="flex-end" onClick={add}
            isDisabled={!free.some((r) => picked.has(r.key))}>
            Add {free.filter((r) => picked.has(r.key)).length} boxes
          </Button>
        </>
      )}
    </Stack>
  );
};

export default NtiBoxPicker;
