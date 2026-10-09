import upperInput from "../../utils/upperInput";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, IconButton, Input, Select, Textarea, Spinner,
  Grid, Alert, AlertIcon, Checkbox, useToast,
} from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import FloatingWindow from "../../components/FloatingWindow";
import printProcessingReport from "./printProcessingReport";
import LotPicker from "../../components/LotPicker";
import {
  fmtDate, today, timeNow, upper, fmtWeight, PROCESSING_TYPES, PROCESSING_LINES,
  fmtClock, minutesSince, fmtDuration,
  SheetField, sheetInputProps, SectionBar, SHEET_GRID,
} from "./shared";
import getRole, { canAcceptReports } from "../../utils/getRole";
import { acceptReport, rejectReport, unacceptReport } from "./reportActions";
import AcceptReportDialog from "./AcceptReportDialog";
import LotMenu from "./LotMenu";
import SearchBar from "../../components/SearchBar";
import FacilityMap from "./FacilityMap";

// The digital version of the paper processing report.
//
// The manager fills one in per run and submits it. Nothing moves until the
// reception person accepts it on the registration form — that is where cases
// come off the lot.
//
// A lot is normally processed across several reports over several days, so this
// is built around many reports per lot rather than one.

const emptyDraft = () => ({
  lotId: null, lotNumber: "",
  processingDate: today(),
  startTime: timeNow(),
  endTime: "",
  processingType: "", lineNo: "",
  customer: "", description: "", brand: "", grade: "", estNumber: "", packDates: [],
  pulls: [{ cases: "" }],
  inedibleWeight: "",
  fpOn: false, fpCases: "", fpItem: "",
  workers: [],
  notes: "",
});

// What the Product section covers. One list: the completeness check and the
// collapsed summary both read it, so they cannot drift apart.
const PRODUCT_FIELDS = [
  ["description", "Description"],
  ["brand", "Brand"],
  ["grade", "Grade"],
  ["estNumber", "EST"],
  ["customer", "Customer"],
  ["packDates", "Packed"],
];

// Packed is a LIST now, so "filled in" cannot be a string test — String([])
// is "" only by accident, and String(["a","b"]) is "a,b".
const isBlank = (v) => (Array.isArray(v) ? v.length === 0 : !String(v || "").trim());
const fieldText = (v) => (Array.isArray(v) ? v.join(", ") : String(v || ""));

const productIncomplete = (d) => PRODUCT_FIELDS.some(([k]) => isBlank(d[k]));

// What a lot already knows about itself, copied into a new run.
//
// Blanks only: what the manager has typed outranks the lot, so re-picking can
// never overwrite work. Pure and module-scope so the JSX stays readable.
// Cases a lot has left: stock, less the runs typed by hand on its form (those never moved stock).
const casesLeftOn = (row) => Math.max(0, (Number(row.qtyCases) || 0) - (Number(row.formManualCases) || 0));

const withLotDefaults = (draft, lot, row) => {
  const next = {
    ...draft,
    lotId: lot ? lot.lotId : null,
    lotNumber: lot ? lot.lotNumber : "",
  };
  if (!row) return next;

  const fill = (key, value, transform = upper) => {
    if (String(next[key] || "").trim() || !String(value ?? "").trim()) return;
    next[key] = transform(String(value));
  };
  fill("description", row.description);
  fill("brand", row.brand);
  fill("grade", row.grade);
  fill("estNumber", row.est);
  // The lot's own pack date seeds the SET, and only while it is empty — what
  // the manager picked outranks it, same as every other field here.
  if (!(next.packDates || []).length && String(row.packDate ?? "").trim()) {
    next.packDates = [row.packDate];
  }

  // The cases still on the lot: processing what is left is the common case.
  // Never a zero, which is not a quantity anyone would submit.
  const left = casesLeftOn(row);
  if (left > 0 && next.pulls.length === 1 && !next.pulls[0].cases) {
    next.pulls = [{ cases: String(left) }];
  }
  return next;
};

// in_progress is grey rather than loud: a run on the line is normal, not
// something waiting on anybody.
const STATUS_COLOR = {
  in_progress: "gray", submitted: "yellow", accepted: "green", rejected: "red",
};
const STATUS_LABEL = {
  in_progress: "On the line", submitted: "Waiting", accepted: "Accepted",
  rejected: "Sent back",
};
// The filter buttons' own words, for saying which one is hiding a search match.
const FILTER_LABEL = {
  submitted: "Waiting", in_progress: "On the line", accepted: "Accepted",
  rejected: "Sent back",
};

