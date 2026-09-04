import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Flex, Text, Select, Button, Input, Spinner, Badge, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../utils/axiosInstance";

// Picks a lot, or issues a new one.
//
// A lot is issued ONCE at Incoming and only referenced afterwards, so this
// component has two modes and the difference is not cosmetic:
//
//   allowCreate={false}  (default)  pick an existing lot. Downstream screens —
//                                   processing, shipments — use this. There is
//                                   no path here that creates a lot.
//   allowCreate                     also offers "Issue" (server allocates the
//                                   next -NN) and accepts a lot typed off a
//                                   paper form. Incoming-side screens only.
//
// The server enforces the same split — POST /lots creates, POST /lots/resolve
// never does — so this prop shapes the UI without being the control.
//
// The sequence is never typed. It used to be, which is why production has
// N26132-03 and N26132-08 with nothing between them.

const LotPicker = ({
  value = null,                 // selected lotId, or null
  onChange,                     // (lot | null) => void — the whole lot object
  allowCreate = false,
  date = null,                  // issue against this day instead of today
  isDisabled = false,
  size = "sm",
  placeholder = "Select a lot…",
}) => {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nextLot, setNextLot] = useState(null);
  const [typed, setTyped] = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, preview] = await Promise.all([
        axiosInstance.get("/lots", { params: { limit: 200 } }),
        allowCreate
          ? axiosInstance.get("/lots/next", { params: date ? { date } : {} }).catch(() => null)
          : Promise.resolve(null),
      ]);
      setLots(data || []);
      setNextLot(preview ? preview.data : null);
    } catch (err) {
      toast({
        title: "Could not load lots",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top",
      });
    } finally {
      setLoading(false);
    }
  }, [allowCreate, date, toast]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(
    () => lots.find((l) => l.lotId === value) || null,
    [lots, value]
  );

  // A lot that was picked but is not in the loaded page (an older one, or one
  // just created) still has to render as selected rather than silently
  // reverting the field to the placeholder.
  const options = useMemo(() => {
    if (!selected && value) return lots;
    return lots;
  }, [lots, selected, value]);

  const pick = (lotId) => {
    if (!lotId) { onChange(null); return; }
    const lot = lots.find((l) => String(l.lotId) === String(lotId));
    onChange(lot || null);
  };

  const adopt = (lot, created) => {
    setLots((prev) => (prev.some((l) => l.lotId === lot.lotId) ? prev : [lot, ...prev]));
    onChange(lot);
    setTyped("");
    toast({
      title: created ? `Lot ${lot.lotNumber} issued` : `Lot ${lot.lotNumber} selected`,
      description: created ? undefined : "This lot already existed — it was not re-created.",
      status: "success", duration: 3000, position: "top",
    });
    if (created) load();   // refresh the previewed next number
  };

  const mutate = async (run) => {
    setBusy(true);
    try {
      const { data } = await run();
      adopt(data.lot, data.created);
    } catch (err) {
      const body = err.response?.data;
      toast({
        title: "Could not get that lot",
        // The server's refusal names the raw text and why it was refused, which
        // is what the operator needs in order to fix it.
        description: body?.reason ? `${body.reason} — "${body.raw}"` : (body?.error || err.message),
        status: "error", duration: 6000, position: "top", isClosable: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const issueNext = () => mutate(() =>
    axiosInstance.post("/lots", date ? { date } : {}));

  const adoptTyped = () => mutate(() =>
    axiosInstance.post("/lots", { lotNumber: typed.trim() }));

  return (
    <Box>
      <Flex gap={2} align="center" wrap="wrap">
        <Select
          size={size}
          bg="white"
          flex="1 1 200px"
          minW="180px"
          placeholder={placeholder}
          value={value ?? ""}
          isDisabled={isDisabled || loading}
          onChange={(e) => pick(e.target.value)}
        >
          {options.map((l) => (
            <option key={l.lotId} value={l.lotId}>
              {l.lotNumber}
            </option>
          ))}
        </Select>

        {loading && <Spinner size="xs" color="blue.500" />}

        {allowCreate && (
          <Button
            size={size}
            colorScheme="blue"
            onClick={issueNext}
            isLoading={busy}
            isDisabled={isDisabled || Boolean(nextLot && nextLot.exhausted)}
            title={nextLot && nextLot.lotNumber
              ? `Issue ${nextLot.lotNumber}`
              : "Issue the next lot number"}
          >
            {nextLot && nextLot.lotNumber ? `Issue ${nextLot.lotNumber}` : "Issue lot"}
          </Button>
        )}
      </Flex>

      {selected && (
        <Flex gap={2} align="baseline" mt={1}>
          <Badge colorScheme="blue" fontSize="10px">{selected.lotNumber}</Badge>
          <Text fontSize="xs" color="gray.500">{selected.lotDate}</Text>
          {selected.notes && <Text fontSize="xs" color="gray.500">· {selected.notes}</Text>}
        </Flex>
      )}

      {/* Hand entry, incoming side only: lots arrive on paper, and a lot coming
          back from AFDC already has a number. Typing one that exists selects it
          rather than making a second — "stored, not re-created". */}
      {allowCreate && (
        <Flex gap={2} align="center" mt={2}>
          <Input
            size={size}
            bg="white"
            flex="1 1 160px"
            placeholder="…or type a lot from paper"
            value={typed}
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            isDisabled={isDisabled}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) adoptTyped(); }}
          />
          <Button
            size={size}
            variant="outline"
            onClick={adoptTyped}
            isLoading={busy}
            isDisabled={isDisabled || !typed.trim()}
          >
            Use
          </Button>
        </Flex>
      )}

      {allowCreate && nextLot && nextLot.exhausted && (
        <Text fontSize="xs" color="red.600" mt={1}>
          All 99 sequences for {nextLot.lotDate} are used. Issue against another date.
        </Text>
      )}
    </Box>
  );
};

export default LotPicker;
