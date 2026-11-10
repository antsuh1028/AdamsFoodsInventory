import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Input, Select, Checkbox, Spinner, Grid, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import upperInput from "../../utils/upperInput";
import FloatingWindow from "../../components/FloatingWindow";
import { fmtDate, fmtWeight, PROCESSING_TYPES } from "../common/shared";
import { mixShared, MIXED_TEXT } from "./mixShared";

// Mixing lots: N lots mixed before processing into one NX lot. Each lot's stock
// goes to 0 and the NX lot carries the total; the server does the arithmetic.

export { mixShared, MIXED_TEXT };

// Pounds as thousandths, so a total of typed weights never picks up float error.
const mils = (w) => {
  const m = /^\s*(\d+)(?:\.(\d{0,3}))?/.exec(String(w ?? ""));
  return m ? Number(m[1]) * 1000 + Number(((m[2] || "") + "000").slice(0, 3)) : 0;
};
const lbText = (m) => (m / 1000).toFixed(2);

const totalsOf = (lots) => ({
  cases: lots.reduce((sum, l) => sum + (l.cases || 0), 0),
  lb: lbText(lots.reduce((sum, l) => sum + mils(l.originalWeight), 0)),
  uncounted: lots.filter((l) => l.cases == null).length,
});

const errText = (err) => err.response?.data?.error || err.message;

// Open N lots with a checkbox each. Lots that cannot be mixed say why and cannot be ticked.
const CandidateList = ({ picked, onToggle, reloadKey = 0 }) => {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const toast = useToast();

  useEffect(() => {
    let live = true;
    setRows(null);
    axiosInstance.get("/lot-mixes/candidates")
      .then(({ data }) => { if (live) setRows(data || []); })
      .catch((err) => {
        if (!live) return;
        setRows([]);
        toast({ status: "error", title: "Could not load lots", description: errText(err), position: "top" });
      });
    return () => { live = false; };
  }, [reloadKey, toast]);

  const shown = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (rows || []).filter((r) => !t
      || [r.lotNumber, r.description, r.vendor].some((v) => String(v || "").toUpperCase().includes(t)));
  }, [rows, q]);

  if (rows === null) return <Flex justify="center" py={6}><Spinner size="sm" /></Flex>;

  return (
    <Box>
      <Input size="sm" mb={2} placeholder="Find a lot, product or vendor…" value={q}
        onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 ? (
        <Text fontSize="sm" color="gray.500" py={3}>No open lots to mix.</Text>
      ) : (
        <Box overflowX="auto" maxH="340px" overflowY="auto" border="1px solid" borderColor="gray.200" borderRadius="md">
          <Box as="table" width="100%" minWidth="620px" fontSize="sm" style={{ borderCollapse: "collapse" }}>
            <Box as="thead" position="sticky" top={0} bg="gray.50" zIndex={1}>
              <tr>
                {["", "Lot", "Product", "Vendor", "Received", "Cases", "Lbs"].map((h, i) => (
                  <Box as="th" key={h || i} px={2} py={1.5} textAlign={i >= 5 ? "right" : "left"}
                    fontSize="xs" color="gray.500" textTransform="uppercase" fontWeight="semibold">{h}</Box>
                ))}
              </tr>
            </Box>
            <tbody>
              {shown.map((r) => {
                const on = picked.has(r.lotId);
                return (
                  <Box as="tr" key={r.lotId} borderTop="1px solid" borderColor="gray.100"
                    bg={on ? "purple.50" : undefined} opacity={r.blocked ? 0.6 : 1}
                    cursor={r.blocked ? "not-allowed" : "pointer"}
                    onClick={() => { if (!r.blocked) onToggle(r); }}>
                    <Box as="td" px={2} py={1.5} width="28px">
                      <Checkbox isChecked={on} isDisabled={Boolean(r.blocked)} pointerEvents="none" />
                    </Box>
                    <Box as="td" px={2} py={1.5} fontWeight="semibold" whiteSpace="nowrap">{r.lotNumber}</Box>
                    <Box as="td" px={2} py={1.5}>
                      <Text>{r.description || "—"}</Text>
                      {r.blocked && <Text fontSize="xs" color="red.600">{r.blocked}</Text>}
                      {!r.blocked && !r.registered && (
                        <Text fontSize="xs" color="gray.500">No registration form yet. Its cases join the mix when it has one.</Text>
                      )}
                    </Box>
                    <Box as="td" px={2} py={1.5}>{r.vendor || "—"}</Box>
                    <Box as="td" px={2} py={1.5} whiteSpace="nowrap">{fmtDate(r.dateReceived)}</Box>
                    <Box as="td" px={2} py={1.5} textAlign="right" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.cases ?? (r.totalQuantity || "—")}
                    </Box>
                    <Box as="td" px={2} py={1.5} textAlign="right" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.originalWeight ? fmtWeight(r.originalWeight) : "—"}
                    </Box>
                  </Box>
                );
              })}
            </tbody>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const usePicked = () => {
  const [picked, setPicked] = useState(() => new Map());
  const toggle = useCallback((row) => setPicked((prev) => {
    const next = new Map(prev);
    if (next.has(row.lotId)) next.delete(row.lotId); else next.set(row.lotId, row);
    return next;
  }), []);
  return [picked, toggle, () => setPicked(new Map())];
};

