import React, { useCallback, useRef, useState } from "react";
import {
  Alert, AlertIcon, Badge, Box, Button, Flex, Stack, Text,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import { primeAudio, beepSuccess, beepError } from "../../utils/scanFeedback";
import { sumWeights, toDisplay } from "../../utils/weight";
import useBarcodeKeys from "./useBarcodeKeys";

// Scanning boxes onto one inventory row. Each box is saved as it is scanned.

const ReceiveSession = ({ row: startRow, active, onDone }) => {
  const [row, setRow] = useState(startRow);
  const [scanned, setScanned] = useState([]); // this session's boxes, newest first
  const [problem, setProblem] = useState(null);
  const [pending, setPending] = useState(0);
  const chain = useRef(Promise.resolve());

  // One request at a time, in the order the boxes were scanned.
  const send = useCallback((raw) => {
    setPending((n) => n + 1);
    chain.current = chain.current.then(async () => {
      try {
        const { data } = await axiosInstance.post(`/inventory/${row._id}/scan-box`, { rawBarcode: raw });
        setRow(data.item);
        setScanned((list) => [data.box, ...list]);
        setProblem(null);
        beepSuccess();
      } catch (err) {
        beepError();
        setProblem(err.response?.data?.error || err.message || "That box was not saved.");
      } finally {
        setPending((n) => n - 1);
      }
    });
  }, [row._id]);

  useBarcodeKeys(active, (result) => {
    if (result.type === "scan") send(result.raw);
    else {
      beepError();
      setProblem(`Not read: ${result.reason || result.code}`);
    }
  });

  const undo = async (box) => {
    try {
      const { data } = await axiosInstance.post(`/inventory/${row._id}/scan-box/undo`, { scanId: box.scanId });
      setRow(data.item);
      setScanned((list) => list.filter((b) => b.scanId !== box.scanId));
    } catch (err) {
      setProblem(err.response?.data?.error || err.message);
    }
  };

  const sessionLb = scanned.length ? toDisplay(sumWeights(scanned.map((b) => b.weight))) : "0.00";

  return (
    <Stack spacing={4} onClick={() => primeAudio()}>
      <Flex justify="space-between" align="flex-start" wrap="wrap" gap={3}
        p={3} bg="blue.50" border="1px solid" borderColor="blue.200" borderRadius="md">
        <Box minW={0}>
          <Text fontSize="lg" fontWeight="700">{row.location} · {row.lot || "No lot"}</Text>
          <Text fontSize="sm" color="gray.600">{row.description || "No description"}{row.vendor ? ` · ${row.vendor}` : ""}</Text>
          <Text fontSize="xs" color="gray.500" mt={1}>
            On the row: {row.boxes.length} box{row.boxes.length === 1 ? "" : "es"} · {row.weight || 0} lb
          </Text>
        </Box>
        <Box textAlign="right">
          <Text fontSize="3xl" fontWeight="800" lineHeight="1" style={{ fontVariantNumeric: "tabular-nums" }}>
            {scanned.length}
          </Text>
          <Text fontSize="xs" color="gray.600">scanned now · {sessionLb} lb</Text>
          {pending > 0 && <Badge colorScheme="yellow" mt={1}>saving {pending}</Badge>}
        </Box>
      </Flex>

      {problem ? (
        <Alert status="error" borderRadius="md"><AlertIcon />{problem}</Alert>
      ) : (
        <Text fontSize="sm" color="gray.500">Scan box labels. Each box is saved as it is scanned.</Text>
      )}

      <Stack spacing={1} maxH="340px" overflowY="auto">
        {scanned.map((b) => (
          <Flex key={b.scanId} align="center" gap={3} px={3} py={2} bg="white"
            border="1px solid" borderColor="gray.100" borderRadius="md"
            style={{ fontVariantNumeric: "tabular-nums" }}>
            <Text fontWeight="700" minW="80px">{b.weight} lb</Text>
            <Text fontSize="xs" color="gray.500" flex={1} minW={0}>
              {[b.scannedUnit === "KG" ? `${b.scannedWeight} kg on label` : null,
                b.serial ? `serial ${b.serial}` : null,
                b.packDate ? `packed ${b.packDate}` : null].filter(Boolean).join(" · ")}
            </Text>
            <Button size="xs" variant="ghost" colorScheme="red" onClick={() => undo(b)}>Undo</Button>
          </Flex>
        ))}
      </Stack>

      <Flex justify="flex-end">
        <Button colorScheme="blue" onClick={onDone} isDisabled={pending > 0}>Done</Button>
      </Flex>
    </Stack>
  );
};

export default ReceiveSession;
