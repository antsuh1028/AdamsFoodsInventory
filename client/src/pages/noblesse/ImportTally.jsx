import React, { useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Select, Spinner,
  Alert, AlertIcon, useToast,
} from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";

// Imports a hand-entered tally sheet for lots whose labels carry no barcode.
//
// Two passes over the same file: the first is a dry run that shows what was
// read, the second commits. The server parses both times, so the preview
// cannot disagree with what ends up stored — which would be the worst possible
// outcome for a document people reconcile shipments against.

const newUuid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const Field = ({ label, value, warn }) => (
  <Flex px={3} py={2} gap={3} align="baseline" borderBottom="1px solid" borderColor="gray.100">
    <Text fontSize="xs" color="gray.500" minW="130px" textTransform="uppercase" letterSpacing="wide">
      {label}
    </Text>
    {value ? (
      <Text fontSize="sm" fontWeight="medium" color="gray.800">{value}</Text>
    ) : (
      <Text fontSize="sm" color={warn ? "orange.500" : "gray.400"} fontStyle="italic">
        {warn || "not on the sheet"}
      </Text>
    )}
  </Flex>
);

const ImportTally = ({ isOpen, onClose, onImported }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [unit, setUnit] = useState("LB");
  const fileRef = useRef(null);
  const toast = useToast();

  const reset = () => { setFile(null); setPreview(null); setError(null); };

  const close = () => { reset(); onClose(); };

  const send = async (chosen, { commit }) => {
    const form = new FormData();
    form.append("file", chosen);
    form.append("weightUnit", unit);
    if (commit) form.append("clientUuid", newUuid());
    else form.append("dryRun", "true");

    const { data } = await axiosInstance.post("/box-batches/import", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  };

  const onPick = async (e) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setPreview(null);
    setError(null);
    setBusy(true);
    try {
      setPreview(await send(chosen, { commit: false }));
    } catch (err) {
      const body = err.response?.data;
      setError(body || { error: err.message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = ""; // allow re-picking the same file
    }
  };

  const onConfirm = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await send(file, { commit: true });
      toast({
        title: result.reused ? "Already imported" : "Tally imported",
        description: `${result.boxes} boxes, ${result.subtotal} ${result.weightUnit}`,
        status: "success", position: "top", duration: 4000,
      });
      onImported?.();
      close();
    } catch (err) {
      setError(err.response?.data || { error: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={close}
      title="Import tally sheet"
      width={720}
      footer={
        <Flex gap={2} width="100%" justify="space-between" wrap="wrap">
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} isDisabled={busy}>
            {file ? "Choose a different file" : "Choose file"}
          </Button>
          <Flex gap={2}>
            <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
            <Button size="sm" colorScheme="teal" onClick={onConfirm}
              isDisabled={!preview || busy} isLoading={busy}>
              Import {preview ? `${preview.boxes} boxes` : ""}
            </Button>
          </Flex>
        </Flex>
      }
    >
      <input ref={fileRef} type="file" hidden onChange={onPick}
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />

      <Alert status="info" borderRadius="md" mb={3} fontSize="sm">
        <AlertIcon />
        For lots with no barcodes. Upload the Excel tally filled in on the iPad —
        nothing is saved until you confirm what was read.
      </Alert>

      <Flex align="center" gap={3} mb={3} wrap="wrap">
        <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
          Weight unit
        </Text>
        <Select size="sm" width="110px" value={unit}
          onChange={(e) => { setUnit(e.target.value); setPreview(null); }}>
          <option value="LB">LB</option>
          <option value="KG">KG</option>
        </Select>
        <Text fontSize="xs" color="gray.400">
          the sheet does not record it — Canada and Mexico ship in kilograms
        </Text>
      </Flex>

      {busy && !preview && (
        <Flex justify="center" py={8}><Spinner color="blue.500" /></Flex>
      )}

      {error && (
        <Alert status="error" borderRadius="md" mb={3}>
          <AlertIcon />
          <Box flex={1}>
            <Text fontWeight="bold">{error.code || "Could not read the file"}</Text>
            <Text fontSize="sm">{error.error}</Text>
            {/* The sheet's own totals disagreed with its weights. Naming the row
                is the difference between "fix it" and "start over". */}
            {error.details?.rows && (
              <Box mt={2} fontSize="sm">
                {error.details.rows.map((r, i) => (
                  <Text key={i}>
                    Row {r.row}: sheet says {r.declared ?? r.declaredBoxes},
                    weights add to {r.computed ?? r.computedBoxes}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        </Alert>
      )}

      {preview && (
        <Box>
          <Flex align="center" gap={2} mb={2}>
            <Badge colorScheme="green">Read successfully</Badge>
            <Text fontSize="xs" color="gray.500">{file?.name}</Text>
          </Flex>

          <Box border="1px solid" borderColor="gray.200" borderRadius="md" mb={3}>
            <Field label="Lot #" value={preview.lotNumber} warn="not on the sheet — add it before importing" />
            <Field label="Vendor" value={preview.vendor} />
            <Field label="Item" value={preview.itemDescription} />
            <Field label="Date" value={preview.date} />
            <Field label="Boxes" value={String(preview.boxes)} />
            <Field label="Total" value={`${preview.subtotal} ${preview.weightUnit}`} />
          </Box>

          <Text fontSize="xs" color="gray.500" mb={1} textTransform="uppercase" letterSpacing="wide">
            Weights read ({preview.weights.length})
          </Text>
          <Box maxH="180px" overflowY="auto" p={2} bg="gray.50" borderRadius="md"
            border="1px solid" borderColor="gray.200">
            <Flex wrap="wrap" gap={2}>
              {preview.weights.map((w, i) => (
                <Box key={i} px={2} py={1} bg="white" borderRadius="sm"
                  border="1px solid" borderColor="gray.200" fontSize="sm"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  <Text as="span" color="gray.400" fontSize="xs" mr={1}>{i + 1}</Text>
                  {w}
                </Box>
              ))}
            </Flex>
          </Box>

          {preview.declared?.subtotal && (
            <Text fontSize="xs" color="gray.500" mt={2}>
              The sheet's own subtotal ({preview.declared.subtotal}) matches the weights read.
            </Text>
          )}
        </Box>
      )}
    </FloatingWindow>
  );
};

export default ImportTally;
