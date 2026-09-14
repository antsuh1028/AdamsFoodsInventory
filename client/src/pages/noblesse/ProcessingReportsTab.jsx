import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Input, Select, Textarea, Spinner,
  Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import FloatingWindow from "../../components/FloatingWindow";
import LotPicker from "../../components/LotPicker";
import { fmtDate, today, upper, PROCESSING_TYPES } from "./shared";
import getRole from "../../utils/getRole";

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
  processingType: "", lineNo: "",
  customer: "", description: "", brand: "", grade: "", estNumber: "", packDate: "",
  pulls: [{ cases: "" }],
  outputCases: "", outputWeight: "", inedibleWeight: "",
  workers: [],
  notes: "",
});

const STATUS_COLOR = { submitted: "yellow", accepted: "green", rejected: "red" };

const Field = ({ label, children, w }) => (
  <Box flex={w ? `0 0 ${w}` : "1 1 160px"} minW="130px">
    <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide" mb={1}>
      {label}
    </Text>
    {children}
  </Box>
);

const ProcessingReportsTab = ({ refreshSignal = 0 }) => {
  const toast = useToast();
  const isAdmin = getRole() === "admin";

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("submitted");
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [workerInput, setWorkerInput] = useState("");

  const fetchReports = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/processing-reports");
      setReports(data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Could not load reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  // Compared against a ref so the mount effect and the signal effect do not
  // both fire on first render.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    fetchReports();
  }, [refreshSignal, fetchReports]);

  const visible = useMemo(
    () => (filter ? reports.filter((r) => r.status === filter) : reports),
    [reports, filter]
  );

  const inputCases = useMemo(
    () => (draft ? draft.pulls.reduce((sum, p) => sum + (parseInt(p.cases, 10) || 0), 0) : 0),
    [draft]
  );

  const canSubmit = Boolean(draft && draft.lotId && inputCases > 0);

  const addWorker = () => {
    const name = upper(workerInput.trim());
    if (!name) return;
    setDraft((d) => ({ ...d, workers: [...d.workers, name] }));
    setWorkerInput("");
  };

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        ...draft,
        pulls: draft.pulls
          .map((p) => ({ cases: parseInt(p.cases, 10) }))
          .filter((p) => Number.isInteger(p.cases) && p.cases > 0),
      };
      if (draft.reportId) {
        await axiosInstance.patch(`/processing-reports/${draft.reportId}`, payload);
      } else {
        await axiosInstance.post("/processing-reports", payload);
      }
      setDraft(null);
      await fetchReports();
      toast({ status: "success", title: "Report submitted", duration: 3000, position: "top" });
    } catch (err) {
      toast({
        status: "error", position: "top", duration: 7000, isClosable: true,
        title: "Could not submit", description: err.response?.data?.error || err.message,
      });
    } finally { setSaving(false); }
  };

  const remove = async (report) => {
    try {
      await axiosInstance.delete(`/processing-reports/${report.reportId}`);
      await fetchReports();
    } catch (err) {
      toast({ status: "error", position: "top", title: "Could not delete",
        description: err.response?.data?.error || err.message });
    }
  };

  const openEdit = (r) => setDraft({
    ...emptyDraft(), ...r,
    pulls: r.pulls.length ? r.pulls.map((p) => ({ cases: String(p.cases) })) : [{ cases: "" }],
    outputCases: r.outputCases != null ? String(r.outputCases) : "",
    outputWeight: r.outputWeight != null ? String(r.outputWeight) : "",
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
          <Select size="sm" width="150px" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="submitted">Waiting</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Sent back</option>
            <option value="">All</option>
          </Select>
          <Button size="sm" colorScheme="blue" onClick={() => setDraft(emptyDraft())}>
            New report
          </Button>
        </Flex>
      </Flex>

      {error && (
        <Alert status="error" borderRadius="md" mb={4} fontSize="sm">
          <AlertIcon />{error}
        </Alert>
      )}

      {loading && <Flex justify="center" py={8}><Spinner color="blue.500" /></Flex>}

      {!loading && visible.length === 0 && (
        <Box p={5} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
          <Text fontSize="sm" color="gray.600">
            {filter === "submitted"
              ? "Nothing waiting. A submitted report shows here until reception accepts it."
              : "No reports here yet."}
          </Text>
        </Box>
      )}

      <Flex direction="column" gap={2}>
        {visible.map((r) => (
          <Box key={r.reportId} px={3} py={2} bg="white" borderRadius="md"
            border="1px solid" borderColor="gray.200">
            <Flex align="baseline" gap={3} wrap="wrap">
              <Text fontSize="sm" fontWeight="700" color="blue.700">{r.lotNumber}</Text>
              <Badge colorScheme={STATUS_COLOR[r.status]} fontSize="9px">
                {r.status === "submitted" ? "Waiting" : r.status === "accepted" ? "Accepted" : "Sent back"}
              </Badge>
              {r.lineNo && <Badge colorScheme="gray" fontSize="9px">Line {r.lineNo}</Badge>}
              {r.description && <Text fontSize="xs" color="gray.600">{r.description}</Text>}
              <Text fontSize="sm" color="gray.700" ml="auto"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {r.inputCases} cs in
                {r.outputCases != null ? ` · ${r.outputCases} cs out` : ""}
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
              {r.status !== "accepted" && (
                <Button size="xs" variant="ghost" colorScheme="blue" onClick={() => openEdit(r)}>
                  Edit
                </Button>
              )}
              {isAdmin && r.status !== "accepted" && (
                <Button size="xs" variant="ghost" colorScheme="red" onClick={() => remove(r)}>
                  Delete
                </Button>
              )}
            </Flex>
          </Box>
        ))}
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
              <Button size="md" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <Button size="md" colorScheme="blue" onClick={submit}
                isLoading={saving} isDisabled={!canSubmit}>
                Submit report
              </Button>
            </Flex>
          </Flex>
        }
      >
        {draft && (
          <Box>
            <Text fontSize="xs" color="gray.600" mb={3}>
              Submitting files the report. Cases come off the lot when reception accepts it.
            </Text>

            {/* Never mints a lot: a report references one that already exists,
                the same rule outgoing weighing follows. */}
            <Field label="Lot">
              <LotPicker
                size="md"
                allowCreate={false}
                value={draft.lotId}
                lotNumber={draft.lotNumber}
                onChange={(lot) => setDraft((d) => ({
                  ...d,
                  lotId: lot ? lot.lotId : null,
                  lotNumber: lot ? lot.lotNumber : "",
                }))}
              />
            </Field>

            <Flex gap={3} wrap="wrap" mt={3}>
              <Field label="Processing date" w="160px">
                <Input size="sm" type="date" value={draft.processingDate}
                  onChange={(e) => setDraft({ ...draft, processingDate: e.target.value })} />
              </Field>
              <Field label="Type" w="250px">
                <Select size="sm" placeholder="Select…" value={draft.processingType}
                  onChange={(e) => setDraft({ ...draft, processingType: e.target.value })}>
                  {PROCESSING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Line" w="90px">
                <Input size="sm" value={draft.lineNo} placeholder="1"
                  onChange={(e) => setDraft({ ...draft, lineNo: upper(e.target.value) })} />
              </Field>
            </Flex>

            <Flex gap={3} wrap="wrap" mt={3}>
              {[
                ["customer", "Customer"], ["description", "Product"],
                ["brand", "Brand"], ["grade", "Grade"], ["estNumber", "EST"],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input size="sm" value={draft[key] || ""}
                    onChange={(e) => setDraft({ ...draft, [key]: upper(e.target.value) })} />
                </Field>
              ))}
              <Field label="Pack date" w="160px">
                <Input size="sm" type="date" value={draft.packDate || ""}
                  onChange={(e) => setDraft({ ...draft, packDate: e.target.value })} />
              </Field>
            </Flex>

            {/* Raw pulled off the rack. Cases only — the manager counts cases,
                and real weights come from the weighing benches. */}
            <Text fontSize="xs" color="gray.500" textTransform="uppercase"
              letterSpacing="wide" mt={5} mb={1}>
              Raw pulled
            </Text>
            <Flex direction="column" gap={2}>
              {draft.pulls.map((p, idx) => (
                <Flex key={idx} gap={2} align="center">
                  <Text fontSize="xs" color="gray.500" width="52px">Pull {idx + 1}</Text>
                  <Input size="sm" width="110px" type="number" placeholder="cases"
                    value={p.cases}
                    onChange={(e) => {
                      const pulls = [...draft.pulls];
                      pulls[idx] = { cases: e.target.value };
                      setDraft({ ...draft, pulls });
                    }} />
                  <Text fontSize="sm" color="gray.500">cases</Text>
                  <Button size="xs" variant="ghost" colorScheme="red"
                    isDisabled={draft.pulls.length <= 1}
                    onClick={() => setDraft({
                      ...draft, pulls: draft.pulls.filter((_, i) => i !== idx),
                    })}>
                    ×
                  </Button>
                  {idx === draft.pulls.length - 1 && (
                    <Button size="xs" variant="outline" colorScheme="blue"
                      onClick={() => setDraft({ ...draft, pulls: [...draft.pulls, { cases: "" }] })}>
                      + pull
                    </Button>
                  )}
                </Flex>
              ))}
            </Flex>
            <Text fontSize="sm" fontWeight="600" color="gray.700" mt={2}
              style={{ fontVariantNumeric: "tabular-nums" }}>
              {inputCases} cases total
            </Text>

            <Text fontSize="xs" color="gray.500" textTransform="uppercase"
              letterSpacing="wide" mt={5} mb={1}>
              Output
            </Text>
            <Flex gap={3} wrap="wrap">
              <Field label="Cases out" w="130px">
                <Input size="sm" type="number" value={draft.outputCases}
                  onChange={(e) => setDraft({ ...draft, outputCases: e.target.value })} />
              </Field>
              <Field label="Weight out (lb)" w="160px">
                <Input size="sm" type="number" value={draft.outputWeight}
                  onChange={(e) => setDraft({ ...draft, outputWeight: e.target.value })} />
              </Field>
              <Field label="Inedible (lb)" w="150px">
                <Input size="sm" type="number" value={draft.inedibleWeight}
                  onChange={(e) => setDraft({ ...draft, inedibleWeight: e.target.value })} />
              </Field>
            </Flex>

            <Text fontSize="xs" color="gray.500" textTransform="uppercase"
              letterSpacing="wide" mt={5} mb={1}>
              Who ran it
            </Text>
            <Flex gap={2} wrap="wrap" align="center" mb={2}>
              {draft.workers.map((w, idx) => (
                <Badge key={idx} colorScheme="blue" borderRadius="full" px={2} py={1}
                  fontSize="sm" fontWeight="500">
                  {w}
                  <Box as="button" type="button" ml={2} color="blue.600"
                    onClick={() => setDraft({
                      ...draft, workers: draft.workers.filter((_, i) => i !== idx),
                    })}>
                    ×
                  </Box>
                </Badge>
              ))}
            </Flex>
            <Flex gap={2}>
              <Input size="sm" width="220px" placeholder="Name, then Enter"
                value={workerInput}
                onChange={(e) => setWorkerInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addWorker(); }
                }} />
              <Button size="sm" variant="outline" onClick={addWorker}>Add</Button>
            </Flex>

            <Text fontSize="xs" color="gray.500" textTransform="uppercase"
              letterSpacing="wide" mt={5} mb={1}>
              Notes
            </Text>
            <Textarea size="sm" rows={2} value={draft.notes || ""}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Box>
        )}
      </FloatingWindow>
    </Box>
  );
};

export default ProcessingReportsTab;
export { ProcessingReportsTab };
