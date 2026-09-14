import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Checkbox, Spinner, Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import { toDisplay, toDisplayHundredths } from "../../utils/weight";
import { fmtDate, today } from "./shared";

// Ties weighing sessions to a registration form.

const cents = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = String(v).trim();
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(n)) return null;
  return Number(toDisplayHundredths(n));
};

// `pendingBatchIds` / `onPendingChange` are how this works BEFORE a form exists.
const BoxWeightLink = ({
  formId, lotNumber, draft, setDraft,
  pendingBatchIds = [], onPendingChange,
}) => {
  const [linked, setLinked] = useState(null);
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(() => new Set());
  // Collapsed once something is tied. Tying is the job when the form is empty
  // and an afterthought once it is done, so the picker stops taking up the
  // panel and becomes a button.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: links }, { data: batches }] = await Promise.all([
        // A form that does not exist yet has nothing linked; the sessions still
        // need listing so they can be picked.
        formId
          ? axiosInstance.get(`/noblesse-registration-forms/${formId}/box-batches`)
          : Promise.resolve({ data: { sessions: [], boxCount: 0, totalWeight: "0", weightUnit: "LB" } }),
        // ARRIVALS ONLY, and this one parameter is the whole guard on this screen.
        axiosInstance.get("/box-batches", { params: { direction: "incoming" } }),
      ]);
      setLinked(links);
      setAvailable(batches || []);
    } catch (err) {
      toast({
        title: "Could not load box weights",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top",
      });
    } finally {
      setLoading(false);
    }
  }, [formId, toast]);

  useEffect(() => { load(); }, [load]);

  const pending = !formId;

  // Before the form exists the picks live on the draft, so "linked" is derived
  // from the same session list instead of coming back from the server.
  const view = useMemo(() => {
    if (!pending) return linked;
    const chosen = available
      .filter((b) => pendingBatchIds.includes(b.batch_id))
      // /box-batches returns totals as [{unit,total}] while the linked endpoint
      // returns a plain `total` string.
      .map((b) => ({ ...b, total: b.totals?.[0]?.total ?? "0" }));
    const totalWeight = chosen
      .reduce((sum, b) => sum + Math.round(Number(b.total) * 1000), 0) / 1000;
    return {
      sessions: chosen,
      boxCount: chosen.reduce((sum, b) => sum + (Number(b.box_count) || 0), 0),
      totalWeight: String(totalWeight),
      weightUnit: "LB",
    };
  }, [pending, linked, available, pendingBatchIds]);

  const linkedIds = useMemo(
    () => new Set((view?.sessions || []).map((s) => s.batch_id)),
    [view]
  );

  // Sessions for this lot float to the top of the picker.
  const options = useMemo(() => {
    const lot = String(lotNumber || "").trim().toUpperCase();
    const formLotId = draft?.lotId ?? null;
    const todayStr = today();
    return available
      .filter((b) => !linkedIds.has(b.batch_id))
      // Already claimed by another registration form.
      .filter((b) => b.form_id == null)
      .map((b) => ({
        ...b,
        suggested: (formLotId != null && b.lot_id === formLotId)
          || (formLotId == null && Boolean(lot)
              && String(b.lot_number || "").toUpperCase().includes(lot)),
        // Weighed today — the arrivals someone is most likely registering right
        // now.
        isToday: String(b.created_at).slice(0, 10) === todayStr,
      }))
      .sort((a, b) => (b.suggested ? 1 : 0) - (a.suggested ? 1 : 0));
  }, [available, linkedIds, lotNumber, draft]);

  const suggested = useMemo(() => options.filter((b) => b.suggested), [options]);

  // Hidden because another form already claims them.
  const tiedElsewhere = useMemo(
    () => available.filter((b) => b.form_id != null && !linkedIds.has(b.batch_id)).length,
    [available, linkedIds]
  );

  const mutate = async (run) => {
    setLoading(true);
    try {
      const { data } = await run();
      setLinked(data);
      setPicking(new Set());
      setPickerOpen(false);
    } catch (err) {
      toast({
        title: err.response?.data?.code === "SESSION_ALREADY_TIED"
          ? "Those boxes belong to another form"
          : "Could not change the link",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 8000, position: "top", isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  // Several at once: a lot weighed across two pallets, or a session stopped and
  // restarted, is one delivery on one form.
  const link = (batchIds) => {
    if (pending) {
      // Nothing to POST to yet. The parent writes these links the moment the
      // form has an id.
      onPendingChange([...new Set([...pendingBatchIds, ...batchIds.map(Number)])]);
      setPicking(new Set());
      return Promise.resolve();
    }
    return mutate(() =>
      axiosInstance.post(`/noblesse-registration-forms/${formId}/box-batches`,
        { batchIds: batchIds.map(Number) }));
  };

  const togglePick = (batchId) => setPicking((prev) => {
    const next = new Set(prev);
    if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
    return next;
  });

  const unlink = (batchId) => {
    if (pending) {
      onPendingChange(pendingBatchIds.filter((id) => id !== batchId));
      return Promise.resolve();
    }
    return mutate(() =>
      axiosInstance.delete(`/noblesse-registration-forms/${formId}/box-batches/${batchId}`));
  };

  // The sessions do not just supply a weight — they are what the form is being
  // written up FROM, so the heading comes across too.
  const FROM_SESSION = [
    ["vendor", "vendor", "vendor"],
    ["productDescription", "item_description", "description"],
    ["vendorLot", "bill_of_lading", "vendor lot"],
    ["brand", "brand", "brand"],
    ["estNumber", "est_number", "EST #"],
    ["grade", "grade", "grade"],
  ];

  const applyToForm = () => {
    const first = view.sessions[0] || {};
    const filled = {
      ...draft,
      originalWeight: view.totalWeight,
      totalQuantity: String(view.boxCount),
    };
    if (!draft.lotId && first.lot_id) {
      filled.lotId = first.lot_id;
      filled.lotNumber = first.lot_number || draft.lotNumber;
    }

    const also = [];
    if (filled.lotNumber !== draft.lotNumber) also.push("lot");
    for (const [formKey, sessionKey, label] of FROM_SESSION) {
      if (!String(draft[formKey] || "").trim() && first[sessionKey]) {
        filled[formKey] = first[sessionKey];
        also.push(label);
      }
    }
    setDraft(filled);

    toast({
      title: "Boxes applied",
      description: `${toDisplay(view.totalWeight)} lb across ${view.boxCount} boxes` +
        (also.length ? `, plus ${also.join(", ")}.` : "."),
      status: "success", duration: 3000, position: "top",
    });
  };

  const live = view ? cents(view.totalWeight) : null;
  const onForm = cents(draft.originalWeight);
  const drifted = live !== null && onForm !== null && live !== onForm;
  const hasBoxes = Boolean(view && view.sessions.length);

  // Anything WRONG keeps the section open: a collapsed panel must never be the
  // reason nobody saw a discrepancy.
  const needsAttention = drifted || suggested.length > 0;
  const collapsed = hasBoxes && !open && !needsAttention;

  if (collapsed) {
    return (
      <Flex align="baseline" gap={3} wrap="wrap"
        px={3} py={2} bg="blue.50" borderRadius="md"
        border="1px solid" borderColor="blue.200">
        <Text fontSize="sm" fontWeight="bold" color="blue.800"
          style={{ fontVariantNumeric: "tabular-nums" }}>
          {toDisplay(view.totalWeight)} lb
        </Text>
        <Text fontSize="sm" color="gray.700">
          {view.boxCount} box{view.boxCount === 1 ? "" : "es"}
        </Text>
        <Text fontSize="xs" color="gray.600">
          {view.sessions.map((x) => x.lot_number || `Batch ${x.batch_id}`).join(", ")}
        </Text>
        {pending && <Text fontSize="xs" color="gray.500">tied when you save</Text>}
        <Box flex={1} />
        <Button size="xs" variant="ghost" colorScheme="blue" onClick={() => setOpen(true)}>
          Change
        </Button>
      </Flex>
    );
  }

  return (
    <Box p={3} bg="blue.50" borderRadius="md" border="1px solid" borderColor="blue.200">
      <Flex justify="space-between" align="baseline" mb={2} gap={2} wrap="wrap">
        <Text fontSize="sm" fontWeight="bold" color="blue.800">
          Box weights
        </Text>
        {pending && hasBoxes && (
          <Text fontSize="xs" color="gray.500">tied when you save</Text>
        )}
        {loading && <Spinner size="xs" color="blue.500" />}
        <Box flex={1} />
        {hasBoxes && !needsAttention && (
          <Button size="xs" variant="ghost" colorScheme="blue"
            onClick={() => { setPickerOpen(false); setOpen(false); }}>
            Done
          </Button>
        )}
      </Flex>

      {hasBoxes && (
        <>
          <Flex align="baseline" gap={4} wrap="wrap" mb={2}>
            <Flex align="baseline" gap={2}>
              <Text fontSize="xs" color="gray.500" textTransform="uppercase">Weighed</Text>
              <Text fontSize="2xl" fontWeight="bold" color="blue.800"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {toDisplay(view.totalWeight)}
              </Text>
              <Text fontSize="sm" color="gray.600">lb</Text>
            </Flex>
            <Text fontSize="sm" color="gray.700">
              {view.boxCount} box{view.boxCount === 1 ? "" : "es"}
            </Text>
            <Button size="xs" colorScheme="blue" onClick={applyToForm} ml="auto">
              Use these boxes
            </Button>
          </Flex>

          {/* A lot is often weighed across two sessions — one pallet, then
              another. Tie one and the drift warning below stays quiet, because
              it compares the form against what is LINKED and those agree. So
              the untied ones have to be pointed at explicitly. */}
          {suggested.length > 0 && (
            <Alert status="warning" borderRadius="md" fontSize="xs" mb={2} py={2}>
              <AlertIcon boxSize={3} />
              <Box flex={1}>
                {suggested.length} more weighing session{suggested.length === 1 ? "" : "s"} for
                this lot {suggested.length === 1 ? "is" : "are"} not tied
                {" — "}
                {suggested.reduce((n, b) => n + (Number(b.box_count) || 0), 0)} more boxes.
              </Box>
              <Button size="xs" variant="ghost" colorScheme="yellow" fontWeight="500"
                isLoading={loading}
                onClick={() => link(suggested.map((b) => b.batch_id))}>
                Tie {suggested.length === 1 ? "it" : "them"}
              </Button>
            </Alert>
          )}

          {/* The point of keeping the link a reference: a box corrected after
              this form was filled shows up here instead of quietly changing it. */}
          {drifted && (
            <Alert status="warning" borderRadius="md" fontSize="xs" mb={2} py={2}>
              <AlertIcon boxSize={3} />
              <Box>
                The form says {toDisplay(draft.originalWeight)} lb but the boxes now
                weigh {toDisplay(view.totalWeight)} lb. A box was probably corrected
                or voided since this was filled in.
              </Box>
            </Alert>
          )}

          <Flex direction="column" gap={1} mb={2}>
            {view.sessions.map((s) => (
              <Flex key={s.batch_id} align="baseline" gap={2} wrap="wrap"
                px={2} py={1} bg="white" borderRadius="sm"
                border="1px solid" borderColor="blue.100">
                <Text fontSize="sm" fontWeight="600" color="blue.700">
                  {s.lot_number || `Batch ${s.batch_id}`}
                </Text>
                <Badge colorScheme={s.status === "closed" ? "green" : "yellow"} fontSize="9px">
                  {s.status === "closed" ? "Closed" : "Open"}
                </Badge>
                {s.source === "imported" && (
                  <Badge colorScheme="teal" fontSize="9px">Imported</Badge>
                )}
                {/* A tie that should never have been made. The server refuses
                    these now, but any made BEFORE that guard existed are still
                    sitting on filed forms, inflating Original Weight with
                    product that was leaving rather than arriving. Without this
                    badge they look exactly like a good tie, so nobody would
                    ever find them — it is the only way back out. */}
                {s.direction === "outgoing" && (
                  <Badge colorScheme="red" fontSize="9px"
                    title="Finished product going out — not an arrival. Untie it.">
                    OUTGOING — UNTIE
                  </Badge>
                )}
                <Text fontSize="xs" color="gray.500">
                  {fmtDate(String(s.created_at).slice(0, 10))}
                </Text>
                <Text fontSize="sm" color="gray.700" ml="auto"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {s.box_count} × {toDisplay(s.total)} lb
                </Text>
                <Button size="xs" variant="ghost" colorScheme="red"
                  onClick={() => unlink(s.batch_id)}>
                  Untie
                </Button>
              </Flex>
            ))}
          </Flex>
        </>
      )}

      {!hasBoxes && !loading && (
        <Text fontSize="sm" color="gray.600" mb={2}>
          No weighing sessions tied to this form yet.
        </Text>
      )}

      {/* Folded away when boxes are already on the form. The drift warning and
          the untied-sibling nudge above stay visible either way — those say
          something is WRONG, which a collapsed section must never hide. */}
      {hasBoxes && !pickerOpen && options.length > 0 && (
        <Button size="xs" variant="outline" colorScheme="blue"
          onClick={() => setPickerOpen(true)}>
          Tie another lot
          {options.length > 1 ? ` (${options.length} available)` : ""}
        </Button>
      )}

      {(!hasBoxes || pickerOpen) && (options.length === 0 ? (
        <Text fontSize="xs" color="gray.500">
          {/* Says WHY the list is short. A list that silently filters itself to
              nothing reads as "there is no work here", which is the opposite of
              the truth — the same reasoning behind the tiedElsewhere count. */}
          {!available.length
            ? "No incoming weighing sessions to tie yet. Finished product weighed " +
              "on the way out is on the Outgoing tab — it records what left, so it " +
              "cannot be registered as an arrival."
            : tiedElsewhere > 0
              ? `Nothing left to tie. ${tiedElsewhere} weighing session${tiedElsewhere === 1 ? " is" : "s are"} ` +
                `on another registration form and cannot be tied twice.`
              : "Every weighing session is already tied to this form."}
        </Text>
      ) : (
        <>
          <Flex justify="space-between" align="baseline" mb={1} gap={2} wrap="wrap">
            <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
              Tie lot
            </Text>
            {suggested.length > 0 && (
              <Button size="xs" variant="link" colorScheme="blue"
                onClick={() => setPicking(new Set(suggested.map((b) => b.batch_id)))}>
                Select the {suggested.length} matching this lot
              </Button>
            )}
          </Flex>

          <Box maxH="132px" overflowY="auto" bg="white" borderRadius="md"
            border="1px solid" borderColor="blue.100" px={2} py={1} mb={2}>
            {options.map((b) => (
              <Checkbox
                key={b.batch_id}
                size="sm"
                width="100%"
                py={1}
                isChecked={picking.has(b.batch_id)}
                onChange={() => togglePick(b.batch_id)}
              >
                <Flex align="baseline" gap={2} wrap="wrap" fontSize="sm">
                  {b.suggested && (
                    <Text as="span" color="blue.500" title="Lot matches this form">★</Text>
                  )}
                  <Text as="span" fontWeight="600"
                    color={b.isToday ? "green.700" : "blue.700"}>
                    {b.lot_number || `Batch ${b.batch_id}`}
                  </Text>
                  {b.isToday && (
                    <Badge colorScheme="green" fontSize="9px" px={1.5} borderRadius="full">
                      TODAY
                    </Badge>
                  )}
                  {b.vendor && <Text as="span" color="gray.600">{b.vendor}</Text>}
                  <Text as="span" color="gray.500" fontSize="xs">
                    {b.box_count} box{b.box_count === 1 ? "" : "es"}
                  </Text>
                </Flex>
              </Checkbox>
            ))}
          </Box>

          <Flex gap={2}>
            <Button size="sm" colorScheme="blue" isDisabled={picking.size === 0}
              onClick={() => link([...picking])}>
              {picking.size > 1 ? `Tie ${picking.size} lots` : "Tie lot"}
            </Button>
            {hasBoxes && (
              <Button size="sm" variant="ghost"
                onClick={() => { setPicking(new Set()); setPickerOpen(false); }}>
                Done
              </Button>
            )}
          </Flex>
        </>
      ))}
    </Box>
  );
};

export default BoxWeightLink;
