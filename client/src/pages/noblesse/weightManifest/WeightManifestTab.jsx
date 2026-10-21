import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Text, Button, Badge, Spinner, Input, Select, Alert, AlertIcon, useToast } from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, CloseIcon } from "@chakra-ui/icons";
import axiosInstance from "../../../utils/axiosInstance";
import DeleteBatchDialog from "../DeleteBatchDialog";
import BoxScanner from "../../../components/navbar/boxScanner";
import printWeightManifest from "../printWeightManifest";
import FpReturnWindow from "../FpReturnWindow";
import { fmtDate, today, weighedDay } from "../shared";
import getRole from "../../../utils/getRole";
import SearchBar from "../../../components/SearchBar";
import { COLUMNS, lotKey } from "./constants";
import { readSeen, writeSeen } from "./seen";
import LotRow from "./rows/LotRow";
import MergedRow from "./rows/MergedRow";
import SessionRow from "./rows/SessionRow";
import MergeDialog from "./dialogs/MergeDialog";
import UnmergeDialog from "./dialogs/UnmergeDialog";
import RemovalsWindow from "./removals/RemovalsWindow";

// Past weighing sessions, one row per session. Expanding a row pulls its boxes
// and shows them in the same sheet they were scanned into, so a manifest can be
// checked or reprinted without leaving the tab.

