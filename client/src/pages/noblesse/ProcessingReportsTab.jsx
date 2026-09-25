import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Input, Select, Textarea, Spinner,
  Grid, Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import FloatingWindow from "../../components/FloatingWindow";
import printProcessingReport from "./printProcessingReport";
import LotPicker from "../../components/LotPicker";
import {
  fmtDate, today, timeNow, upper, fmtWeight, PROCESSING_TYPES, PROCESSING_LINES,
  SheetField, sheetInputProps, SectionBar, SHEET_GRID,
} from "./shared";
import getRole from "../../utils/getRole";
import { acceptReport, rejectReport, unacceptReport } from "./reportActions";
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
  const left = Number(row.qtyCases) || 0;
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

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("submitted");
  // Searched on the server; the status buttons still narrow what comes back.
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [stock, setStock] = useState([]);
  const [draft, setDraft] = useState(null);
  // Collapsed once the product is described, open while any of it is blank.
  const [productOpen, setProductOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workerInput, setWorkerInput] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

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
      const { data } = await axiosInstance.get("/nti-inventory");
      setStock((data || []).filter((r) => r.stage === "raw"));
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
  const casesLeft = lotStock ? Number(lotStock.qtyCases) || 0 : null;
  const overdrawn = casesLeft != null && inputCases > casesLeft;

  // Staging needs only the lot: at the start of a run the cases are not known
  // yet. Confirming still needs them.
  const canStage = Boolean(draft && draft.lotId);
  const canSubmit = canStage && inputCases > 0;

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
  });

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={4} gap={3} wrap="wrap">
        <Box>
          <Text fontSize="lg" fontWeight="bold" color="gray.800">Processing</Text>
          <Text fontSize="sm" color="gray.500">
            One report per run. Cases come off the lot when reception accepts it.
          </Text>
        </Box>
        <Flex gap={2} align="center" wrap="wrap">
          <SearchBar
            placeholder="Search lot, product, customer…"
            isSearching={searching}
            onSearch={(text) => { setSearching(true); setQ(text); }}
          />
          <Flex gap={1}>
            {[
              ["submitted", "Waiting", "yellow"],
              ["in_progress", "On the line", "gray"],
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
              <Text fontSize="sm" fontWeight="700" color="blue.700">{r.lotNumber}</Text>
              <Badge colorScheme={STATUS_COLOR[r.status]} fontSize="9px">
                {STATUS_LABEL[r.status] || r.status}
              </Badge>
              {r.lineNo && <Badge colorScheme="gray" fontSize="9px">Line {r.lineNo}</Badge>}
              {r.description && <Text fontSize="xs" color="gray.600">{r.description}</Text>}
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
              {r.status === "submitted" && (
                <>
                  <Button size="xs" variant="ghost" isLoading={busyId === r.reportId}
                    onClick={(e) => { e.stopPropagation(); setRejecting(r.reportId); setReason(""); }}>
                    Send back
                  </Button>
                  <Button size="xs" colorScheme="blue" isLoading={busyId === r.reportId}
                    onClick={(e) => { e.stopPropagation(); act(r, acceptReport); }}>
                    Accept
                  </Button>
                </>
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
          flex={{ base: "1 1 auto", lg: "0 0 46%" }}
          width={{ base: "100%", lg: "46%" }}
          order={{ base: -1, lg: 0 }}
          border="1px solid" borderColor="gray.200" borderRadius="md"
          position={{ base: "static", lg: "sticky" }} top={0}
        >
          <Flex align="center" gap={2} px={3} py={2} bg="gray.50"
            borderTopRadius="md">
            <Text fontSize="sm" fontWeight="700">Floor</Text>
            <Badge colorScheme={onTheLine ? "green" : "gray"}>
              {onTheLine} running
            </Badge>
          </Flex>
          <Box p={3}>
            <FacilityMap runs={reports} onPick={openReport} />
          </Box>
        </Box>
      </Flex>

      <FloatingWindow
        isOpen={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.reportId ? `Report ${draft.reportId}` : "New processing report"}
        width={720}
        footer={
          <Flex gap={2} width="100%" justify="space-between" align="center" wrap="wrap">
            <Text fontSize="sm" color="gray.600" style={{ fontVariantNumeric: "tabular-nums" }}>
              {inputCases} case{inputCases === 1 ? "" : "s"} off the lot
            </Text>
            <Flex gap={2}>
              {/* Prints what is on screen, saved or not: the floor wants the
                  sheet in hand while the run is happening. */}
              <Button size="md" variant="outline"
                onClick={() => printProcessingReport(draft)}>
                Print
              </Button>
              <Button size="md" variant="ghost" onClick={() => setDraft(null)}>
                {draft?.readOnly ? "Close" : "Cancel"}
              </Button>
              {/* A run is opened when it starts and confirmed when it ends.
                  Saving while it is still running keeps it off reception's
                  queue — nothing on it is final until the line stops. */}
              {!draft?.readOnly && (
                <Button size="md" variant="outline" colorScheme="yellow"
                  onClick={() => submit(true)}
                  isLoading={saving} isDisabled={!canStage}>
                  Save, still running
                </Button>
              )}
              {!draft?.readOnly && (
                <Button size="md" colorScheme="blue" onClick={() => submit(false)}
                  isLoading={saving} isDisabled={!canSubmit}>
                  {draft?.status === "in_progress" ? "Confirm run" : "Submit report"}
                </Button>
              )}
            </Flex>
          </Flex>
        }
      >
        {draft && (
          <Box>
            <Text fontSize="xs" color="gray.600" mb={3}>
              {draft.readOnly
                ? `Accepted by ${draft.acceptedBy || "reception"} — ${draft.inputCases} cases are off the lot. An admin can un-accept it from the list.`
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
                  onChange={(e) => setDraft({ ...draft, description: upper(e.target.value) })} />
              </SheetField>
              <SheetField label="Brand">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.brand || ""}
                  onChange={(e) => setDraft({ ...draft, brand: upper(e.target.value) })} />
              </SheetField>
              <SheetField label="Grade">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.grade || ""}
                  onChange={(e) => setDraft({ ...draft, grade: upper(e.target.value) })} />
              </SheetField>
              <SheetField label="EST #">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.estNumber || ""}
                  onChange={(e) => setDraft({ ...draft, estNumber: upper(e.target.value) })} />
              </SheetField>
              <SheetField label="Customer">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.customer || ""}
                  onChange={(e) => setDraft({ ...draft, customer: upper(e.target.value) })} />
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
                  {lotStock && (
                    <Text fontSize="xs" color="gray.500"
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                      lot registered {lotStock.registeredCases ?? "?"} cases
                      {lotStock.registeredWeight ? ` = ${fmtWeight(lotStock.registeredWeight)} lb` : ""}
                      {" · "}{casesLeft} left now
                      {inputCases > 0 && !overdrawn ? ` · ${casesLeft - inputCases} after this` : ""}
                    </Text>
                  )}
                </Flex>
              </SheetField>

              <SheetField label="Inedible (lb)">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} type="number" value={draft.inedibleWeight}
                  onChange={(e) => setDraft({ ...draft, inedibleWeight: e.target.value })} />
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
                      value={workerInput}
                      onChange={(e) => setWorkerInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addWorker(); }
                      }} />
                    <Button size="sm" variant="outline" onClick={addWorker}>Add</Button>
                  </Flex>
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
                That is more than the {casesLeft} cases left on this lot. Reception will
                not be able to accept it.
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
