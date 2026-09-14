import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Input, Select, Textarea, Spinner,
  Grid, Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import FloatingWindow from "../../components/FloatingWindow";
import LotPicker from "../../components/LotPicker";
import {
  fmtDate, today, upper, fmtWeight, PROCESSING_TYPES,
  SheetField, sheetInputProps, SectionBar, SHEET_GRID,
} from "./shared";
import getRole from "../../utils/getRole";
import { acceptReport, rejectReport, unacceptReport } from "./reportActions";

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
  inedibleWeight: "",
  workers: [],
  notes: "",
});

const STATUS_COLOR = { submitted: "yellow", accepted: "green", rejected: "red" };

const ProcessingReportsTab = ({ refreshSignal = 0 }) => {
  const toast = useToast();
  const isAdmin = getRole() === "admin";

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("submitted");
  const [stock, setStock] = useState([]);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [workerInput, setWorkerInput] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

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

  const openReport = (r) => setDraft({
    readOnly: r.status === "accepted",
    ...emptyDraft(), ...r,
    pulls: r.pulls.length ? r.pulls.map((p) => ({ cases: String(p.cases) })) : [{ cases: "" }],
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
          <Flex gap={1}>
            {[
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
            border="1px solid" borderColor="gray.200"
            cursor="pointer"
            _hover={{ borderColor: "blue.300", bg: "blue.50" }}
            title="Double-click to open"
            onDoubleClick={() => openReport(r)}>
            <Flex align="baseline" gap={3} wrap="wrap">
              <Text fontSize="sm" fontWeight="700" color="blue.700">{r.lotNumber}</Text>
              <Badge colorScheme={STATUS_COLOR[r.status]} fontSize="9px">
                {r.status === "submitted" ? "Waiting" : r.status === "accepted" ? "Accepted" : "Sent back"}
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
              <Button size="md" variant="ghost" onClick={() => setDraft(null)}>
                {draft?.readOnly ? "Close" : "Cancel"}
              </Button>
              {!draft?.readOnly && (
                <Button size="md" colorScheme="blue" onClick={submit}
                  isLoading={saving} isDisabled={!canSubmit}>
                  Submit report
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
                    onChange={(lot) => setDraft((d) => ({
                      ...d,
                      lotId: lot ? lot.lotId : null,
                      lotNumber: lot ? lot.lotNumber : "",
                    }))}
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

              <SheetField label="Line #">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} placeholder="1" value={draft.lineNo}
                  onChange={(e) => setDraft({ ...draft, lineNo: upper(e.target.value) })} />
              </SheetField>
              <SheetField label="Customer">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} value={draft.customer || ""}
                  onChange={(e) => setDraft({ ...draft, customer: upper(e.target.value) })} />
              </SheetField>

              <SectionBar>Product</SectionBar>

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
              <SheetField label="Pack Date">
                <Input {...sheetInputProps} isReadOnly={draft.readOnly} type="date" value={draft.packDate || ""}
                  onChange={(e) => setDraft({ ...draft, packDate: e.target.value })} />
              </SheetField>

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
                        pulls[idx] = { cases: e.target.value };
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
