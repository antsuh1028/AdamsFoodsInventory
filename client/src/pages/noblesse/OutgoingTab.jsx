import upperInput from "../../utils/upperInput";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Spinner, Input, Alert, AlertIcon,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import WeighFinishedBoxes from "../../components/navbar/WeighFinishedBoxes";
import DeleteBatchDialog from "./DeleteBatchDialog";
import FlagSession from "./FlagSession";
import { toDisplay } from "../../utils/weight";
import { fmtDate, fmtDateOnly, fmtDateTime, fmtLongDate, today, upper } from "./shared";
import { groupOutgoing, milsToLb, clockOf } from "./outgoingGroups";
import getRole, { canReceive } from "../../utils/getRole";
import LotTimeline from "../../components/LotTimeline";
import ItemDescriptionInput from "../../components/ItemDescriptionInput";
import CustomerInput from "../../components/CustomerInput";
import printPackingList from "./printPackingList";
import printOutgoingTag from "./printOutgoingTag";
import useLang from "../../hooks/useLang";
import LangToggle from "../../components/LangToggle";
import SearchBar from "../../components/SearchBar";

// Outgoing: product leaving NTI, either back to AdamsFoods for distribution or
// straight to a customer.

const STATUS = {
  draft:     { label: "Draft",     color: "gray" },
  shipped:   { label: "Shipped",   color: "green" },
  cancelled: { label: "Cancelled", color: "red" },
};

const lb = (v) => (v === null || v === undefined || v === "" ? "0.00" : toDisplay(v));

// The heading fields, paired with the column each reads back from.
const HEADING_FIELDS = [
  ["itemDescription", "Item", "item_description"],
  ["shipTo", "Going to", "ship_to"],
  ["vendor", "Vendor", "vendor"],
  ["billOfLading", "BOL", "bill_of_lading"],
  ["brand", "Brand", "brand"],
  ["estNumber", "EST", "est_number"],
  ["grade", "Grade", "grade"],
  ["remarks", "Remarks", "remarks"],
];

// What the dock may change: what is in the boxes, and where they are going.
// The rest of an outgoing heading is the driver's paperwork and is admin-only.
// DOCK_EDITABLE in routes/boxes.pg.js is the control — this only decides which
// fields are worth offering.
const DOCK_FIELDS = ["itemDescription", "shipTo"];

const HeadingEditor = ({ batchId, detail, isAdmin, onSaved, onCancel }) => {
  const toast = useToast();
  const { t } = useLang();
  const offered = HEADING_FIELDS.filter(
    ([key]) => isAdmin || DOCK_FIELDS.includes(key));
  const original = Object.fromEntries(
    offered.map(([key, , col]) => [key, detail[col] || ""]));

  const [draft, setDraft] = useState(original);
  const [saving, setSaving] = useState(false);
  // "" = the day the session was opened. Admin-only on an outgoing session,
  // like the rest of this heading beyond the dock's two fields.
  const [weighedOn, setWeighedOn] = useState(detail.weighed_on || "");

  const dateChanged = isAdmin && weighedOn !== (detail.weighed_on || "");
  const dirty = dateChanged
    || offered.some(([k]) => draft[k].trim() !== original[k].trim());
  const set = (key) => (e) =>
    setDraft((d) => ({ ...d, [key]: upperInput(e) }));

  const save = async () => {
    setSaving(true);
    try {
      // Only what actually changed, so a field nobody touched cannot be blanked
      // by a stale draft.
      const changed = Object.fromEntries(
        offered
          .map(([k]) => k)
          .filter((k) => draft[k].trim() !== original[k].trim())
          .map((k) => [k, draft[k].trim() || null]));
      if (dateChanged) changed.weighedOn = weighedOn || null;
      await axiosInstance.patch(`/box-batches/${batchId}`, changed);
      await onSaved();
      toast({ status: "success", title: t("Session updated"),
        duration: 2000, position: "top" });
    } catch (err) {
      toast({ status: "error", position: "top", duration: 7000, isClosable: true,
        title: t("Could not save"),
        description: err.response?.data?.error || err.message });
    } finally { setSaving(false); }
  };

  return (
    <Box mb={3}>
      <Flex gap={3} wrap="wrap" mb={2}>
        {offered.map(([key, label]) => (
          <Box key={key} minW={key === "remarks" ? "220px" : "150px"}>
            <Text fontSize="9px" color="gray.500" textTransform="uppercase"
              letterSpacing="wide" mb={0.5}>{t(label)}</Text>
            {key === "itemDescription" && detail.direction === "outgoing" ? (
              <ItemDescriptionInput compact size="xs"
                listId={`item-descriptions-edit-${batchId}`}
                value={draft[key]}
                onChange={(v) => setDraft((d) => ({ ...d, [key]: upper(v) }))} />
            ) : key === "shipTo" && detail.direction === "outgoing" ? (
              <CustomerInput compact size="xs"
                listId={`customers-edit-${batchId}`}
                value={draft[key]}
                onChange={(v) => setDraft((d) => ({ ...d, [key]: upper(v) }))} />
            ) : (
              <Input size="xs" value={draft[key]} onChange={set(key)}
                autoComplete="off" bg="white" />
            )}
          </Box>
        ))}
        {/* For a session entered after the fact. */}
        {isAdmin && (
          <Box minW="150px">
            <Text fontSize="9px" color="gray.500" textTransform="uppercase"
              letterSpacing="wide" mb={0.5}>{t("Weighed on")}</Text>
            <Input size="xs" type="date" bg="white" max={today()}
              value={weighedOn || (detail.created_at ? today(new Date(detail.created_at)) : "")}
              onChange={(e) => setWeighedOn(e.target.value)} />
          </Box>
        )}
      </Flex>
      {!isAdmin && (
        <Text fontSize="xs" color="gray.500" mb={2}>
          {t("The rest of this heading is reception's to change.")}
        </Text>
      )}
      <Flex gap={2}>
        <Button size="xs" colorScheme="blue" onClick={save}
          isLoading={saving} isDisabled={!dirty}>
          {t("Save")}
        </Button>
        <Button size="xs" variant="ghost" onClick={onCancel} isDisabled={saving}>
          {t("Cancel")}
        </Button>
      </Flex>
    </Box>
  );
};