const ProcessingReportsTab = ({ refreshSignal = 0 }) => {
  const toast = useToast();
  const isAdmin = getRole() === "admin";
  // Reception checks and accepts; the floor manager submits and waits.
  const canAccept = canAcceptReports();
  const [checking, setChecking] = useState(null);

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Opens on what is running now; the floor's view first.
  const [filter, setFilter] = useState("in_progress");
  // Ticks so a running row's duration stays current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  // Searched on the server; the status buttons still narrow what comes back.
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [stock, setStock] = useState([]);
  const [draft, setDraft] = useState(null);
  // Collapsed once the product is described, open while any of it is blank.
  const [productOpen, setProductOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workerInput, setWorkerInput] = useState("");
  // Names from earlier runs, most frequent first.
  const [knownWorkers, setKnownWorkers] = useState([]);
  const fetchWorkers = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/processing-reports/workers");
      setKnownWorkers(data || []);
    } catch {
      // Suggestions only; typing still works without them.
    }
  }, []);
  useEffect(() => { fetchWorkers(); }, [fetchWorkers]);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");
  // The floor on its own, for a screen on the wall or a close look.
  const [mapFull, setMapFull] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  // A reply to an older search is dropped rather than shown over a newer one.
  const reportSeq = useRef(0);
  const fetchReports = useCallback(async () => {
    const mine = ++reportSeq.current;
    try {
      const { data } = await axiosInstance.get("/processing-reports",
        { params: { q: q || undefined } });
      if (mine !== reportSeq.current) return;
      setReports(data || []);
      setError(null);
    } catch (err) {
      if (mine !== reportSeq.current) return;
      setError(err.response?.data?.error || err.message || "Could not load reports");
    } finally {
      if (mine === reportSeq.current) { setLoading(false); setSearching(false); }
    }
  }, [q]);

  // The lot's registered total and what is left, so the manager sees the same
  // context the paper carries on its total line.
  const fetchStock = useCallback(async () => {
    try {
      const [{ data }, fp] = await Promise.all([
        axiosInstance.get("/nti-inventory"),
        axiosInstance.get("/fp-lots").catch(() => ({ data: [] })),
      ]);
      const raw = (data || []).filter((r) => r.stage === "raw");
      // An FP lot's count is what is waiting; its product details are the parent's.
      const further = (fp.data || []).map((f) => ({
        ...(raw.find((r) => r.lotId === f.parentLotId) || {}),
        lotId: f.lotId,
        lot: f.lotNumber,
        qtyCases: f.waiting,
        registeredCases: f.sent,
        registeredWeight: null,
        // The N lot's hand-typed runs are the N lot's; the FP count already stands alone.
        formManualCases: 0,
        fp: true,
        parentLotNumber: f.parentLotNumber,
      }));
      setStock([...raw, ...further]);
    } catch {
      // Context only. Losing it must not stop a report being filed.
    }
  }, []);

  useEffect(() => { fetchReports(); fetchStock(); }, [fetchReports, fetchStock]);

  // Compared against a ref so the mount effect and the signal effect do not
  // both fire on first render.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    fetchReports();
    fetchStock();
  }, [refreshSignal, fetchReports, fetchStock]);

  const waitingCount = useMemo(
    () => reports.filter((r) => r.status === "submitted").length, [reports]
  );

  const onTheLine = useMemo(
    () => reports.filter((r) => r.status === "in_progress").length, [reports]
  );

  const visible = useMemo(
    () => (filter ? reports.filter((r) => r.status === filter) : reports),
    [reports, filter]
  );

  const inputCases = useMemo(
    () => (draft ? draft.pulls.reduce((sum, p) => sum + (parseInt(p.cases, 10) || 0), 0) : 0),
    [draft]
  );

  const lotStock = useMemo(
    () => (draft && draft.lotId ? stock.find((r) => r.lotId === draft.lotId) : null),
    [stock, draft]
  );
  // Hand-typed runs on the form never came off stock, so they come off here.
  const casesLeft = lotStock ? casesLeftOn(lotStock) : null;
  const handCases = lotStock ? Number(lotStock.formManualCases) || 0 : 0;
  // The lot's figures in one line, shared by the window and the printout. An accepted
  // report's cases are already off, so it gets no "after this".
  const lotLine = lotStock ? [
    lotStock.fp
      ? `${lotStock.registeredCases} cases of ${lotStock.parentLotNumber} sent to the freezer`
      : `lot registered ${lotStock.registeredCases ?? "?"} cases`
        + (lotStock.registeredWeight ? ` = ${fmtWeight(lotStock.registeredWeight)} lb` : ""),
    handCases ? `${handCases} processed by hand on the form` : null,
    `${casesLeft} ${lotStock.fp ? "waiting" : "left now"}`,
    draft && draft.status !== "accepted" && inputCases > 0 && inputCases <= casesLeft
      ? `${casesLeft - inputCases} after this` : null,
  ].filter(Boolean).join(" · ") : null;
  const overdrawn = casesLeft != null && inputCases > casesLeft && draft?.status !== "accepted";

  // Staging needs only the lot: at the start of a run the cases are not known
  // yet. Confirming still needs them.
  const canStage = Boolean(draft && draft.lotId);
  // Ticked for further processing means a count is owed before it is handed over.
  const fpMissing = Boolean(draft && draft.fpOn && !(parseInt(draft.fpCases, 10) > 0));
  const canSubmit = canStage && inputCases > 0 && !fpMissing;
  // The FP lot these cases would go to: an N lot's own, or the FP lot the run is already on.
  const fpTarget = draft && /^N\d/.test(draft.lotNumber || "") ? `FP${draft.lotNumber.slice(1)}`
    : (draft && /^FP\d/.test(draft.lotNumber || "") ? draft.lotNumber : null);

  const addWorker = () => {
    const name = upper(workerInput.trim());
    if (!name) return;
    setDraft((d) => ({ ...d, workers: [...d.workers, name] }));
    setWorkerInput("");
  };

  // `inProgress` keeps the run out of reception's queue: it is still on the
  // line, so nothing on it is a finished figure yet. Confirming is what hands
  // it over, and that stays the default.
  const submit = async (inProgress = false) => {
    setSaving(true);
    try {
      const payload = {
        ...draft,
        inProgress,
        fpCases: draft.fpOn && fpTarget ? draft.fpCases : null,
        fpItem: draft.fpOn && fpTarget ? draft.fpItem : null,
        pulls: draft.pulls
          .map((p) => ({ cases: parseInt(p.cases, 10) }))
          .filter((p) => Number.isInteger(p.cases) && p.cases > 0),
      };
      const editing = Boolean(draft.reportId);
      const wasRejected = draft.status === "rejected";
      if (editing) {
        await axiosInstance.patch(`/processing-reports/${draft.reportId}`, payload);
      } else {
        await axiosInstance.post("/processing-reports", payload);
      }
      const lot = draft.lotNumber || "the lot";
      setDraft(null);
      await fetchReports();
      fetchWorkers();
      toast({
        status: "success", position: "top", duration: 6000, isClosable: true,
        title: wasRejected
          ? `Resubmitted — ${inputCases} case${inputCases === 1 ? "" : "s"} on ${lot}`
          : editing
            ? `Report updated — ${inputCases} case${inputCases === 1 ? "" : "s"} on ${lot}`
            : `Report filed — ${inputCases} case${inputCases === 1 ? "" : "s"} on ${lot}`,
        description: "Nothing moves until reception accepts it.",
      });
    } catch (err) {
      toast({
        status: "error", position: "top", duration: 7000, isClosable: true,
        title: "Could not submit", description: err.response?.data?.error || err.message,
      });
    } finally { setSaving(false); }
  };

  const act = async (report, fn, ...args) => {
    setBusyId(report.reportId);
    const result = await fn(report.reportId, ...args, toast);
    setBusyId(null);
    if (result.ok) { await fetchReports(); await fetchStock(); }
    return result.ok;
  };

  const silence = async (report, silenced) => {
    setBusyId(report.reportId);
    try {
      await axiosInstance.post(`/processing-reports/${report.reportId}/silence`, { silenced });
      await fetchReports();
      toast({
        status: "success", position: "top", duration: 4000,
        title: silenced ? `${report.lotNumber} taken off the floor map` : `${report.lotNumber} back on the floor map`,
        description: silenced ? "It stays here, waiting, until it is accepted or sent back." : undefined,
      });
    } catch (err) {
      toast({ status: "error", position: "top", title: "Could not change the map",
        description: err.response?.data?.error || err.message });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (report) => {
    try {
      await axiosInstance.delete(`/processing-reports/${report.reportId}`);
      await fetchReports();
      toast({
        status: "success", position: "top", duration: 4000,
        title: `Report for ${report.lotNumber} deleted`,
        description: "It had not been accepted, so no stock moved.",
      });
    } catch (err) {
      toast({ status: "error", position: "top", title: "Could not delete",
        description: err.response?.data?.error || err.message });
    }
  };

  // A waiting report opened by reception: the footer accepts or sends back instead of submitting.
  const reviewing = Boolean(draft && canAccept && draft.reportId && draft.status === "submitted");
  const [sendingBack, setSendingBack] = useState(false);
  const closeDraft = () => { setDraft(null); setSendingBack(false); };

  // Opening a draft decides the section with it, rather than an effect
  // correcting the panel after it has already painted.
  const openDraft = (d) => {
    setProductOpen(productIncomplete(d));
    setDraft(d);
  };

  const openReport = (r) => openDraft({
    readOnly: r.status === "accepted",
    ...emptyDraft(), ...r,
    pulls: r.pulls.length
      ? r.pulls.map((p) => ({ cases: String(p.cases) }))
      : [{ cases: "" }],
    // Always a list here, so the chips and the blank test never see undefined
    // on a report filed before this field existed.
    packDates: r.packDates || [],
    inedibleWeight: r.inedibleWeight != null ? String(r.inedibleWeight) : "",
    fpOn: Boolean(r.fpCases),
    fpCases: r.fpCases != null ? String(r.fpCases) : "",
    fpItem: r.fpItem || "",
  });

  return (
    <Box>
      {/* Heading left, search and filters in the middle, actions right — the
          same three-part row the other tabs use. */}
      <Flex justify="space-between" align={{ base: "stretch", md: "center" }} mb={4}
        direction={{ base: "column", md: "row" }} gap={3}>
        <Box flexShrink={0}>
          <Text fontSize="lg" fontWeight="bold" color="gray.800">Processing</Text>
          <Text fontSize="sm" color="gray.500">
            One report per run. Cases come off the lot when reception accepts it.
          </Text>
        </Box>
        <Flex gap={2} align="center" wrap="wrap" flex={1}
          justify={{ base: "flex-start", md: "center" }}>
          <SearchBar
            placeholder="Search lot, product, customer…"
            isSearching={searching}
            onSearch={(text) => { setSearching(true); setQ(text); }}
          />
          <Flex gap={1}>
            {[
              ["in_progress", "On the line", "gray"],
              ["submitted", "Waiting", "yellow"],
              ["accepted", "Accepted", "green"],
              ["rejected", "Sent back", "red"],
              ["", "All", "teal"],
            ].map(([value, label, scheme]) => (
              <Button key={label} size="xs"
                variant={filter === value ? "solid" : "outline"}
                colorScheme={filter === value ? scheme : "gray"}
                onClick={() => setFilter(value)}>
                {label}
                {value === "submitted" && waitingCount > 0 ? ` (${waitingCount})` : ""}
              </Button>
            ))}
          </Flex>
        </Flex>
        <Flex gap={2} align="center" flexShrink={0}>
          <Button size="sm" colorScheme="blue" onClick={() => openDraft(emptyDraft())}>
            New report
          </Button>
        </Flex>
      </Flex>

      <Flex gap={4} align="flex-start" direction={{ base: "column", lg: "row" }}>
        {/* minWidth 0 or a long lot number stops the column ever shrinking. */}
        <Box flex="1 1 auto" minWidth={0} width={{ base: "100%", lg: "auto" }}>
      {error && (
        <Alert status="error" borderRadius="md" mb={4} fontSize="sm">
          <AlertIcon />{error}
        </Alert>
      )}

      {loading && <Flex justify="center" py={8}><Spinner color="blue.500" /></Flex>}

      {!loading && visible.length === 0 && (
        <Box p={5} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
          {q ? (
            // The status buttons still apply to a search, and they default to
            // Waiting — so an accepted report for the lot looks like no match.
            <Flex align="center" gap={3} wrap="wrap">
              <Text fontSize="sm" color="gray.600">
                {filter && reports.length > 0
                  ? `Nothing ${FILTER_LABEL[filter].toLowerCase()} matches “${q}”, but ${reports.length} other report${reports.length === 1 ? " does" : "s do"}.`
                  : `Nothing matches “${q}”.`}
              </Text>
              {filter && reports.length > 0 && (
                <Button size="xs" colorScheme="teal" variant="outline"
                  onClick={() => setFilter("")}>
                  Show all
                </Button>
              )}
            </Flex>
          ) : (
            <Text fontSize="sm" color="gray.600">
              {filter === "submitted"
                ? "Nothing waiting. A submitted report shows here until reception accepts it."
                : "No reports here yet."}
            </Text>
          )}
        </Box>
      )}

      <Flex direction="column" gap={2}>
        {visible.map((r) => (
          <Box key={r.reportId} px={3} py={2} bg="white" borderRadius="md"
            border="1px solid" borderColor="gray.200"
            cursor="pointer"
            _hover={{ borderColor: "blue.300", bg: "blue.50" }}
            title="Double-click to open"
            onDoubleClick={() => openReport(r)}>
            <Flex align="baseline" gap={3} wrap="wrap">
              <LotMenu lotNumber={r.lotNumber} lotId={r.lotId} />
              {r.lotKind === "further" && (
                <Badge colorScheme="blue" variant="outline" fontSize="9px"
                  title={`Back from the freezer. Goes on ${r.parentLotNumber}'s form.`}>
                  FP of {r.parentLotNumber}
                </Badge>
              )}
              {r.fpCases > 0 && (
                <Badge colorScheme="teal" variant="subtle" fontSize="9px"
                  title={`${r.fpCases} cases${r.fpItem ? ` of ${r.fpItem}` : ""} packed for another run`}>
                  {r.fpCases} cs to freezer
                </Badge>
              )}
              <Badge colorScheme={STATUS_COLOR[r.status]} fontSize="9px">
                {STATUS_LABEL[r.status] || r.status}
              </Badge>
              {r.lineNo && <Badge colorScheme="gray" fontSize="9px">Line {r.lineNo}</Badge>}
              {r.status === "submitted" && r.mapSilenced && (
                <Badge colorScheme="gray" variant="outline" fontSize="9px"
                  title={`Taken off the floor map${r.mapSilencedBy ? ` by ${r.mapSilencedBy}` : ""} for review`}>
                  off the map
                </Badge>
              )}
              {r.description && <Text fontSize="xs" color="gray.600">{r.description}</Text>}
              {r.status === "in_progress" && r.startTime && (
                <Text fontSize="xs" color="green.700" fontWeight="600"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  Started {fmtClock(r.startTime)}
                  {minutesSince(r.processingDate, r.startTime, now) != null
                    && ` · running ${fmtDuration(minutesSince(r.processingDate, r.startTime, now))}`}
                </Text>
              )}
              <Text fontSize="sm" color="gray.700" ml="auto"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {r.inputCases} cases
                {r.inedibleWeight ? ` · ${r.inedibleWeight} lb inedible` : ""}
              </Text>
              <Text fontSize="xs" color="gray.500">{fmtDate(r.processingDate)}</Text>
            </Flex>
            <Flex align="baseline" gap={3} wrap="wrap" mt={1}>
              {r.processingType && (
                <Text fontSize="xs" color="gray.500">{r.processingType}</Text>
              )}
              {r.workers.length > 0 && (
                <Text fontSize="xs" color="gray.500">{r.workers.join(", ")}</Text>
              )}
              {r.status === "rejected" && r.rejectReason && (
                <Text fontSize="xs" color="red.600">Sent back: {r.rejectReason}</Text>
              )}
              {r.status === "accepted" && (
                <Text fontSize="xs" color="green.700">
                  Accepted by {r.acceptedBy || "reception"}
                </Text>
              )}
              <Box flex={1} />
              {r.status === "submitted" && canAccept && (
                <>
                  <Button size="xs" variant="ghost" colorScheme="gray" isLoading={busyId === r.reportId}
                    title={r.mapSilenced ? "Put it back on the floor map" : "Take it off the floor map while it is reviewed"}
                    onClick={(e) => { e.stopPropagation(); silence(r, !r.mapSilenced); }}>
                    {r.mapSilenced ? "Show on map" : "Silence"}
                  </Button>
                  <Button size="xs" variant="ghost" isLoading={busyId === r.reportId}
                    onClick={(e) => { e.stopPropagation(); setRejecting(r.reportId); setReason(""); }}>
                    Send back
                  </Button>
                  <Button size="xs" colorScheme="blue" isLoading={busyId === r.reportId}
                    onClick={(e) => { e.stopPropagation(); setChecking(r); }}>
                    Accept
                  </Button>
                </>
              )}
              {r.status === "submitted" && !canAccept && (
                <Text fontSize="xs" color="gray.500">Waiting for reception</Text>
              )}
              {isAdmin && r.status === "accepted" && (
                <Button size="xs" variant="ghost" colorScheme="red"
                  isLoading={busyId === r.reportId}
                  onClick={(e) => { e.stopPropagation(); act(r, unacceptReport); }}>
                  Un-accept
                </Button>
              )}
              {isAdmin && r.status !== "accepted" && (
                <Button size="xs" variant="ghost" colorScheme="red"
                  onClick={(e) => { e.stopPropagation(); remove(r); }}>
                  Delete
                </Button>
              )}
            </Flex>

            {rejecting === r.reportId && (
              <Flex gap={2} mt={2} onClick={(e) => e.stopPropagation()}>
                <Input size="xs" placeholder="What is wrong with it?" value={reason}
                  onChange={(e) => setReason(e.target.value)} />
                <Button size="xs" colorScheme="red" isLoading={busyId === r.reportId}
                  onClick={async () => {
                    if (await act(r, rejectReport, reason.trim())) setRejecting(null);
                  }}>
                  Send back
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setRejecting(null)}>
                  Cancel
                </Button>
              </Flex>
            )}
          </Box>
        ))}
        </Flex>
        </Box>

        {/* The floor, and what is on it. Reads the same reports the list beside
            it does, so the two cannot disagree. Ordered first when the columns
            stack, so a phone still leads with the floor. */}
        <Box
          flex={{ base: "1 1 auto", lg: mapOpen ? "0 0 46%" : "0 0 auto" }}
          width={{ base: "100%", lg: mapOpen ? "46%" : "auto" }}
          order={{ base: -1, lg: 0 }}
          border="1px solid" borderColor="gray.200" borderRadius="md"
          position={{ base: "static", lg: "sticky" }} top={0}
        >
          <Flex align="center" gap={2} px={3} py={2} bg="gray.50"
            borderTopRadius="md" borderBottomRadius={mapOpen ? 0 : "md"}>
            <Flex as="button" type="button" align="center" gap={1}
              onClick={() => setMapOpen((o) => !o)}
              aria-expanded={mapOpen}
              title={mapOpen ? "Fold the floor map" : "Show the floor map"}>
              {mapOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
              <Text fontSize="sm" fontWeight="700">Floor</Text>
            </Flex>
            <Badge colorScheme={onTheLine ? "green" : "gray"}>
              {onTheLine} running
            </Badge>
            <Box flex={1} />
            <IconButton size="xs" variant="ghost"
              icon={<ExternalLinkIcon />}
              aria-label="Open the floor full screen"
              title="Open the floor full screen"
              onClick={() => setMapFull(true)} />
          </Flex>
          {mapOpen && (
            <Box p={3}>
              <FacilityMap runs={reports} onPick={openReport} />
            </Box>
          )}
        </Box>
      </Flex>

      <AcceptReportDialog
        report={checking}
        isOpen={Boolean(checking)}
        busy={Boolean(checking) && busyId === checking.reportId}
        onCancel={() => setChecking(null)}
        onAccept={async (type) => {
          if (await act(checking, acceptReport, type)) {
            if (draft?.reportId === checking.reportId) closeDraft();
            setChecking(null);
          }
        }}
      />

      {/* The same map, given the whole screen. One component, so the two can
          never drift apart. */}
      <FloatingWindow
        isOpen={mapFull}
        onClose={() => setMapFull(false)}
        title="Processing Room 2"
        width="92%"
      >
        <FacilityMap runs={reports} maxHeight="78vh"
          onPick={(r) => { setMapFull(false); openReport(r); }} />
      </FloatingWindow>

      <FloatingWindow
        isOpen={Boolean(draft)}
        onClose={closeDraft}
        title={draft?.reportId ? `Report ${draft.reportId}` : "New processing report"}
        width={720}
        // dvh follows Safari's toolbar, so the Save buttons stay on a phone's screen.
        maxHeight={{ base: "70dvh", md: "80vh" }}
        footer={
          <Box width="100%">
          {reviewing && sendingBack && (
            <Flex gap={2} mb={2}>
              <Input size="sm" placeholder="What is wrong with it?" value={reason}
                onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" colorScheme="red" isLoading={busyId === draft.reportId}
                onClick={async () => {
                  if (await act(draft, rejectReport, reason.trim())) closeDraft();
                }}>
                Send back
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSendingBack(false)}>
                Cancel
              </Button>
            </Flex>
          )}
          <Flex gap={2} width="100%" justify="space-between" align="center" wrap="wrap">
            <Text fontSize="sm" color="gray.600" style={{ fontVariantNumeric: "tabular-nums" }}>
              {inputCases} case{inputCases === 1 ? "" : "s"} off the lot
            </Text>
            <Flex gap={2}>
              {/* Prints what is on screen, saved or not: the floor wants the
                  sheet in hand while the run is happening. */}
              <Button size="md" variant="outline"
                onClick={() => printProcessingReport(draft, { lotLine })}>
                Print
              </Button>
              <Button size="md" variant="ghost" onClick={closeDraft}>
                {draft?.readOnly || reviewing ? "Close" : "Cancel"}
              </Button>
              {/* A run is opened when it starts and confirmed when it ends.
                  Saving while it is still running keeps it off reception's
                  queue — nothing on it is final until the line stops. */}
              {reviewing && (
                <Button size="md" variant="outline" colorScheme="red"
                  isLoading={busyId === draft.reportId}
                  onClick={() => { setSendingBack(true); setReason(""); }}>
                  Send back
                </Button>
              )}
              {reviewing && (
                <Button size="md" colorScheme="blue" isLoading={busyId === draft.reportId}
                  onClick={() => setChecking(reports.find((x) => x.reportId === draft.reportId) || draft)}>
                  Accept
                </Button>
              )}
              {!draft?.readOnly && !reviewing && (
                <Button size="md" variant="outline" colorScheme="yellow"
                  onClick={() => submit(true)}
                  isLoading={saving} isDisabled={!canStage}>
                  Save, still running
                </Button>
              )}
              {!draft?.readOnly && !reviewing && (
                <Button size="md" colorScheme="blue" onClick={() => submit(false)}
                  isLoading={saving} isDisabled={!canSubmit}>
                  {draft?.status === "in_progress" ? "Confirm run" : "Submit report"}
                </Button>
              )}
            </Flex>
          </Flex>
          </Box>
        }
      >
        {draft && (
          <Box>
            <Text fontSize="xs" color="gray.600" mb={3}>
              {draft.readOnly
                ? `Accepted by ${draft.acceptedBy || "reception"} — ${draft.inputCases} cases are off the lot. An admin can un-accept it from the list.`
                : reviewing
                  ? "Waiting for your check. Accepting takes the cases off the lot; sending it back returns it to the floor."
                  : "Submitting files the report. Cases come off the lot when reception accepts it."}
            </Text>

            <Grid {...SHEET_GRID} mb={5}>
              <SectionBar>Lot &amp; Run</SectionBar>

              {/* Never mints a lot: a report references one that already
                  exists, the same rule outgoing weighing follows. */}
              <SheetField label="Lot" plain>
                <Box px={1}>
                  <LotPicker
                    size="sm"
                    allowCreate={false}
                    includeFurther
                    isDisabled={draft.readOnly}
                    value={draft.lotId}
                    lotNumber={draft.lotNumber}
                    onChange={(lot) => setDraft((d) => withLotDefaults(
                      d, lot, lot && stock.find((r) => r.lotId === lot.lotId)))}
                  />
                </Box>
              </SheetField>
              <SheetField label="Processing Date">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} type="date" value={draft.processingDate}
                  onChange={(e) => setDraft({ ...draft, processingDate: e.target.value })} />
              </SheetField>

              <SheetField label="Processing Type" full>
                <Select {...sheetInputProps} isReadOnly={draft.readOnly} placeholder="Select…" value={draft.processingType}
                  onChange={(e) => setDraft({ ...draft, processingType: e.target.value })}>
                  {PROCESSING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </SheetField>

              <SheetField label="Started">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} type="time"
                  value={draft.startTime || ""}
                  onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
              </SheetField>
              <SheetField label="Finished">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} type="time"
                  value={draft.endTime || ""}
                  onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
              </SheetField>

              {/* Named stations rather than a typed number. A value already on
                  an old report that is not in the list is kept as its own
                  option, so opening it cannot silently blank the field. */}
              <SheetField label="Line">
                <Select {...sheetInputProps} isDisabled={draft.readOnly}
                  value={draft.lineNo || ""}
                  onChange={(e) => setDraft({ ...draft, lineNo: e.target.value })}>
                  <option value="">—</option>
                  {PROCESSING_LINES.map((l) => <option key={l} value={l}>{l}</option>)}
                  {draft.lineNo && !PROCESSING_LINES.includes(draft.lineNo) && (
                    <option value={draft.lineNo}>{draft.lineNo}</option>
                  )}
                </Select>
              </SheetField>

              {/* Five fields describing what the product IS, which is the same
                  on every run of a lot and is read far more often than changed.
                  Open while any of it is still blank, so collapsing can never be
                  why a field went unfilled. */}
              <SectionBar
                isOpen={productOpen}
                onToggle={() => setProductOpen((v) => !v)}
                summary={PRODUCT_FIELDS
                  .filter(([k]) => !isBlank(draft[k]))
                  .map(([k, label]) => `${label} ${fieldText(draft[k])}`)
                  .join(" · ") || "nothing filled in"}
              >
                Product
              </SectionBar>

              {productOpen && (<>
              <SheetField label="Description" full>
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.description || ""}
                  onChange={(e) => setDraft({ ...draft, description: upperInput(e) })} />
              </SheetField>
              <SheetField label="Brand">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.brand || ""}
                  onChange={(e) => setDraft({ ...draft, brand: upperInput(e) })} />
              </SheetField>
              <SheetField label="Grade">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.grade || ""}
                  onChange={(e) => setDraft({ ...draft, grade: upperInput(e) })} />
              </SheetField>
              <SheetField label="EST #">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.estNumber || ""}
                  onChange={(e) => setDraft({ ...draft, estNumber: upperInput(e) })} />
              </SheetField>
              <SheetField label="Customer">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.customer || ""}
                  onChange={(e) => setDraft({ ...draft, customer: upperInput(e) })} />
              </SheetField>
              {/* A lot routinely spans several pack dates, so this takes the
                  whole set. Picking a date adds it; each can be removed. */}
              <SheetField label="Pack Dates" full>
                <Flex align="center" gap={2} px={2} py={1.5} wrap="wrap">
                  {(draft.packDates || []).map((d) => (
                    <Flex key={d} align="center" gap={1}
                      bg="white" border="1px solid" borderColor="gray.300"
                      borderRadius="md" pl={2} pr={1} py={0.5}>
                      <Text fontSize="sm">{fmtDate(d)}</Text>
                      {!draft.readOnly && (
                        <Button size="xs" variant="ghost" colorScheme="red"
                          px={1} minW="auto" title="Remove this date"
                          onClick={() => setDraft({
                            ...draft,
                            packDates: draft.packDates.filter((x) => x !== d),
                          })}>
                          ×
                        </Button>
                      )}
                    </Flex>
                  ))}
                  {!draft.readOnly && (
                    <Input
                      size="sm" type="date" bg="white" width="170px"
                      // Cleared after each pick, so the control is always ready
                      // for the next one rather than holding the last.
                      value=""
                      onChange={(e) => {
                        const d = e.target.value;
                        if (!d || (draft.packDates || []).includes(d)) return;
                        setDraft({
                          ...draft,
                          packDates: [...(draft.packDates || []), d].sort(),
                        });
                      }}
                    />
                  )}
                  {!(draft.packDates || []).length && draft.readOnly && (
                    <Text fontSize="sm" color="gray.400">—</Text>
                  )}
                </Flex>
              </SheetField>
              </>)}

              <SectionBar>Cases Processed</SectionBar>

              {/* One row per batch off the rack. Cases only: the manager counts
                  cases, and real weights come from the weighing benches. */}
              {draft.pulls.map((p, idx) => (
                <SheetField key={idx} label={`(${idx + 1}) Cases`} full>
                  <Flex gap={3} align="center" px={3} py={1.5}>
                    <Input
                      {...sheetInputProps} isReadOnly={draft.readOnly}
                      bg="white" flex="0 0 130px" type="number" placeholder="cases"
                      value={p.cases}
                      onChange={(e) => {
                        const pulls = [...draft.pulls];
                        pulls[idx] = { ...pulls[idx], cases: e.target.value };
                        setDraft({ ...draft, pulls });
                      }}
                    />
                    <Button size="xs" variant="ghost" colorScheme="red" px={1} minW="auto"
                      isDisabled={draft.readOnly || draft.pulls.length <= 1}
                      title={draft.pulls.length <= 1 ? "Cannot delete last row" : "Delete this row"}
                      onClick={() => setDraft({
                        ...draft, pulls: draft.pulls.filter((_, i) => i !== idx),
                      })}>
                      ×
                    </Button>
                    {idx === draft.pulls.length - 1 && (
                      <Button size="xs" variant="outline" colorScheme="blue" px={2} minW="auto"
                        isDisabled={draft.readOnly}
                        title="Add another batch"
                        onClick={() => setDraft({ ...draft, pulls: [...draft.pulls, { cases: "" }] })}>
                        +
                      </Button>
                    )}
                  </Flex>
                </SheetField>
              ))}

              <SheetField label="Total" full plain>
                <Flex align="baseline" gap={3} wrap="wrap" px={3} py={2}>
                  <Text fontSize="sm" fontWeight="bold" color="gray.800"
                    style={{ fontVariantNumeric: "tabular-nums" }}>
                    {inputCases} cases
                  </Text>
                  {lotLine && (
                    <Text fontSize="xs" color="gray.500"
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                      {lotLine}
                    </Text>
                  )}
                </Flex>
              </SheetField>

              <SheetField label="Inedible (lb)">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} type="number" value={draft.inedibleWeight}
                  onChange={(e) => setDraft({ ...draft, inedibleWeight: e.target.value })} />
              </SheetField>

              {/* Part of the run packed to be frozen and processed again later. One item, one count. */}
              {/* Fills out the Inedible row, so the next field starts on its own line. */}
              <Box gridColumn="3 / -1" display={{ base: "none", md: "block" }} />

              <SheetField label="Further processing" full plain>
                  <Box px={3} py={2}>
                    <Checkbox isChecked={Boolean(draft.fpOn) && Boolean(fpTarget)}
                      isDisabled={draft.readOnly || !fpTarget}
                      size="lg" colorScheme="blue"
                      // The default border is too pale to see on the grey sheet.
                      sx={{ "& .chakra-checkbox__control:not([data-checked])": { borderColor: "gray.500", bg: "white" } }}
                      onChange={(e) => setDraft({
                        ...draft, fpOn: e.target.checked,
                        fpItem: draft.fpItem || upper(draft.description || ""),
                      })}>
                      <Text as="span" fontSize="sm">Part of this run goes to the AF freezer for another run</Text>
                    </Checkbox>
                    {!fpTarget && (
                      <Text fontSize="xs" color="gray.500" mt={1}>
                        {draft.lotId ? "Only one of our N lots can send product to the freezer." : "Pick the lot first."}
                      </Text>
                    )}
                    {draft.fpOn && fpTarget && (
                      <>
                        <Flex gap={3} align="center" wrap="wrap" mt={2}>
                          <Input {...sheetInputProps} isReadOnly={draft.readOnly} bg="white"
                            flex="0 0 130px" type="number" placeholder="cases"
                            borderColor={fpMissing ? "red.300" : undefined}
                            value={draft.fpCases}
                            onChange={(e) => setDraft({ ...draft, fpCases: e.target.value })} />
                          <Input {...sheetInputProps} isReadOnly={draft.readOnly} bg="white"
                            flex="1 1 200px" placeholder="What it is (e.g. CLOD TIP)"
                            value={draft.fpItem}
                            onChange={(e) => setDraft({ ...draft, fpItem: upperInput(e) })} />
                        </Flex>
                        <Text fontSize="xs" color="gray.500" mt={1}>
                          Cases packed for later, not the cases put in. When reception accepts this run
                          they wait on <b>{fpTarget}</b> for the next run.
                        </Text>
                      </>
                    )}
                  </Box>
                </SheetField>

              <SectionBar>Crew &amp; Notes</SectionBar>

              <SheetField label="Who Ran It" full plain>
                <Box px={3} py={2}>
                  <Flex gap={2} wrap="wrap" align="center" mb={draft.workers.length ? 2 : 0}>
                    {draft.workers.map((w, idx) => (
                      <Badge key={idx} colorScheme="blue" borderRadius="full" px={2} py={1}
                        fontSize="sm" fontWeight="500">
                        {w}
                        <Box as="button" type="button" ml={2} color="blue.600"
                          display={draft.readOnly ? "none" : undefined}
                          onClick={() => setDraft({
                            ...draft, workers: draft.workers.filter((_, i) => i !== idx),
                          })}>
                          ×
                        </Box>
                      </Badge>
                    ))}
                  </Flex>
                  <Flex gap={2} display={draft.readOnly ? "none" : undefined}>
                    <Input size="sm" bg="white" width="220px" placeholder="Name, then Enter"
                      list="report-worker-names" autoComplete="off"
                      value={workerInput}
                      onChange={(e) => setWorkerInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addWorker(); }
                      }} />
                    <datalist id="report-worker-names">
                      {knownWorkers.map((n) => <option key={n} value={n} />)}
                    </datalist>
                    <Button size="sm" variant="outline" onClick={addWorker}>Add</Button>
                  </Flex>
                  {/* The regulars, one tap each; names already on this run drop out. */}
                  {!draft.readOnly && knownWorkers.some((n) => !draft.workers.includes(n)) && (
                    <Flex gap={1} wrap="wrap" mt={2}>
                      {knownWorkers.filter((n) => !draft.workers.includes(n)).slice(0, 14).map((n) => (
                        <Button key={n} size="xs" variant="outline" colorScheme="gray" borderRadius="full"
                          onClick={() => setDraft((d) => ({ ...d, workers: [...d.workers, n] }))}>
                          + {n}
                        </Button>
                      ))}
                    </Flex>
                  )}
                </Box>
              </SheetField>

              <SheetField label="Remarks" full>
                <Textarea {...sheetInputProps} isReadOnly={draft.readOnly} rows={2} value={draft.notes || ""}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </SheetField>
            </Grid>

            {overdrawn && (
              <Alert status="warning" borderRadius="md" fontSize="xs" py={2} mb={3}>
                <AlertIcon boxSize={3} />
                That is more than the {casesLeft} cases {lotStock?.fp
                  ? `waiting on ${lotStock.lot}. Check the F.P Tracker for ${lotStock.parentLotNumber}, or reception`
                  : "left on this lot. Reception"} will not be able to accept it.
              </Alert>
            )}
          </Box>
        )}
      </FloatingWindow>
    </Box>
  );
};

export default ProcessingReportsTab;
export { ProcessingReportsTab };
