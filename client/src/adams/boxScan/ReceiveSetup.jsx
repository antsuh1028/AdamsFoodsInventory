import React, { useState } from "react";
import {
  Box, Button, Flex, Input, Select, SimpleGrid, Spinner, Stack, Text, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import upperInput from "../../utils/upperInput";
import { today } from "../../noblesse/common/shared";

// Where scanned boxes go: a location, then a row already there or a new one.

const EMPTY_ROW = { lot: "", vendor: "", brand: "", species: "", description: "", grade: "", est: "", type: "raw" };

const ReceiveSetup = ({ onStart }) => {
  const toast = useToast();
  const [location, setLocation] = useState("");
  const [checked, setChecked] = useState(null); // the location that was looked up
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_ROW);

  const fail = (title, err) => toast({ title, description: err?.response?.data?.error || err?.message,
    status: "error", duration: 5000, position: "top", isClosable: true });

  const lookUp = async () => {
    const loc = location.trim().toUpperCase();
    if (!loc) return;
    setBusy(true);
    try {
      const { data: valid } = await axiosInstance.post("/verifyLocation", { location: loc });
      if (valid !== "OK") {
        toast({ title: `${loc} is not a location`, status: "warning", duration: 4000, position: "top" });
        setChecked(null);
        return;
      }
      const { data } = await axiosInstance.post("/inventoryFind", { inputs: { location: loc } });
      // The search matches by prefix, so keep this exact location only.
      setRows((data || []).filter((r) => String(r.location).toUpperCase() === loc));
      setChecked(loc);
      setCreating(false);
    } catch (err) {
      fail("Could not look up that location", err);
    } finally {
      setBusy(false);
    }
  };

  const createRow = async () => {
    setBusy(true);
    try {
      // The occupants were just shown, so a shared location is a choice, not a mistake.
      const { data } = await axiosInstance.post("/inventoryAdd", {
        inputs: { ...draft, location: checked, date_recvd: today(), boxes: [] },
        force: true,
      });
      onStart(data);
    } catch (err) {
      fail("Could not start the row", err);
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, upper = true) => (
    <Box>
      <Text fontSize="xs" color="gray.500" mb={1}>{label}</Text>
      <Input size="sm" bg="white" value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: upper ? upperInput(e) : e.target.value })} />
    </Box>
  );

  return (
    <Stack spacing={4}>
      <Box>
        <Text fontSize="xs" color="gray.500" mb={1}>Freezer location</Text>
        <Flex gap={2}>
          <Input size="md" bg="white" maxW="220px" placeholder="A101" value={location}
            onChange={(e) => setLocation(upperInput(e))}
            onKeyDown={(e) => { if (e.key === "Enter") lookUp(); }} />
          <Button onClick={lookUp} isLoading={busy && !checked} colorScheme="blue">Look up</Button>
        </Flex>
      </Box>

      {checked && (
        <Box>
          <Text fontSize="sm" fontWeight="600" mb={2}>
            {rows.length ? `On ${checked} now` : `${checked} is empty`}
          </Text>
          <Stack spacing={2}>
            {rows.map((r) => (
              <Flex key={r._id} align="center" gap={3} p={3} border="1px solid" borderColor="gray.200"
                borderRadius="md" bg="white" wrap="wrap">
                <Box flex="1 1 220px" minW={0}>
                  <Text fontSize="sm" fontWeight="600">{r.lot || "No lot"} · {r.description || "No description"}</Text>
                  <Text fontSize="xs" color="gray.500">
                    {r.vendor || "—"} · {r.boxes.length} box{r.boxes.length === 1 ? "" : "es"} · {r.weight || 0} lb
                  </Text>
                </Box>
                <Button size="sm" colorScheme="blue" variant="outline" onClick={() => onStart(r)}>
                  Scan onto this row
                </Button>
              </Flex>
            ))}
          </Stack>

          {!creating ? (
            <Button mt={3} size="sm" colorScheme="teal" onClick={() => { setDraft(EMPTY_ROW); setCreating(true); }}>
              New row on {checked}
            </Button>
          ) : (
            <Box mt={3} p={3} border="1px solid" borderColor="teal.200" borderRadius="md" bg="teal.50">
              <Text fontSize="sm" fontWeight="600" mb={2}>New row on {checked}</Text>
              <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
                {field("lot", "Lot #")}
                {field("vendor", "Vendor")}
                {field("brand", "Brand")}
                {field("description", "Description")}
                {field("species", "Species")}
                {field("grade", "Grade")}
                {field("est", "EST")}
                <Box>
                  <Text fontSize="xs" color="gray.500" mb={1}>Type</Text>
                  <Select size="sm" bg="white" value={draft.type}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                    <option value="raw">Raw</option>
                    <option value="prc">Processed</option>
                  </Select>
                </Box>
              </SimpleGrid>
              <Flex gap={2} mt={3}>
                <Button size="sm" colorScheme="teal" onClick={createRow} isLoading={busy}
                  isDisabled={!draft.lot.trim() || !draft.description.trim()}>
                  Start scanning
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </Flex>
              <Text fontSize="xs" color="gray.500" mt={2}>Lot # and description are needed.</Text>
            </Box>
          )}
        </Box>
      )}
      {busy && checked && <Spinner size="sm" />}
    </Stack>
  );
};

export default ReceiveSetup;