const PickedTotals = ({ picked }) => {
  const lots = [...picked.values()];
  if (!lots.length) return <Text fontSize="sm" color="gray.500">Tick the lots going into the mix.</Text>;
  const t = totalsOf(lots);
  return (
    <Box>
      <Text fontSize="sm" color="gray.800">
        <b>{lots.length}</b> lot{lots.length === 1 ? "" : "s"}: <b>{t.cases}</b> cases, <b>{t.lb}</b> lb
      </Text>
      {t.uncounted > 0 && (
        <Text fontSize="xs" color="orange.700">
          {t.uncounted} of them {t.uncounted === 1 ? "has" : "have"} no case count on the form yet.
        </Text>
      )}
    </Box>
  );
};

/** Makes a new NX lot from the lots ticked. */
export const MixLotsWindow = ({ isOpen, onClose, onMade }) => {
  const [picked, toggle, clear] = usePicked();
  const [head, setHead] = useState({ productDescription: "", processingType: "", spec: "", dueDate: "", predictedYield: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!isOpen) return;
    clear();
    setHead({ productDescription: "", processingType: "", spec: "", dueDate: "", predictedYield: "" });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared description of the lots ticked, offered as a starting point.
  const suggested = useMemo(() => {
    const d = mixShared([...picked.values()], "description");
    return d && d !== MIXED_TEXT ? d : "";
  }, [picked]);

  const make = async () => {
    setBusy(true);
    try {
      const { data } = await axiosInstance.post("/lot-mixes", {
        lotIds: [...picked.keys()],
        ...head,
        productDescription: head.productDescription || suggested,
      });
      toast({ status: "success", position: "top", duration: 4000,
        title: `${data.lotNumber} made`,
        description: `${data.sources.length} lot${data.sources.length === 1 ? "" : "s"} mixed. Their stock is now on ${data.lotNumber}.` });
      onMade(data);
    } catch (err) {
      toast({ status: "error", position: "top", duration: 8000, isClosable: true,
        title: "Could not mix those lots", description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (e) => setHead({ ...head, [key]: key === "processingType" ? e.target.value : upperInput(e) });
  const canMake = picked.size > 0 && (head.productDescription.trim() || suggested);

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title="Mix lots" width={820}
      footer={(
        <Flex justify="space-between" align="center" width="100%" gap={3} wrap="wrap">
          <PickedTotals picked={picked} />
          <Flex gap={2}>
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" colorScheme="purple" isLoading={busy} isDisabled={!canMake} onClick={make}>
              Mix {picked.size || ""} lot{picked.size === 1 ? "" : "s"}
            </Button>
          </Flex>
        </Flex>
      )}>
      <Text fontSize="sm" color="gray.600" mb={3}>
        The mix gets a new NX lot number and its own registration form. Each lot&apos;s stock goes to 0 and
        the NX lot carries the total. Product that comes in later on one of these lots is added to the
        NX lot too, and more lots can be added to the mix later.
      </Text>
      <CandidateList picked={picked} onToggle={toggle} reloadKey={isOpen ? 1 : 0} />
      <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={3} mt={4}>
        <Box gridColumn={{ md: "1 / -1" }}>
          <Text fontSize="xs" color="gray.500" mb={1}>Product description of the mix</Text>
          <Input size="sm" textTransform="uppercase" placeholder={suggested || "e.g. BEEF BONES, MIXED"}
            value={head.productDescription} onChange={set("productDescription")} />
        </Box>
        <Box>
          <Text fontSize="xs" color="gray.500" mb={1}>Processing type</Text>
          <Select size="sm" value={head.processingType} onChange={set("processingType")}>
            <option value="">— Select processing type —</option>
            {PROCESSING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Box>
        <Box>
          <Text fontSize="xs" color="gray.500" mb={1}>Spec (##X##)</Text>
          <Input size="sm" textTransform="uppercase" placeholder="10X30" value={head.spec} onChange={set("spec")} />
        </Box>
        <Box>
          <Text fontSize="xs" color="gray.500" mb={1}>Due date</Text>
          <Input size="sm" type="date" value={head.dueDate} onChange={(e) => setHead({ ...head, dueDate: e.target.value })} />
        </Box>
        <Box>
          <Text fontSize="xs" color="gray.500" mb={1}>Predicted yield (%)</Text>
          <Input size="sm" type="number" value={head.predictedYield}
            onChange={(e) => setHead({ ...head, predictedYield: e.target.value })} />
        </Box>
      </Grid>
    </FloatingWindow>
  );
};

/** Picks more lots for an existing mix. */
const AddLotsWindow = ({ isOpen, onClose, mix, onAdded }) => {
  const [picked, toggle, clear] = usePicked();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (isOpen) clear(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    setBusy(true);
    try {
      const { data } = await axiosInstance.post(`/lot-mixes/${mix.lotId}/lots`, { lotIds: [...picked.keys()] });
      toast({ status: "success", position: "top", duration: 3000,
        title: `Added to ${mix.lotNumber}`, description: [...picked.values()].map((l) => l.lotNumber).join(", ") });
      onAdded(data);
    } catch (err) {
      toast({ status: "error", position: "top", duration: 8000, isClosable: true,
        title: "Could not add those lots", description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title={`Add lots to ${mix.lotNumber}`} width={760} zIndex={1500}
      footer={(
        <Flex justify="space-between" align="center" width="100%" gap={3} wrap="wrap">
          <PickedTotals picked={picked} />
          <Flex gap={2}>
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" colorScheme="purple" isLoading={busy} isDisabled={!picked.size} onClick={add}>
              Add {picked.size || ""} lot{picked.size === 1 ? "" : "s"}
            </Button>
          </Flex>
        </Flex>
      )}>
      <CandidateList picked={picked} onToggle={toggle} reloadKey={isOpen ? 1 : 0} />
    </FloatingWindow>
  );
};

/**
 * The lots in an NX lot, on its registration form: what each brought, add more,
 * take one out or undo the mix while nothing has been done with it.
 */
export const MixSources = ({ mixLotId, readOnly = false, onChanged, onUndone }) => {
  const [mix, setMix] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(null);  // { kind: "remove", source } | { kind: "undo" }
  const [busy, setBusy] = useState(false);
  const safeRef = useRef(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get(`/lot-mixes/${mixLotId}`);
      setMix(data);
      return data;
    } catch (err) {
      toast({ status: "error", title: "Could not load the mix", description: errText(err), position: "top" });
      return null;
    }
  }, [mixLotId, toast]);

  useEffect(() => { load(); }, [load]);

  const changed = (data) => { setMix(data); if (onChanged) onChanged(data); };

  const runConfirm = async () => {
    setBusy(true);
    try {
      if (confirm.kind === "remove") {
        const { data } = await axiosInstance.delete(`/lot-mixes/${mixLotId}/lots/${confirm.source.lotId}`);
        toast({ status: "success", position: "top", duration: 3000,
          title: `${confirm.source.lotNumber} taken out`, description: "It has its own stock back." });
        changed(data);
      } else {
        const { data } = await axiosInstance.delete(`/lot-mixes/${mixLotId}`);
        toast({ status: "success", position: "top", duration: 4000,
          title: `${data.undone} undone`, description: `${data.sources.join(", ")} each have their own stock back.` });
        if (onUndone) onUndone(data);
      }
      setConfirm(null);
    } catch (err) {
      toast({ status: "error", position: "top", duration: 8000, isClosable: true,
        title: "Could not do that", description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!mix) return <Flex justify="center" py={4}><Spinner size="sm" /></Flex>;
  const t = totalsOf(mix.sources);
  const cell = { px: 2, py: 1.5, borderTop: "1px solid", borderColor: "gray.100" };
  const num = { ...cell, textAlign: "right", style: { fontVariantNumeric: "tabular-nums" } };

  return (
    <Box>
      <Box overflowX="auto" border="1px solid" borderColor="gray.200" borderRadius="md" bg="white">
        <Box as="table" width="100%" minWidth="760px" fontSize="sm" style={{ borderCollapse: "collapse" }}>
          <Box as="thead" bg="gray.50">
            <tr>
              {["Lot", "Received", "Vendor", "Vendor lot", "EST#", "Brand", "Grade", "Cases", "Lbs", ""].map((h, i) => (
                <Box as="th" key={h || i} px={2} py={1.5} textAlign={i === 7 || i === 8 ? "right" : "left"}
                  fontSize="xs" color="gray.500" textTransform="uppercase" fontWeight="semibold">{h}</Box>
              ))}
            </tr>
          </Box>
          <tbody>
            {mix.sources.map((s) => (
              <tr key={s.lotId}>
                <Box as="td" {...cell} fontWeight="semibold" whiteSpace="nowrap">{s.lotNumber}</Box>
                <Box as="td" {...cell} whiteSpace="nowrap">{fmtDate(s.dateReceived)}</Box>
                <Box as="td" {...cell}>{s.vendor || "—"}</Box>
                <Box as="td" {...cell}>{s.vendorLot || "—"}</Box>
                <Box as="td" {...cell}>{s.estNumber || "—"}</Box>
                <Box as="td" {...cell}>{s.brand || "—"}</Box>
                <Box as="td" {...cell}>{s.grade || "—"}</Box>
                <Box as="td" {...num}>{s.cases ?? (s.totalQuantity || "—")}</Box>
                <Box as="td" {...num}>{s.originalWeight ? fmtWeight(s.originalWeight) : "—"}</Box>
                <Box as="td" {...cell} textAlign="right">
                  {!readOnly && (
                    <Button size="xs" variant="ghost" colorScheme="red"
                      isDisabled={Boolean(mix.removeBlocked)}
                      title={mix.removeBlocked || "Take this lot back out of the mix"}
                      onClick={() => setConfirm({ kind: "remove", source: s })}>
                      Take out
                    </Button>
                  )}
                </Box>
              </tr>
            ))}
            {mix.sources.length === 0 && (
              <tr><Box as="td" {...cell} colSpan={10} color="gray.500">No lots in this mix yet.</Box></tr>
            )}
            <Box as="tr" bg="gray.50" fontWeight="bold">
              <Box as="td" {...cell} colSpan={7}>Total, {mix.sources.length} lot{mix.sources.length === 1 ? "" : "s"}</Box>
              <Box as="td" {...num}>{t.cases}</Box>
              <Box as="td" {...num}>{t.lb}</Box>
              <Box as="td" {...cell} />
            </Box>
          </tbody>
        </Box>
      </Box>
      <Flex mt={2} gap={2} align="center" wrap="wrap">
        {!readOnly && (
          <Button size="xs" colorScheme="purple" variant="outline" onClick={() => setAdding(true)}>+ Add lots</Button>
        )}
        <Text fontSize="xs" color="gray.500" flex="1 1 240px">
          {mix.casesOnHand != null ? `${mix.casesOnHand} cases on hand on ${mix.lotNumber}. ` : ""}
          {mix.removeBlocked
            ? "Lots can still be added, but no longer taken out."
            : "Lots can be taken out until the mix is processed."}
        </Text>
        {!readOnly && !mix.removeBlocked && (
          <Button size="xs" variant="ghost" colorScheme="red" onClick={() => setConfirm({ kind: "undo" })}>
            Undo mix
          </Button>
        )}
      </Flex>

      {!readOnly && (
        <AddLotsWindow isOpen={adding} onClose={() => setAdding(false)} mix={mix}
          onAdded={(data) => { setAdding(false); changed(data); }} />
      )}

      <AlertDialog isOpen={Boolean(confirm)} leastDestructiveRef={safeRef} onClose={() => setConfirm(null)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {confirm?.kind === "remove" ? `Take ${confirm.source.lotNumber} out of ${mix.lotNumber}?` : `Undo ${mix.lotNumber}?`}
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm">
                {confirm?.kind === "remove"
                  ? `${confirm.source.lotNumber} gets its own stock back, and ${mix.lotNumber} drops by what it brought.`
                  : `Every lot gets its own stock back, and ${mix.lotNumber} and its registration form are deleted.`}
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={safeRef} onClick={() => setConfirm(null)}>Go back</Button>
              <Button colorScheme="red" isLoading={busy} onClick={runConfirm}>
                {confirm?.kind === "remove" ? "Take it out" : "Undo the mix"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
};

/** A value an NX form takes from its lots, shown read-only. */
export const MixValue = ({ value, children }) => (
  <Flex px={2} py={1} minH={{ base: "44px", md: "32px" }} align="center" gap={2}>
    <Text fontSize="sm" color={value === MIXED_TEXT ? "purple.700" : "gray.700"}
      fontWeight={value === MIXED_TEXT ? "semibold" : "normal"}>
      {children ?? (value || "—")}
    </Text>
  </Flex>
);
