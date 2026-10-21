import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert, AlertIcon, Badge, Box, Button, Flex, Input, Radio, RadioGroup, Stack, Text, useToast,
  AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import { primeAudio, beepSuccess, beepError } from "../../utils/scanFeedback";
import { sumWeights, toDisplay } from "../../utils/weight";
import useBarcodeKeys from "./useBarcodeKeys";

// Scanning boxes onto a pull list, then taking them all out at once:
// for a customer order, or to NTI as a production order.

const lbOf = (boxes) => (boxes.length ? toDisplay(sumWeights(boxes.map((b) => b.weight))) : "0.00");

const PullOut = ({ active }) => {
  const toast = useToast();
  const [list, setList] = useState([]); // [{ rowId, row, box }], newest first
  const [problem, setProblem] = useState(null);
  const [pending, setPending] = useState(0);
  const [reason, setReason] = useState("customer");
  const [customer, setCustomer] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRef = useRef(list);
  listRef.current = list;
  const chain = useRef(Promise.resolve());
  const cancelRef = useRef(null);

  // One lookup at a time, so two identical boxes never resolve to the same one.
  const lookUp = useCallback((raw) => {
    setPending((n) => n + 1);
    chain.current = chain.current.then(async () => {
      try {
        const exclude = listRef.current.map((x) => x.box.scanId);
        const { data } = await axiosInstance.post("/inventory/scan-lookup", { rawBarcode: raw, exclude });
        const entry = { rowId: data.row.id, row: data.row, box: data.box };
        listRef.current = [entry, ...listRef.current];
        setList(listRef.current);
        setProblem(null);
        beepSuccess();
      } catch (err) {
        beepError();
        setProblem(err.response?.data?.error || err.message || "That box could not be found.");
      } finally {
        setPending((n) => n - 1);
      }
    });
  }, []);

  useBarcodeKeys(active && !confirming, (result) => {
    if (result.type === "scan") lookUp(result.raw);
    else {
      beepError();
      setProblem(`Not read: ${result.reason || result.code}`);
    }
  });

  const drop = (scanId) => setList((l) => l.filter((x) => x.box.scanId !== scanId));

  // The list grouped by the row each box comes from.
  const groups = useMemo(() => {
    const m = new Map();
    for (const x of list) {
      if (!m.has(x.rowId)) m.set(x.rowId, { row: x.row, boxes: [] });
      m.get(x.rowId).boxes.push(x.box);
    }
    return [...m.values()];
  }, [list]);

  const canFinish = list.length > 0 && pending === 0 && (reason === "nti" || customer.trim());

  const finish = async () => {
    setBusy(true);
    try {
      const { data } = await axiosInstance.post("/inventory/scan-out", {
        reason, customer: customer.trim(),
        boxes: list.map((x) => ({ rowId: x.rowId, scanId: x.box.scanId })),
      });
      const n = list.length;
      toast({ status: "success", position: "top", duration: 6000, isClosable: true,
        title: reason === "nti" ? `${n} box${n === 1 ? "" : "es"} sent to NTI` : `${n} box${n === 1 ? "" : "es"} out for ${data.customer}`,
        description: reason === "nti" ? "A production order was made for them." : "Recorded in the history." });
      setList([]);
      setCustomer("");
      setProblem(null);
    } catch (err) {
      const body = err.response?.data || {};
      if (body.code === "BOXES_GONE") {
        const gone = new Set(body.gone || []);
        setList((l) => l.filter((x) => !gone.has(x.box.scanId)));
      }
      setProblem(body.error || err.message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Stack spacing={4} onClick={() => primeAudio()}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={3}
        p={3} bg="gray.50" border="1px solid" borderColor="gray.200" borderRadius="md">
        <Text fontSize="sm" color="gray.700">Scan the boxes leaving. Nothing comes off stock until you finish.</Text>
        <Box textAlign="right">
          <Text fontSize="3xl" fontWeight="800" lineHeight="1" style={{ fontVariantNumeric: "tabular-nums" }}>{list.length}</Text>
          <Text fontSize="xs" color="gray.600">on the list · {lbOf(list.map((x) => x.box))} lb</Text>
          {pending > 0 && <Badge colorScheme="yellow" mt={1}>looking up {pending}</Badge>}
        </Box>
      </Flex>

      {problem && <Alert status="error" borderRadius="md"><AlertIcon />{problem}</Alert>}

      <Stack spacing={2} maxH="300px" overflowY="auto">
        {groups.map((g) => (
          <Box key={g.row.id} border="1px solid" borderColor="gray.200" borderRadius="md" bg="white">
            <Flex px={3} py={2} justify="space-between" bg="gray.50" borderTopRadius="md" wrap="wrap" gap={2}>
              <Text fontSize="sm" fontWeight="600">{g.row.location} · {g.row.lot || "No lot"} · {g.row.description || ""}</Text>
              <Text fontSize="xs" color="gray.600" style={{ fontVariantNumeric: "tabular-nums" }}>
                {g.boxes.length} box{g.boxes.length === 1 ? "" : "es"} · {lbOf(g.boxes)} lb
              </Text>
            </Flex>
            {g.boxes.map((b) => (
              <Flex key={b.scanId} px={3} py={1} align="center" gap={3} style={{ fontVariantNumeric: "tabular-nums" }}>
                <Text fontSize="sm" minW="80px">{b.weight} lb</Text>
                <Text fontSize="xs" color="gray.500" flex={1}>
                  {[b.serial ? `serial ${b.serial}` : null, b.packDate ? `packed ${b.packDate}` : null].filter(Boolean).join(" · ")}
                </Text>
                <Button size="xs" variant="ghost" onClick={() => drop(b.scanId)}>Remove from list</Button>
              </Flex>
            ))}
          </Box>
        ))}
      </Stack>

      <Box p={3} border="1px solid" borderColor="gray.200" borderRadius="md">
        <RadioGroup value={reason} onChange={setReason}>
          <Stack direction={{ base: "column", sm: "row" }} spacing={5}>
            <Radio value="customer">Customer order</Radio>
            <Radio value="nti">Sent to NTI</Radio>
          </Stack>
        </RadioGroup>
        {reason === "customer" && (
          <Input mt={3} size="sm" maxW="320px" placeholder="Customer" value={customer}
            onChange={(e) => setCustomer(e.target.value.toUpperCase())} />
        )}
        <Flex justify="flex-end" mt={3}>
          <Button colorScheme="red" isDisabled={!canFinish} onClick={() => setConfirming(true)}>
            Take out {list.length} box{list.length === 1 ? "" : "es"}
          </Button>
        </Flex>
      </Box>

      <AlertDialog isOpen={confirming} leastDestructiveRef={cancelRef} onClose={() => setConfirming(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Take out {list.length} box{list.length === 1 ? "" : "es"}?
            </AlertDialogHeader>
            <AlertDialogBody>
              {lbOf(list.map((x) => x.box))} lb from {groups.length} row{groups.length === 1 ? "" : "s"},{" "}
              {reason === "nti" ? "sent to NTI as a production order." : `for ${customer.trim()}.`}
              {" "}Rows left with no boxes are removed.
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setConfirming(false)}>Go back</Button>
              <Button colorScheme="red" onClick={finish} isLoading={busy}>Take them out</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Stack>
  );
};

export default PullOut;