export const WeightManifestTab = ({ refreshSignal = 0 }) => {
  // An open session can be corrected by whoever is running it; a closed one is
  // an admin act. The server enforces both — this only decides what to draw.
  const isAdmin = getRole() === "admin";
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  // Run on the server, so it reaches sessions past the newest 50 a plain
  // listing shows. The column filters below still narrow what comes back.
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({});   // batch_id -> full batch
  const [loadingId, setLoadingId] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  // A lot weighed across several sessions ships on one manifest.
  const [selected, setSelected] = useState(() => new Set());
  const [groups, setGroups] = useState([]);
  // Sessions tied to one registration form: one lot, shown as one row.
  const [formGroups, setFormGroups] = useState([]);
  const [openFormId, setOpenFormId] = useState(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  // The heading the merged manifest will carry. Pre-filled from the sessions
  // and editable, because merging used to take the first session's values
  // silently — so a vendor or BOL that disagreed between sessions vanished
  // without anyone seeing which one won.
  const [mergeHeader, setMergeHeader] = useState(null);
  // The whole session, not one box inside it.
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(null);

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
  const [merging, setMerging] = useState(false);
  const cancelMergeRef = useRef(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  // When the scanner is opened by reopening a manifest, it carries the session
  // to pick up — so nobody has to go and find it in a list.
  const [scannerAdopt, setScannerAdopt] = useState(null);
  const [returnsOpen, setReturnsOpen] = useState(false);
  // Who counts freezer returns at the incoming dock; the server's RETURN_ROLES is the control.
  const canReturnFp = ["admin", "reception", "ntimanager", "noblesse"].includes(getRole());
  const toast = useToast();

  // ARRIVALS ONLY. A weight manifest is the tally for product that came IN.
  // Finished product weighed on its way out is a different thing with a
  // different home (the Outgoing tab) — it used to be listed here, where it was
  // indistinguishable from an arrival and could be tied to a registration form
  // as though it were one.
  //
  // Filtered by the SERVER, not here: the listing returns 50 rows by default, so
  // filtering client-side would have quietly dropped arrivals off the end of the
  // page as outgoing sessions accumulated.
  // Each fetch drops its answer if a newer one has been asked for since, so a
  // slow reply to an old search cannot overwrite the current one.
  const batchSeq = useRef(0);
  const groupSeq = useRef(0);

  const fetchBatches = useCallback(async () => {
    const mine = ++batchSeq.current;
    try {
      const { data } = await axiosInstance.get("/box-batches",
        { params: { direction: "incoming", q: q || undefined } });
      if (mine !== batchSeq.current) return;
      setBatches(data || []);
      setError(null);
    } catch (err) {
      if (mine !== batchSeq.current) return;
      setError(err.response?.data?.error || err.message || "Could not load sessions");
    } finally {
      if (mine === batchSeq.current) { setLoading(false); setSearching(false); }
    }
  }, [q]);

  // Searched too, and by its sessions as well as its own heading: the table
  // shows a manifest in place of its sessions, so the two must be found together.
  const fetchGroups = useCallback(async () => {
    const mine = ++groupSeq.current;
    const params = { params: { q: q || undefined } };
    // Each on its own: a merged listing failing must not blank the sessions,
    // and a failed form listing just leaves those sessions as their own rows.
    const [stored, byForm] = await Promise.all([
      axiosInstance.get("/manifest-groups", params).catch(() => null),
      axiosInstance.get("/form-manifests", params).catch(() => null),
    ]);
    if (mine !== groupSeq.current) return;
    if (stored) setGroups(stored.data || []);
    setFormGroups(byForm ? byForm.data || [] : []);
  }, [q]);

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
  const onScannerClose = () => {
    setScannerOpen(false);
    setScannerAdopt(null);
    fetchBatches();
  };

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

  // Opens to its sessions as ordinary rows, so every correction still works.
  const toggleFormGroup = (g) => {
    if (openFormId === g.form_id) { setOpenFormId(null); return; }
    (g.batch_ids || []).forEach((id) => markSeen(`b${id}`));
    setOpenFormId(g.form_id);
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
      date: fmtDate(weighedDay(full)),
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
      const { data } = await axiosInstance.get(group.kind === "form"
        ? `/form-manifests/${group.form_id}`
        : `/manifest-groups/${group.group_id}`);
      printWeightManifest({
        lotNumber: data.lot_number,
        vendor: data.vendor,
        shipTo: data.ship_to,
        billOfLading: data.bill_of_lading,
        itemDescription: data.item_description,
        // When its product was weighed, not when someone merged it.
        date: fmtDate(group.first_opened
          ? today(new Date(group.first_opened)) : today(new Date(data.created_at))),
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
  // The dialog owns the request; this is the list's own tidy-up afterwards.
  const afterBatchDeleted = async (batchId) => {
    if (expandedId === batchId) setExpandedId(null);
    setDetails((prev) => { const next = { ...prev }; delete next[batchId]; return next; });
    setSelected((prev) => { const next = new Set(prev); next.delete(batchId); return next; });
    fetchBatches();
    if (showRemovals) loadRemovals();
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

  // Sessions a registration form ties into one lot sit under that lot's row.
  const tiedBatchIds = useMemo(
    () => new Set(formGroups.flatMap((g) => g.batch_ids || [])),
    [formGroups]
  );

  const visible = useMemo(() => batches.filter((b) => {
    if (mergedBatchIds.has(b.batch_id) || tiedBatchIds.has(b.batch_id)) return false;
    if (statusFilter && b.status !== statusFilter) return false;
    return matchesFilters(b);
  }), [batches, statusFilter, matchesFilters, mergedBatchIds, tiedBatchIds]);

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
    const byId = new Map(batches.map((b) => [b.batch_id, b]));
    const formRows = formGroups
      // A status filter keeps a lot whose sessions include that status.
      .filter((g) => matchesFilters(g) && (!statusFilter
        || (g.batch_ids || []).some((id) => byId.get(id)?.status === statusFilter)))
      .map((g) => ({
        kind: "formGroup",
        key: `f${g.form_id}`,
        at: g.first_opened || g.created_at,
        lot: lotKey(g.lot_number),
        group: g,
        // New while any of its sessions is.
        seenKeys: (g.batch_ids || []).map((id) => `b${id}`),
      }));
    const sessionRows = visible.map((b) => ({
      kind: "session", key: `b${b.batch_id}`, at: b.weighed_on || b.created_at,
      lot: lotKey(b.lot_number), batch: b,
    }));
    const sorted = [...groupRows, ...formRows, ...sessionRows].sort((a, b) => {
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
    // An open lot's sessions go straight under it, after sorting, so they stay attached.
    return sorted.flatMap((r) => {
      if (r.kind !== "formGroup" || r.group.form_id !== openFormId) return [r];
      const children = (r.group.batch_ids || [])
        .map((id) => byId.get(id)).filter(Boolean)
        .map((b) => ({ kind: "session", key: `b${b.batch_id}`, child: true,
          at: b.weighed_on || b.created_at, lot: r.lot, batch: b }));
      return [r, ...children];
    });
  }, [groups, formGroups, batches, visible, matchesFilters, statusFilter, openFormId]);

  // Counted over `rows` (what is actually on screen) rather than everything
  // loaded, so the number always matches the dots someone can point at.
  // "New" means arrived since you last looked. A search reaches rows this
  // device never loaded, which were never marked seen, so while searching
  // nothing is called new — an old lot found by search would otherwise light up.
  const isUnseen = useCallback(
    (key) => !q && !seen.has(key),
    [q, seen]
  );

  // A lot row is new through its sessions; its opened children are not counted again.
  const rowUnseen = useCallback(
    (r) => (r.seenKeys ? r.seenKeys.some(isUnseen) : isUnseen(r.key)),
    [isUnseen]
  );

  const newCount = useMemo(
    () => rows.reduce((n, r) => (!r.child && rowUnseen(r) ? n + 1 : n), 0),
    [rows, rowUnseen]
  );

  const markAllSeen = useCallback(() => {
    setSeen((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => (r.seenKeys || [r.key]).forEach((k) => next.add(k)));
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
    () => batches.filter((b) => !mergedBatchIds.has(b.batch_id) && !tiedBatchIds.has(b.batch_id)).length
      + groups.length + formGroups.length,
    [batches, groups, formGroups, mergedBatchIds, tiedBatchIds]
  );

  const todayStr = today();
  const isToday = (b) => weighedDay(b) === todayStr;

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
          <SearchBar
            placeholder="Search lot, vendor, item, BOL…"
            isSearching={searching}
            onSearch={(text) => { setSearching(true); setQ(text); }}
          />
          <Flex gap={1}>
            {[["", "All"], ["open", "Open"], ["closed", "Closed"]].map(([value, label]) => (
              <Button key={label} size="xs"
                variant={statusFilter === value ? "solid" : "outline"}
                colorScheme={statusFilter === value ? (value === "open" ? "yellow" : "blue") : "gray"}
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
          {canReturnFp && (
            <Button size="xs" variant="outline" colorScheme="teal" onClick={() => setReturnsOpen(true)}>
              Back from freezer
            </Button>
          )}
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
          {/* A search that finds nothing also empties both lists — which, read
              the old way, claimed there were no sessions at all. */}
          {q
            ? `Nothing matches “${q}”.`
            : batches.length === 0 && groups.length === 0
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
                if (row.kind === "formGroup") {
                  return <LotRow key={row.key} i={i} openFormId={openFormId} printGroup={printGroup} row={row} rowUnseen={rowUnseen} toggleFormGroup={toggleFormGroup} />;
                }

                if (row.kind === "group") {
                  return <MergedRow key={row.key} expandedGroupId={expandedGroupId} groupDetails={groupDetails} i={i} isAdmin={isAdmin} isUnseen={isUnseen} printGroup={printGroup} row={row} setConfirmDeleteGroup={setConfirmDeleteGroup} toggleGroup={toggleGroup} />;
                }

                return <SessionRow key={row.key} details={details} expandedId={expandedId} fetchBatches={fetchBatches} handlersFor={handlersFor} i={i} isAdmin={isAdmin} isToday={isToday} isUnseen={isUnseen} loadingId={loadingId} print={print} row={row} rowBusy={rowBusy} selected={selected} setConfirmDeleteBatch={setConfirmDeleteBatch} setDetails={setDetails} setScannerAdopt={setScannerAdopt} setScannerOpen={setScannerOpen} toggleExpand={toggleExpand} toggleSelected={toggleSelected} />;
              })}
            </Box>
          </Box>
          <Text fontSize="xs" color="gray.400" mt={2}>
            Double-click a session, or use the chevron, to see its box weights.
          </Text>
        </Box>
      )}

      <MergeDialog cancelMergeRef={cancelMergeRef} confirmMerge={confirmMerge} createGroup={createGroup} mergeHeader={mergeHeader} merging={merging} selected={selected} setConfirmMerge={setConfirmMerge} setMergeHeader={setMergeHeader} visible={visible} />

      {/* Deleting a whole session destroys every weight in it, so the dialog
          states the count rather than asking "are you sure". leastDestructiveRef
          keeps focus on the safe button. */}
      <DeleteBatchDialog
        batch={confirmDeleteBatch}
        onClose={() => setConfirmDeleteBatch(null)}
        onDeleted={afterBatchDeleted}
      />

      {/* Removing a merged manifest destroys a saved form somebody may have
          printed and filed. The sessions survive, and the dialog says so, since
          that is the thing a person is actually worried about here. */}
      <UnmergeDialog cancelDeleteGroupRef={cancelDeleteGroupRef} confirmDeleteGroup={confirmDeleteGroup} deleteGroup={deleteGroup} setConfirmDeleteGroup={setConfirmDeleteGroup} />

      {/* Everything taken off a tally. Voids and restores sit alongside the
          permanent deletions on purpose: a trail showing only removals, and
          not the ones that were undone, overstates what actually left. */}
      <RemovalsWindow expandedRemovalId={expandedRemovalId} loadRemovals={loadRemovals} removals={removals} setExpandedRemovalId={setExpandedRemovalId} setShowRemovals={setShowRemovals} showRemovals={showRemovals} />

      <BoxScanner isOpen={scannerOpen} onClose={onScannerClose} adoptBatchId={scannerAdopt} />
      <FpReturnWindow isOpen={returnsOpen} onClose={() => setReturnsOpen(false)} />
    </Box>
  );
};

export default WeightManifestTab;
