import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Spinner, Input, Select, Checkbox, Alert, AlertIcon, Tooltip,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import WeighFinishedBoxes from "../../components/navbar/WeighFinishedBoxes";
import DeleteBatchDialog from "./DeleteBatchDialog";
import { toDisplay } from "../../utils/weight";
import { fmtDate, fmtDateTime, today, upper } from "./shared";
import getRole from "../../utils/getRole";
import printPackingList from "./printPackingList";

// Outgoing: product leaving NTI, either back to AdamsFoods for distribution or
// straight to a customer.

const STATUS = {
  draft:     { label: "Draft",     color: "gray" },
  shipped:   { label: "Shipped",   color: "green" },
  cancelled: { label: "Cancelled", color: "red" },
};

const lb = (v) => (v === null || v === undefined || v === "" ? "0.00" : toDisplay(v));

// The stock row's own description, or what the bench typed when weighing it out.
// Trimmed so the lot number itself is not pushed off a narrow select.
const MAX_DESC = 32;

const stockDescription = (a) => {
  const d = (a.description || a.weighedDescription || "").trim();
  if (!d) return "";
  return d.length > MAX_DESC ? `${d.slice(0, MAX_DESC - 1)}\u2026` : d;
};

// One weighed session opened up: what it was, and every box in it.
//
// Read-only on purpose. Correcting or voiding a box is the Weight Manifests
// tab's job and it carries the guards for that; this is the Outgoing tab
// answering "what is actually in this session".
const BatchBoxes = ({ detail, totalLb }) => {
  if (!detail) {
    return <Flex justify="center" py={4}><Spinner size="sm" color="blue.500" /></Flex>;
  }
  const items = detail.items || [];
  const live = items.filter((it) => !it.voidedAt);
  const voided = items.length - live.length;

  const facts = [
    ["Item", detail.item_description],
    ["Going to", detail.ship_to],
    ["Vendor", detail.vendor],
    ["BOL", detail.bill_of_lading],
    ["Brand", detail.brand],
    ["EST", detail.est_number],
    ["Grade", detail.grade],
    ["Expected", detail.expected_boxes],
    ["Added", fmtDateTime(detail.created_at)],
    ["Closed", fmtDateTime(detail.closed_at)],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <Box mt={1} mb={2} px={3} py={3} bg="gray.50" borderRadius="md"
      border="1px solid" borderColor="blue.200">
      {facts.length > 0 && (
        <Flex gap={4} wrap="wrap" mb={3}>
          {facts.map(([label, value]) => (
            <Box key={label}>
              <Text fontSize="9px" color="gray.500" textTransform="uppercase"
                letterSpacing="wide">{label}</Text>
              <Text fontSize="sm" color="gray.800">{value}</Text>
            </Box>
          ))}
        </Flex>
      )}

      {detail.remarks && (
        <Text fontSize="xs" color="gray.600" mb={3}>Remarks: {detail.remarks}</Text>
      )}

      <Flex align="baseline" gap={3} wrap="wrap" mb={2}>
        <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
          Boxes
        </Text>
        <Text fontSize="sm" fontWeight="600" color="gray.800"
          style={{ fontVariantNumeric: "tabular-nums" }}>
          {live.length} · {lb(totalLb)} lb
        </Text>
        {voided > 0 && (
          <Text fontSize="xs" color="gray.500">({voided} voided, not in that total)</Text>
        )}
      </Flex>

      {items.length === 0 ? (
        <Text fontSize="sm" color="gray.500">No boxes were recorded in this session.</Text>
      ) : (
        // Wrapping badges rather than a wide table: this list is read on a
        // tablet, where a ten-column grid would scroll sideways.
        <Flex wrap="wrap" gap={2}>
          {items.map((it, i) => (
            <Badge key={it.localId ?? i}
              colorScheme={it.voidedAt ? "red" : "gray"}
              fontSize="sm" px={2} py={1} borderRadius="md"
              title={it.voidedAt ? `Voided: ${it.voidReason || "no reason given"}` : undefined}
              style={{
                fontVariantNumeric: "tabular-nums",
                textDecoration: it.voidedAt ? "line-through" : "none",
              }}>
              {/* A tilde marks a figure nobody weighed - a batch entry off the
                  label, where the boxes themselves vary. */}
              {it.isEstimated ? "~" : ""}{it.weight}
              {it.weightUnit && it.weightUnit !== "LB" ? ` ${it.weightUnit}` : ""}
            </Badge>
          ))}
        </Flex>
      )}
    </Box>
  );
};

const Field = ({ label, children, w }) => (
  <Box flex={w ? `0 0 ${w}` : "1 1 150px"} minW="120px">
    <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide" mb={1}>
      {label}
    </Text>
    {children}
  </Box>
);

