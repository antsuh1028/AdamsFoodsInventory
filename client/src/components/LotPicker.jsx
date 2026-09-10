import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Select, Button, Input, Spinner, Badge, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
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
  lotNumber = "",               // the text, needed when there is no lotId to show
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
  // Set when the registry refuses what was typed, which turns the refusal into
  // a confirmation rather than a dead end.
  const [freeForm, setFreeForm] = useState(null);
  const cancelFreeFormRef = useRef(null);
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

  // Try to register what was typed. If the registry refuses it — a supplier's
  // own format, a number off a piece of paper that is not N{YY}{JJJ}-{NN} —
  // offer to use it verbatim instead of dead-ending.
  //
  // The SERVER stays the authority on what counts as canonical: this never
  // pattern-matches locally, it asks and reacts to the answer. That keeps
  // normalisation in one place, so "N26244-3" still becomes "N26244-03" rather
  // than being waved through as free-form because the client's idea of the
  // format was narrower than lot.js's.
  const adoptTyped = async () => {
    const text = typed.trim();
    if (!text) return;
    setBusy(true);
    try {
      const { data } = await axiosInstance.post("/lots", { lotNumber: text });
      adopt(data.lot, data.created);
    } catch (err) {
      const body = err.response?.data;
      // A refusal to PARSE is the case this handles. Anything else — a network
      // failure, a 500 — is a real error and still surfaces as one.
      if (err.response?.status === 400 && body?.code) {
        setFreeForm({ text: text.toUpperCase(), reason: body.reason || body.error });
      } else {
        toast({
          title: "Could not get that lot",
          description: body?.reason ? `${body.reason} — "${body.raw}"` : (body?.error || err.message),
          status: "error", duration: 6000, position: "top", isClosable: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  // Confirmed free-form. No registry row is created — `lots` requires a date
  // and a sequence that this text does not carry, and inventing them would put
  // a fictional lot in the registry that everything downstream would then
  // resolve against.
  //
  // Instead the text is carried on the record itself with lot_id NULL, which is
  // exactly what the server already does for unparseable text (lotColumns) and
  // what the text columns are still authoritative for.
  const useFreeForm = () => {
    onChange({ lotId: null, lotNumber: freeForm.text });
    setTyped("");
    setFreeForm(null);
  };

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

        {/* A free-form lot has no lotId, so the Select above cannot show it and
            the field would read as empty — someone would type a lot, confirm
            it, and watch it disappear. It is shown here instead, marked, so it
            is obvious both that a lot IS set and that it is not one of ours. */}
        {!value && String(lotNumber || "").trim() && (
          <Flex align="center" gap={2} flexShrink={0}>
            <Text fontSize={size} fontWeight="700" color="gray.800">{lotNumber}</Text>
            <Badge colorScheme="yellow" fontSize="9px" borderRadius="full" px={2}
              title="Not one of our lot numbers — recorded as written, with no registry link">
              as written
            </Badge>
            {!isDisabled && (
              <Button size="xs" variant="ghost" colorScheme="gray" px={1}
                title="Clear it and pick or issue a lot instead"
                onClick={() => onChange(null)}>
                clear
              </Button>
            )}
          </Flex>
        )}

        {/* Secondary to picking an existing lot: most of the time the lot is
            already there, and issuing a new one is the exception. Ghost and
            small so it reads as an offer rather than the default action. */}
        {allowCreate && (
          <Button
            size="xs"
            variant="ghost"
            colorScheme="blue"
            fontWeight="500"
            px={2}
            onClick={issueNext}
            isLoading={busy}
            isDisabled={isDisabled || Boolean(nextLot && nextLot.exhausted)}
            title={nextLot && nextLot.lotNumber
              ? `Issue ${nextLot.lotNumber}`
              : "Issue the next lot number"}
          >
            {nextLot && nextLot.lotNumber ? `+ ${nextLot.lotNumber}` : "+ New lot"}
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
          back from AdamsFoods already has a number. Typing one that exists selects it
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
            size="xs"
            variant="ghost"
            colorScheme="blue"
            fontWeight="500"
            px={2}
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

      {/* The intermediate step. Using a number the registry does not recognise
          is legitimate — suppliers have their own formats — but it costs the
          lot its links, so it is confirmed rather than assumed. */}
      <AlertDialog isOpen={Boolean(freeForm)} leastDestructiveRef={cancelFreeFormRef}
        onClose={() => setFreeForm(null)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Use this as written?
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={3}>
                <b>{freeForm?.text}</b> is not one of our lot numbers
                {freeForm?.reason ? ` — ${freeForm.reason}` : ""}.
                Ours look like <Text as="span" fontFamily="mono">N26253-04</Text>.
              </Text>
              <Text fontSize="sm" mb={2}>
                You can still use it. It will be recorded on this record exactly as
                written, which is right for a supplier's own number off a box or a
                delivery note.
              </Text>
              {/* Said plainly, because the cost is invisible until someone goes
                  looking for the lot later and it is not there. */}
              <Box px={3} py={2} bg="yellow.50" border="1px solid" borderColor="yellow.200"
                borderRadius="md">
                <Text fontSize="xs" color="yellow.900">
                  It will not be added to the lot registry, so it gets no lot history,
                  and totals for it will not join up with anything else. If this delivery
                  should have one of our lot numbers, go back and issue one instead.
                </Text>
              </Box>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelFreeFormRef} onClick={() => setFreeForm(null)}>
                Go back
              </Button>
              <Button colorScheme="blue" onClick={useFreeForm}>
                Use as written
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
};

export default LotPicker;
