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

const BoxWeightLink = ({ formId, lotNumber, draft, setDraft }) => {
  const [linked, setLinked] = useState(null);
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(() => new Set());
  const toast = useToast();

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    try {
      const [{ data: links }, { data: batches }] = await Promise.all([
        axiosInstance.get(`/noblesse-registration-forms/${formId}/box-batches`),
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

  const linkedIds = useMemo(
    () => new Set((linked?.sessions || []).map((s) => s.batch_id)),
    [linked]
  );

  // Sessions for this lot float to the top of the picker. Lot cells are often
  // messy ("P12 N26230-01"), so this is a contains match used only for ordering
  // — every session stays selectable.
  const options = useMemo(() => {
    const lot = String(lotNumber || "").trim().toUpperCase();
    return available
      .filter((b) => !linkedIds.has(b.batch_id))
      .map((b) => ({
        ...b,
        suggested: Boolean(lot) && String(b.lot_number || "").toUpperCase().includes(lot),
      }))
      .sort((a, b) => (b.suggested ? 1 : 0) - (a.suggested ? 1 : 0));
  }, [available, linkedIds, lotNumber]);

  const suggested = useMemo(() => options.filter((b) => b.suggested), [options]);

  const mutate = async (run) => {
    setLoading(true);
    try {
      const { data } = await run();
      setLinked(data);
      setPicking(new Set());
    } catch (err) {
      toast({
        title: "Could not change the link",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 5000, position: "top",
      });
    } finally {
      setLoading(false);
    }
  };

  // Several at once: a lot weighed across two pallets, or a session stopped
  // and restarted, is one delivery on one form. The endpoint has always taken
  // an array.
  const link = (batchIds) => mutate(() =>
    axiosInstance.post(`/noblesse-registration-forms/${formId}/box-batches`,
      { batchIds: batchIds.map(Number) }));

  const togglePick = (batchId) => setPicking((prev) => {
    const next = new Set(prev);
    if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
    return next;
  });

  const unlink = (batchId) => mutate(() =>
    axiosInstance.delete(`/noblesse-registration-forms/${formId}/box-batches/${batchId}`));

  const applyToForm = () => {
    setDraft({
      ...draft,
      originalWeight: linked.totalWeight,
      totalQuantity: String(linked.boxCount),
    });
    toast({
      title: "Weights applied",
      description: `${toDisplay(linked.totalWeight)} lb across ${linked.boxCount} boxes.`,
      status: "success", duration: 3000, position: "top",
    });
  };

  // A form saved before this existed has no id to hang links on.
  if (!formId) {
    return (
      <Box p={3} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
        <Text fontSize="sm" color="gray.600">
          Save this form once, then weighing sessions can be tied to it and their
          weights pulled in.
        </Text>
      </Box>
    );
  }

  const live = linked ? cents(linked.totalWeight) : null;
  const onForm = cents(draft.originalWeight);
  const drifted = live !== null && onForm !== null && live !== onForm;
  const hasBoxes = Boolean(linked && linked.sessions.length);

  return (
    <Box p={3} bg="blue.50" borderRadius="md" border="1px solid" borderColor="blue.200">
      <Flex justify="space-between" align="baseline" mb={2} gap={2} wrap="wrap">
        <Text fontSize="sm" fontWeight="bold" color="blue.800">
          Box weights
        </Text>
        {loading && <Spinner size="xs" color="blue.500" />}
      </Flex>

      {hasBoxes && (
        <>
          <Flex align="baseline" gap={4} wrap="wrap" mb={2}>
            <Flex align="baseline" gap={2}>
              <Text fontSize="xs" color="gray.500" textTransform="uppercase">Weighed</Text>
              <Text fontSize="2xl" fontWeight="bold" color="blue.800"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {toDisplay(linked.totalWeight)}
              </Text>
              <Text fontSize="sm" color="gray.600">lb</Text>
            </Flex>
            <Text fontSize="sm" color="gray.700">
              {linked.boxCount} box{linked.boxCount === 1 ? "" : "es"}
            </Text>
            <Button size="xs" colorScheme="blue" onClick={applyToForm} ml="auto">
              Use these weights
            </Button>
          </Flex>

          {/* The point of keeping the link a reference: a box corrected after
              this form was filled shows up here instead of quietly changing it. */}
          {drifted && (
            <Alert status="warning" borderRadius="md" fontSize="xs" mb={2} py={2}>
              <AlertIcon boxSize={3} />
              <Box>
                The form says {toDisplay(draft.originalWeight)} lb but the boxes now
                weigh {toDisplay(linked.totalWeight)} lb. A box was probably corrected
                or voided since this was filled in.
              </Box>
            </Alert>
          )}

          <Flex direction="column" gap={1} mb={2}>
            {linked.sessions.map((s) => (
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