export const OutgoingTab = ({ refreshSignal = 0 }) => {
  const isAdmin = getRole() === "admin";
  const toast = useToast();

  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [available, setAvailable] = useState([]);
  const [stockError, setStockError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(null);
  // Set while the same form is editing an existing draft rather than making one.
  const [editingId, setEditingId] = useState(null);

  // A new line being added to the open draft.
  const [line, setLine] = useState({ stockKey: "", weight: "", qtyCases: "" });

  // Finished product weighed at the bench. Listed on this tab in its own right
  // now, not just offered inside an open draft.
  const [batches, setBatches] = useState([]);
  const [pickedBatches, setPickedBatches] = useState(() => new Set());
  // A session to reopen the weighing window on, so an interrupted lot can be
  // carried on with instead of started again.
  const [adoptBatchId, setAdoptBatchId] = useState(null);
  // A weighed session an admin wants gone. The route refuses while a load or a
  // form still references it, and the dialog says which.
  const [deletingBatch, setDeletingBatch] = useState(null);

  const [confirmShip, setConfirmShip] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Weighing finished product. Opens the same session machinery the incoming
  // bench uses, pointed the other way.
  const [weighOpen, setWeighOpen] = useState(false);
  // Which weighed session is expanded, and its boxes once fetched. Cached by
  // id so collapsing and reopening does not refetch.
  const [openBatch, setOpenBatch] = useState(null);
  const [batchDetail, setBatchDetail] = useState({});
  // Weighing straight into a line: the lot is already decided, so the window
  // opens bound to it and the finished session is tied to this load on close.
  const [weighFor, setWeighFor] = useState(null);
  const cancelRef = useRef(null);

  const fetchShipments = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/shipments");
      setShipments(data || []);
    } catch (err) {
      toast({ title: "Could not load shipments",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchAvailable = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/shipments/available");
      setAvailable(data || []);
      setStockError(null);
    } catch (err) {
      // Tolerated so a failure here cannot blank the shipments themselves — but
      // NOT swallowed: an empty dropdown with no explanation reads as "there is
      // nothing to ship".
      setStockError(err.response?.data?.error || err.message);
    }
  }, []);

  // OUTGOING ONLY.
  const fetchBatches = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/box-batches",
        { params: { direction: "outgoing" } });
      setBatches(data || []);
    } catch {
      // Tying a session is optional, so failing to list them must not stop a
      // load being built by typing its totals.
    }
  }, []);

  useEffect(() => {
    fetchShipments(); fetchAvailable(); fetchBatches();
  }, [fetchShipments, fetchAvailable, fetchBatches]);

  // The parent polls every 60s and bumps this.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    fetchShipments();
    fetchAvailable();
    // Weighed sessions are primary content on this tab now, not just a picker
    // inside a draft, so they have to follow the poll.
    fetchBatches();
  }, [refreshSignal, fetchShipments, fetchAvailable, fetchBatches]);

  const openShipment = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    try {
      const { data } = await axiosInstance.get(`/shipments/${id}`);
      setDetail(data);
    } catch (err) {
      toast({ title: "Could not open that shipment",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
      setOpenId(null);
    }
  };

  const refreshOpen = async (id) => {
    const { data } = await axiosInstance.get(`/shipments/${id}`);
    setDetail(data);
    fetchShipments();
    fetchAvailable();
  };

  const run = async (fn, successTitle) => {
    setBusy(true);
    try {
      await fn();
      if (successTitle) {
        toast({ title: successTitle, status: "success", duration: 3000, position: "top" });
      }
    } catch (err) {
      const body = err.response?.data;
      toast({
        title: "That did not work",
        // The server names the lot and the shortfall when a load asks for more
        // than is on hand, which is exactly what the operator needs to see.
        description: body?.shortfalls
          ? body.shortfalls.map((s) =>
              `${s.lotNumber}: asked ${lb(s.requested)}, on hand ${lb(s.onHand)}`).join(" · ")
          : (body?.error || err.message),
        status: "error", duration: 8000, position: "top", isClosable: true,
      });
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const tieSessions = () => run(async () => {
    await axiosInstance.post(`/shipments/${openId}/box-batches`,
      { batchIds: [...pickedBatches] });
    setPickedBatches(new Set());
    await refreshOpen(openId);
  }, "Weighing sessions tied");

  const untieSession = (batchId) => run(async () => {
    await axiosInstance.delete(`/shipments/${openId}/box-batches/${batchId}`);
    await refreshOpen(openId);
  });

  const startDraft = () => {
    setDraft({
      shipDate: today(), destinationType: "adamsfoods", destinationName: "",
      billOfLading: "", carrier: "", driver: "", shipTo: "",
    });
    setCreating(true);
  };

  const startEdit = () => {
    setDraft({
      shipDate: detail.shipDate || today(),
      destinationType: detail.destinationType || "adamsfoods",
      destinationName: detail.destinationName || "",
      billOfLading: detail.billOfLading || "",
      carrier: detail.carrier || "",
      driver: detail.driver || "",
      shipTo: detail.shipTo || "",
    });
    setEditingId(detail.shipmentId);
    setCreating(true);
  };

  const closeForm = () => { setCreating(false); setEditingId(null); setDraft(null); };

  const saveHeader = () => run(async () => {
    await axiosInstance.patch(`/shipments/${editingId}`, draft);
    closeForm();
    await fetchShipments();
    await refreshOpen(editingId);
  }, "Shipment updated");

  const createDraft = () => run(async () => {
    const { data } = await axiosInstance.post("/shipments", draft);
    closeForm();
    await fetchShipments();
    setOpenId(data.shipmentId);
    setDetail(data);
  }, "Draft created");

  const addLine = () => run(async () => {
    const stock = available.find((a) => String(a.ntiItemId) === String(line.stockKey));
    // Thrown rather than returned: `run` reports a throw and swallows a return,
    // so this used to no-op and still say "Lot added".
    if (!stock) throw new Error("That stock row is no longer available — refresh and pick again.");
    await axiosInstance.post(`/shipments/${openId}/items`, {
      lotId: stock.lotId,
      ntiItemId: stock.ntiItemId,
      weight: String(line.weight).trim(),
      qtyCases: line.qtyCases !== "" ? Number(line.qtyCases) : null,
      description: stock.description,
    });
    setLine({ stockKey: "", weight: "", qtyCases: "" });
    await refreshOpen(openId);
  }, "Lot added");

  // Called by the weighing window as it closes, with the session it just shut.
  const tieClosedSession = async (batchId) => {
    const target = weighFor?.shipmentId;
    if (!target) return;
    try {
      await axiosInstance.post(`/shipments/${target}/box-batches`,
        { batchIds: [batchId] });
      toast({ title: "Boxes tied to this load", status: "success",
        duration: 3000, position: "top" });
      if (openId === target) await refreshOpen(target);
    } catch (err) {
      // The boxes are recorded whatever happens here; only the link failed, and
      // it can still be made by hand from the session list.
      toast({
        status: "warning", duration: 10000, isClosable: true, position: "top",
        title: "Weights saved, but not tied to the load",
        description: `${err.response?.data?.error || err.message} — tie the `
          + `session to the load by hand below.`,
      });
    }
  };

  // One line per weighed lot, from the sessions already tied to this load.
  // The bench has said what is leaving; this is that, in the form shipping
  // understands.
  const addWeighedAsLines = () => run(async () => {
    const already = new Set((detail.items || []).map((it) => it.lotId));
    const pending = [...weighedByLot.entries()].filter(([lotId]) => !already.has(lotId));
    if (!pending.length) throw new Error("Every weighed lot is already on this load.");

    try {
      for (const [lotId, w] of pending) {
        // Matched to a stock row where there is one, so shipping deducts what
        // it should; without one the line still ships and `movedNothing` says
        // so. /shipments/available orders processed stock first, so a lot with
        // both raw and processed rows matches the processed one — which is
        // what was just weighed off the bench.
        const stock = available.find((a) => a.lotId === lotId);
        const session = (detail.sessions || []).find((b) => b.lotId === lotId);
        await axiosInstance.post(`/shipments/${openId}/items`, {
          lotId,
          ntiItemId: stock ? stock.ntiItemId : null,
          // Thousandths, as the route requires.
          weight: (w.mils / 1000).toFixed(3),
          qtyCases: w.boxes,
          description: session?.itemDescription || stock?.description || null,
        });
      }
    } finally {
      // Whatever happened, show what actually landed: a run that failed on the
      // second lot still added the first, and leaving the screen stale hides it.
      await refreshOpen(openId);
    }
  }, "Weighed lots added to this load");

  // Double-click a weighed session to see the individual boxes, the way the
  // Weight Manifests tab does. Read-only here: correcting or voiding a box is
  // that tab's job, and it has the guards for it.
  const toggleBatch = async (batchId) => {
    if (openBatch === batchId) { setOpenBatch(null); return; }
    setOpenBatch(batchId);
    if (batchDetail[batchId]) return;
    try {
      const { data } = await axiosInstance.get(`/box-batches/${batchId}`);
      setBatchDetail((prev) => ({ ...prev, [batchId]: data }));
    } catch (err) {
      toast({ title: "Could not open that session",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 5000, position: "top" });
      setOpenBatch(null);
    }
  };

  const removeLine = (itemId) => run(async () => {
    await axiosInstance.delete(`/shipments/${openId}/items/${itemId}`);
    await refreshOpen(openId);
  });

  const ship = () => run(async () => {
    setConfirmShip(false);
    const { data } = await axiosInstance.post(`/shipments/${openId}/ship`);
    await refreshOpen(openId);
    // A line with no stock row behind it ships and deducts nothing. That is
    // correct — there is nothing to take off — but silent it reads as though
    // inventory moved.
    const nil = data?.movedNothing || [];
    if (nil.length) {
      toast({
        status: "warning", position: "top", duration: 10000, isClosable: true,
        title: `${nil.length} line${nil.length === 1 ? "" : "s"} moved no stock`,
        description: `${nil.map((n) => `${n.lotNumber} (${lb(n.weight)} lb)`).join(", ")}`
          + " — not in NTI inventory, so nothing was deducted.",
      });
    }
  }, "Shipped — stock deducted");

  const cancel = () => run(async () => {
    setConfirmCancel(false);
    await axiosInstance.post(`/shipments/${openId}/cancel`);
    await refreshOpen(openId);
  }, "Cancelled — stock restored");

  // The load is gone afterwards, so unlike cancel there is nothing to refresh into
  // — the open row is collapsed and the list reloaded instead.
  const deleteDraft = () => run(async () => {
    setConfirmDelete(false);
    const { data } = await axiosInstance.delete(`/shipments/${openId}`);
    setOpenId(null);
    setDetail(null);
    await fetchShipments();
    if (data?.stockRestored) await fetchAvailable();
  }, "Shipment deleted");

  // Weighed boxes per lot on the open load, so a line can say whether its
  // product has been on the bench. Thousandths, per the weight rules.
  const weighedByLot = useMemo(() => {
    const m = new Map();
    for (const b of detail?.sessions || []) {
      if (b.lotId == null) continue;
      const cur = m.get(b.lotId) || { boxes: 0, mils: 0 };
      m.set(b.lotId, {
        boxes: cur.boxes + (Number(b.boxCount) || 0),
        mils: cur.mils + Math.round(Number(b.total || 0) * 1000),
      });
    }
    return m;
  }, [detail]);

  // Named in the ship dialog: leaving without weighing means that lot can never
  // have a yield.
  const unweighed = (detail?.items || []).filter((it) => !weighedByLot.has(it.lotId));

  // The mirror: boxes weighed onto this load whose lot is not a line yet, so
  // they count for nothing when it ships.
  const lineLots = new Set((detail?.items || []).map((it) => it.lotId));
  const weighedNotOnLoad = [...weighedByLot.keys()].filter((id) => !lineLots.has(id));

  const selectedStock = available.find((a) => String(a.ntiItemId) === String(line.stockKey));
  const tiedIds = new Set((detail?.sessions || []).map((b) => b.batchId));
  const untiedBatches = batches.filter((b) => !tiedIds.has(b.batch_id));
  const isDraft = detail && detail.status === "draft";

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={4} gap={3} wrap="wrap">
        <Box>
          <Text fontSize="lg" fontWeight="bold" color="gray.800">Outgoing</Text>
          <Text fontSize="sm" color="gray.500">
            Loads leaving for AdamsFoods or a customer. Stock moves when a load ships.
          </Text>
        </Box>
        <Flex gap={2} wrap="wrap">
          {/* Weighing finished product is a separate act from building a load:
              it happens at the bench as boxes come off the line, often before
              anyone knows which shipment they will go on. So it opens its own
              session rather than hanging off a draft. */}
          <Button size="sm" variant="outline" colorScheme="blue"
            onClick={() => setWeighOpen(true)}>
            Weigh finished boxes
          </Button>
          <Button size="sm" colorScheme="blue" onClick={startDraft}>New shipment</Button>
        </Flex>
      </Flex>

      {/* Finished product weighed at the bench, listed whether or not a load
          has been built for it.

          It used to appear ONLY inside an open draft's tie picker, so a lot
          weighed on Friday afternoon was visible nowhere until somebody started
          a shipment — while simultaneously showing up on the Weight Manifests
          tab as though it were an arrival. Weighing and loading are separate
          acts, as the button above says: boxes are weighed as they come off the
          line, often before anyone knows which truck they are going on. */}
      {batches.length > 0 && (
        <Box mb={5}>
          <Text fontSize="sm" fontWeight="bold" color="gray.800">
            Finished product weighed
          </Text>
          <Text fontSize="xs" color="gray.500" mb={2}>
            Boxes weighed off the bench on their way out. Tie one to a load below,
            or leave it until there is a load for it.
          </Text>
          <Flex direction="column" gap={1}>
            {batches.map((b) => (
              <Box key={b.batch_id}>
              <Flex align="baseline" gap={3} wrap="wrap"
                px={3} py={2} bg="white" borderRadius="md"
                border="1px solid" borderColor={openBatch === b.batch_id ? "blue.300" : "gray.200"}
                cursor="pointer" title="Double-click to see the boxes"
                onDoubleClick={() => toggleBatch(b.batch_id)}>
                <Text fontSize="sm" fontWeight="600" color="blue.700">
                  {b.lot_number || `Batch ${b.batch_id}`}
                </Text>
                <Badge colorScheme={b.status === "closed" ? "green" : "yellow"} fontSize="9px">
                  {b.status === "closed" ? "Closed" : "Open"}
                </Badge>
                {b.item_description && (
                  <Text fontSize="xs" color="gray.600">{b.item_description}</Text>
                )}
                {b.ship_to && (
                  <Badge colorScheme="blue" fontSize="9px">to {b.ship_to}</Badge>
                )}
                {/* The listing returns totals as [{unit,total}] — a session can
                    hold more than one unit — where the shipment detail returns a
                    plain string. Read the LB entry rather than assuming [0]. */}
                <Text fontSize="xs" color="gray.500" ml="auto" whiteSpace="nowrap"
                  title={`Added ${b.created_at}`}>
                  {fmtDateTime(b.created_at) || "—"}
                </Text>
                <Text fontSize="sm" color="gray.700"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {b.box_count} × {lb((b.totals || []).find((t) => t.unit === "LB")?.total)} lb
                </Text>
                {b.shipment ? (
                  <Badge colorScheme="blue" fontSize="9px">
                    On {b.shipment.destinationName} ({b.shipment.status})
                  </Badge>
                ) : (
                  <Badge colorScheme="gray" fontSize="9px">Not on a load</Badge>
                )}
                {b.status === "open" && (
                  <Button size="xs" variant="ghost" colorScheme="blue"
                    onClick={() => { setAdoptBatchId(b.batch_id); setWeighOpen(true); }}
                    onDoubleClick={(e) => e.stopPropagation()}>
                    Carry on weighing
                  </Button>
                )}
                {/* The client check is a courtesy; requireRole("admin") on the
                    route is the control. */}
                {isAdmin && (
                  <Button size="xs" variant="ghost" colorScheme="red"
                    onClick={() => setDeletingBatch(b)}
                    onDoubleClick={(e) => e.stopPropagation()}>
                    Delete
                  </Button>
                )}
              </Flex>

              {openBatch === b.batch_id && (
                <BatchBoxes detail={batchDetail[b.batch_id]}
                  totalLb={(b.totals || []).find((t) => t.unit === "LB")?.total} />
              )}
              </Box>
            ))}
          </Flex>
        </Box>
      )}

      {loading && <Flex justify="center" py={8}><Spinner color="blue.500" /></Flex>}

      {!loading && shipments.length === 0 && (
        <Box p={5} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
          <Text fontSize="sm" color="gray.600">
            Nothing has shipped yet. Start a shipment, add the lots going on the
            truck, then ship it — that is the point stock comes out of inventory.
          </Text>
        </Box>
      )}

      <Flex direction="column" gap={2}>
        {shipments.map((s) => {
          const st = STATUS[s.status] || STATUS.draft;
          const open = openId === s.shipmentId;
          return (
            <Box key={s.shipmentId} border="1px solid"
              borderColor={open ? "blue.300" : "gray.200"} borderRadius="md" overflow="hidden">
              <Flex px={3} py={2} gap={3} align="center" wrap="wrap" bg={open ? "blue.50" : "white"}
                cursor="pointer" onClick={() => openShipment(s.shipmentId)}>
                <Badge colorScheme={st.color} fontSize="10px">{st.label}</Badge>
                <Text fontSize="sm" fontWeight="bold" color="gray.800">{s.destinationName}</Text>
                <Text fontSize="sm" color="gray.500">{fmtDate(s.shipDate)}</Text>
                {s.billOfLading && <Text fontSize="sm" color="gray.500">BOL {s.billOfLading}</Text>}
                <Text fontSize="sm" color="gray.600">
                  {s.lineCount} lot{s.lineCount === 1 ? "" : "s"}
                </Text>
                <Text fontSize="sm" fontWeight="600" color="gray.800" ml="auto"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {lb(s.totalWeight)} lb
                </Text>
              </Flex>

              {open && (
                <Box p={3} borderTop="1px solid" borderColor="gray.200">
                  {!detail && <Flex justify="center" py={4}><Spinner size="sm" color="blue.500" /></Flex>}

                  {detail && (
                    <>
                      {detail.items.length === 0 && (
                        <Text fontSize="sm" color="gray.500" mb={3}>No lots on this load yet.</Text>
                      )}

                      {detail.items.length > 0 && (
                        <Box borderWidth="1px" borderColor="gray.200" borderRadius="md"
                          overflow="hidden" mb={3}>
                          {detail.items.map((it, i) => (
                            <Flex key={it.itemId} px={3} py={2} gap={3} align="baseline" wrap="wrap"
                              bg={i % 2 ? "gray.50" : "white"}>
                              <Text fontSize="sm" fontWeight="600" color="blue.700">{it.lotNumber}</Text>
                              {it.stage === "raw" && (
                                <Badge colorScheme="yellow" fontSize="9px">Raw</Badge>
                              )}
                              <Text fontSize="sm" color="gray.600">{it.description || "—"}</Text>
                              {/* Weighed or not is the whole point of the load now
                                  — an unweighed lot leaves with no yield. */}
                              {weighedByLot.has(it.lotId) ? (
                                <Badge colorScheme="green" fontSize="9px">
                                  {weighedByLot.get(it.lotId).boxes} boxes ·{" "}
                                  {lb(weighedByLot.get(it.lotId).mils / 1000)} lb weighed
                                </Badge>
                              ) : (
                                <Badge colorScheme="gray" fontSize="9px">Not weighed</Badge>
                              )}
                              <Text fontSize="sm" color="gray.700" ml="auto"
                                style={{ fontVariantNumeric: "tabular-nums" }}>
                                {it.qtyCases != null ? `${it.qtyCases} cs · ` : ""}{lb(it.weight)} lb
                              </Text>
                              {isDraft && (
                                <Button size="xs" variant="ghost" colorScheme="blue"
                                  onClick={() => setWeighFor({
                                    shipmentId: detail.shipmentId,
                                    lotId: it.lotId, lotNumber: it.lotNumber,
                                    // The load already says what is on the truck
                                    // and where it is going.
                                    description: it.description || "",
                                    shipTo: detail.shipTo || detail.destinationName || "",
                                  })}>
                                  Weigh boxes
                                </Button>
                              )}
                              {isDraft && (
                                <Button size="xs" variant="ghost" colorScheme="red"
                                  isLoading={busy} onClick={() => removeLine(it.itemId)}>
                                  Remove
                                </Button>
                              )}
                            </Flex>
                          ))}
                          <Flex px={3} py={2} gap={3} align="baseline" bg="gray.100"
                            borderTop="1px solid" borderColor="gray.200">
                            <Text fontSize="sm" fontWeight="bold">Total</Text>
                            <Text fontSize="lg" fontWeight="bold" color="blue.800" ml="auto"
                              style={{ fontVariantNumeric: "tabular-nums" }}>
                              {lb(detail.totalWeight)} lb
                            </Text>
                          </Flex>
                        </Box>
                      )}

                      {isDraft && (
                        <Flex gap={2} align="flex-end" wrap="wrap" mb={3}
                          p={3} bg="gray.50" borderRadius="md">
                          <Field label="Lot to ship" w="260px">
                            <Select size="sm" bg="white" placeholder="Pick from stock…"
                              value={line.stockKey}
                              onChange={(e) => {
                                const stock = available.find((a) => String(a.ntiItemId) === e.target.value);
                                setLine({
                                  stockKey: e.target.value,
                                  // Prefilled with everything on hand, which is
                                  // the common case; a partial load is typed over.
                                  weight: stock ? String(stock.onHand) : "",
                                  qtyCases: stock && stock.qtyCases != null ? String(stock.qtyCases) : "",
                                });
                              }}>
                              {/* Cases first for raw stock: processing deducts
                                  cases, not pounds, so the case count is the
                                  live figure and the weight is what was
                                  registered on arrival. */}
                              {available.map((a) => (
                                <option key={a.ntiItemId} value={a.ntiItemId}>
                                  {a.lotNumber} · {a.stage === "raw" ? "RAW · " : ""}
                                  {/* A lot number says nothing about what it
                                      is, and picking the wrong one here ships
                                      the wrong product. */}
                                  {stockDescription(a) ? `${stockDescription(a)} · ` : ""}
                                  {a.stage === "raw"
                                    ? `${a.qtyCases ?? "?"} cs left · ${lb(a.onHand)} lb registered`
                                    : `${lb(a.onHand)} lb`}
                                  {a.inProcessing ? " · in processing" : ""}
                                  {a.unlinked ? " · NOT IN LOT REGISTRY — cannot ship" : ""}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Weight (lbs)" w="120px">
                            <Input size="sm" bg="white" type="number" value={line.weight}
                              onChange={(e) => setLine((l) => ({ ...l, weight: e.target.value }))} />
                          </Field>
                          <Field label="Cases" w="90px">
                            <Input size="sm" bg="white" type="number" value={line.qtyCases}
                              onChange={(e) => setLine((l) => ({ ...l, qtyCases: e.target.value }))} />
                          </Field>
                          {/* Refused here rather than by the server: the route
                              answers "lotId is required", which says nothing
                              about which row or what to do. */}
                          <Button size="sm" colorScheme="blue" isLoading={busy}
                            isDisabled={!line.stockKey || !String(line.weight).trim()
                              || Boolean(selectedStock && selectedStock.unlinked)}
                            onClick={addLine}>
                            Add lot
                          </Button>

                          {stockError && (
                            <Alert status="error" borderRadius="md" fontSize="xs" py={2} flex="1 1 100%">
                              <AlertIcon boxSize={3} />
                              Could not load what is in stock — the list above may be
                              incomplete. {stockError}
                            </Alert>
                          )}

                          {/* Shippable, but nothing downstream can attribute it:
                              no lot_id means no yield, no lot timeline. */}
                          {selectedStock && selectedStock.unlinked && (
                            <Alert status="warning" borderRadius="md" fontSize="xs" py={2} flex="1 1 100%">
                              <AlertIcon boxSize={3} />
                              <b>{selectedStock.lotNumber} is not in the lot registry</b>, so it
                              cannot go on a load: every line is attributed to a lot, which is
                              what makes a yield possible. Open its registration form and set
                              the lot, then come back — it will be selectable here.
                            </Alert>
                          )}

                          {/* Warned, not blocked: there may be a good reason to
                              ship a lot that is mid-processing. */}
                          {selectedStock && selectedStock.inProcessing && (
                            <Alert status="warning" borderRadius="md" fontSize="xs" py={2} flex="1 1 100%">
                              <AlertIcon boxSize={3} />
                              {selectedStock.lotNumber} has processing still open. You can ship it anyway.
                            </Alert>
                          )}
                          {/* Said plainly, because the number above is the one
                              somebody will type into the weight field: a
                              processed lot has had cases taken off it but its
                              weight is still what the registration form
                              claimed on arrival. */}
                          {selectedStock && selectedStock.stage === "raw" && (
                            <Alert status="warning" borderRadius="md" fontSize="xs" py={2} flex="1 1 100%">
                              <AlertIcon boxSize={3} />
                              <Box>
                                {selectedStock.lotNumber} is raw — it has not been processed.
                                {" "}The {lb(selectedStock.onHand)} lb is the weight registered on
                                arrival, not a live figure: processing takes cases off a lot, not
                                pounds. {selectedStock.qtyCases ?? "?"} cases are left.
                              </Box>
                            </Alert>
                          )}
                        </Flex>
                      )}

                      {/* What the boxes actually weighed, beside what the
                          lines claim. Deliberately NOT reconciled for you: a
                          difference between the two is the thing worth seeing. */}
                      {detail.sessions && detail.sessions.length > 0 && (
                        <Box mb={3} p={3} bg="blue.50" borderRadius="md"
                          border="1px solid" borderColor="blue.200">
                          <Flex align="baseline" gap={3} wrap="wrap" mb={2}>
                            <Text fontSize="sm" fontWeight="bold" color="blue.800">
                              Weighed on the dock
                            </Text>
                            <Text fontSize="lg" fontWeight="bold" color="blue.800"
                              style={{ fontVariantNumeric: "tabular-nums" }}>
                              {lb(detail.weighedTotal)} lb
                            </Text>
                            {detail.items.length > 0 &&
                              Math.abs(Number(detail.weighedTotal) - Number(detail.totalWeight)) > 0.004 && (
                              <Badge colorScheme="yellow" fontSize="9px">
                                differs from the {lb(detail.totalWeight)} lb being shipped
                              </Badge>
                            )}
                          </Flex>
                          {detail.sessions.map((b) => (
                            <Flex key={b.batchId} align="baseline" gap={2} wrap="wrap"
                              px={2} py={1} bg="white" borderRadius="sm" mb={1}
                              border="1px solid" borderColor="blue.100">
                              <Text fontSize="sm" fontWeight="600" color="blue.700">
                                {b.lotNumber || `Batch ${b.batchId}`}
                              </Text>
                              {b.source === "imported" && (
                                <Badge colorScheme="teal" fontSize="9px">Imported</Badge>
                              )}
                              <Text fontSize="sm" color="gray.700" ml="auto"
                                style={{ fontVariantNumeric: "tabular-nums" }}>
                                {b.boxCount} × {lb(b.total)} lb
                              </Text>
                              {isDraft && (
                                <Button size="xs" variant="ghost" colorScheme="red"
                                  isLoading={busy} onClick={() => untieSession(b.batchId)}>
                                  Untie
                                </Button>
                              )}
                            </Flex>
                          ))}

                          {/* Weighing a lot onto a load does not put it ON the
                              load: lines are what ship and what move stock. The
                              two were never joined, so a load could hold
                              thousands of weighed pounds and still refuse to
                              ship as empty. */}
                          {isDraft && weighedNotOnLoad.length > 0 && (
                            <Alert status="warning" borderRadius="md" fontSize="xs" py={2} mt={2}
                              alignItems="flex-start">
                              <AlertIcon boxSize={3} />
                              <Box flex="1">
                                <Text fontWeight="600">
                                  {weighedNotOnLoad.length} weighed lot
                                  {weighedNotOnLoad.length === 1 ? " is" : "s are"} not on this
                                  load yet.
                                </Text>
                                <Text color="gray.700" mt={0.5}>
                                  Boxes weighed here do not ship on their own — a lot has to be
                                  on the load for stock to move and for it to reach the packing
                                  list.
                                </Text>
                                <Button size="xs" colorScheme="blue" mt={2} isLoading={busy}
                                  onClick={addWeighedAsLines}>
                                  Add {weighedNotOnLoad.length} weighed lot
                                  {weighedNotOnLoad.length === 1 ? "" : "s"} to the load
                                </Button>
                              </Box>
                            </Alert>
                          )}
                        </Box>
                      )}

                      {isDraft && untiedBatches.length > 0 && (
                        <Box mb={3}>
                          <Text fontSize="xs" color="gray.500" textTransform="uppercase"
                            letterSpacing="wide" mb={1}>
                            Tie a weighing session (optional)
                          </Text>
                          <Box maxH="120px" overflowY="auto" bg="white" borderRadius="md"
                            border="1px solid" borderColor="gray.200" px={2} py={1} mb={2}>
                            {untiedBatches.map((b) => (
                              <Checkbox key={b.batch_id} size="sm" width="100%" py={1}
                                isChecked={pickedBatches.has(b.batch_id)}
                                onChange={() => setPickedBatches((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(b.batch_id)) next.delete(b.batch_id);
                                  else next.add(b.batch_id);
                                  return next;
                                })}>
                                <Flex align="baseline" gap={2} wrap="wrap" fontSize="sm">
                                  <Text as="span" fontWeight="600" color="blue.700">
                                    {b.lot_number || `Batch ${b.batch_id}`}
                                  </Text>
                                  <Text as="span" color="gray.500" fontSize="xs">
                                    {b.box_count} boxes
                                  </Text>
                                </Flex>
                              </Checkbox>
                            ))}
                          </Box>
                          <Button size="xs" variant="ghost" colorScheme="blue" px={2}
                            isLoading={busy} isDisabled={pickedBatches.size === 0}
                            onClick={tieSessions}>
                            Tie {pickedBatches.size || ""} session{pickedBatches.size === 1 ? "" : "s"}
                          </Button>
                        </Box>
                      )}

                      <Flex gap={2} wrap="wrap">
                        <Button size="sm" variant="outline" colorScheme="blue"
                          isDisabled={detail.items.length === 0}
                          onClick={() => printPackingList(detail)}>
                          Packing list
                        </Button>
                        {isDraft && (
                          <Tooltip isDisabled={detail.items.length > 0} hasArrow
                            label={weighedNotOnLoad.length
                              ? "Weighed boxes are tied to this load but no lot is on it yet. Add them as lines first."
                              : "Add at least one lot to ship."}>
                            <Box>
                              <Button size="sm" colorScheme="green" isLoading={busy}
                                isDisabled={detail.items.length === 0}
                                onClick={() => setConfirmShip(true)}>
                                Ship
                              </Button>
                            </Box>
                          </Tooltip>
                        )}
                        {/* Destination, date and BOL are all typed before the
                            truck is loaded, so they are all wrong sometimes. */}
                        {isDraft && (
                          <Button size="sm" variant="outline" onClick={startEdit}>
                            Edit details
                          </Button>
                        )}
                        {detail.status === "shipped" && isAdmin && (
                          <Button size="sm" variant="ghost" colorScheme="red"
                            onClick={() => setConfirmCancel(true)}>
                            Cancel shipment
                          </Button>
                        )}
                        {/* Deleting is for a load that should not exist at all —
                            a duplicate, or a test. Admin only, in any state.
                            Cancel remains the right action for a real load that
                            came back: it restores stock AND keeps the record,
                            where this destroys it. */}
                        {isAdmin && (
                          <Button size="sm" variant="ghost" colorScheme="red"
                            onClick={() => setConfirmDelete(true)}>
                            {isDraft ? "Delete draft" : "Delete shipment"}
                          </Button>
                        )}
                        {detail.shippedAt && (
                          <Text fontSize="xs" color="gray.500" alignSelf="center">
                            Shipped {new Date(detail.shippedAt).toLocaleString()}
                          </Text>
                        )}
                      </Flex>
                    </>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Flex>

      {/* One form for both: making a draft and correcting its header. */}
      <AlertDialog isOpen={creating} leastDestructiveRef={cancelRef}
        onClose={closeForm} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent maxW="560px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {editingId ? "Edit shipment" : "New shipment"}
            </AlertDialogHeader>
            <AlertDialogBody>
              {draft && (
                <Flex gap={3} wrap="wrap">
                  <Field label="Going to" w="160px">
                    <Select size="sm" value={draft.destinationType}
                      onChange={(e) => setDraft({ ...draft, destinationType: e.target.value })}>
                      <option value="adamsfoods">AdamsFoods</option>
                      <option value="customer">Customer</option>
                    </Select>
                  </Field>
                  {draft.destinationType === "customer" && (
                    <Field label="Customer" w="220px">
                      <Input size="sm" placeholder="e.g. Sysco" value={draft.destinationName}
                        onChange={(e) => setDraft({ ...draft, destinationName: upper(e.target.value) })} />
                    </Field>
                  )}
                  <Field label="Ship date" w="150px">
                    <Input size="sm" type="date" value={draft.shipDate}
                      onChange={(e) => setDraft({ ...draft, shipDate: e.target.value })} />
                  </Field>
                  <Field label="Ship to" w="220px">
                    <Input size="sm" value={draft.shipTo}
                      onChange={(e) => setDraft({ ...draft, shipTo: upper(e.target.value) })} />
                  </Field>
                  <Field label="BOL #" w="120px">
                    <Input size="sm" value={draft.billOfLading}
                      onChange={(e) => setDraft({ ...draft, billOfLading: upper(e.target.value) })} />
                  </Field>
                  <Field label="Carrier" w="150px">
                    <Input size="sm" value={draft.carrier}
                      onChange={(e) => setDraft({ ...draft, carrier: upper(e.target.value) })} />
                  </Field>
                  <Field label="Driver" w="150px">
                    <Input size="sm" value={draft.driver}
                      onChange={(e) => setDraft({ ...draft, driver: upper(e.target.value) })} />
                  </Field>
                </Flex>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={closeForm}>Go back</Button>
              <Button colorScheme="blue" onClick={editingId ? saveHeader : createDraft}
                isLoading={busy}
                isDisabled={!draft || !draft.shipDate ||
                  (draft.destinationType === "customer" && !draft.destinationName.trim())}>
                {editingId ? "Save changes" : "Create draft"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Ship — the point stock actually moves, so it states what is leaving. */}
      <AlertDialog isOpen={confirmShip} leastDestructiveRef={cancelRef}
        onClose={() => setConfirmShip(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Ship this load?</AlertDialogHeader>
            <AlertDialogBody>
              {detail && (
                <>
                  <Text fontSize="sm" mb={3}>
                    This deducts every lot below from stock and closes the shipment
                    to further changes. Cancelling afterwards puts the stock back.
                  </Text>
                  {/* Warned, not blocked — but it is in the dialog someone has to
                      read to ship, because it cannot be put right afterwards. */}
                  {unweighed.length > 0 && (
                    <Alert status="warning" borderRadius="md" fontSize="sm" py={2} mb={3}>
                      <AlertIcon />
                      <Box>
                        <Text fontWeight="600">
                          {unweighed.length} lot{unweighed.length === 1 ? "" : "s"} shipping
                          unweighed — {unweighed.map((it) => it.lotNumber).join(", ")}.
                        </Text>
                        <Text fontSize="xs" color="gray.700">
                          Nothing was weighed off the bench for
                          {unweighed.length === 1 ? " it" : " them"}, so
                          {unweighed.length === 1 ? " that lot" : " those lots"} will
                          never have a yield. Weigh the boxes first if they are still here.
                        </Text>
                      </Box>
                    </Alert>
                  )}
                  <Box px={3} py={2} bg="gray.50" borderRadius="md"
                    border="1px solid" borderColor="gray.200">
                    <Text fontSize="sm" fontWeight="bold" color="gray.800">
                      {detail.destinationName} · {fmtDate(detail.shipDate)}
                    </Text>
                    {detail.items.map((it) => (
                      <Text key={it.itemId} fontSize="sm" color="gray.700" mt={1}>
                        {it.lotNumber} — {lb(it.weight)} lb
                        {it.qtyCases != null ? ` · ${it.qtyCases} cs` : ""}
                        {it.stage === "raw" ? " · RAW" : ""}
                      </Text>
                    ))}
                    <Text fontSize="lg" fontWeight="bold" color="blue.800" mt={2}
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                      {lb(detail.totalWeight)} lb total
                    </Text>
                  </Box>
                </>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setConfirmShip(false)}>Go back</Button>
              <Button colorScheme="green" onClick={ship} isLoading={busy}>Ship it</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Cancel — restores stock, keeps the record. */}
      <AlertDialog isOpen={confirmCancel} leastDestructiveRef={cancelRef}
        onClose={() => setConfirmCancel(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Cancel this shipment?</AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm">
                Every lot on it goes back into stock. The shipment stays on the
                record marked cancelled — it is not deleted, so what left and
                came back is still visible.
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setConfirmCancel(false)}>Go back</Button>
              <Button colorScheme="red" onClick={cancel} isLoading={busy}>Cancel shipment</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <AlertDialog isOpen={confirmDelete} leastDestructiveRef={cancelRef}
        onClose={() => setConfirmDelete(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {isDraft ? "Delete this draft?" : "Delete this shipment?"}
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={2}>
                {isDraft
                  ? "The draft and its lines are gone for good. Nothing has shipped from it, so no stock moves and there is nothing to restore."
                  : "The shipment and its lines are gone for good — it will not appear on any record afterwards."}
              </Text>

              {/* A shipped load deducted stock. Deleting puts that weight back
                  first, or inventory would stay short with nothing left to say
                  why — but cancelling is still the action that keeps a record,
                  so it is offered here rather than assumed against. */}
              {detail?.status === "shipped" && (
                <Alert status="warning" borderRadius="md" fontSize="sm" mb={2} py={2}
                  alignItems="flex-start">
                  <AlertIcon />
                  <Box>
                    <Text fontWeight="600">This load has already shipped.</Text>
                    <Text fontSize="xs" color="gray.700">
                      Its weight goes back into stock first, so inventory stays
                      right. But the load itself is destroyed — if you want what
                      went out and came back to stay visible,{" "}
                      <b>cancel it instead</b>.
                    </Text>
                  </Box>
                </Alert>
              )}
              {detail?.status === "cancelled" && (
                <Text fontSize="xs" color="gray.600" mb={2}>
                  Already cancelled, so its stock went back at that point. Nothing
                  moves now — this only removes the record.
                </Text>
              )}
              {/* The reason someone is usually here. Deleting the draft is what
                  frees a weighing session that cannot be deleted while a
                  shipment still points at it. */}
              {detail?.sessions?.length > 0 && (
                <Text fontSize="sm" color="gray.600">
                  {detail.sessions.length} weighing session
                  {detail.sessions.length === 1 ? "" : "s"} tied to it
                  {detail.sessions.length === 1 ? " is" : " are"} released — the
                  sessions and their boxes are untouched.
                </Text>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setConfirmDelete(false)}>Go back</Button>
              <Button colorScheme="red" onClick={deleteDraft} isLoading={busy}>
                {isDraft ? "Delete draft" : "Delete shipment"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* The same session machinery the incoming bench uses, pointed the other
          way: direction="outgoing" is what makes these weights the numerator of
          a yield rather than another arrival.
          Closing refreshes the tie-able sessions, since a session just closed
          here is exactly what someone will want to attach to a load next. */}
      {/* Its own screen, not the incoming scanner pointed the other way. That
          screen is built around reading barcodes — a scan grid, a keypad, a
          global keydown handler — and finished boxes carry no barcode, so all
          of it was between the operator and the scale. */}
      <DeleteBatchDialog
        batch={deletingBatch}
        onClose={() => setDeletingBatch(null)}
        onDeleted={fetchBatches}
        // On this screen "untie it in Outgoing" is a pointer at the screen you
        // are already standing on.
        shipmentHint="untie it from the load below, or delete that draft."
      />

      <WeighFinishedBoxes
        isOpen={weighOpen || Boolean(weighFor)}
        adoptBatchId={adoptBatchId}
        presetLot={weighFor}
        onSessionClosed={weighFor ? tieClosedSession : null}
        onClose={() => {
          setWeighOpen(false); setAdoptBatchId(null); setWeighFor(null); fetchBatches();
        }}
      />
    </Box>
  );
};

export default OutgoingTab;
