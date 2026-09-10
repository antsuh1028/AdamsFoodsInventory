import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Spinner, IconButton, Input, Textarea, Select, Checkbox,
  Alert, AlertIcon, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, CloseIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import ScanSheet from "../../components/navbar/ScanSheet";
import BoxScanner from "../../components/navbar/boxScanner";
import printWeightManifest from "./printWeightManifest";
import ImportTally from "./ImportTally";
import FloatingWindow from "../../components/FloatingWindow";
import { fmtDate, today, upper } from "./shared";
import getRole from "../../utils/getRole";

// Past weighing sessions, one row per session. Expanding a row pulls its boxes
// and shows them in the same sheet they were scanned into, so a manifest can be
// checked or reprinted without leaving the tab.

const COLUMNS = [
  { key: "lot_number",       label: "Lot",     filter: "text",   width: "130px" },
  { key: "vendor",           label: "Vendor",  filter: "select", width: "150px" },
  { key: "item_description", label: "Item",    filter: "text",   width: "200px" },
  { key: "created_at",       label: "Opened",  filter: "none",   width: "170px" },
  { key: "box_count",        label: "Boxes",   filter: "none",   width: "80px", align: "right" },
  { key: "totals",           label: "Total",   filter: "none",   width: "150px", align: "right" },
  { key: "status",           label: "Status",  filter: "none",   width: "90px" },
];

// Restores are shown in the same trail, so the labels have to distinguish
// "gone for good" from "taken off but recoverable".
const REMOVAL_LABEL = {
  item_voided: "Voided",
  item_restored: "Restored",
  item_deleted: "Box erased",
  batch_deleted: "Session deleted",
  manifest_group_deleted: "Manifest removed",
};

const REMOVAL_COLOR = {
  item_voided: "orange",
  item_restored: "green",
  item_deleted: "red",
  batch_deleted: "red",
  manifest_group_deleted: "gray",
};

// ── "You have not looked at this yet" ────────────────────────────────────────
// Which manifest rows THIS BROWSER has opened. Per-device on purpose: the
// question is "have I seen this", not "has anyone", so one person expanding a
// session must not clear the marker for everyone else.
//
// Every access is wrapped. Safari in private mode throws on localStorage rather
// than returning null, and a shared scanning iPad is exactly where that bites.
// A throw here must cost the highlight, never the tab.
const SEEN_KEY = "noblesse.manifestSeen.v1";

// null means "nothing has ever been stored", which is different from "stored
// and empty" — the first case seeds, the second does not.
const readSeen = () => {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const writeSeen = (set) => {
  try {
    // Capped so this cannot grow without bound. The oldest keys fall off and at
    // worst an ancient session highlights once more, which is harmless.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500)));
  } catch {
    // Private mode: the highlight simply does not persist across reloads.
  }
};

// Sort key for a lot number.
//
// Upper-cased and trimmed so casing or a stray space cannot split one lot into
// two positions. A session with no lot at all becomes "", which sorts LAST
// descending — an unlabelled session belongs at the bottom, not above today's
// work just because the string happens to compare high.
const lotKey = (lotNumber) => String(lotNumber || "").trim().toUpperCase();

const totalsText = (totals) =>
  Array.isArray(totals) && totals.length
    ? totals.map((t) => `${t.total} ${t.unit}`).join("  ·  ")
    : "—";

// ── Removal history detail ───────────────────────────────────────────────────
// The audit row carries the destroyed record in full (`details`), because for a
// deleted session that JSON is the only copy of those weights that still
// exists. It is rendered generically rather than field-by-field: a column added
// to batch_items later must show up here on its own, not silently drop out of
// the one place the box is still written down.

const DETAIL_LABELS = {
  batch_id: "Session #", item_id: "Box #", group_id: "Manifest #",
  lot_number: "Lot #", lot_id: "Lot record", name: "Manifest name",
  // Both columns feed the one line on the printed manifest, and both now mean
  // the vendor's lot. Nulls are dropped from the grid, so in practice only the
  // one a session actually carries is shown.
  vendor: "Vendor", item_description: "Item", ship_to: "Vendor Lot #/IC#",
  bill_of_lading: "Vendor Lot #/IC#", source: "Source", status: "Status",
  created_at: "Opened", closed_at: "Closed", scanned_at: "Scanned",
  weight: "Weight", weight_unit: "Unit", original_weight: "Weight on the label",
  converted_from: "Converted from", gtin: "GTIN", production_date: "Production date",
  serial: "Serial", raw_barcode: "Barcode", is_manual: "Entered by hand",
  edited_at: "Corrected", edited_by: "Corrected by", position: "Position",
  voided_at: "Voided", voided_by: "Voided by", void_reason: "Void reason",
  box_count: "Boxes",
};

// tenant_id is identical on every row here and says nothing about what happened.
const SKIP_DETAIL_KEYS = new Set(["tenant_id"]);

const detailLabel = (k) =>
  DETAIL_LABELS[k] || k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const detailValue = (key, value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "production_date") return fmtDate(value);
  if (/_at$/.test(key)) return new Date(value).toLocaleString();
  return String(value);
};

// Integer thousandths, never floats — the same rule the scanner, the server and
// the printed manifest follow, so a total shown here cannot disagree with the
// one that was on the tally. Parsed off the decimal string directly: no
// Number(weight) ever happens, so "76.20" and "76.2" add up identically.
const sumByUnit = (items) => {
  const totals = new Map();
  for (const it of items || []) {
    if (!it || it.weight == null || it.voided_at) continue;
    const [whole, frac = ""] = String(it.weight).split(".");
    const th = (Number(whole) || 0) * 1000 + Number((frac + "000").slice(0, 3));
    const unit = it.weight_unit || "LB";
    totals.set(unit, (totals.get(unit) || 0) + th);
  }
  return [...totals.entries()].map(([unit, th]) => `${(th / 1000).toFixed(2)} ${unit}`);
};

