import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Box, Flex, Text, Button, IconButton, Badge, Spinner, useToast, Image,
  Grid, GridItem, Input, Textarea, Select, Checkbox, Menu, MenuButton, MenuList, MenuItem,
} from "@chakra-ui/react";
import { DeleteIcon, ChevronDownIcon, ChevronUpIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import { fmtDate, today, Th, Td } from "./shared";
import printRegistrationForm from "./printRegistrationForm";
import BoxWeightLink from "./BoxWeightLink";
import ntiLogo from "../../assets/nti.jpg";
import FloatingWindow from "../../components/FloatingWindow";
import AllFormsTable from "./AllFormsTable";


// Stored verbatim as the field value, so the number, abbreviation and name all
// survive into the printed form and the history snapshot with no lookup table
// to keep in sync.
const PROCESSING_TYPES = [
  "101 SLC-BG Slicing & Bagging",
  "102 DBN-PK Deboning & Bagging",
  "103 PRTN-PK Portioning & Packing",
  "104 CUT-PK 1/2 Cutting & Packing",
  "105 BONE CUT Bone Cut",
  "106 CUT-RL Cutting & Rolling",
  "108 SHR-CT Short Rib Cut",
];

const emptyDraft = () => ({
  id: null,
  lotNumber: "", formDate: "", dateReceived: "", timeReceived: "",
  vendorLot: "", vendor: "", productDescription: "", processingType: "",
  spec: "", brand: "", estNumber: "", grade: "",
  dueDate: "", predictedYield: "",
  manifestBlAttached: false, processReportAttached: false,
  originalWeight: "", totalQuantity: "",
  processingDates: [
    { date: "", weight: "", cases: "" },
  ],
  actualYield: "", temp: "", remarks: "", checkedBy: "",
  status: "in_progress",
});

// Fills the form with realistic placeholder values — for previewing/printing
// the layout without needing a saved record from the backend.
const sampleDraft = () => ({
  lotNumber: "N26124-01", formDate: today(), dateReceived: today(), timeReceived: "14:30",
  vendorLot: "IC-88213", vendor: "IBP Foods",
  productDescription: "Beef Brisket, Boneless", processingType: "104 CUT-PK 1/2 Cutting & Packing",
  spec: "10X30", brand: "IBP", estNumber: "9268", grade: "Choice",
  dueDate: today(), predictedYield: "92",
  manifestBlAttached: true, processReportAttached: false,
  originalWeight: "1842", totalQuantity: "24",
  processingDates: [
    { date: today(), weight: "1695", cases: "22" },
  ],
  actualYield: "92.0", temp: "27",
  remarks: "Sample record for print preview — no backend data behind this.",
  checkedBy: "J. Rivera",
});

// Sheet-style field: bold right-aligned label + light-gray filled input,
// laid out as a pair of grid columns to mirror the printed form's rows.
// On mobile the sheet collapses to a single column, so each field becomes a
// label row stacked above its input row; the right-aligned two-column pairing
// only makes sense once there is room for it.
const SheetField = ({ label, full, plain, children }) => (
  <>
    <GridItem
      colSpan={1}
      display="flex"
      alignItems="center"
      justifyContent={{ base: "flex-start", md: "flex-end" }}
    >
      <Text
        fontSize="2xs" fontWeight="bold" p={2} color="gray.700"
        textTransform="uppercase" letterSpacing="wide"
        textAlign={{ base: "left", md: "right" }}
      >
        {label}
      </Text>
    </GridItem>
    <GridItem
      colSpan={{ base: 1, md: full ? 3 : 1 }}
      bg={plain ? "transparent" : "#f0f0f0"}
      borderRadius="sm"
    >
      {children}
    </GridItem>
  </>
);

const sheetInputProps = { size: "sm", bg: "transparent", border: "none", borderRadius: 0, px: 2, _focus: { boxShadow: "none", bg: "white" } };

const SectionBar = ({ children }) => (
  <GridItem colSpan={{ base: 1, md: 4 }} bg="#ccd3db" px={3} py={2} fontSize="xs" fontWeight="bold" color="gray.800">
    {children}
  </GridItem>
);

const RegistrationFormModal = ({ isOpen, onClose, draft, setDraft, onSave, saving }) => {
  const [isFullScreen, setIsFullScreen] = useState(false);
  if (!draft) return null;
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });
  const setCheck = (key) => (e) => setDraft({ ...draft, [key]: e.target.checked });

  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title={draft.id ? `Edit Registration Form${draft.lotNumber ? " — " + draft.lotNumber : ""}` : "New Registration Form"}
      isFullScreen={isFullScreen}
      onToggleFullScreen={() => setIsFullScreen((v) => !v)}
      width={900}
      footer={<Flex justify="space-between" width="100%" gap={2} wrap="wrap">
        <Button size="sm" variant="outline" colorScheme="teal" onClick={() => setDraft({ ...draft, ...sampleDraft() })}>
          Fill Sample Data
        </Button>
        <Flex gap={2} flex={{ base: "1 1 100%", md: "0 0 auto" }} justify="flex-end">
          <Button size="sm" variant="outline" onClick={() => printRegistrationForm(draft)}>Print</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" colorScheme="blue" isLoading={saving} onClick={onSave}>Save</Button>
        </Flex>
      </Flex>}
    >
        <Box maxW="820px" mx="auto">
          <Flex
            direction={{ base: "column", md: "row" }}
            align={{ base: "stretch", md: "flex-start" }}
            justify="space-between" gap={{ base: 3, md: 0 }}
            borderBottom="2px solid #2b6cb0" pb={2} mb={3}
          >
            <Image
              src={ntiLogo} alt="Noblesse Trading Inc."
              width={{ base: "160px", md: "220px" }} objectFit="contain"
            />
            <Flex direction="column" gap={2} align={{ base: "stretch", md: "flex-end" }}>
              <Flex align="center" gap={2}>
                <Text fontSize="sm" fontWeight="bold" color="blue.700" minW="40px">Lot#:</Text>
                <Input size="sm" width={{ base: "100%", md: "150px" }} value={draft.lotNumber} onChange={set("lotNumber")} placeholder="N26124-01" />
              </Flex>
              <Flex align="center" gap={2}>
                <Text fontSize="sm" fontWeight="bold" color="blue.700" minW="40px">Date:</Text>
                <Input size="sm" width={{ base: "100%", md: "150px" }} type="date" value={draft.formDate} onChange={set("formDate")} />
              </Flex>
            </Flex>
          </Flex>
          <Text textAlign="center" fontSize="lg" fontWeight="extrabold" color="blue.700" mb={4}>
            {draft.id ? "Edit Registration Form" : "New Registration Form"}
          </Text>

          <Grid
            templateColumns={{ base: "1fr", md: "1fr 2fr 1fr 2fr" }}
            gap="1px" bg="gray.200" mb={5} border="1px solid" borderColor="gray.200"
          >
            <SectionBar>Logistics &amp; Vendor</SectionBar>
            <SheetField label="Date Received"><Input {...sheetInputProps} type="date" value={draft.dateReceived} onChange={set("dateReceived")} /></SheetField>
            <SheetField label="Time Received"><Input {...sheetInputProps} type="time" value={draft.timeReceived} onChange={set("timeReceived")} /></SheetField>
            <SheetField label="Vendor Lot/(IC)#"><Input {...sheetInputProps} value={draft.vendorLot} onChange={set("vendorLot")} /></SheetField>
            <SheetField label="Vendor"><Input {...sheetInputProps} value={draft.vendor} onChange={set("vendor")} /></SheetField>

            <SectionBar>Product Identification</SectionBar>
            <SheetField label="Product Description" full><Input {...sheetInputProps} value={draft.productDescription} onChange={set("productDescription")} /></SheetField>
            <SheetField label="Processing Type">
              {/* Styled like the Status select rather than with sheetInputProps,
                  which strips the border and makes a dropdown look like a
                  plain text field. */}
              <Select size="sm" bg="white" border="1px solid" borderColor="gray.300"
                value={draft.processingType || ""} onChange={set("processingType")}>
                <option value="">— Select processing type —</option>
                {PROCESSING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                {/* Forms saved before this list existed hold free text. Keeping
                    the current value as an option stops opening an old form
                    from silently blanking the field. */}
                {draft.processingType && !PROCESSING_TYPES.includes(draft.processingType) && (
                  <option value={draft.processingType}>{draft.processingType} (existing)</option>
                )}
              </Select>
            </SheetField>
            <SheetField label="Original Weight (lbs)"><Input {...sheetInputProps} type="number" value={draft.originalWeight} onChange={set("originalWeight")} /></SheetField>
            <SheetField label="Spec. ">
              <Flex gap={1} align="center">
                <Input
                  {...sheetInputProps}
                  placeholder="10"
                  value={draft.spec ? draft.spec.split("X")[0] || "" : ""}
                  onChange={(e) => {
                    const parts = draft.spec ? draft.spec.split("X") : ["", ""];
                    setDraft({ ...draft, spec: `${e.target.value}X${parts[1] || ""}`.replace(/^X/, "") });
                  }}
                  flex={1}
                />
                <Text fontSize="sm" fontWeight="bold" color="gray.600">×</Text>
                <Input
                  {...sheetInputProps}
                  placeholder="30"
                  value={draft.spec ? draft.spec.split("X")[1] || "" : ""}
                  onChange={(e) => {
                    const parts = draft.spec ? draft.spec.split("X") : ["", ""];
                    setDraft({ ...draft, spec: `${parts[0] || ""}X${e.target.value}`.replace(/X$/, "") });
                  }}
                  flex={1}
                />
              </Flex>
            </SheetField>
            <SheetField label="Brand"><Input {...sheetInputProps} value={draft.brand} onChange={set("brand")} /></SheetField>
            <SheetField label="EST#"><Input {...sheetInputProps} value={draft.estNumber} onChange={set("estNumber")} /></SheetField>
            <SheetField label="Grade"><Input {...sheetInputProps} value={draft.grade} onChange={set("grade")} /></SheetField>

            <SectionBar>Estimation/Checks</SectionBar>
            <SheetField label="Due Date?"><Input {...sheetInputProps} type="date" value={draft.dueDate} onChange={set("dueDate")} /></SheetField>
            <SheetField label="Predicted Yield (%)"><Input {...sheetInputProps} type="number" value={draft.predictedYield} onChange={set("predictedYield")} /></SheetField>
            <SheetField label="Manifest/BL Attached?" plain>
              <Checkbox isChecked={draft.manifestBlAttached} onChange={setCheck("manifestBlAttached")} px={2} />
            </SheetField>
            <SheetField label="Process Report Attached?" plain>
              <Checkbox isChecked={draft.processReportAttached} onChange={setCheck("processReportAttached")} px={2} />
            </SheetField>

            {/* Where the Original Weight actually comes from. Sits above the
                yield section because it is the measured input both that and
                Total Quantity are derived from. */}
            <SectionBar>Box Weights</SectionBar>
            <Box gridColumn="1 / -1" p={2}>
              <BoxWeightLink
                formId={draft.id}
                lotNumber={draft.lotNumber}
                draft={draft}
                setDraft={setDraft}
              />
            </Box>

            <SectionBar>Processing &amp; Yield</SectionBar>
            <Box gridColumn="1 / -1" />
            <SheetField label="Total Quantity (c/s)"><Input {...sheetInputProps} value={draft.totalQuantity} onChange={set("totalQuantity")} /></SheetField>
            <Box gridColumn="3 / -1" />

            {Array.isArray(draft.processingDates) && draft.processingDates.map((pd, idx) => (
              <React.Fragment key={idx}>
                {/* One processing event per row: weight, cases and the date it
                    happened. The date carries no label of its own — a date
                    input is self-evident, and the row reads left to right. */}
                <SheetField label={`(${idx + 1}) Processed`} full>
                  {/* Three fields share one cell, so they are white and spaced:
                      the cell's own grey shows through as a gutter and the row
                      reads as weight / cases / date rather than one long strip.
                      Every other field on the sheet is a lone input filling its
                      cell, which is why only this row needs it. */}
                  <Flex gap={5} align="center" px={3} py={1.5}>
                    <Input
                      {...sheetInputProps}
                      bg="white"
                      size="sm"
                      flex="1 1 30%"
                      type="number"
                      placeholder="lbs"
                      title="Processed weight (lbs)"
                      value={pd.weight || ""}
                      onChange={(e) => {
                        const newDates = [...draft.processingDates];
                        newDates[idx] = { ...newDates[idx], weight: e.target.value };
                        setDraft({ ...draft, processingDates: newDates });
                      }}
                    />
                    <Input
                      {...sheetInputProps}
                      bg="white"
                      size="sm"
                      flex="1 1 30%"
                      type="number"
                      placeholder="c/s"
                      title="Processed quantity (cases)"
                      value={pd.cases || ""}
                      onChange={(e) => {
                        const newDates = [...draft.processingDates];
                        newDates[idx] = { ...newDates[idx], cases: e.target.value };
                        setDraft({ ...draft, processingDates: newDates });
                      }}
                    />
                    <Input
                      {...sheetInputProps}
                      bg="white"
                      size="sm"
                      flex="1 1 30%" minW="118px"
                      type="date"
                      title="Processing date"
                      value={pd.date || ""}
                      onChange={(e) => {
                        const newDates = [...draft.processingDates];
                        newDates[idx] = { ...newDates[idx], date: e.target.value };
                        setDraft({ ...draft, processingDates: newDates });
                      }}
                    />
                    <Button
                      size="xs"
                      variant="ghost"
                      colorScheme="red"
                      minW="auto"
                      px={1}
                      ml={1}
                      flexShrink={0}
                      isDisabled={draft.processingDates.length <= 1}
                      title={draft.processingDates.length <= 1 ? "Cannot delete last row" : "Delete this row"}
                      onClick={() => {
                        const newDates = draft.processingDates.filter((_, i) => i !== idx);
                        setDraft({ ...draft, processingDates: newDates });
                      }}
                    >
                      ×
                    </Button>
                    {idx === draft.processingDates.length - 1 && (
                      <Button
                        size="xs"
                        variant="outline"
                        colorScheme="blue"
                        minW="auto"
                        px={2}
                        flexShrink={0}
                        title="Add another processing date"
                        onClick={() => {
                          const newDates = Array.isArray(draft.processingDates) ? [...draft.processingDates] : [];
                          newDates.push({ date: "", weight: "", cases: "" });
                          setDraft({ ...draft, processingDates: newDates });
                        }}
                      >
                        +
                      </Button>
                    )}
                  </Flex>
                </SheetField>
              </React.Fragment>
            ))}

            <SheetField label="Actual Yield (%)">
              <Box {...sheetInputProps} bg="white" border="1px solid" borderColor="gray.200" py={1}>
                <Text fontSize="sm" color="gray.700" fontWeight="medium">
                  {calculateYield(draft) ?? "—"}
                </Text>
              </Box>
            </SheetField>
            <SheetField label="Temp"><Input {...sheetInputProps} value={draft.temp} onChange={set("temp")} /></SheetField>

            <SectionBar>Additional</SectionBar>
            <SheetField label="Remarks" full>
              <Textarea {...sheetInputProps} rows={3} value={draft.remarks} onChange={set("remarks")} />
            </SheetField>
            <SheetField label="Checked By"><Input {...sheetInputProps} value={draft.checkedBy} onChange={set("checkedBy")} /></SheetField>
            <SheetField label="Status" plain>
              <Select size="sm" bg="white" border="1px solid" borderColor="gray.300" value={draft.status} onChange={set("status")}>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </Select>
            </SheetField>
          </Grid>
        </Box>
    </FloatingWindow>
  );
};