// One weighed session opened up: what it was, and every box in it.
//
// The heading is editable here; the boxes are not. Correcting or voiding a box
// is the Weight Manifests tab's job and it carries the guards for that.
const BatchBoxes = ({ detail, totalLb, batchId, isAdmin, onChanged }) => {
  const [editing, setEditing] = useState(false);
  const { t } = useLang();

  if (!detail) {
    return <Flex justify="center" py={4}><Spinner size="sm" color="blue.500" /></Flex>;
  }
  // Mirrors the route: on an outgoing session the dock's two labels stay
  // editable after it closes; anywhere else a closed session is admin-only.
  const mayEdit = isAdmin || detail.direction === "outgoing" || detail.status !== "closed";
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
    // Only shown when someone set it; otherwise "Added" is the day anyway.
    ["Weighed", detail.weighed_on ? fmtDate(detail.weighed_on) : null],
    ["Added", fmtDateTime(detail.created_at)],
    ["Closed", fmtDateTime(detail.closed_at)],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <Box mt={1} mb={2} px={3} py={3} bg="gray.50" borderRadius="md"
      border="1px solid" borderColor="blue.200">
      {editing ? (
        <HeadingEditor
          batchId={batchId}
          detail={detail}
          isAdmin={isAdmin}
          onSaved={async () => { await onChanged(); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <Flex gap={4} wrap="wrap" mb={3} align="flex-start">
            {facts.map(([label, value]) => (
              <Box key={label}>
                <Text fontSize="9px" color="gray.500" textTransform="uppercase"
                  letterSpacing="wide">{t(label)}</Text>
                <Text fontSize="sm" color="gray.800">{value}</Text>
              </Box>
            ))}
            {mayEdit && (
              <Button size="xs" variant="outline" colorScheme="blue" ml="auto"
                onClick={() => setEditing(true)}>
                {t("Edit details")}
              </Button>
            )}
          </Flex>

          {detail.remarks && (
            <Text fontSize="xs" color="gray.600" mb={3}>
              {t("Remarks: {remarks}", { remarks: detail.remarks })}
            </Text>
          )}
        </>
      )}

      <Flex align="baseline" gap={3} wrap="wrap" mb={2}>
        <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
          {t("Boxes")}
        </Text>
        <Button size="xs" variant="outline" colorScheme="blue" ml="auto"
          onClick={() => printOutgoingTag({
            lotNumber: detail.lot_number,
            date: detail.weighed_on
              ? fmtDate(detail.weighed_on)
              : fmtDateOnly(detail.closed_at || detail.created_at),
            shipTo: detail.ship_to,
            itemDescription: detail.item_description,
            billOfLading: detail.bill_of_lading,
            driver: detail.driver || "",
            boxes: items,
            weighedBy: detail.vendor || "",
            memo: detail.remarks || "",
            furtherProcessing: Boolean(detail.further_processing),
          })}>
          {t("Print tag")}
        </Button>
        <Text fontSize="sm" fontWeight="600" color="gray.800"
          style={{ fontVariantNumeric: "tabular-nums" }}>
          {live.length} · {lb(totalLb)} lb
        </Text>
        {voided > 0 && (
          <Text fontSize="xs" color="gray.500">
            {t("({n} voided, not in that total)", { n: voided })}
          </Text>
        )}
      </Flex>

      {items.length === 0 ? (
        <Text fontSize="sm" color="gray.500">{t("No boxes were recorded in this session.")}</Text>
      ) : (
        // Wrapping badges rather than a wide table: this list is read on a
        // tablet, where a ten-column grid would scroll sideways.
        <Flex wrap="wrap" gap={2}>
          {items.map((it, i) => (
            <Badge key={it.localId ?? i}
              colorScheme={it.voidedAt ? "red" : "gray"}
              fontSize="sm" px={2} py={1} borderRadius="md"
              title={it.voidedAt
                ? t("Voided: {reason}", { reason: it.voidReason || t("no reason given") })
                : undefined}
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

// One line: a long description is cut off with "…" (full text on hover) rather
// than wrapping its row. flex + minW are what let it shrink — a flex item
// otherwise never goes below its text's width, so it would never be cut.
const ONE_LINE = {
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  flex: "1 1 0", minW: "60px",
};

// What an empty side of the tab says instead of just being blank.
const EmptyNote = ({ children }) => (
  <Box p={4} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
    <Text fontSize="sm" color="gray.600">{children}</Text>
  </Box>
);


export const OutgoingTab = ({ refreshSignal = 0 }) => {
  const isAdmin = getRole() === "admin";
  // The dock weighs; reception owns the load and calls a lot finished. The
  // server enforces this — hiding it here only keeps the dock's screen to the
  // one job it has.
  const reception = canReceive();
  const toast = useToast();
  const { lang, t, toggle: toggleLang } = useLang();
  // Read inside the fetch callbacks, which must not re-run on a language change.
  const tRef = useRef(t);
  tRef.current = t;

  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  // Every outgoing pallet.
  const [batches, setBatches] = useState([]);
  // One box narrows both lists; matches are kept apart from the full list.
  const [q, setQ] = useState("");
  const [foundBatches, setFoundBatches] = useState(null);   // null = not searching
  const [searching, setSearching] = useState(false);
  const shipSeq = useRef(0);
  const batchSeq = useRef(0);
  // A session to reopen the weighing window on, so an interrupted lot can be
  // carried on with instead of started again.
  const [adoptBatchId, setAdoptBatchId] = useState(null);
  // A closed pallet whose heading the next one starts from.
  const [nextFrom, setNextFrom] = useState(null);
  const [reopening, setReopening] = useState(null);
  // A weighed session an admin wants gone. The route refuses while a load or a
  // form still references it, and the dialog says which.
  const [deletingBatch, setDeletingBatch] = useState(null);

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Weighing finished product. Opens the same session machinery the incoming
  // bench uses, pointed the other way.
  const [weighOpen, setWeighOpen] = useState(false);
  // Which weighed session is expanded, and its boxes once fetched. Cached by
  // id so collapsing and reopening does not refetch.
  const [openBatch, setOpenBatch] = useState(null);
  const [batchDetail, setBatchDetail] = useState({});
  // Which lot's history is open, for reception to read the figures and close it.
  const [timelineLot, setTimelineLot] = useState(null);
  // Shipment groups the user opened or closed by hand.
  const [toggledGroups, setToggledGroups] = useState(() => new Set());
  const [pastOpen, setPastOpen] = useState(false);
  // The shipment whose driver is being typed: { id, value }.
  const [driverEdit, setDriverEdit] = useState(null);
  const [savingDriver, setSavingDriver] = useState(false);
  const cancelRef = useRef(null);

  // Nothing else reads the load list, so a search simply replaces it. A reply
  // to an older search is dropped rather than shown over a newer one.
  const fetchShipments = useCallback(async () => {
    const mine = ++shipSeq.current;
    try {
      const { data } = await axiosInstance.get("/shipments", { params: { q: q || undefined } });
      if (mine === shipSeq.current) setShipments(data || []);
    } catch (err) {
      if (mine !== shipSeq.current) return;
      toast({ title: tRef.current("Could not load shipments"),
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    } finally {
      if (mine === shipSeq.current) setLoading(false);
    }
  }, [toast, q]);

  // OUTGOING ONLY.
  // The full list AND, while searching, the matches — together, so every
  // existing refresh of this list refreshes a search too.
  const fetchBatches = useCallback(async () => {
    const mine = ++batchSeq.current;
    try {
      const [all, hits] = await Promise.all([
        axiosInstance.get("/box-batches", { params: { direction: "outgoing", limit: 200 } }),
        q ? axiosInstance.get("/box-batches", { params: { direction: "outgoing", q } }) : null,
      ]);
      if (mine !== batchSeq.current) return;
      setBatches(all.data || []);
      setFoundBatches(hits ? hits.data || [] : null);
    } catch {
      // Kept quiet; the next poll retries.
    } finally {
      if (mine === batchSeq.current) setSearching(false);
    }
  }, [q]);

  useEffect(() => {
    fetchShipments(); fetchBatches();
  }, [fetchShipments, fetchBatches]);

  // The parent polls every 60s and bumps this.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    fetchShipments();
    fetchBatches();
  }, [refreshSignal, fetchShipments, fetchBatches]);

  const openShipment = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    try {
      const { data } = await axiosInstance.get(`/shipments/${id}`);
      setDetail(data);
    } catch (err) {
      toast({ title: t("Could not open that shipment"),
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
      setOpenId(null);
    }
  };

  const refreshOpen = async (id) => {
    const { data } = await axiosInstance.get(`/shipments/${id}`);
    setDetail(data);
    fetchShipments();
    fetchBatches();
  };

  // Reports a failure and returns false. It never re-throws: every caller is a
  // button, and a rejected promise nobody awaits is what put the crash screen up.
  const run = async (fn, successTitle, failTitle = t("That did not work")) => {
    setBusy(true);
    try {
      await fn();
      if (successTitle) {
        toast({ title: successTitle, status: "success", duration: 3000, position: "top" });
      }
      return true;
    } catch (err) {
      const body = err.response?.data;
      toast({
        title: failTitle,
        // The server names the lot and the shortfall when a load asks for more
        // than is on hand, which is exactly what the operator needs to see.
        description: body?.shortfalls
          ? body.shortfalls.map((s) => t("{lot}: asked {asked}, on hand {onHand}",
              { lot: s.lotNumber, asked: lb(s.requested), onHand: lb(s.onHand) })).join(" · ")
          : (body?.error || err.message),
        status: "error", duration: 8000, position: "top", isClosable: true,
      });
      // A conflict means this screen was behind the server. Catch it up, so the
      // offer that just failed is not sitting there to be made again.
      if (err.response?.status === 409) {
        fetchBatches();
        if (openId) refreshOpen(openId).catch(() => {});
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

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
      toast({ title: t("Could not open that session"),
        description: err.response?.data?.error || err.message,
        status: "error", duration: 5000, position: "top" });
      setOpenBatch(null);
    }
  };

  // After a heading edit: the detail AND the row above it both show the item
  // and where it is going, so refreshing one alone leaves the other stale.
  const reloadBatch = async (batchId) => {
    const { data } = await axiosInstance.get(`/box-batches/${batchId}`);
    setBatchDetail((prev) => ({ ...prev, [batchId]: data }));
    await fetchBatches();
  };

  const cancel = () => run(async () => {
    setConfirmCancel(false);
    await axiosInstance.post(`/shipments/${openId}/cancel`);
    await refreshOpen(openId);
  }, t("Cancelled — stock restored"), t("Could not cancel this shipment"));

  // The load is gone afterwards, so unlike cancel there is nothing to refresh into
  // — the open row is collapsed and the list reloaded instead.
  const deleteDraft = () => run(async () => {
    setConfirmDelete(false);
    await axiosInstance.delete(`/shipments/${openId}`);
    setOpenId(null);
    setDetail(null);
    await fetchShipments();
    await fetchBatches();
  }, t("Shipment deleted"), t("Could not delete this shipment"));

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

  // One entry per LOT, in the order the sessions are listed — a lot weighed
  // across several pallets is one stop, not three.
  const timelineLots = [];
  for (const b of batches) {
    if (b.lot_id && !timelineLots.some((l) => l.lotId === b.lot_id)) {
      timelineLots.push({ lotId: b.lot_id, lotNumber: b.lot_number });
    }
  }
  const timelineIndex = timelineLot
    ? timelineLots.findIndex((l) => l.lotId === timelineLot.lotId) : -1;
  const shownBatches = foundBatches ?? batches;
  const isDraft = detail && detail.status === "draft";

  const days = useMemo(() => groupOutgoing(shownBatches), [shownBatches]);
  const todayStr = today();
  const yesterdayStr = today(new Date(Date.now() - 86400000));
  // Groups with a pallet still being weighed start open.
  const groupIsOpen = (g) => g.open !== toggledGroups.has(g.id);
  const toggleGroup = (id) => setToggledGroups((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const draftLoads = shipments.filter((sh) => sh.status === "draft");
  const shippedLoads = shipments.filter((sh) => sh.status === "shipped");
  const cancelledLoads = shipments.filter((sh) => sh.status === "cancelled");

  // One weighed session's row.
  // Closed by mistake: reopen and carry straight on. A session already on a load or
  // a form is refused by the server for anyone but an admin, and the toast says why.
  const reopenSession = async (b) => {
    setReopening(b.batch_id);
    try {
      await axiosInstance.post(`/box-batches/${b.batch_id}/reopen`);
      toast({ title: t("Session reopened"), status: "success", duration: 3000, position: "top" });
      setAdoptBatchId(b.batch_id);
      setWeighOpen(true);
      fetchBatches();
    } catch (err) {
      toast({ title: t("Could not reopen this session"),
        description: err.response?.data?.error || err.message,
        status: "error", duration: 9000, isClosable: true, position: "top" });
    } finally {
      setReopening(null);
    }
  };

  const renderSession = (b) => (
    <Box key={b.batch_id}>
    {/* Flagged reads red at a glance. It still counts everywhere — the flag
        asks an admin to look, it does not remove anything. */}
    <Flex align="baseline" gap={3} wrap="wrap"
      px={3} py={2} bg={b.flagged_at ? "red.50" : "white"} borderRadius="md"
      border="1px solid"
      borderColor={b.flagged_at ? "red.300"
        : openBatch === b.batch_id ? "blue.300" : "gray.200"}
      cursor="pointer" title={t("Double-click to see the boxes")}
      onDoubleClick={() => toggleBatch(b.batch_id)}>
      {reception && b.lot_id ? (
        <Button variant="link" size="sm" fontWeight="600" colorScheme="blue"
          onClick={(e) => {
            e.stopPropagation();
            setTimelineLot({ lotId: b.lot_id, lotNumber: b.lot_number });
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={t("Open this lot — its figures, and whether it is finished")}>
          {b.lot_number}
        </Button>
      ) : (
        <Text fontSize="sm" fontWeight="600" color="blue.700">
          {b.lot_number || t("Batch {id}", { id: b.batch_id })}
        </Text>
      )}
      {/* <Badge colorScheme={b.status === "closed" ? "green" : "yellow"} fontSize="9px">
        {b.status === "closed" ? t("Closed") : t("Open")}
      </Badge> */}
      {b.item_description && (
        <Text fontSize="xs" color="gray.600" {...ONE_LINE} title={b.item_description}>
          {b.item_description}
        </Text>
      )}
      {b.further_processing && (
        <Badge colorScheme="teal" fontSize="9px" title={t("Weighed for the AF freezer. It comes back for another run, so it is not counted as shipped.")}>
          {t("for further processing")}
        </Badge>
      )}
      {b.ship_to && (
        <Badge colorScheme="blue" fontSize="9px">
          {t("to {shipTo}", { shipTo: b.ship_to })}
        </Badge>
      )}
      {/* The listing returns totals as [{unit,total}] — a session can
          hold more than one unit — where the shipment detail returns a
          plain string. Read the LB entry rather than assuming [0]. */}
      <Text fontSize="xs" color="gray.500" ml="auto" whiteSpace="nowrap"
        title={t("Added {when}", { when: b.created_at })}>
        {b.weighed_on ? fmtDate(b.weighed_on) : (fmtDateTime(b.created_at) || "—")}
      </Text>
      <Text fontSize="sm" color="gray.700"
        style={{ fontVariantNumeric: "tabular-nums" }}>
        {b.box_count } c/s - {lb((b.totals || []).find((t) => t.unit === "LB")?.total)} lb
      </Text>
      {/* {b.shipment ? (
        <Badge colorScheme="blue" fontSize="9px">
          {t("On {destination} ({status})", {
            destination: b.shipment.destinationName,
            status: t(b.shipment.status),
          })}
        </Badge>
      ) : (
        <Badge colorScheme="gray" fontSize="9px">{t("Not on a load")}</Badge>
      )} */}
      {b.status === "open" && (
        <Button size="xs" variant="ghost" colorScheme="blue"
          onClick={() => { setAdoptBatchId(b.batch_id); setWeighOpen(true); }}
          onDoubleClick={(e) => e.stopPropagation()}>
          {t("Carry on weighing")}
        </Button>
      )}
      {/* A closed pallet: start the next one on the same heading, or reopen one closed by mistake. */}
      {b.status === "closed" && (
        <>
          <Button size="xs" variant="ghost" colorScheme="teal"
            onClick={() => setNextFrom({
              lotId: b.lot_id ?? null, lotNumber: b.lot_number || "",
              description: b.item_description || "", shipTo: b.ship_to || "",
              expectedBoxes: b.expected_boxes ?? null, nextPallet: true,
              furtherProcessing: Boolean(b.further_processing),
            })}
            onDoubleClick={(e) => e.stopPropagation()}>
            {t("Next pallet")}
          </Button>
          <Button size="xs" variant="ghost" colorScheme="gray"
            isLoading={reopening === b.batch_id}
            onClick={() => reopenSession(b)}
            onDoubleClick={(e) => e.stopPropagation()}>
            {t("Reopen")}
          </Button>
        </>
      )}
      {/* The dock weighs it and the dock notices when it is wrong, so this is
          open to everyone — unlike Delete below. */}
      <FlagSession batch={b} onChanged={fetchBatches} t={t} />
      {/* The client check is a courtesy; requireRole("admin") on the
          route is the control. */}
      {isAdmin && (
        <Button size="xs" variant="ghost" colorScheme="red"
          onClick={() => setDeletingBatch(b)}
          onDoubleClick={(e) => e.stopPropagation()}>
          {t("Delete")}
        </Button>
      )}
    </Flex>

    {openBatch === b.batch_id && (
      <BatchBoxes detail={batchDetail[b.batch_id]}
        batchId={b.batch_id}
        isAdmin={isAdmin}
        onChanged={() => reloadBatch(b.batch_id)}
        totalLb={(b.totals || []).find((t) => t.unit === "LB")?.total} />
    )}
    </Box>
  );

  // Sets the driver on every pallet of a shipment.
  const saveDriver = async (g) => {
    setSavingDriver(true);
    try {
      await axiosInstance.post("/box-batches/driver", {
        batchIds: g.sessions.map((s) => s.batch_id), driver: driverEdit.value,
      });
      setDriverEdit(null);
      await fetchBatches();
    } catch (err) {
      toast({ title: t("Could not save the driver"),
        description: err.response?.data?.error || err.message,
        status: "error", duration: 6000, isClosable: true, position: "top" });
    } finally {
      setSavingDriver(false);
    }
  };

  const stop = (e) => e.stopPropagation();

  const renderDriver = (g) => {
    if (driverEdit?.id === g.id) {
      return (
        <Flex gap={1} align="center" onClick={stop}>
          <Input size="xs" bg="white" width="160px" autoFocus autoComplete="off"
            placeholder={t("Driver's name")} value={driverEdit.value}
            textTransform="uppercase"
            onChange={(e) => setDriverEdit({ ...driverEdit, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveDriver(g);
              if (e.key === "Escape") setDriverEdit(null);
            }} />
          <Button size="xs" colorScheme="blue" isLoading={savingDriver} onClick={() => saveDriver(g)}>
            {t("Save")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDriverEdit(null)}>{t("Cancel")}</Button>
        </Flex>
      );
    }
    return (
      <Button size="xs" variant="ghost" colorScheme={g.driver ? "gray" : "blue"}
        onClick={(e) => { stop(e); setDriverEdit({ id: g.id, value: g.driver }); }}
        title={g.driverMixed ? t("Not every pallet has this driver. Save to set it on all of them.") : undefined}>
        {g.driver
          ? `${t("Driver")}: ${g.driver}${g.driverMixed ? " *" : ""}`
          : t("+ Driver")}
      </Button>
    );
  };

  // One auto-grouped shipment: a customer's pallets close together on one day.
  const renderShipment = (g) => {
    const open = groupIsOpen(g);
    const start = clockOf(g.startMs);
    const end = g.open ? t("now") : clockOf(g.endMs);
    return (
      <Box key={g.id} border="1px solid" borderRadius="md" overflow="hidden"
        borderColor={g.flagged ? "red.300" : open ? "blue.300" : "gray.200"}>
        <Flex px={3} py={2} gap={3} align="center" wrap="wrap" cursor="pointer"
          bg={g.freezer ? "teal.50" : open ? "blue.50" : "white"}
          onClick={() => toggleGroup(g.id)}>
          <Text fontSize="sm" fontWeight="bold" color={g.freezer ? "teal.700" : "gray.800"}>
            {g.freezer ? t("To the AF freezer") : (g.destination || t("No destination"))}
          </Text>
          <Text fontSize="xs" color="gray.500" whiteSpace="nowrap">
            {start === end ? start : `${start} - ${end}`}
          </Text>
          {g.open && <Badge colorScheme="yellow" fontSize="9px">{t("Weighing")}</Badge>}
          {renderDriver(g)}
          <Flex gap={1} wrap="wrap">
            {g.lots.map((l) => (
              <Badge key={l} variant="outline" colorScheme="gray" fontSize="9px">{l}</Badge>
            ))}
          </Flex>
          <Text fontSize="sm" color="gray.700" ml="auto" whiteSpace="nowrap"
            style={{ fontVariantNumeric: "tabular-nums" }}>
            {t(g.sessions.length === 1 ? "{n} pallet" : "{n} pallets", { n: g.sessions.length })}
            {" · "}{g.boxes} c/s · {lb(milsToLb(g.mils))} lb
          </Text>
        </Flex>
        {open && (
          <Flex direction="column" gap={1} p={2} bg="gray.50"
            borderTop="1px solid" borderColor="gray.200">
            {g.sessions.map(renderSession)}
          </Flex>
        )}
      </Box>
    );
  };

  // One past load: read-only, apart from an admin's cancel and delete.
  const renderLoad = (s) => {
    const st = STATUS[s.status] || STATUS.draft;
    const open = openId === s.shipmentId;
    return (
      <Box key={s.shipmentId} border="1px solid"
        borderColor={open ? "blue.300" : "gray.200"} borderRadius="md" overflow="hidden">
        <Flex px={3} py={2} gap={3} align="center" wrap="wrap" bg={open ? "blue.50" : "white"}
          cursor="pointer" onClick={() => openShipment(s.shipmentId)}>
          <Badge colorScheme={st.color} fontSize="10px">{t(st.label)}</Badge>
          <Text fontSize="sm" fontWeight="bold" color="gray.800">{s.destinationName}</Text>
          <Text fontSize="sm" color="gray.500">{fmtDate(s.shipDate)}</Text>
          {s.billOfLading && (
            <Text fontSize="sm" color="gray.500">{t("BOL {bol}", { bol: s.billOfLading })}</Text>
          )}
          <Text fontSize="sm" color="gray.600">
            {t(s.lineCount === 1 ? "{n} lot" : "{n} lots", { n: s.lineCount })}
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
                  <Text fontSize="sm" color="gray.500" mb={3}>{t("No lots on this load yet.")}</Text>
                )}

                {detail.items.length > 0 && (
                  <Box borderWidth="1px" borderColor="gray.200" borderRadius="md"
                    overflow="hidden" mb={3}>
                    {detail.items.map((it, i) => (
                      <Flex key={it.itemId} px={3} py={2} gap={3} align="baseline" wrap="wrap"
                        bg={i % 2 ? "gray.50" : "white"}>
                        <Text fontSize="sm" fontWeight="600" color="blue.700">{it.lotNumber}</Text>
                        {it.stage === "raw" && (
                          <Badge colorScheme="yellow" fontSize="9px">{t("Raw")}</Badge>
                        )}
                        <Text fontSize="sm" color="gray.600" {...ONE_LINE}
                          title={it.description || undefined}>
                          {it.description || "—"}
                        </Text>
                        {/* Weighed or not is the whole point of the load now
                            — an unweighed lot leaves with no yield. */}
                        {weighedByLot.has(it.lotId) ? (
                          <Badge colorScheme="green" fontSize="9px">
                            {t("{boxes} boxes · {weight} lb weighed", {
                              boxes: weighedByLot.get(it.lotId).boxes,
                              weight: lb(weighedByLot.get(it.lotId).mils / 1000),
                            })}
                          </Badge>
                        ) : (
                          <Badge colorScheme="gray" fontSize="9px">{t("Not weighed")}</Badge>
                        )}
                        <Text fontSize="sm" color="gray.700" ml="auto"
                          style={{ fontVariantNumeric: "tabular-nums" }}>
                          {it.qtyCases != null ? `${it.qtyCases} cs · ` : ""}{lb(it.weight)} lb
                        </Text>
                      </Flex>
                    ))}
                    <Flex px={3} py={2} gap={3} align="baseline" bg="gray.100"
                      borderTop="1px solid" borderColor="gray.200">
                      <Text fontSize="sm" fontWeight="bold">{t("Total")}</Text>
                      <Text fontSize="lg" fontWeight="bold" color="blue.800" ml="auto"
                        style={{ fontVariantNumeric: "tabular-nums" }}>
                        {lb(detail.totalWeight)} lb
                      </Text>
                    </Flex>
                  </Box>
                )}

                {/* What the boxes actually weighed, beside what the
                    lines claim. Deliberately NOT reconciled for you: a
                    difference between the two is the thing worth seeing. */}
                {detail.sessions && detail.sessions.length > 0 && (
                  <Box mb={3} p={3} bg="blue.50" borderRadius="md"
                    border="1px solid" borderColor="blue.200">
                    <Flex align="baseline" gap={3} wrap="wrap" mb={2}>
                      <Text fontSize="sm" fontWeight="bold" color="blue.800">
                        {t("Weighed on the dock")}
                      </Text>
                      <Text fontSize="lg" fontWeight="bold" color="blue.800"
                        style={{ fontVariantNumeric: "tabular-nums" }}>
                        {lb(detail.weighedTotal)} lb
                      </Text>
                      {detail.items.length > 0 &&
                        Math.abs(Number(detail.weighedTotal) - Number(detail.totalWeight)) > 0.004 && (
                        <Badge colorScheme="yellow" fontSize="9px">
                          {t("differs from the {weight} lb being shipped",
                            { weight: lb(detail.totalWeight) })}
                        </Badge>
                      )}
                    </Flex>
                    {detail.sessions.map((b) => (
                      <Flex key={b.batchId} align="baseline" gap={2} wrap="wrap"
                        px={2} py={1} bg="white" borderRadius="sm" mb={1}
                        border="1px solid" borderColor="blue.100">
                        <Text fontSize="sm" fontWeight="600" color="blue.700">
                          {b.lotNumber || t("Batch {id}", { id: b.batchId })}
                        </Text>
                        {b.source === "imported" && (
                          <Badge colorScheme="teal" fontSize="9px">{t("Imported")}</Badge>
                        )}
                        <Text fontSize="sm" color="gray.700" ml="auto"
                          style={{ fontVariantNumeric: "tabular-nums" }}>
                          {b.boxCount} × {lb(b.total)} lb
                        </Text>
                      </Flex>
                    ))}
                  </Box>
                )}

                <Flex gap={2} wrap="wrap">
                  <Button size="sm" variant="outline" colorScheme="blue"
                    isDisabled={detail.items.length === 0}
                    onClick={() => printPackingList(detail)}>
                    {t("Packing list")}
                  </Button>
                  {detail.status === "shipped" && isAdmin && (
                    <Button size="sm" variant="ghost" colorScheme="red"
                      onClick={() => setConfirmCancel(true)}>
                      {t("Cancel shipment")}
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
                      {isDraft ? t("Delete draft") : t("Delete shipment")}
                    </Button>
                  )}
                  {detail.shippedAt && (
                    <Text fontSize="xs" color="gray.500" alignSelf="center">
                      {t("Shipped {when}", { when: new Date(detail.shippedAt).toLocaleString() })}
                    </Text>
                  )}
                </Flex>
              </>
            )}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box>
      {/* Heading left, search in the middle, actions right — the same
          three-part row the other tabs use. */}
      <Flex justify="space-between" align={{ base: "stretch", md: "center" }} mb={4}
        direction={{ base: "column", md: "row" }} gap={3}>
        <Box flexShrink={0}>
          <Text fontSize="lg" fontWeight="bold" color="gray.800">{t("Outgoing")}</Text>
          <Text fontSize="sm" color="gray.500">
            {t("Pallets going to the same customer close together are grouped as one shipment.")}
          </Text>
        </Box>
        <Flex gap={2} wrap="wrap" align="center" flex={1}
          justify={{ base: "flex-start", md: "center" }}>
          <SearchBar
            placeholder="Search lot, product, destination, BOL…"
            isSearching={searching}
            onSearch={(text) => { setSearching(true); setQ(text); }}
          />
        </Flex>
        <Flex gap={2} wrap="wrap" align="center" flexShrink={0}>
          {/* Shared with the weighing window, so the two never disagree. */}
          <LangToggle lang={lang} onToggle={toggleLang} />
          <Button size="sm" colorScheme="blue"
            onClick={() => setWeighOpen(true)}>
            {t("Weigh finished boxes")}
          </Button>
        </Flex>
      </Flex>

      {/* Every outgoing pallet, by day, auto-grouped into shipments. */}
      <Box mb={4}>
        {days.length === 0 && (
          <EmptyNote>
            {q ? t("No weighed sessions match “{q}”.", { q }) : t("Nothing has been weighed out yet.")}
          </EmptyNote>
        )}
        {days.map((d) => (
          <Box key={d.day} mb={4}>
            <Flex align="baseline" gap={2} wrap="wrap"
              pt={{ base: "28px", md: "36px" }} pb={2} mb={1}
              position="sticky" top={{ base: "-12px", md: "-20px" }} bg="white" zIndex={1}
              borderBottom="2px solid" borderColor="gray.200">
              <Text fontSize="md" fontWeight="bold" color="gray.800">
                {d.day ? fmtLongDate(new Date(`${d.day}T20:00:00Z`)) : t("No date")}
              </Text>
              {(d.day === todayStr || d.day === yesterdayStr) && (
                <Badge colorScheme={d.day === todayStr ? "blue" : "gray"} fontSize="9px">
                  {d.day === todayStr ? t("Today") : t("Yesterday")}
                </Badge>
              )}
              <Text fontSize="xs" color="gray.500" ml="auto" style={{ fontVariantNumeric: "tabular-nums" }}>
                {t(d.shipments.length === 1 ? "{n} shipment" : "{n} shipments", { n: d.shipments.length })}
                {" · "}{d.boxes} c/s · {lb(milsToLb(d.mils))} lb
              </Text>
            </Flex>
            <Flex direction="column" gap={2}>{d.shipments.map(renderShipment)}</Flex>
          </Box>
        ))}
      </Box>

      {/* Loads made the old way, kept for the record. */}
      {reception && shipments.length > 0 && (
        <Box mb={4}>
          <Button size="sm" variant="ghost" colorScheme="gray" px={1}
            onClick={() => setPastOpen((v) => !v)}>
            {pastOpen ? "▾" : "▸"} {t("Past loads ({n})", { n: shipments.length })}
          </Button>
          {pastOpen && (loading ? (
            <Flex justify="center" py={6}><Spinner color="blue.500" /></Flex>
          ) : (
            <Flex direction="column" gap={2} mt={2}>
              {[...draftLoads, ...shippedLoads, ...cancelledLoads].map(renderLoad)}
            </Flex>
          ))}
        </Box>
      )}

      {reception && (<>
      {/* Cancel — restores stock, keeps the record. */}
      <AlertDialog isOpen={confirmCancel} leastDestructiveRef={cancelRef}
        onClose={() => setConfirmCancel(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">{t("Cancel this shipment?")}</AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm">
                {t("Every lot on it goes back into stock. The shipment stays on the record marked cancelled — it is not deleted, so what left and came back is still visible.")}
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setConfirmCancel(false)}>{t("Go back")}</Button>
              <Button colorScheme="red" onClick={cancel} isLoading={busy}>{t("Cancel shipment")}</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <AlertDialog isOpen={confirmDelete} leastDestructiveRef={cancelRef}
        onClose={() => setConfirmDelete(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {isDraft ? t("Delete this draft?") : t("Delete this shipment?")}
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={2}>
                {isDraft
                  ? t("The draft and its lines are gone for good. Nothing has shipped from it, so no stock moves and there is nothing to restore.")
                  : t("The shipment and its lines are gone for good — it will not appear on any record afterwards.")}
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
                    <Text fontWeight="600">{t("This load has already shipped.")}</Text>
                    <Text fontSize="xs" color="gray.700">
                      {t("Its weight goes back into stock first, so inventory stays right. But the load itself is destroyed — if you want what went out and came back to stay visible,")}{" "}
                      <b>{t("cancel it instead")}</b>.
                    </Text>
                  </Box>
                </Alert>
              )}
              {detail?.status === "cancelled" && (
                <Text fontSize="xs" color="gray.600" mb={2}>
                  {t("Already cancelled, so its stock went back at that point. Nothing moves now — this only removes the record.")}
                </Text>
              )}
              {/* The reason someone is usually here. Deleting the draft is what
                  frees a weighing session that cannot be deleted while a
                  shipment still points at it. */}
              {detail?.sessions?.length > 0 && (
                <Text fontSize="sm" color="gray.600">
                  {t(detail.sessions.length === 1
                    ? "{n} weighing session tied to it is released — the sessions and their boxes are untouched."
                    : "{n} weighing sessions tied to it are released — the sessions and their boxes are untouched.",
                  { n: detail.sessions.length })}
                </Text>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setConfirmDelete(false)}>{t("Go back")}</Button>
              <Button colorScheme="red" onClick={deleteDraft} isLoading={busy}>
                {isDraft ? t("Delete draft") : t("Delete shipment")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
      </>)}

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
        shipmentHint="an admin can delete that load under Past loads."
      />

      {/* Reception reads the lot's figures here and decides whether it is
          finished; the close itself is gated server-side too. */}
      <LotTimeline
        lotId={timelineLot?.lotId ?? null}
        lotNumber={timelineLot?.lotNumber ?? ""}
        isOpen={Boolean(timelineLot)}
        onClose={() => setTimelineLot(null)}
        t={t}
        onStep={(d) => {
          const next = timelineLots[timelineIndex + d];
          if (next) setTimelineLot(next);
        }}
        stepPosition={timelineIndex >= 0
          ? { index: timelineIndex, total: timelineLots.length } : null}
      />

      <WeighFinishedBoxes
        isOpen={weighOpen || Boolean(nextFrom)}
        adoptBatchId={adoptBatchId}
        presetLot={nextFrom}
        onClose={() => {
          setWeighOpen(false); setAdoptBatchId(null); setNextFrom(null); fetchBatches();
        }}
      />
    </Box>
  );
};

export default OutgoingTab;