const DetailGrid = ({ data }) => {
  const pairs = Object.entries(data || {})
    .filter(([k]) => !SKIP_DETAIL_KEYS.has(k))
    .map(([k, v]) => [detailLabel(k), detailValue(k, v)])
    .filter(([, v]) => v !== null);
  if (!pairs.length) return null;
  return (
    <Box display="grid" gridTemplateColumns={{ base: "auto 1fr", md: "auto 1fr auto 1fr" }}
      columnGap={4} rowGap={1} fontSize="xs" mb={3}>
      {pairs.map(([label, value]) => (
        <React.Fragment key={label}>
          <Text color="gray.500" whiteSpace="nowrap">{label}</Text>
          <Text color="gray.800" style={{ wordBreak: "break-word" }}>{value}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
};

// Every box that went with a deleted session. Voided rows are kept and struck
// through rather than dropped — what was on the tally and what counted are
// different questions, and the audit trail has to answer both.
const BOX_COLUMNS = [
  ["item_id", "Box #", "left"],
  ["weight", "Weight", "right"],
  ["weight_unit", "Unit", "left"],
  ["original_weight", "Label", "right"],
  ["converted_from", "From", "left"],
  ["serial", "Serial", "left"],
  ["gtin", "GTIN", "left"],
  ["production_date", "Prod. date", "left"],
  ["is_manual", "Manual", "left"],
  ["raw_barcode", "Barcode", "left"],
];

const DeletedBoxes = ({ items }) => {
  const voided = items.filter((it) => it.voided_at).length;
  const totals = sumByUnit(items);
  return (
    <Box>
      <Flex align="baseline" gap={2} mb={1} wrap="wrap">
        <Text fontSize="xs" fontWeight="600" color="gray.600"
          textTransform="uppercase" letterSpacing="wide">
          {items.length} box{items.length === 1 ? "" : "es"}
        </Text>
        {totals.length > 0 && (
          <Text fontSize="xs" color="gray.700" fontWeight="600">
            {totals.join("  ·  ")}
          </Text>
        )}
        {voided > 0 && (
          <Text fontSize="xs" color="gray.500">
            ({voided} voided, not in that total)
          </Text>
        )}
      </Flex>
      {/* A scroll container with no floor lets the table crush to nothing. */}
      <Box overflowX="auto" width="100%" borderWidth="1px" borderColor="gray.200"
        borderRadius="md">
        <Box as="table" width="100%" style={{ minWidth: "760px", borderCollapse: "collapse" }}>
          <Box as="thead">
            <Box as="tr">
              {BOX_COLUMNS.map(([key, label, align]) => (
                <Box as="th" key={key} bg="gray.100" px={2} py={1} textAlign={align}
                  fontSize="9px" fontWeight="bold" color="gray.600"
                  textTransform="uppercase" letterSpacing="wide"
                  borderBottom="1px solid" borderColor="gray.300">
                  {label}
                </Box>
              ))}
            </Box>
          </Box>
          <Box as="tbody">
            {items.map((it, i) => (
              <Box as="tr" key={it.item_id ?? i} bg={i % 2 ? "gray.50" : "white"}>
                {BOX_COLUMNS.map(([key, , align]) => (
                  <Box as="td" key={key} px={2} py={1} textAlign={align} fontSize="11px"
                    color={it.voided_at ? "gray.400" : "gray.800"}
                    borderBottom="1px solid" borderColor="gray.100"
                    style={{
                      textDecoration: it.voided_at ? "line-through" : "none",
                      fontFamily: key === "raw_barcode" || key === "gtin" ? "monospace" : undefined,
                      whiteSpace: "nowrap",
                    }}>
                    {detailValue(key, it[key]) ?? "—"}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

// The sessions a removed manifest covered. They are untouched by the removal,
// so this is a reference list rather than a copy.
// The heading fields that print on the manifest, and adding a box that was
// weighed but never scanned.
//
// Both are corrections to a record that is already written, so both follow the
// same rule the row corrections follow: an operator may work on an open
// session, a closed one is admin-only. The server enforces it; this only
// disables the controls to match, because a hidden button is not a control.
//
// The LOT is shown but never editable. Every box here was weighed against it,
// a registration form may reference it, and stock may have moved under it —
// changing it would silently re-attribute physical product.
const HEADER_FIELDS = [
  ["vendor", "Vendor", "TREX/GOP"],
  ["itemDescription", "Item description", "HUMERUS BONE"],
  ["billOfLading", "Vendor Lot #/IC#", ""],
  ["brand", "Brand", "IBP"],
  ["estNumber", "EST #", "9268"],
  ["grade", "Grade", "CHOICE"],
];

const fromDetail = (d) => ({
  vendor: d.vendor || "",
  itemDescription: d.item_description || "",
  billOfLading: d.bill_of_lading || "",
  brand: d.brand || "",
  estNumber: d.est_number || "",
  grade: d.grade || "",
  remarks: d.remarks || "",
});

const ManifestEditor = ({ batchId, detail, onChanged }) => {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => fromDetail(detail));
  const [saving, setSaving] = useState(false);

  const [confirmReopen, setConfirmReopen] = useState(false);
  const [reopening, setReopening] = useState(false);
  // What else points at this session, so the confirmation can say what will
  // stop matching if boxes are added. Loaded only when the dialog is opened —
  // there is no reason to ask on every expanded row.
  const [blockers, setBlockers] = useState(null);
  const cancelReopenRef = useRef(null);

  // Re-seed when a different session is expanded, or the detail is refetched.
  useEffect(() => { setDraft(fromDetail(detail)); setEditing(false); }, [detail, batchId]);

  // Read here rather than passed down: this component is rendered per row, and
  // threading the role through every one of them only creates a chance for the
  // two to disagree. Courtesy only — the server decides.
  const isAdmin = getRole() === "admin";
  const mayEdit = detail.status !== "closed" || isAdmin;
  const original = fromDetail(detail);
  const dirty = Object.keys(draft).some((k) => draft[k].trim() !== original[k].trim());

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: upper(e.target.value) }));

  const fail = (title) => (err) => toast({
    status: "error", position: "top", duration: 7000, isClosable: true, title,
    description: err.response?.data?.error || err.message,
  });

  const saveHeader = async () => {
    setSaving(true);
    try {
      // Only what actually changed, so a field someone never touched cannot be
      // blanked by a stale draft.
      const changed = Object.fromEntries(
        Object.keys(draft)
          .filter((k) => draft[k].trim() !== original[k].trim())
          .map((k) => [k, draft[k].trim() || null])
      );
      await axiosInstance.patch(`/box-batches/${batchId}`, changed);
      await onChanged();
      setEditing(false);
      toast({ status: "success", title: "Manifest updated", duration: 2000, position: "top" });
    } catch (err) { fail("Could not save")(err); } finally { setSaving(false); }
  };

  // Ask what references this session before offering to reopen it, so the
  // consequence is stated up front rather than discovered afterwards.
  const openReopenDialog = async () => {
    setBlockers(null);
    setConfirmReopen(true);
    try {
      const { data } = await axiosInstance.get(`/box-batches/${batchId}/references`);
      setBlockers(data);
    } catch {
      // The dialog still works without it; the warning simply is not shown.
    }
  };

  const reopen = async () => {
    setReopening(true);
    try {
      await axiosInstance.post(`/box-batches/${batchId}/reopen`);
      setConfirmReopen(false);
      await onChanged();
      toast({
        status: "success", position: "top", duration: 8000, isClosable: true,
        title: "Session reopened",
        description: "Open the scanner and press Continue on this lot to scan more boxes. " +
                     "Close it again when you are done.",
      });
    } catch (err) { fail("Could not reopen")(err); } finally { setReopening(false); }
  };

  return (
    <Box mb={3} px={3} py={2} bg="gray.50" borderRadius="md"
      border="1px solid" borderColor="gray.200">
      <Flex align="center" gap={2} mb={2} wrap="wrap">
        <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
          Manifest details
        </Text>
        {detail.status === "closed" && (
          <Badge colorScheme={mayEdit ? "purple" : "gray"} fontSize="9px">
            {mayEdit ? "closed — admin edit" : "closed"}
          </Badge>
        )}
        <Box flex={1} />
        {mayEdit && !editing && (
          <Button size="xs" variant="outline" colorScheme="blue"
            onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </Flex>

      {editing ? (
        <>
          <Flex gap={3} wrap="wrap" mb={2}>
            {HEADER_FIELDS.map(([key, label, placeholder]) => (
              <Box key={key} flex="1 1 150px">
                <Text fontSize="10px" color="gray.500" textTransform="uppercase" mb={1}>
                  {label}
                </Text>
                <Input size="sm" bg="white" value={draft[key]} onChange={set(key)}
                  placeholder={placeholder} textTransform="uppercase"
                  autoCorrect="off" autoCapitalize="characters" spellCheck={false} />
              </Box>
            ))}
          </Flex>
          <Text fontSize="10px" color="gray.500" textTransform="uppercase" mb={1}>
            Remarks — prints as MEMO
          </Text>
          <Textarea size="sm" rows={2} bg="white" value={draft.remarks}
            onChange={set("remarks")} textTransform="uppercase"
            placeholder="ANYTHING WORTH SAYING ABOUT THIS TALLY"
            autoCorrect="off" autoCapitalize="characters" spellCheck={false} />
          <Flex gap={2} mt={2} justify="flex-end">
            <Button size="xs" variant="ghost"
              onClick={() => { setDraft(fromDetail(detail)); setEditing(false); }}>
              Cancel
            </Button>
            <Button size="xs" colorScheme="blue" isLoading={saving}
              isDisabled={!dirty} onClick={saveHeader}>
              Save
            </Button>
          </Flex>
        </>
      ) : (
        <Flex gap={6} wrap="wrap">
          {[...HEADER_FIELDS.map(([k, l]) => [l, original[k]]),
            ["Remarks", original.remarks]]
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <Box key={label} maxW="320px">
                <Text fontSize="10px" color="gray.500" textTransform="uppercase">{label}</Text>
                <Text fontSize="sm" color="gray.800" style={{ whiteSpace: "pre-wrap" }}>
                  {value}
                </Text>
              </Box>
            ))}
        </Flex>
      )}

      {/* More boxes go on by SCANNING them, not by typing them.
          A keyed weight is unverified; a scanned one is re-derived from the
          barcode server-side, deduplicated on serial, and recorded as scanned.
          So a late box arrives on the same footing as every other box on the
          manifest rather than as somebody's typing. */}
      {isAdmin && (
        <Flex gap={3} align="center" mt={3} pt={3} wrap="wrap"
          borderTop="1px solid" borderColor="gray.200">
          {detail.status === "closed" ? (
            <>
              <Button size="sm" colorScheme="orange" variant="outline"
                isLoading={reopening} onClick={openReopenDialog}>
                Reopen for scanning
              </Button>
              <Text fontSize="xs" color="gray.600">
                Puts this session back in the scanner so more boxes can be scanned onto it.
              </Text>
            </>
          ) : (
            <Text fontSize="xs" color="gray.600">
              This session is <b>open</b> — open the scanner and press{" "}
              <b>Continue</b> on {detail.lot_number || "this lot"} to scan more boxes onto it.
            </Text>
          )}
        </Flex>
      )}

      <AlertDialog isOpen={confirmReopen} leastDestructiveRef={cancelReopenRef}
        onClose={() => setConfirmReopen(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Reopen this session?
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={2}>
                <b>{detail.lot_number || `Session ${batchId}`}</b> goes back to open, and
                will appear in the scanner under <b>Continue</b>. Its existing boxes stay
                exactly as they are.
              </Text>
              <Text fontSize="sm" mb={2}>
                Close it again when you have finished — a session left open is not
                finished work, and the manifest total moves with every box added.
              </Text>
              {/* Adding boxes changes the total that anything referencing this
                  session already recorded. Naming them beats a surprise later. */}
              {blockers && !blockers.deletable && (
                <Alert status="warning" borderRadius="md" fontSize="xs" py={2}
                  alignItems="flex-start">
                  <AlertIcon />
                  <Box>
                    <Text fontWeight="600">Something already references this session.</Text>
                    {blockers.forms.map((f) => (
                      <Text key={`f${f.id}`}>
                        Registration form <b>{f.lot_number || `#${f.id}`}</b> — its recorded
                        weight will no longer match if you add boxes.
                      </Text>
                    ))}
                    {blockers.groups.map((g) => (
                      <Text key={`g${g.group_id}`}>
                        Merged manifest <b>{g.name || g.lot_number || `#${g.group_id}`}</b>.
                      </Text>
                    ))}
                    {blockers.shipments.map((s) => (
                      <Text key={`s${s.shipment_id}`}>
                        Shipment <b>#{s.shipment_id} {s.destination_name}</b> ({s.status}).
                      </Text>
                    ))}
                  </Box>
                </Alert>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelReopenRef} onClick={() => setConfirmReopen(false)}>
                Go back
              </Button>
              <Button colorScheme="orange" isLoading={reopening} onClick={reopen}>
                Reopen
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
};

const MemberSessions = ({ rows }) => (
  <Box>
    <Text fontSize="xs" fontWeight="600" color="gray.600" mb={1}
      textTransform="uppercase" letterSpacing="wide">
      Sessions it covered
    </Text>
    <Flex direction="column" gap={1}>
      {rows.map((m) => (
        <Flex key={m.batch_id} gap={3} align="baseline" wrap="wrap" fontSize="xs">
          <Text color="gray.500">#{m.batch_id}</Text>
          <Text color="gray.800" fontWeight="600">{m.lot_number || "—"}</Text>
          <Text color="gray.700">{m.vendor || "—"}</Text>
          <Text color="gray.600">{m.item_description || ""}</Text>
          {m.box_count != null && (
            <Text color="gray.500" ml="auto">
              {m.box_count} box{m.box_count === 1 ? "" : "es"}
            </Text>
          )}
        </Flex>
      ))}
    </Flex>
  </Box>
);

export const WeightManifestTab = ({ refreshSignal = 0 }) => {
  // An open session can be corrected by whoever is running it; a closed one is
  // an admin act. The server enforces both — this only decides what to draw.
  const isAdmin = getRole() === "admin";
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({});   // batch_id -> full batch
  const [loadingId, setLoadingId] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  // A lot weighed across several sessions ships on one manifest.
  const [selected, setSelected] = useState(() => new Set());
  const [groups, setGroups] = useState([]);
  const [confirmMerge, setConfirmMerge] = useState(false);
  // The heading the merged manifest will carry. Pre-filled from the sessions
  // and editable, because merging used to take the first session's values
  // silently — so a vendor or BOL that disagreed between sessions vanished
  // without anyone seeing which one won.
  const [mergeHeader, setMergeHeader] = useState(null);
  // The whole session, not one box inside it.
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(null);
  // What is holding this session, read when the dialog opens. null while it is
  // still loading — which is why the Delete button waits rather than assuming
  // "nothing found yet" means "nothing holds it".
  const [deleteBlockers, setDeleteBlockers] = useState(null);

  // Opening the dialog asks the server what would refuse the delete, so the
  // answer is on screen BEFORE the button is pressed instead of arriving as a
  // failed request afterwards.
  const askToDelete = useCallback(async (batch) => {
    setConfirmDeleteBatch(batch);
    setDeleteBlockers(null);
    try {
      const { data } = await axiosInstance.get(`/box-batches/${batch.batch_id}/references`);
      setDeleteBlockers(data);
    } catch {
      // The dialog still works without this: the delete itself is guarded
      // server-side and will say no. Falling back to "deletable" keeps the
      // button live rather than trapping someone behind a failed lookup.
      setDeleteBlockers({ groups: [], forms: [], shipments: [], deletable: true, unknown: true });
    }
  }, []);
  // Removing a merged manifest destroys a saved, filed form — it gets the same
  // confirmation the session delete does.
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(null);
  const cancelDeleteGroupRef = useRef(null);
  const [removals, setRemovals] = useState(null);
  const [showRemovals, setShowRemovals] = useState(false);
  // One entry open at a time: these expand into a full box table, and several
  // open at once turns the window into a scroll of tables with no context.
  const [expandedRemovalId, setExpandedRemovalId] = useState(null);

  const [seen, setSeen] = useState(() => readSeen() || new Set());
  // Whether this device has ever stored a seen-set. Read once, at mount: after
  // the first write it must not flip back, or the seeding effect would re-run
  // and swallow genuinely new rows.
  const seededRef = useRef(readSeen() !== null);

  const markSeen = useCallback((key) => {
    setSeen((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev).add(key);
      writeSeen(next);
      return next;
    });
  }, []);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const cancelDeleteBatchRef = useRef(null);
  const [merging, setMerging] = useState(false);
  const cancelMergeRef = useRef(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const toast = useToast();

  const fetchBatches = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/box-batches");
      setBatches(data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Could not load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/manifest-groups");
      setGroups(data || []);
    } catch {
      // A merged-manifest listing failing must not blank the sessions table,
      // which is the part people actually need to keep working.
    }
  }, []);

  useEffect(() => { fetchBatches(); fetchGroups(); }, [fetchBatches, fetchGroups]);

  // Re-fetch on the parent's auto-refresh, compared against a ref so the
  // initial value does not cause a duplicate load alongside the mount effect.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    fetchBatches();
    fetchGroups();
  }, [refreshSignal, fetchBatches, fetchGroups]);

  // Closing the scanner means a session may have been opened or closed.
  const onScannerClose = () => { setScannerOpen(false); fetchBatches(); };

  const [expandedGroupId, setExpandedGroupId] = useState(null);
  const [groupDetails, setGroupDetails] = useState({});

  // Expanding a manifest shows every box across its sessions, in one sheet —
  // which is the thing the merge exists to produce.
  const toggleGroup = async (g) => {
    if (expandedGroupId === g.group_id) { setExpandedGroupId(null); return; }
    markSeen(`g${g.group_id}`);   // opening it IS the interaction
    setExpandedGroupId(g.group_id);
    if (groupDetails[g.group_id]) return;
    try {
      const { data } = await axiosInstance.get(`/manifest-groups/${g.group_id}`);
      setGroupDetails((prev) => ({ ...prev, [g.group_id]: data }));
    } catch (err) {
      toast({ title: "Could not load that manifest", status: "error",
        duration: 3000, position: "top" });
      setExpandedGroupId(null);
    }
  };

  const toggleExpand = async (batch) => {
    if (expandedId === batch.batch_id) { setExpandedId(null); return; }
    markSeen(`b${batch.batch_id}`);   // opening it IS the interaction
    setExpandedId(batch.batch_id);
    if (details[batch.batch_id]) return;      // already loaded
    setLoadingId(batch.batch_id);
    try {
      const { data } = await axiosInstance.get(`/box-batches/${batch.batch_id}`);
      setDetails((prev) => ({ ...prev, [batch.batch_id]: data }));
    } catch (err) {
      toast({ title: "Could not load that session", status: "error", duration: 3000, position: "top" });
      setExpandedId(null);
    } finally {
      setLoadingId(null);
    }
  };

  const print = async (batch) => {
    let full = details[batch.batch_id];
    if (!full) {
      try {
        const { data } = await axiosInstance.get(`/box-batches/${batch.batch_id}`);
        full = data;
        setDetails((prev) => ({ ...prev, [batch.batch_id]: data }));
      } catch {
        toast({ title: "Could not load that session", status: "error", duration: 3000, position: "top" });
        return;
      }
    }
    printWeightManifest({
      lotNumber: full.lot_number,
      vendor: full.vendor,
      shipTo: full.ship_to,
      billOfLading: full.bill_of_lading,
      itemDescription: full.item_description,
      date: fmtDate(String(full.created_at).slice(0, 10)),
      scans: full.items,
      // The form already carries a MEMO line — the session's remarks are what
      // it was always there for.
      memo: full.remarks,
    });
  };

  // Re-reads the batch after a correction rather than patching state by hand,
  // so what is displayed is always what the server actually holds.
  const afterRowChange = async (batch) => {
    const { data } = await axiosInstance.get(`/box-batches/${batch.batch_id}`);
    setDetails((prev) => ({ ...prev, [batch.batch_id]: data }));
    fetchBatches();   // counts and totals on the summary row have moved
  };

  // Extra arguments are forwarded: onEditWeight is called as (row, newWeight),
  // while onVoid and onRestore take the row alone.
  const rowAction = (batch, run, successTitle) => async (row, ...rest) => {
    setRowBusy(row.localId);
    try {
      await run(row, ...rest);
      await afterRowChange(batch);
      if (successTitle) {
        toast({ title: successTitle, status: "success", duration: 2500, position: "top" });
      }
    } catch (err) {
      toast({
        title: "Could not change that row",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 5000, position: "top",
      });
    } finally {
      setRowBusy(null);
    }
  };

  const handlersFor = (batch) => {
    // A closed session is only editable by an admin. Handing back no handlers
    // renders the grid read-only, exactly as it was before.
    if (batch.status !== "open" && !isAdmin) return {};
    const base = `/box-batches/${batch.batch_id}/items`;
    return {
      // The unit goes up as the operator typed it; the server converts it
      // itself rather than trusting a client-converted figure.
      onEditWeight: rowAction(batch,
        (row, weight, weightUnit = "LB") => axiosInstance.patch(`${base}/${row.localId}`,
          { weight, weightUnit }), "Weight corrected"),
      onVoid: rowAction(batch,
        (row) => axiosInstance.delete(`${base}/${row.localId}`), "Box taken off the tally"),
      onRestore: rowAction(batch,
        (row) => axiosInstance.post(`${base}/${row.localId}/restore`), "Box put back"),
    };
  };

  const toggleSelected = (batchId) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
    return next;
  });

  // What the chosen sessions say for each heading field. One distinct value is
  // agreement; more than one is a conflict the operator has to settle.
  const headerFor = (chosen) => {
    const field = (key) => {
      const values = [...new Set(chosen.map((b) => (b[key] || "").trim()).filter(Boolean))];
      return { value: values[0] || "", values, conflict: values.length > 1 };
    };
    return {
      lot_number: field("lot_number"),
      vendor: field("vendor"),
      item_description: field("item_description"),
      bill_of_lading: field("bill_of_lading"),
      ship_to: field("ship_to"),
    };
  };

  const openMerge = () => {
    const chosen = visible.filter((b) => selected.has(b.batch_id));
    const h = headerFor(chosen);
    setMergeHeader({
      name: "",
      lotNumber: h.lot_number.value,
      vendor: h.vendor.value,
      itemDescription: h.item_description.value,
      billOfLading: h.bill_of_lading.value,
      shipTo: h.ship_to.value,
      conflicts: h,
    });
    setConfirmMerge(true);
  };

  const createGroup = async () => {
    setMerging(true);
    try {
      const batchIds = visible.filter((b) => selected.has(b.batch_id)).map((b) => b.batch_id);
      const { data } = await axiosInstance.post("/manifest-groups", {
        batchIds,
        // Sent explicitly rather than left to the server's "first session wins"
        // default, so what prints is what was confirmed on screen.
        name: mergeHeader?.name || null,
        lotNumber: mergeHeader?.lotNumber || null,
        vendor: mergeHeader?.vendor || null,
        itemDescription: mergeHeader?.itemDescription || null,
        billOfLading: mergeHeader?.billOfLading || null,
        shipTo: mergeHeader?.shipTo || null,
      });
      toast({
        title: "Merged manifest created",
        description: `${batchIds.length} sessions on one form`,
        status: "success", duration: 3500, position: "top",
      });
      setSelected(new Set());
      setConfirmMerge(false);
      await fetchGroups();
      return data;
    } catch (err) {
      toast({
        title: err.response?.data?.code === "LOT_MISMATCH"
          ? "Those sessions are different lots"
          : "Could not merge those sessions",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 8000, position: "top", isClosable: true,
      });
      setConfirmMerge(false);
      return null;
    } finally {
      setMerging(false);
    }
  };

  // Pulled fresh every time rather than cached: the group references its
  // sessions, so a weight corrected since the last print has to appear.
  const printGroup = async (group) => {
    try {
      const { data } = await axiosInstance.get(`/manifest-groups/${group.group_id}`);
      printWeightManifest({
        lotNumber: data.lot_number,
        vendor: data.vendor,
        shipTo: data.ship_to,
        billOfLading: data.bill_of_lading,
        itemDescription: data.item_description,
        date: fmtDate(String(data.created_at).slice(0, 10)),
        scans: data.items,
        memo: data.remarks,
      });
    } catch (err) {
      toast({
        title: "Could not load that manifest",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top",
      });
    }
  };

  const loadRemovals = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/box-removals", { params: { limit: 100 } });
      setRemovals(data || []);
    } catch (err) {
      toast({
        title: "Could not load the removal history",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top",
      });
    }
  }, [toast]);

  const deleteGroup = async (group) => {
    setConfirmDeleteGroup(null);
    try {
      await axiosInstance.delete(`/manifest-groups/${group.group_id}`);
      toast({ title: "Merged manifest removed",
        description: "The sessions and their boxes are untouched.",
        status: "info", duration: 3000, position: "top" });
      fetchGroups();
      if (showRemovals) loadRemovals();
    } catch (err) {
      toast({ title: "Could not remove it",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    }
  };

  // Deletes the session and every box in it. The server refuses when the
  // session belongs to a merged manifest and says which one, so that message is
  // surfaced verbatim rather than flattened into a generic failure.
  const deleteBatch = async () => {
    const batch = confirmDeleteBatch;
    if (!batch) return;
    setDeletingBatch(true);
    try {
      const { data } = await axiosInstance.delete(`/box-batches/${batch.batch_id}`);
      toast({
        title: "Session deleted",
        description: `${batch.lot_number || `Batch ${batch.batch_id}`} and its ${data.boxesDeleted} box(es) are gone.`,
        status: "success", duration: 4000, position: "top",
      });
      setConfirmDeleteBatch(null);
      if (expandedId === batch.batch_id) setExpandedId(null);
      setDetails((prev) => {
        const next = { ...prev };
        delete next[batch.batch_id];
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(batch.batch_id);
        return next;
      });
      fetchBatches();
      if (showRemovals) loadRemovals();
    } catch (err) {
      toast({
        title: "Could not delete that session",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 8000, position: "top", isClosable: true,
      });
      setConfirmDeleteBatch(null);
    } finally {
      setDeletingBatch(false);
    }
  };

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const clearFilters = () => setFilters({});
  const activeFilters = Object.entries(filters).filter(([, v]) => v);

  const toggleFilters = () => {
    setShowFilters((open) => {
      if (open) clearFilters();   // hiding must not leave the list silently narrowed
      return !open;
    });
  };

  const vendorOptions = useMemo(
    () => [...new Set(batches.map((b) => b.vendor).filter(Boolean))].sort(),
    [batches]
  );

  const matchesFilters = useCallback((row) => {
    const active = Object.entries(filters).filter(([, v]) => v);
    return active.every(([key, value]) => {
      const col = COLUMNS.find((c) => c.key === key);
      const cell = String(row[key] ?? "");
      return col.filter === "select"
        ? cell === value
        : cell.toLowerCase().includes(value.toLowerCase());
    });
  }, [filters]);

  // Every session that belongs to a merged manifest. Those sessions do not
  // appear on their own — the manifest stands in for them, which is what a
  // merge means. Listing both showed the same boxes twice and made the totals
  // look like they double-counted.
  const mergedBatchIds = useMemo(
    () => new Set(groups.flatMap((g) => g.batch_ids || [])),
    [groups]
  );

  const visible = useMemo(() => batches.filter((b) => {
    if (mergedBatchIds.has(b.batch_id)) return false;
    if (statusFilter && b.status !== statusFilter) return false;
    return matchesFilters(b);
  }), [batches, statusFilter, matchesFilters, mergedBatchIds]);

  // Merged manifests and loose sessions in one list, ordered by when the
  // product was WEIGHED rather than when someone got round to merging it.
  const rows = useMemo(() => {
    const groupRows = groups
      .filter((g) => matchesFilters(g))
      .map((g) => ({
        kind: "group",
        key: `g${g.group_id}`,
        at: g.first_opened || g.created_at,
        lot: lotKey(g.lot_number),
        group: g,
      }));
    const sessionRows = visible.map((b) => ({
      kind: "session", key: `b${b.batch_id}`, at: b.created_at,
      lot: lotKey(b.lot_number), batch: b,
    }));
    return [...groupRows, ...sessionRows].sort((a, b) => {
      // Newest lot first. N{YY}{JJJ}-{NN} is fixed width, so comparing the text
      // sorts by year, then day, then sequence in one step — which is why the
      // format was chosen (CLAUDE.md §3). No parsing, nothing to get wrong.
      //
      // This also beats sorting by created_at: two sessions weighed against the
      // same lot hours apart now sit together instead of being separated by
      // whatever else was weighed in between.
      if (a.lot !== b.lot) return b.lot.localeCompare(a.lot);
      // Same lot: newest sitting first, so the most recent work is on top.
      return String(b.at || "").localeCompare(String(a.at || ""));
    });
  }, [groups, visible, matchesFilters]);

  // Counted over `rows` (what is actually on screen) rather than everything
  // loaded, so the number always matches the dots someone can point at.
  const newCount = useMemo(
    () => rows.reduce((n, r) => (seen.has(r.key) ? n : n + 1), 0),
    [rows, seen]
  );

  const markAllSeen = useCallback(() => {
    setSeen((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => next.add(r.key));
      writeSeen(next);
      return next;
    });
  }, [rows]);

  // First run on this device: treat everything already on screen as seen.
  // Without this the very first visit marks the entire history NEW, which
  // teaches people to ignore the marker on day one.
  //
  // Seeded off `batches`/`groups` rather than `rows`, so an active filter at
  // the moment of seeding cannot leave the rows it hides looking new later.
  useEffect(() => {
    if (seededRef.current) return;
    if (batches.length === 0 && groups.length === 0) return;   // nothing loaded yet
    seededRef.current = true;
    const all = new Set([
      ...batches.map((b) => `b${b.batch_id}`),
      ...groups.map((g) => `g${g.group_id}`),
    ]);
    setSeen(all);
    writeSeen(all);
  }, [batches, groups]);

  // The denominator for the count beside the filters. A merged session is
  // represented by its manifest, so counting it again would read "2 of 7" on a
  // tab that is showing everything it has.
  const totalRows = useMemo(
    () => batches.filter((b) => !mergedBatchIds.has(b.batch_id)).length + groups.length,
    [batches, groups, mergedBatchIds]
  );

  const todayStr = today();
  const isToday = (b) => String(b.created_at).slice(0, 10) === todayStr;

  if (loading) {
    return <Flex justify="center" py={10}><Spinner size="lg" color="blue.500" /></Flex>;
  }

  return (
    <Box>
      <Flex justify="space-between" align={{ base: "stretch", md: "center" }} mb={4}
        direction={{ base: "column", md: "row" }} gap={{ base: 3, md: 0 }}>
        <Flex align="center" gap={3} wrap="wrap" flex={1}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.600"
            textTransform="uppercase" letterSpacing="wide">
            Sessions
          </Text>
          <Flex gap={1}>
            {[["", "All"], ["open", "Open"], ["closed", "Closed"]].map(([value, label]) => (
              <Button key={label} size="xs"
                variant={statusFilter === value ? "solid" : "outline"}
                colorScheme={statusFilter === value ? (value === "open" ? "orange" : "blue") : "gray"}
                onClick={() => setStatusFilter(value)}>
                {label}
              </Button>
            ))}
          </Flex>
          <Button size="xs"
            variant={showFilters ? "solid" : "outline"}
            colorScheme={activeFilters.length ? "blue" : "gray"}
            leftIcon={<SearchIcon boxSize={3} />}
            rightIcon={showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
            onClick={toggleFilters}>
            Filters{activeFilters.length > 0 && ` (${activeFilters.length})`}
          </Button>
          {activeFilters.length > 0 && (
            <Button size="xs" variant="ghost" leftIcon={<CloseIcon boxSize={2} />} onClick={clearFilters}>
              Clear
            </Button>
          )}
          <Text fontSize="sm" color="gray.500">
            {rows.length}{rows.length !== totalRows && ` of ${totalRows}`}
          </Text>
          {newCount > 0 && (
            <Flex align="center" gap={1}>
              <Badge colorScheme="blue" borderRadius="full" fontSize="10px">
                {newCount} new
              </Badge>
              <Button size="xs" variant="ghost" colorScheme="blue"
                onClick={markAllSeen}>
                Mark all seen
              </Button>
            </Flex>
          )}
        </Flex>

        <Flex gap={2} wrap="wrap">
          {selected.size >= 2 && (  
            <Button size="xs" colorScheme="teal" onClick={openMerge}>
              Combine {selected.size} sessions
            </Button>
          )}
          {selected.size === 1 && (
            <Text fontSize="xs" color="gray.500" alignSelf="center">
              Pick one more to combine
            </Text>
          )}
          <Button size="xs" variant="outline" colorScheme="teal" onClick={() => setImportOpen(true)}>
            Import tally sheet
          </Button>
          <Button size="xs" colorScheme="teal" onClick={() => setScannerOpen(true)}>
            + New Box Weighing Session
          </Button>
        </Flex>
      </Flex>

      {error && (
        <Alert status="error" borderRadius="md" mb={3} fontSize="sm">
          <AlertIcon />{error}
        </Alert>
      )}

      <Flex mb={4}>
        <Button size="xs" variant="outline" colorScheme="gray"
          onClick={() => {
            setShowRemovals(true);
            if (removals === null) loadRemovals();
          }}>
          Removal history
        </Button>
      </Flex>

      {/* Gated on `rows`, which is what the table below actually renders —
          merged manifests AND loose sessions. Gating on `visible` (sessions
          only) blanked the entire tab the moment the last unmerged session went
          away: deleting one session hid every manifest too, and the data was
          still there. */}
      {rows.length === 0 ? (
        <Text fontSize="sm" color="gray.400">
          {batches.length === 0 && groups.length === 0
            ? "No weighing sessions yet. Start one to begin scanning boxes."
            : "Nothing matches these filters."}
        </Text>
      ) : (
        <Box overflowX="auto" width="100%">
          <Box as="table" width="100%" style={{ minWidth: "980px", borderCollapse: "collapse" }}>
            <Box as="thead">
              <Box as="tr">
                <Box as="th" bg="gray.100" borderBottom="1px solid" borderColor="gray.300"
                  px={2} py={2} style={{ width: "40px" }} />
                {COLUMNS.map((c) => (
                  <Box as="th" key={c.key} bg="gray.100" borderBottom="1px solid" borderColor="gray.300"
                    px={3} py={2} textAlign={c.align || "left"} style={{ width: c.width }}
                    fontSize="xs" fontWeight="bold" color="gray.600"
                    textTransform="uppercase" letterSpacing="wide">
                    {c.label}
                  </Box>
                ))}
                <Box as="th" bg="gray.100" borderBottom="1px solid" borderColor="gray.300"
                  px={3} py={2} style={{ width: "120px" }} />
              </Box>

              {showFilters && (
                <Box as="tr">
                  <Box as="th" bg="gray.50" borderBottom="1px solid" borderColor="gray.200" />
                  {COLUMNS.map((c) => (
                    <Box as="th" key={c.key} bg="gray.50" borderBottom="1px solid"
                      borderColor="gray.200" px={2} py={1}>
                      {c.filter === "text" && (
                        <Input size="xs" bg="white" placeholder="Filter…"
                          value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)} />
                      )}
                      {c.filter === "select" && (
                        <Select size="xs" bg="white"
                          value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)}>
                          <option value="">All</option>
                          {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                        </Select>
                      )}
                    </Box>
                  ))}
                  <Box as="th" bg="gray.50" borderBottom="1px solid" borderColor="gray.200" />
                </Box>
              )}
            </Box>

            <Box as="tbody">
              {rows.map((row, i) => {
                if (row.kind === "group") {
                  const g = row.group;
                  const gOpen = expandedGroupId === g.group_id;
                  const gDetail = groupDetails[g.group_id];
                  return (
                    <React.Fragment key={row.key}>
                      <Box as="tr" bg={i % 2 ? "teal.50" : "white"}
                        _hover={{ bg: "teal.100" }} cursor="pointer"
                        onDoubleClick={() => toggleGroup(g)}>
                        <Box as="td" px={2} py={2} borderBottom="1px solid" borderColor="gray.100" />
                        <Box as="td" px={3} py={2} fontSize="sm" fontWeight="600" color="teal.800"
                          borderBottom="1px solid" borderColor="gray.100"
                          borderLeft="4px solid" borderLeftColor="teal.500">
                          <Flex align="center" gap={2}>
                            <IconButton
                              aria-label={gOpen ? "Collapse" : "Expand"}
                              icon={gOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                              size="xs" variant="ghost" colorScheme={gOpen ? "teal" : "gray"}
                              onClick={(e) => { e.stopPropagation(); toggleGroup(g); }}
                              onDoubleClick={(e) => e.stopPropagation()}
                            />
                            {/* The teal left edge is what marks a row as a
                                merged manifest, so an unseen one takes the dot
                                and the pill and leaves that edge alone. */}
                            {!seen.has(row.key) && (
                              <Box as="span" width="7px" height="7px" borderRadius="full"
                                bg="blue.500" flexShrink={0} title="Not opened on this device yet" />
                            )}
                            <Text as="span">{g.name || g.lot_number || `Manifest ${g.group_id}`}</Text>
                            {!seen.has(row.key) && (
                              <Badge colorScheme="blue" fontSize="9px" px={1.5} borderRadius="full">
                                NEW
                              </Badge>
                            )}
                          </Flex>
                        </Box>
                        <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
                          borderBottom="1px solid" borderColor="gray.100">{g.vendor || "—"}</Box>
                        <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
                          borderBottom="1px solid" borderColor="gray.100">{g.item_description || "—"}</Box>
                        <Box as="td" px={3} py={2} fontSize="sm" color="gray.700" whiteSpace="nowrap"
                          borderBottom="1px solid" borderColor="gray.100">
                          {row.at ? new Date(row.at).toLocaleString() : "—"}
                        </Box>
                        <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
                          borderBottom="1px solid" borderColor="gray.100">{g.box_count}</Box>
                        <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
                          whiteSpace="nowrap" style={{ fontVariantNumeric: "tabular-nums" }}
                          borderBottom="1px solid" borderColor="gray.100">{g.total} LB</Box>
                        <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100">
                          <Badge colorScheme="teal" fontSize="10px">
                            Merged · {g.session_count}
                          </Badge>
                        </Box>
                        <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100"
                          textAlign="right">
                          <Flex gap={2} justify="flex-end">
                            <Button size="xs" variant="outline" colorScheme="blue"
                              onClick={(e) => { e.stopPropagation(); printGroup(g); }}>
                              Print
                            </Button>
                            {isAdmin && (
                              <Button size="xs" variant="ghost" colorScheme="red"
                                title="Unmerge — the sessions come back as their own rows"
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteGroup(g); }}>
                                Unmerge
                              </Button>
                            )}
                          </Flex>
                        </Box>
                      </Box>

                      {gOpen && (
                        <Box as="tr">
                          <Box as="td" colSpan={COLUMNS.length + 2} style={{ padding: 0 }}
                            bg="teal.50" borderTop="2px solid" borderColor="teal.300">
                            <Box p={4}>
                              {!gDetail ? (
                                <Flex justify="center" py={6}><Spinner size="sm" color="teal.500" /></Flex>
                              ) : (
                                <>
                                  <Text fontSize="xs" color="gray.600" mb={2}>
                                    {gDetail.sessions.length} session
                                    {gDetail.sessions.length === 1 ? "" : "s"} merged —
                                    {" "}{gDetail.sessions.map((x) => x.lot_number || `batch ${x.batch_id}`).join(", ")}
                                  </Text>
                                  <ScanSheet scans={gDetail.items} />
                                </>
                              )}
                            </Box>
                          </Box>
                        </Box>
                      )}
                    </React.Fragment>
                  );
                }

                const b = row.batch;
                const open = expandedId === b.batch_id;
                const detail = details[b.batch_id];
                // Composed with today's green rather than competing with it: a
                // row is often BOTH. Today keeps the background and the left
                // edge; unseen adds the dot and the NEW pill, and only claims
                // the left edge when today has not.
                const isNew = !seen.has(row.key);
                return (
                  <React.Fragment key={row.key}>
                    <Box as="tr"
                      bg={isToday(b) ? "green.50" : i % 2 ? "gray.50" : "white"}
                      _hover={{ bg: isToday(b) ? "green.100" : "blue.50" }}
                      cursor="pointer" onDoubleClick={() => toggleExpand(b)}>
                      {/* Centred on the td, not the Checkbox: Chakra renders the
                          control as an inline-flex label, so textAlign is what
                          moves it. alignSelf does nothing here — a table cell is
                          not a flex container for it to align against. */}
                      <Box as="td" px={2} py={2} textAlign="center"
                        borderBottom="1px solid" borderColor="gray.100"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}>
                        <Checkbox size="sm" isChecked={selected.has(b.batch_id)} borderColor="gray.500"
                          onChange={() => toggleSelected(b.batch_id)}
                          aria-label={`Select ${b.lot_number || b.batch_id}`} />
                      </Box>
                      <Box as="td" px={3} py={2} fontSize="sm" fontWeight="600" color="blue.700"
                        borderBottom="1px solid" borderColor="gray.100"
                        borderLeft={isToday(b) || isNew ? "4px solid" : undefined}
                        borderLeftColor={isToday(b) ? "green.500" : isNew ? "blue.400" : undefined}>
                        <Flex align="center" gap={2}>
                          <IconButton
                            aria-label={open ? "Collapse" : "Expand"}
                            title={open ? "Collapse" : "Expand"}
                            icon={open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                            size="xs" variant="ghost"
                            colorScheme={open ? "blue" : "gray"}
                            onClick={(e) => { e.stopPropagation(); toggleExpand(b); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                          />
                          {/* A dot rather than more colour on the row: a NEW row
                              that is also today's must still read as today's. */}
                          {isNew && (
                            <Box as="span" width="7px" height="7px" borderRadius="full"
                              bg="blue.500" flexShrink={0} title="Not opened on this device yet" />
                          )}
                          <Text as="span">{b.lot_number || `Batch ${b.batch_id}`}</Text>
                          {isNew && (
                            <Badge colorScheme="blue" fontSize="9px" px={1.5} borderRadius="full">
                              NEW
                            </Badge>
                          )}
                        </Flex>
                      </Box>
                      <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
                        borderBottom="1px solid" borderColor="gray.100">{b.vendor || "—"}</Box>
                      <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
                        borderBottom="1px solid" borderColor="gray.100">{b.item_description || "—"}</Box>
                      <Box as="td" px={3} py={2} fontSize="sm" color="gray.700" whiteSpace="nowrap"
                        borderBottom="1px solid" borderColor="gray.100">
                        {new Date(b.created_at).toLocaleString()}
                        {isToday(b) && (
                          <Badge ml={2} colorScheme="green" fontSize="9px" px={1.5} borderRadius="full">TODAY</Badge>
                        )}
                      </Box>
                      <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
                        borderBottom="1px solid" borderColor="gray.100">{b.box_count}</Box>
                      <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
                        whiteSpace="nowrap" style={{ fontVariantNumeric: "tabular-nums" }}
                        borderBottom="1px solid" borderColor="gray.100">{totalsText(b.totals)}</Box>
                      <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100">
                        <Flex gap={1} wrap="wrap">
                          <Badge colorScheme={b.status === "closed" ? "green" : "orange"} fontSize="10px">
                            {b.status === "closed" ? "Closed" : "Open"}
                          </Badge>
                          {/* A barcode-verified lot and one keyed in by hand
                              carry different confidence. */}
                          {b.source === "imported" && (
                            <Badge colorScheme="teal" fontSize="10px">Imported</Badge>
                          )}
                        </Flex>
                      </Box>
                      <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100" textAlign="right">
                        <Flex gap={2} justify="flex-end">
                          <Button size="xs" variant="outline" colorScheme="blue"
                            isDisabled={!b.box_count}
                            onClick={(e) => { e.stopPropagation(); print(b); }}>
                            Print
                          </Button>
                          {/* Deletes the whole session, boxes and all. Admin
                              only, and gated server-side too. */}
                          {isAdmin && (
                            <Button size="xs" variant="ghost" colorScheme="red"
                              onClick={(e) => { e.stopPropagation(); askToDelete(b); }}>
                              Delete
                            </Button>
                          )}
                        </Flex>
                      </Box>
                    </Box>

                    {open && (
                      <Box as="tr">
                        <Box as="td" colSpan={COLUMNS.length + 2} style={{ padding: 0 }}
                          bg="blue.50" borderTop="2px solid" borderColor="blue.300">
                          <Box p={4}>
                            {loadingId === b.batch_id ? (
                              <Flex justify="center" py={6}><Spinner size="sm" color="blue.500" /></Flex>
                            ) : detail ? (
                              <>
                                {/* Brand, EST and grade are captured at weighing
                                    and deliberately kept OFF the printed
                                    manifest, so this is the only place they can
                                    be read back. Without it they would be
                                    write-only — recorded and unreachable.
                                    Hidden entirely when none were entered,
                                    rather than showing a row of dashes. */}
                                <ManifestEditor
                                  batchId={b.batch_id}
                                  detail={detail}
                                  onChanged={async () => {
                                    // The heading, the boxes and the row's own
                                    // count and total can all have moved, so
                                    // both the detail and the listing reload.
                                    const { data } = await axiosInstance
                                      .get(`/box-batches/${b.batch_id}`);
                                    setDetails((prev) => ({ ...prev, [b.batch_id]: data }));
                                    await fetchBatches();
                                  }}
                                />
                                <ScanSheet scans={detail.items}
                                  busyId={rowBusy} {...handlersFor(b)} />
                              </>
                            ) : null}
                          </Box>
                        </Box>
                      </Box>
                    )}
                  </React.Fragment>
                );
              })}
            </Box>
          </Box>
          <Text fontSize="xs" color="gray.400" mt={2}>
            Double-click a session, or use the chevron, to see its box weights.
          </Text>
        </Box>
      )}

      <AlertDialog isOpen={confirmMerge} leastDestructiveRef={cancelMergeRef}
        onClose={() => setConfirmMerge(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Combine these into one manifest
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={3}>
                These sessions will print as a single tally sheet. Nothing is
                copied — correcting a box in a session afterwards will show on
                the next print of this manifest.
              </Text>

              {/* The heading, confirmed rather than assumed. Anywhere the
                  sessions disagree is marked and the alternatives listed, so a
                  vendor or BOL cannot be dropped without someone choosing. */}
              {mergeHeader && (
                <Box mb={3}>
                  {Object.values(mergeHeader.conflicts).some((c) => c.conflict) && (
                    <Alert status="warning" borderRadius="md" fontSize="xs" mb={2} py={2}>
                      <AlertIcon boxSize={3} />
                      These sessions do not agree on every field. Confirm what the
                      manifest should say.
                    </Alert>
                  )}

                  {[
                    ["lotNumber", "Lot #", "lot_number"],
                    ["vendor", "Vendor", "vendor"],
                    ["itemDescription", "Item description", "item_description"],
                    ["billOfLading", "Vendor Lot #/IC#", "bill_of_lading"],
                  ].map(([key, label, conflictKey]) => {
                    const c = mergeHeader.conflicts[conflictKey];
                    return (
                      <Box key={key} mb={2}>
                        <Flex align="baseline" gap={2} mb={1}>
                          <Text fontSize="xs" color="gray.500" textTransform="uppercase"
                            letterSpacing="wide">{label}</Text>
                          {c.conflict && (
                            <Badge colorScheme="orange" fontSize="9px">
                              {c.values.length} different values
                            </Badge>
                          )}
                        </Flex>
                        <Input
                          size="sm"
                          bg={c.conflict ? "orange.50" : "white"}
                          borderColor={c.conflict ? "orange.300" : "gray.200"}
                          value={mergeHeader[key]}
                          onChange={(e) => setMergeHeader((h) => ({ ...h, [key]: upper(e.target.value) }))}
                        />
                        {c.conflict && (
                          <Flex gap={1} mt={1} wrap="wrap">
                            {c.values.map((v) => (
                              <Button key={v} size="xs" variant="outline" colorScheme="orange"
                                fontWeight="400"
                                onClick={() => setMergeHeader((h) => ({ ...h, [key]: v }))}>
                                {v}
                              </Button>
                            ))}
                          </Flex>
                        )}
                      </Box>
                    );
                  })}

                  <Box mb={2}>
                    <Text fontSize="xs" color="gray.500" textTransform="uppercase"
                      letterSpacing="wide" mb={1}>Name (optional)</Text>
                    <Input size="sm" bg="white" placeholder="e.g. PALLETS 1-3"
                      value={mergeHeader.name}
                      onChange={(e) => setMergeHeader((h) => ({ ...h, name: upper(e.target.value) }))} />
                  </Box>
                </Box>
              )}
              <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden">
                {visible.filter((b) => selected.has(b.batch_id)).map((b, i) => (
                  <Flex key={b.batch_id} px={3} py={2} gap={3} align="baseline"
                    bg={i % 2 ? "gray.50" : "white"} wrap="wrap">
                    <Text fontSize="sm" fontWeight="bold" color="red.800">
                      {b.lot_number || `Batch ${b.batch_id}`}
                    </Text>
                    <Text fontSize="sm" color="gray.600">{b.vendor || "—"}</Text>
                    <Text fontSize="sm" color="gray.700" ml="auto">
                      {b.box_count} boxes · {totalsText(b.totals)}
                    </Text>
                  </Flex>
                ))}
              </Box>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelMergeRef} onClick={() => setConfirmMerge(false)}>
                Go back
              </Button>
              <Button colorScheme="teal" onClick={createGroup} isLoading={merging}>
                Combine
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Deleting a whole session destroys every weight in it, so the dialog
          states the count rather than asking "are you sure". leastDestructiveRef
          keeps focus on the safe button. */}
      <AlertDialog
        isOpen={Boolean(confirmDeleteBatch)}
        leastDestructiveRef={cancelDeleteBatchRef}
        onClose={() => setConfirmDeleteBatch(null)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete this whole session?
            </AlertDialogHeader>
            <AlertDialogBody>
              {confirmDeleteBatch && (
                <>
                  <Text fontSize="sm" mb={3}>
                    This removes the session and every box weighed in it. It cannot
                    be undone.
                  </Text>
                  <Box px={3} py={2} bg="gray.50" borderRadius="md"
                    border="1px solid" borderColor="gray.200">
                    <Flex gap={3} align="baseline" wrap="wrap">
                      <Text fontSize="sm" fontWeight="bold" color="red.800">
                        {confirmDeleteBatch.lot_number || `Batch ${confirmDeleteBatch.batch_id}`}
                      </Text>
                      {confirmDeleteBatch.vendor && (
                        <Text fontSize="sm" color="gray.600">{confirmDeleteBatch.vendor}</Text>
                      )}
                    </Flex>
                    <Text fontSize="sm" color="gray.700" mt={1}>
                      {confirmDeleteBatch.box_count} box
                      {confirmDeleteBatch.box_count === 1 ? "" : "es"}
                      {" · "}{totalsText(confirmDeleteBatch.totals)}
                    </Text>
                  </Box>
                  {confirmDeleteBatch.status === "open" && (
                    <Text fontSize="sm" color="orange.700" mt={3}>
                      This session is still open. If someone is scanning into it
                      right now, their work goes too.
                    </Text>
                  )}

                  {/* What is holding it, and where to go and undo that. Closing
                      the session does NOT clear any of these — the session's own
                      status and what references it are separate questions, and
                      conflating them is what sends people looking in the wrong
                      place. */}
                  {deleteBlockers && !deleteBlockers.deletable && (
                    <Alert status="warning" borderRadius="md" mt={3}
                      alignItems="flex-start" py={2}>
                      <AlertIcon />
                      <Box minW={0}>
                        <Text fontSize="sm" fontWeight="600" mb={1}>
                          This cannot be deleted yet
                        </Text>
                        {deleteBlockers.groups.map((g) => (
                          <Text key={`g${g.group_id}`} fontSize="xs" color="gray.700">
                            On merged manifest <b>{g.name || g.lot_number || `#${g.group_id}`}</b>
                            {" "}— remove it from that manifest first.
                          </Text>
                        ))}
                        {deleteBlockers.forms.map((f) => (
                          <Text key={`f${f.id}`} fontSize="xs" color="gray.700">
                            Tied to registration form <b>{f.lot_number || `#${f.id}`}</b>
                            {" "}— untie it there first.
                          </Text>
                        ))}
                        {deleteBlockers.shipments.map((s) => (
                          <Text key={`s${s.shipment_id}`} fontSize="xs" color="gray.700">
                            On shipment <b>#{s.shipment_id} {s.destination_name}</b>
                            {" "}({s.status}) —{" "}
                            {s.status === "draft"
                              ? "untie it in Outgoing, or delete that draft."
                              : "a shipped load must be cancelled first."}
                          </Text>
                        ))}
                      </Box>
                    </Alert>
                  )}
                </>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelDeleteBatchRef} onClick={() => setConfirmDeleteBatch(null)}>
                Go back
              </Button>
              <Button colorScheme="red" onClick={deleteBatch}
                isLoading={deletingBatch || deleteBlockers === null}
                isDisabled={Boolean(deleteBlockers && !deleteBlockers.deletable)}>
                Delete session
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Removing a merged manifest destroys a saved form somebody may have
          printed and filed. The sessions survive, and the dialog says so, since
          that is the thing a person is actually worried about here. */}
      <AlertDialog
        isOpen={Boolean(confirmDeleteGroup)}
        leastDestructiveRef={cancelDeleteGroupRef}
        onClose={() => setConfirmDeleteGroup(null)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Remove this merged manifest?
            </AlertDialogHeader>
            <AlertDialogBody>
              {confirmDeleteGroup && (
                <>
                  <Text fontSize="sm" mb={3}>
                    The merged form goes. The weighing sessions it covered, and every
                    box in them, are left untouched — only the grouping is removed.
                  </Text>
                  <Box px={3} py={2} bg="gray.50" borderRadius="md"
                    border="1px solid" borderColor="gray.200">
                    <Text fontSize="sm" fontWeight="bold" color="red.800">
                      {confirmDeleteGroup.name || confirmDeleteGroup.lot_number
                        || `Manifest ${confirmDeleteGroup.group_id}`}
                    </Text>
                    <Text fontSize="sm" color="gray.700" mt={1}>
                      {confirmDeleteGroup.session_count} session
                      {confirmDeleteGroup.session_count === 1 ? "" : "s"}
                      {" · "}{confirmDeleteGroup.box_count} boxes
                    </Text>
                  </Box>
                </>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelDeleteGroupRef} onClick={() => setConfirmDeleteGroup(null)}>
                Go back
              </Button>
              <Button colorScheme="red" onClick={() => deleteGroup(confirmDeleteGroup)}>
                Unmerge manifest
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Everything taken off a tally. Voids and restores sit alongside the
          permanent deletions on purpose: a trail showing only removals, and
          not the ones that were undone, overstates what actually left. */}
      <FloatingWindow
        isOpen={showRemovals}
        onClose={() => setShowRemovals(false)}
        title="Removal history"
        width={860}
        footer={
          <Flex justify="space-between" width="100%" gap={2} wrap="wrap">
            <Button size="sm" variant="outline" onClick={loadRemovals}>Refresh</Button>
            <Button size="sm" onClick={() => setShowRemovals(false)}>Close</Button>
          </Flex>
        }
      >
        {removals === null ? (
          <Flex justify="center" py={8}><Spinner size="md" color="blue.500" /></Flex>
        ) : removals.length === 0 ? (
          <Box p={4} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
            <Text fontSize="sm" color="gray.600">
              Nothing has been removed yet. From here on, every void, erased box,
              deleted session and removed manifest is recorded here.
            </Text>
          </Box>
        ) : (
          <>
          <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden">
            {removals.map((r, i) => {
              const d = r.details || null;
              // Three shapes reach this: a session delete logs
              // { batch, items }, a manifest removal { group, batches }, and a
              // single box logs the row itself.
              const items  = Array.isArray(d?.items) ? d.items : null;
              const members = Array.isArray(d?.batches) ? d.batches : null;
              const head = d?.batch || d?.group || (items || members ? null : d);
              const open = expandedRemovalId === r.id;
              return (
                <Box key={r.id} bg={i % 2 ? "gray.50" : "white"}
                  borderBottom={i === removals.length - 1 ? "none" : "1px solid"}
                  borderColor="gray.100">
                  <Flex px={3} py={2} gap={3} align="baseline" wrap="wrap"
                    cursor={d ? "pointer" : "default"}
                    onClick={() => d && setExpandedRemovalId(open ? null : r.id)}>
                    {d ? (
                      <IconButton
                        aria-label={open ? "Hide what was recorded" : "Show what was recorded"}
                        icon={open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                        size="xs" variant="ghost" alignSelf="center"
                        colorScheme={open ? "blue" : "gray"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedRemovalId(open ? null : r.id);
                        }}
                      />
                    ) : (
                      <Box width="24px" />
                    )}
                    <Badge fontSize="9px" colorScheme={REMOVAL_COLOR[r.action] || "gray"}>
                      {REMOVAL_LABEL[r.action] || r.action}
                    </Badge>
                    {r.lot_number && (
                      <Text fontSize="sm" fontWeight="600" color="gray.700">{r.lot_number}</Text>
                    )}
                    <Text fontSize="sm" color="gray.700">{r.summary}</Text>
                    {r.reason && (
                      <Text fontSize="xs" color="gray.500" fontStyle="italic">“{r.reason}”</Text>
                    )}
                    <Text fontSize="xs" color="gray.500" ml="auto" whiteSpace="nowrap">
                      {r.performed_by ? `${r.performed_by} · ` : ""}
                      {new Date(r.created_at).toLocaleString()}
                    </Text>
                  </Flex>

                  {open && d && (
                    <Box px={4} pb={3} pt={2} bg="white"
                      borderTop="1px solid" borderColor="gray.200">
                      {head && <DetailGrid data={head} />}
                      {items && <DeletedBoxes items={items} />}
                      {members && <MemberSessions rows={members} />}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
          <Text fontSize="xs" color="gray.400" mt={2}>
            Expand an entry to see everything that was recorded — for a deleted
            session, that includes every box weight, and it is the only copy left.
          </Text>
          </>
        )}
      </FloatingWindow>

      <BoxScanner isOpen={scannerOpen} onClose={onScannerClose} />
      <ImportTally isOpen={importOpen} onClose={() => setImportOpen(false)} onImported={fetchBatches} />
    </Box>
  );
};

export default WeightManifestTab;
