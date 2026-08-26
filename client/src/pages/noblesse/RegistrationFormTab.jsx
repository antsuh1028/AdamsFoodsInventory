import React, { useEffect, useState, useCallback } from "react";
import {
  Box, Flex, Text, Button, IconButton, Badge, Spinner, useToast, Image,
  Grid, GridItem, Input, Textarea, Select, Checkbox, Menu, MenuButton, MenuList, MenuItem,
} from "@chakra-ui/react";
import { DeleteIcon, ChevronDownIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import { fmtDate, today, Th, Td } from "./shared";
import printRegistrationForm from "./printRegistrationForm";
import ntiLogo from "../../assets/nti.jpg";
import FloatingWindow from "../../components/FloatingWindow";

const emptyDraft = () => ({
  id: null,
  lotNumber: "", formDate: "", dateReceived: "", timeReceived: "",
  vendorLot: "", vendor: "", productDescription: "", processingType: "",
  spec: "", brand: "", estNumber: "", grade: "",
  dueDate: "", predictedYield: "",
  manifestBlAttached: false, processReportAttached: false,
  originalWeight: "", totalQuantity: "",
  processingDate1: "", processedWeight1: "",
  processingDate2: "", processedWeight2: "",
  actualYield: "", temp: "", remarks: "", checkedBy: "",
  status: "in_progress",
});

// Fills the form with realistic placeholder values — for previewing/printing
// the layout without needing a saved record from the backend.
const sampleDraft = () => ({
  lotNumber: "N26124-01", formDate: today(), dateReceived: today(), timeReceived: "14:30",
  vendorLot: "IC-88213", vendor: "IBP Foods",
  productDescription: "Beef Brisket, Boneless", processingType: "Cut & Vacuum Pack",
  spec: "10X30", brand: "IBP", estNumber: "9268", grade: "Choice",
  dueDate: today(), predictedYield: "92",
  manifestBlAttached: true, processReportAttached: false,
  originalWeight: "1842", totalQuantity: "24",
  processingDate1: today(), processedWeight1: "1695",
  processingDate2: "", processedWeight2: "",
  actualYield: "92.0", temp: "27",
  remarks: "Sample record for print preview — no backend data behind this.",
  checkedBy: "J. Rivera",
});

// Sheet-style field: bold right-aligned label + light-gray filled input,
// laid out as a pair of grid columns to mirror the printed form's rows.
const SheetField = ({ label, full, plain, children }) => (
  <>
    <GridItem colSpan={1} display="flex" alignItems="center" justifyContent="flex-end">
      <Text fontSize="2xs" fontWeight="bold" p={2} color="gray.700" textTransform="uppercase" letterSpacing="wide" textAlign="right">
        {label}
      </Text>
    </GridItem>
    <GridItem colSpan={full ? 3 : 1} bg={plain ? "transparent" : "#f0f0f0"} borderRadius="sm">
      {children}
    </GridItem>
  </>
);

const sheetInputProps = { size: "sm", bg: "transparent", border: "none", borderRadius: 0, px: 2, _focus: { boxShadow: "none", bg: "white" } };

const SectionBar = ({ children }) => (
  <GridItem colSpan={4} bg="#ccd3db" px={3} py={2} fontSize="xs" fontWeight="bold" color="gray.800">
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
      footer={<Flex justify="space-between" width="100%">
        <Button size="sm" variant="outline" colorScheme="purple" onClick={() => setDraft({ ...draft, ...sampleDraft() })}>
          Fill Sample Data
        </Button>
        <Flex gap={2}>
          <Button size="sm" variant="outline" onClick={() => printRegistrationForm(draft)}>Print</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" colorScheme="blue" isLoading={saving} onClick={onSave}>Save</Button>
        </Flex>
      </Flex>}
    >
        <Box maxW="820px" mx="auto">
          <Flex align="flex-start" justify="space-between" borderBottom="2px solid #2b6cb0" pb={2} mb={3}>
            <Image src={ntiLogo} alt="Noblesse Trading Inc." width="220px" objectFit="contain" />
            <Flex direction="column" gap={2} align="flex-end">
              <Flex align="center" gap={2}>
                <Text fontSize="sm" fontWeight="bold" color="blue.700">Lot#:</Text>
                <Input size="sm" width="150px" value={draft.lotNumber} onChange={set("lotNumber")} placeholder="N26124-01" />
              </Flex>
              <Flex align="center" gap={2}>
                <Text fontSize="sm" fontWeight="bold" color="blue.700">Date:</Text>
                <Input size="sm" width="150px" type="date" value={draft.formDate} onChange={set("formDate")} />
              </Flex>
            </Flex>
          </Flex>
          <Text textAlign="center" fontSize="lg" fontWeight="extrabold" color="blue.700" mb={4}>
            {draft.id ? "Edit Registration Form" : "New Registration Form"}
          </Text>

          <Grid templateColumns="1fr 2fr 1fr 2fr" gap="1px" bg="gray.200" mb={5} border="1px solid" borderColor="gray.200">
            <SectionBar>Logistics &amp; Vendor</SectionBar>
            <SheetField label="Date Received"><Input {...sheetInputProps} type="date" value={draft.dateReceived} onChange={set("dateReceived")} /></SheetField>
            <SheetField label="Time Received"><Input {...sheetInputProps} type="time" value={draft.timeReceived} onChange={set("timeReceived")} /></SheetField>
            <SheetField label="Vendor Lot/(IC)#"><Input {...sheetInputProps} value={draft.vendorLot} onChange={set("vendorLot")} /></SheetField>
            <SheetField label="Vendor"><Input {...sheetInputProps} value={draft.vendor} onChange={set("vendor")} /></SheetField>

            <SectionBar>Product Identification</SectionBar>
            <SheetField label="Product Description" full><Input {...sheetInputProps} value={draft.productDescription} onChange={set("productDescription")} /></SheetField>
            <SheetField label="Processing Type" full><Input {...sheetInputProps} value={draft.processingType} onChange={set("processingType")} /></SheetField>
            <SheetField label="Spec.(##X##)"><Input {...sheetInputProps} value={draft.spec} onChange={set("spec")} /></SheetField>
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

            <SectionBar>Processing &amp; Yield</SectionBar>
            <SheetField label="Original Weight (lbs)"><Input {...sheetInputProps} type="number" value={draft.originalWeight} onChange={set("originalWeight")} /></SheetField>
            <SheetField label="Total Quantity (c/s)"><Input {...sheetInputProps} value={draft.totalQuantity} onChange={set("totalQuantity")} /></SheetField>
            <SheetField label="(1) Processing Date"><Input {...sheetInputProps} type="date" value={draft.processingDate1} onChange={set("processingDate1")} /></SheetField>
            <SheetField label="Processed Weight (lbs)"><Input {...sheetInputProps} type="number" value={draft.processedWeight1} onChange={set("processedWeight1")} /></SheetField>
            <SheetField label="(2) Processing Date"><Input {...sheetInputProps} type="date" value={draft.processingDate2} onChange={set("processingDate2")} /></SheetField>
            <SheetField label="Processed Weight (lbs)"><Input {...sheetInputProps} type="number" value={draft.processedWeight2} onChange={set("processedWeight2")} /></SheetField>
            <SheetField label="Actual Yield (%)"><Input {...sheetInputProps} type="number" value={draft.actualYield} onChange={set("actualYield")} /></SheetField>
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

const statusColor = (status) => (status === "completed" ? "green" : "yellow");

export const RegistrationFormTab = ({ isAdmin, canDelete = false }) => {
  const toast = useToast();
  const [forms, setForms]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [statusFilter, setStatusFilter] = useState("in_progress");

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

  useEffect(() => { fetchForms(); }, [fetchForms]);

  const openNew  = () => setDraft(emptyDraft());
  const openEdit = (form) => setDraft({ ...emptyDraft(), ...form });
  const close    = () => setDraft(null);

  const save = async () => {
    setSaving(true);
    try {
      if (draft.id) {
        const res = await axiosInstance.patch(`/noblesse-registration-forms/${draft.id}`, draft);
        setForms((prev) => prev.map((f) => (f.id === res.data.id ? res.data : f)));
      } else {
        const res = await axiosInstance.post("/noblesse-registration-forms", draft);
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
      const res = await axiosInstance.patch(`/noblesse-registration-forms/${id}`, { status: newStatus });
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
      <Flex justify="space-between" align="center" mb={4}>
        <Flex align="center" gap={3} flex={1}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide">
            Registration Forms
          </Text>
          <Flex gap={1}>
            <Button
              size="xs"
              variant={statusFilter === null ? "solid" : "outline"}
              colorScheme={statusFilter === null ? "purple" : "gray"}
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
        {isAdmin && <Button size="xs" colorScheme="blue" onClick={openNew}>+ New Registration Form</Button>}
      </Flex>

      {filteredForms.length === 0 ? (
        <Text fontSize="sm" color="gray.400">
          {forms.length === 0 ? "No registration forms saved yet." : statusFilter ? `No ${statusFilter === "in_progress" ? "in progress" : "completed"} registration forms.` : "No registration forms."}
        </Text>
      ) : (
        <Box as="table" width="100%" borderCollapse="collapse">
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
              <Box as="tr" key={f.id} bg={i % 2 === 0 ? "white" : "gray.50"}>
                <Td fontWeight="medium" color="blue.700">{f.lotNumber || "—"}</Td>
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
                      {f.status === "completed" ? "View" : "Revisit"}
                    </Button>
                    <Button size="xs" variant="outline" colorScheme="blue" onClick={() => printRegistrationForm(f)}>
                      Print
                    </Button>
                    {canDelete && (
                      <IconButton size="xs" aria-label="Delete" icon={<DeleteIcon />}
                        variant="ghost" colorScheme="red" onClick={() => remove(f.id)} />
                    )}
                  </Flex>
                </Td>
              </Box>
            ))}
          </tbody>
        </Box>
      )}

      <RegistrationFormModal
        isOpen={!!draft} onClose={close}
        draft={draft} setDraft={setDraft}
        onSave={save} saving={saving}
      />
    </Box>
  );
};
