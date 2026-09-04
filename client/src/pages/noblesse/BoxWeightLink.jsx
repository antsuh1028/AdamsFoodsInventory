import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Checkbox, Spinner, Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import { toDisplay, toDisplayHundredths } from "../../utils/weight";
import { fmtDate } from "./shared";

// Ties weighing sessions to a registration form.
//
// The form records what came in; box weighing is how that figure is actually
// measured. Before this, someone read a total off a printed manifest and typed
// it into the form, which is a transcription step with nothing checking it.
//
// The link is a REFERENCE, not a copy — the same choice merged manifests make.
// The form's own Original Weight stays a stable record of what was filed, and
// the live box total is shown beside it, so a box corrected or voided after the
// form was filled shows up here as a discrepancy instead of silently rewriting
// a filed form and the yield calculated from it.

const cents = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = String(v).trim();
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(n)) return null;
  return Number(toDisplayHundredths(n));
};

// `pendingBatchIds` / `onPendingChange` are how this works BEFORE a form exists.
// The boxes are weighed on the dock first and the form is written up afterwards,
// so requiring a saved form before sessions could be picked had the real
// sequence backwards. On a new form the picks are held on the draft and the
// links are written straight after it saves.
const BoxWeightLink = ({
  formId, lotNumber, draft, setDraft,
  pendingBatchIds = [], onPendingChange,
}) => {
  const [linked, setLinked] = useState(null);
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(() => new Set());
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
        axiosInstance.get("/box-batches"),
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
      // returns a plain `total` string. Normalised here so one render path
      // serves both, rather than the row silently showing an empty weight.
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
  //
  // Matched on lot_id when both sides have one — exact, and it cannot pair the
  // wrong lot. The text contains-match stays as the fallback for sessions that
  // predate the registry or whose lot cell never resolved ("P12 N26230-01").
  // Every session stays selectable either way.
  const options = useMemo(() => {
    const lot = String(lotNumber || "").trim().toUpperCase();
    const formLotId = draft?.lotId ?? null;
    return available
      .filter((b) => !linkedIds.has(b.batch_id))
      .map((b) => ({
        ...b,
        suggested: (formLotId != null && b.lot_id === formLotId)
          || (formLotId == null && Boolean(lot)
              && String(b.lot_number || "").toUpperCase().includes(lot)),
      }))
      .sort((a, b) => (b.suggested ? 1 : 0) - (a.suggested ? 1 : 0));
  }, [available, linkedIds, lotNumber, draft]);

  const suggested = useMemo(() => options.filter((b) => b.suggested), [options]);

  const mutate = async (run) => {
    setLoading(true);
    try {
      const { data } = await run();
      setLinked(data);
      setPicking(new Set());
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

  // Several at once: a lot weighed across two pallets, or a session stopped
  // and restarted, is one delivery on one form. The endpoint has always taken
  // an array.
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
  // written up FROM, so the heading comes across too. Only into fields still
  // empty: whatever the operator already typed wins over anything inferred.
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
    if (!String(draft.vendor || "").trim() && first.vendor) filled.vendor = first.vendor;
    if (!String(draft.productDescription || "").trim() && first.item_description) {
      filled.productDescription = first.item_description;
    }
    setDraft(filled);

    const also = [
      filled.lotNumber !== draft.lotNumber && "lot",
      filled.vendor !== draft.vendor && "vendor",
      filled.productDescription !== draft.productDescription && "description",
    ].filter(Boolean);

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
              <Button size="xs" variant="ghost" colorScheme="orange" fontWeight="500"
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
                <Badge colorScheme={s.status === "closed" ? "green" : "orange"} fontSize="9px">
                  {s.status === "closed" ? "Closed" : "Open"}
                </Badge>
                {s.source === "imported" && (
                  <Badge colorScheme="teal" fontSize="9px">Imported</Badge>
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

      {options.length === 0 ? (
        <Text fontSize="xs" color="gray.500">
          {available.length
            ? "Every weighing session is already tied to this form."
            : "No weighing sessions to tie yet."}
        </Text>
      ) : (
        <>
          <Flex justify="space-between" align="baseline" mb={1} gap={2} wrap="wrap">
            <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
              Tie weighing sessions
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
                  <Text as="span" fontWeight="600" color="blue.700">
                    {b.lot_number || `Batch ${b.batch_id}`}
                  </Text>
                  {b.vendor && <Text as="span" color="gray.600">{b.vendor}</Text>}
                  <Text as="span" color="gray.500" fontSize="xs">
                    {b.box_count} box{b.box_count === 1 ? "" : "es"}
                  </Text>
                </Flex>
              </Checkbox>
            ))}
          </Box>

          <Button size="sm" colorScheme="blue" isDisabled={picking.size === 0}
            onClick={() => link([...picking])}>
            {picking.size > 1 ? `Tie ${picking.size} sessions` : "Tie session"}
          </Button>
        </>
      )}
    </Box>
  );
};

export default BoxWeightLink;