// Human labels for the snapshot shown on create/delete history entries.
const SNAPSHOT_FIELDS = [
  ["lotNumber", "Lot #"],
  ["formDate", "Form date"],
  ["dateReceived", "Date received"],
  ["timeReceived", "Time received"],
  ["vendor", "Vendor"],
  ["vendorLot", "Vendor lot"],
  ["productDescription", "Product"],
  ["processingType", "Processing type"],
  ["spec", "Spec"],
  ["brand", "Brand"],
  ["estNumber", "EST #"],
  ["grade", "Grade"],
  ["dueDate", "Due date"],
  ["predictedYield", "Predicted yield"],
  ["originalWeight", "Original weight"],
  ["totalQuantity", "Total quantity"],
  ["actualYield", "Actual yield"],
  ["temp", "Temp"],
  ["remarks", "Remarks"],
  ["checkedBy", "Checked by"],
  ["status", "Status"],
];

const isBlank = (v) =>
  v === null || v === undefined || v === "" ||
  (Array.isArray(v) && v.length === 0);

// Renders the full form captured on a create or a delete. Empty fields are
// omitted so a sparse form does not produce a wall of dashes.
const HistorySnapshot = ({ form, tone, label }) => {
  if (!form) return null;
  const filled = SNAPSHOT_FIELDS.filter(([key]) => !isBlank(form[key]));
  const dates = Array.isArray(form.processingDates)
    ? form.processingDates.filter((pd) => pd && (pd.date || pd.weight))
    : [];

  if (filled.length === 0 && dates.length === 0) {
    return <Text fontSize="xs" color="gray.500" fontStyle="italic">No field data recorded.</Text>;
  }

  return (
    <Box mt={1} p={2} bg={`${tone}.50`} borderRadius="md" border="1px solid" borderColor={`${tone}.200`}>
      <Text fontSize="xs" fontWeight="bold" color={`${tone}.800`} mb={1}>{label}</Text>
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={1} fontSize="xs">
        {filled.map(([key, labelText]) => (
          <Flex key={key} gap={2}>
            <Text color="gray.500" minW="110px" flexShrink={0}>{labelText}:</Text>
            <Text color="gray.800" wordBreak="break-word">{String(form[key])}</Text>
          </Flex>
        ))}
      </Grid>
      {dates.length > 0 && (
        <Box mt={1}>
          <Text color="gray.500" fontSize="xs">Processing:</Text>
          {dates.map((pd, i) => (
            <Text key={i} fontSize="xs" color="gray.800" pl={2}>
              ({i + 1}) {pd.date || "—"} · {pd.weight ?? "—"} lbs
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

const statusColor = (status) => (status === "completed" ? "green" : "yellow");

const calculateYield = (draft) => {
  if (!draft || !draft.originalWeight || !Array.isArray(draft.processingDates)) {
    return null;
  }
  const originalWeight = parseFloat(draft.originalWeight);
  if (!originalWeight || originalWeight <= 0) return null;

  const totalProcessedWeight = draft.processingDates.reduce((sum, pd) => {
    const weight = parseFloat(pd.weight || 0);
    return sum + (isNaN(weight) ? 0 : weight);
  }, 0);

  if (totalProcessedWeight === 0) return null;
  const yield_ = (totalProcessedWeight / originalWeight * 100).toFixed(2);
  return yield_;
};

export const RegistrationFormTab = ({ isAdmin, canDelete = false, isAdminUser = false, refreshSignal = 0 }) => {
  const toast = useToast();
  const [forms, setForms]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [statusFilter, setStatusFilter] = useState("in_progress");
  const [expandedId, setExpandedId] = useState(null);
  const [allHistoryOpen, setAllHistoryOpen] = useState(false);
  const [allHistory, setAllHistory] = useState([]);
  const [allHistoryLoading, setAllHistoryLoading] = useState(false);
  const [excelViewOpen, setExcelViewOpen] = useState(false);

  const fetchForms = useCallback(async () => {
    try {
      const res = await axiosInstance.get("/noblesse-registration-forms");
      setForms(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const openAllHistoryModal = async () => {
    setAllHistoryOpen(true);
    setAllHistoryLoading(true);
    try {
      const res = await axiosInstance.get("/noblesse-registration-forms/all/history");
      setAllHistory(res.data || []);
    } catch (err) {
      console.error(err);
      toast({ status: "error", title: "Failed to load history", duration: 2000 });
    } finally {
      setAllHistoryLoading(false);
    }
  };

  const closeAllHistoryModal = () => setAllHistoryOpen(false);

  useEffect(() => { fetchForms(); }, [fetchForms]);

  // Re-fetch when the parent's auto-refresh ticks. Compared against a ref so
  // the initial value does not trigger a duplicate fetch alongside the mount
  // effect above.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    fetchForms();
  }, [refreshSignal, fetchForms]);

  const openNew  = () => setDraft(emptyDraft());
  const openEdit = (form) => {
    const draft = { ...emptyDraft(), ...form };
    // Convert backend format to array format. An empty array is truthy, so it
    // has to be checked for explicitly — otherwise the form renders with no
    // processing row at all and the yield can never be calculated.
    if (!Array.isArray(draft.processingDates) || draft.processingDates.length === 0) {
      const dates = [];
      for (let i = 1; i <= 10; i++) {
        if (draft[`processingDate${i}`] || draft[`processedWeight${i}`]) {
          dates.push({ date: draft[`processingDate${i}`] || "", weight: draft[`processedWeight${i}`] || "" });
        }
      }
      if (dates.length === 0) dates.push({ date: "", weight: "" });
      draft.processingDates = dates;
    }
    setDraft(draft);
  };
  const close    = () => setDraft(null);

  const save = async () => {
    setSaving(true);
    try {
      // Send processingDates array directly to backend - no conversion needed
      const payload = { ...draft };

      if (draft.id) {
        const res = await axiosInstance.patch(`/noblesse-registration-forms/${draft.id}`, payload);
        setForms((prev) => prev.map((f) => (f.id === res.data.id ? res.data : f)));
      } else {
        const res = await axiosInstance.post("/noblesse-registration-forms", payload);
        setForms((prev) => [res.data, ...prev]);
      }
      toast({ status: "success", title: "Registration form saved", duration: 2000 });
      close();
    } catch (err) {
      toast({ status: "error", title: "Save failed", description: err.message, duration: 3000 });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this registration form?")) return;
    try {
      await axiosInstance.delete(`/noblesse-registration-forms/${id}`);
      setForms((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      toast({ status: "error", title: "Delete failed", description: err.message, duration: 3000 });
    }
  };

  const updateStatus = async (id, newStatus) => {
    try {
      const res = await axiosInstance.patch(`/noblesse-registration-forms/${id}/status`, { status: newStatus });
      setForms((prev) => prev.map((f) => (f.id === id ? res.data : f)));
      toast({
        status: "success",
        title: `Status changed to ${newStatus === "completed" ? "Completed" : "In Progress"}`,
        duration: 2000,
      });
    } catch (err) {
      toast({ status: "error", title: "Failed to update status", description: err.message, duration: 3000 });
    }
  };

  if (loading) {
    return <Flex justify="center" py={10}><Spinner size="lg" color="blue.500" /></Flex>;
  }

  const filteredForms = forms.filter((f) => !statusFilter || f.status === statusFilter);

  return (
    <Box>
      <Flex justify="space-between" align={{ base: "stretch", md: "center" }} mb={4}
        direction={{ base: "column", md: "row" }} gap={{ base: 3, md: 0 }}>
        <Flex align="center" gap={3} flex={1} wrap="wrap">
          <Text fontSize="sm" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide">
            Registration Forms
          </Text>
          <Flex gap={1}>
            <Button
              size="xs"
              variant={statusFilter === null ? "solid" : "outline"}
              colorScheme={statusFilter === null ? "teal" : "gray"}
              onClick={() => setStatusFilter(null)}
            >
              All
            </Button>
            <Button
              size="xs"
              variant={statusFilter === "in_progress" ? "solid" : "outline"}
              colorScheme={statusFilter === "in_progress" ? "blue" : "gray"}
              onClick={() => setStatusFilter("in_progress")}
            >
              In Progress
            </Button>
            <Button
              size="xs"
              variant={statusFilter === "completed" ? "solid" : "outline"}
              colorScheme={statusFilter === "completed" ? "green" : "gray"}
              onClick={() => setStatusFilter("completed")}
            >
              Completed
            </Button>
          </Flex>
        </Flex>
        <Flex gap={2} wrap="wrap">
          <Button size="xs" colorScheme="gray" variant="outline" onClick={() => setExcelViewOpen(true)}>View All</Button>
          {/* The isAdmin prop above is really "can edit" and is always true here.
              History is gated on the actual role check. */}
          {isAdminUser && <Button size="xs" colorScheme="gray" onClick={openAllHistoryModal}>History</Button>}
          {isAdmin && <Button size="xs" colorScheme="blue" onClick={openNew}>+ New Registration Form</Button>}
        </Flex>
      </Flex>

      {filteredForms.length === 0 ? (
        <Text fontSize="sm" color="gray.400">
          {forms.length === 0 ? "No registration forms saved yet." : statusFilter ? `No ${statusFilter === "in_progress" ? "in progress" : "completed"} registration forms.` : "No registration forms."}
        </Text>
      ) : (
        // A table cannot reflow into a narrow column, so on mobile it scrolls
        // sideways inside this box rather than forcing the whole page to.
        <Box overflowX="auto" width="100%">
        <table style={{ width: "100%", minWidth: "720px", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <Th>Lot #</Th>
              <Th>Vendor</Th>
              <Th>Product Description</Th>
              <Th>Date Received</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {filteredForms.map((f, i) => (
              <React.Fragment key={f.id}>
                <tr
                  style={{
                    backgroundColor: i % 2 === 0 ? "white" : "rgb(245, 245, 245)",
                    cursor: "pointer",
                    transition: "background-color 0.2s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = i % 2 === 0 ? "rgb(245, 245, 245)" : "rgb(230, 230, 230)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = i % 2 === 0 ? "white" : "rgb(245, 245, 245)"; }}
                  onDoubleClick={() => {
                    if (expandedId === f.id) {
                      setExpandedId(null);
                    } else {
                      setExpandedId(f.id);
                    }
                  }}
                >
                  <Td fontWeight="medium" color="blue.700">
                    <Flex align="center" gap={2}>
                      {/* Inside the first cell rather than its own column, so
                          the expanded row's colSpan does not have to change. */}
                      <IconButton
                        aria-label={expandedId === f.id ? "Collapse details" : "Expand details"}
                        title={expandedId === f.id ? "Collapse" : "Expand"}
                        icon={expandedId === f.id ? <ChevronUpIcon /> : <ChevronDownIcon />}
                        size="xs"
                        variant="ghost"
                        colorScheme={expandedId === f.id ? "blue" : "gray"}
                        // The row also expands on double-click. Without these
                        // the button's own events bubble up to it and toggle a
                        // second time, cancelling the first.
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId(expandedId === f.id ? null : f.id);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                      />
                      <Text as="span">{f.lotNumber || "—"}</Text>
                    </Flex>
                  </Td>
                  <Td>{f.vendor || "—"}</Td>
                  <Td>{f.productDescription || "—"}</Td>
                  <Td>{fmtDate(f.dateReceived)}</Td>
                  <Td>
                    <Menu>
                      <MenuButton
                        as={Badge}
                        colorScheme={statusColor(f.status)}
                        borderRadius="full"
                        px={2}
                        cursor="pointer"
                        _hover={{ opacity: 0.8 }}
                      >
                        <Flex align="center" gap={1}>
                          <Text fontSize="xs">{f.status === "completed" ? "Completed" : "In Progress"}</Text>
                          <ChevronDownIcon boxSize={3} />
                        </Flex>
                      </MenuButton>
                      <MenuList minW="120px">
                        <MenuItem
                          onClick={() => updateStatus(f.id, "in_progress")}
                          isDisabled={f.status === "in_progress"}
                          fontSize="sm"
                        >
                          In Progress
                        </MenuItem>
                        <MenuItem
                          onClick={() => updateStatus(f.id, "completed")}
                          isDisabled={f.status === "completed"}
                          fontSize="sm"
                        >
                          Completed
                        </MenuItem>
                      </MenuList>
                    </Menu>
                  </Td>
                  <Td>
                    <Flex gap={2}>
                      <Button size="xs" variant="outline" onClick={() => openEdit(f)}>
                        {f.status === "completed" ? "View" : "Edit"}
                      </Button>
                      <Button size="xs" variant="outline" colorScheme="blue" onClick={() => printRegistrationForm(f)}>
                        Print
                      </Button>
                      <IconButton size="xs" aria-label="Delete" icon={<DeleteIcon />}
                        variant="ghost" colorScheme="red" onClick={() => remove(f.id)}
                        isDisabled={!canDelete} title={canDelete ? "Delete" : "Admins only"} />
                    </Flex>
                  </Td>
                </tr>
                {expandedId === f.id && (
                  <tr style={{ backgroundColor: "rgb(230, 240, 255)", borderTop: "2px solid rgb(66, 153, 225)" }}>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <Box p={4} width="100%">
                        <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={4} fontSize="sm">
                          <GridItem>
                            <Text fontWeight="bold" color="gray.700">Lot #</Text>
                            <Text>{f.lotNumber || "—"}</Text>
                          </GridItem>
                          <GridItem>
                            <Text fontWeight="bold" color="gray.700">Form Date</Text>
                            <Text>{fmtDate(f.formDate) || "—"}</Text>
                          </GridItem>
                          <GridItem>
                            <Text fontWeight="bold" color="gray.700">Vendor</Text>
                            <Text>{f.vendor || "—"}</Text>
                          </GridItem>
                          <GridItem>
                            <Text fontWeight="bold" color="gray.700">Product Description</Text>
                            <Text>{f.productDescription || "—"}</Text>
                          </GridItem>
                          <GridItem>
                            <Text fontWeight="bold" color="gray.700">Processing Type</Text>
                            <Text>{f.processingType || "—"}</Text>
                          </GridItem>
                          <GridItem>
                            <Text fontWeight="bold" color="gray.700">Spec</Text>
                            <Text>{f.spec || "—"}</Text>
                          </GridItem>
                          <GridItem colSpan={{ base: 1, md: 2 }}>
                            <Text fontWeight="bold" color="gray.700">Remarks</Text>
                            <Text>{f.remarks || "—"}</Text>
                          </GridItem>
                        </Grid>
                      </Box>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        </Box>
      )}

      <FloatingWindow
        isOpen={excelViewOpen}
        onClose={() => setExcelViewOpen(false)}
        title="All Registration Forms"
        width={1360}
      >
        {/* Double-click opens the edit form over this list rather than closing
            it, so the filters and page survive the round trip. */}
        <AllFormsTable forms={forms} onEdit={openEdit} />
      </FloatingWindow>

      <FloatingWindow
        isOpen={allHistoryOpen}
        onClose={closeAllHistoryModal}
        title="Registration Forms — All Changes"
        width={900}
      >
        {allHistoryLoading ? (
          <Flex justify="center" py={6}><Spinner size="sm" color="blue.500" /></Flex>
        ) : allHistory.length === 0 ? (
          <Text fontSize="sm" color="gray.500">No changes recorded</Text>
        ) : (
          <Flex direction="column" gap={3} maxH="70vh" overflowY="auto">
            {allHistory.map((entry, idx) => (
              <Box key={idx} p={3} bg="gray.50" borderRadius="md" borderLeft="4px" borderLeftColor="blue.500">
                <Flex justify="space-between" align="start" gap={2} mb={1}>
                  <Flex gap={2} align="center" flex={1}>
                    <Badge
                      colorScheme={
                        entry.action === "created" ? "green" :
                        entry.action === "deleted" ? "red" :
                        entry.action === "status_changed" ? "teal" :
                        "blue"
                      }
                      fontSize="xs"
                    >
                      {entry.action === "created" && "Created"}
                      {entry.action === "updated" && "Updated"}
                      {entry.action === "status_changed" && "Status"}
                      {entry.action === "deleted" && "Deleted"}
                    </Badge>
                    <Text fontSize="sm" fontWeight="bold" color="gray.700" flex={1}>
                      {entry.lotNumber || "—"}
                    </Text>
                  </Flex>
                  <Text fontSize="xs" color="gray.500" whiteSpace="nowrap">
                    {fmtDate(entry.createdAt)}
                  </Text>
                </Flex>
                <Flex gap={2} fontSize="xs" color="gray.600" mb={2}>
                  <Text fontWeight="500">{entry.performedBy || "System"}</Text>
                </Flex>
                {entry.changedFields && entry.changedFields.length > 0 && (
                  <Box>
                    <Text fontSize="xs" fontWeight="bold" color="gray.700" mb={1}>
                      Changed: {entry.changedFields.join(", ")}
                    </Text>
                    {entry.oldValues && entry.newValues && (
                      <Flex direction="column" gap={1} fontSize="xs" color="gray.600">
                        {entry.changedFields.map((field) => (
                          <Flex key={field} gap={2}>
                            <Text minW="100px">{field}:</Text>
                            <Text color="red.600">{JSON.stringify(entry.oldValues[field])}</Text>
                            <Text>→</Text>
                            <Text color="green.600">{JSON.stringify(entry.newValues[field])}</Text>
                          </Flex>
                        ))}
                      </Flex>
                    )}
                  </Box>
                )}

                {/* A create or delete has no field diff, so show the whole form
                    instead. For a delete this is the only surviving copy. */}
                {!entry.changedFields?.length && (entry.newValues || entry.oldValues) && (
                  <HistorySnapshot
                    form={entry.newValues || entry.oldValues}
                    tone={entry.action === "deleted" ? "red" : "green"}
                    label={entry.action === "deleted" ? "Deleted record" : "Created with"}
                  />
                )}
              </Box>
            ))}
          </Flex>
        )}
      </FloatingWindow>

      {/* Rendered last on purpose. Every FloatingWindow sits at zIndex 1400, so
          at equal z-index DOM order decides what stacks on top — and the edit
          form has to sit above the list it was opened from. */}
      <RegistrationFormModal
        isOpen={!!draft} onClose={close}
        draft={draft} setDraft={setDraft}
        onSave={save} saving={saving}
      />
    </Box>
  );
};
