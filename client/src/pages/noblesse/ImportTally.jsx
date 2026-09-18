import React, { useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Select, Spinner, Input,
  Alert, AlertIcon, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";
import { toDisplay } from "../../utils/weight";

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

// Read off the sheet but correctable before committing — real files carry
// things like "P12 N26230-01" in the lot cell.
const EditableField = ({ label, value, onChange, placeholder }) => (
  <Flex px={3} py={2} gap={{ base: 1, sm: 3 }} align={{ base: "stretch", sm: "center" }}
    direction={{ base: "column", sm: "row" }}
    borderBottom="1px solid" borderColor="gray.100">
    <Text fontSize="xs" color="gray.500" minW={{ base: "auto", sm: "120px" }}
      textTransform="uppercase" letterSpacing="wide">
      {label}
    </Text>
    <Input size="sm" flex={1} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || "blank on the sheet"}
      autoCorrect="off" autoCapitalize="off" spellCheck={false} />
  </Flex>
);

const ReadOnlyField = ({ label, value }) => (
  <Flex px={3} py={2} gap={{ base: 1, sm: 3 }} align={{ base: "flex-start", sm: "baseline" }}
    direction={{ base: "column", sm: "row" }}
    borderBottom="1px solid" borderColor="gray.100">
    <Text fontSize="xs" color="gray.500" minW={{ base: "auto", sm: "120px" }}
      textTransform="uppercase" letterSpacing="wide">
      {label}
    </Text>
    <Text fontSize="sm" fontWeight="medium" color="gray.800">{value}</Text>
  </Flex>
);

// Two decimals, zeros included, matching the grid and the printed tally. The
// sheet's own figures stay visible via asWritten for comparison against paper.
const show = (w) => (w === null || w === undefined || w === "" ? "—" : toDisplay(w));

// The same shape the server accepts, so a correction cannot be confirmed here
// and then refused on commit.
const WEIGHT_RE = /^\d{1,5}(\.\d{1,3})?$/;

const cents = (w) => Math.round(Number(w) * 100);

const ImportTally = ({ isOpen, onClose, onImported }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [unit, setUnit] = useState("LB");
  const [heading, setHeading] = useState({ lotNumber: "", vendor: "", itemDescription: "", shipTo: "" });
  // Corrected weights, keyed by position: { 3: "41.20" }. The sheet's own
  // figures stay in `preview.weights` so both can be shown.
  const [edits, setEdits] = useState({});
  // The box being corrected, awaiting its own confirmation.
  const [editing, setEditing] = useState(null);
  const cancelEditRef = useRef(null);
  const setField = (k) => (v) => setHeading((h) => ({ ...h, [k]: v }));
  const fileRef = useRef(null);
  const toast = useToast();

  const reset = () => {
    setFile(null); setPreview(null); setError(null); setEdits({}); setEditing(null);
    setHeading({ lotNumber: "", vendor: "", itemDescription: "", shipTo: "" });
  };

  const close = () => { reset(); onClose(); };

  // What is corrected, and what the load will actually weigh once it is.
  const editedCount = Object.keys(edits).length;
  const correctedTotal = (preview?.weights || [])
    .reduce((sum, w, i) => sum + cents(edits[i] ?? w), 0);

  const editValid = editing !== null && WEIGHT_RE.test(String(editing.value).trim());
  const sheetSaid = editing !== null ? preview?.weights?.[editing.index] : null;
  // Confirming the same figure back is not a correction; drop it instead of
  // recording an edit that changes nothing.
  const editChangesIt = editValid
    && cents(String(editing.value).trim()) !== cents(sheetSaid);

  const applyEdit = () => {
    const value = String(editing.value).trim();
    setEdits((prev) => {
      const next = { ...prev };
      if (editChangesIt) next[editing.index] = value;
      else delete next[editing.index];
      return next;
    });
    setEditing(null);
  };

  const send = async (chosen, { commit }) => {
    const form = new FormData();
    form.append("file", chosen);
    form.append("weightUnit", unit);
    if (commit) {
      form.append("clientUuid", newUuid());
      for (const [k, v] of Object.entries(heading)) if (v.trim()) form.append(k, v.trim());
      // Weights the operator corrected box by box. The sheet still had to pass
      // its own checksums to get here; these are overrides on top of that, and
      // each one was confirmed on its own.
      const changed = Object.entries(edits)
        .map(([index, weight]) => ({ index: Number(index), weight }));
      if (changed.length) form.append("weightEdits", JSON.stringify(changed));
    }
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
      const data = await send(chosen, { commit: false });
      setPreview(data);
      setEdits({});
      setHeading({
        lotNumber: data.lotNumber || "",
        vendor: data.vendor || "",
        itemDescription: data.itemDescription || "",
        shipTo: data.shipTo || "",
      });
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
            <EditableField label="Lot #" value={heading.lotNumber} onChange={setField("lotNumber")} placeholder="N26229-01" />
            <EditableField label="Vendor" value={heading.vendor} onChange={setField("vendor")} />
            <EditableField label="Item" value={heading.itemDescription} onChange={setField("itemDescription")} />
            <EditableField label="Vendor Lot #/IC#" value={heading.shipTo} onChange={setField("shipTo")} />
            {/* Read from the sheet and checked against its own totals, so not
                open to editing — that is the guarantee the import rests on. */}
            <ReadOnlyField label="Date" value={preview.date || "—"} />
            <ReadOnlyField label="Boxes" value={String(preview.boxes)} />
            <ReadOnlyField label="Total" value={`${show(preview.subtotal)} ${preview.weightUnit}`} />
          </Box>

          <Flex align="baseline" gap={3} wrap="wrap" mb={1}>
            <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
              Weights read ({preview.weights.length})
            </Text>
            <Text fontSize="xs" color="gray.500">
              Tap a box to correct what was written.
            </Text>
            {editedCount > 0 && (
              <Badge colorScheme="yellow" fontSize="9px">
                {editedCount} corrected
              </Badge>
            )}
          </Flex>
          <Box maxH="180px" overflowY="auto" p={2} bg="gray.50" borderRadius="md"
            border="1px solid" borderColor="gray.200">
            <Flex wrap="wrap" gap={2}>
              {preview.weights.map((w, i) => {
                const corrected = edits[i] !== undefined;
                return (
                  <Box key={i} as="button" type="button" textAlign="left"
                    px={2} py={1} borderRadius="sm" fontSize="sm"
                    bg={corrected ? "yellow.50" : "white"}
                    border="1px solid"
                    borderColor={corrected ? "yellow.400" : "gray.200"}
                    _hover={{ borderColor: "blue.400" }}
                    onClick={() => setEditing({ index: i, value: edits[i] ?? String(w) })}
                    title={corrected ? `The sheet said ${show(w)}` : "Correct this weight"}
                    style={{ fontVariantNumeric: "tabular-nums" }}>
                    <Text as="span" color="gray.400" fontSize="xs" mr={1}>{i + 1}</Text>
                    {corrected ? (
                      <>
                        <Text as="span" color="gray.400" textDecoration="line-through" mr={1}>
                          {show(w)}
                        </Text>
                        <Text as="span" fontWeight="600" color="yellow.800">
                          {show(edits[i])}
                        </Text>
                      </>
                    ) : show(w)}
                  </Box>
                );
              })}
            </Flex>
          </Box>

          {preview.declared?.subtotal && editedCount === 0 && (
            <Text fontSize="xs" color="gray.500" mt={2}>
              The sheet's own subtotal ({preview.declared.subtotal}) matches the weights read.
            </Text>
          )}

          {/* Once a box is corrected the stored total no longer matches the
              paper, and saying so is the whole point of showing it. */}
          {editedCount > 0 && (
            <Alert status="warning" borderRadius="md" fontSize="xs" mt={2} py={2}
              alignItems="flex-start">
              <AlertIcon boxSize={3} />
              <Box>
                <Text fontWeight="600">
                  {editedCount} box{editedCount === 1 ? "" : "es"} corrected — this will
                  be filed as {show(String(correctedTotal / 100))}
                  {preview.declared?.subtotal
                    ? `, not the ${preview.declared.subtotal} on the sheet.`
                    : "."}
                </Text>
                <Text color="gray.700">
                  What the sheet said is kept against each box, so the manifest
                  shows both.
                </Text>
              </Box>
            </Alert>
          )}
        </Box>
      )}
      <AlertDialog isOpen={editing !== null} leastDestructiveRef={cancelEditRef}
        onClose={() => setEditing(null)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Correct box {editing !== null ? editing.index + 1 : ""}?
            </AlertDialogHeader>
            <AlertDialogBody>
              <Flex align="baseline" gap={3} mb={3} wrap="wrap">
                <Box>
                  <Text fontSize="xs" color="gray.500" textTransform="uppercase">
                    The sheet says
                  </Text>
                  <Text fontSize="2xl" fontWeight="bold" color="gray.700"
                    style={{ fontVariantNumeric: "tabular-nums" }}>
                    {show(sheetSaid)}
                  </Text>
                </Box>
                <Text fontSize="xl" color="gray.400">&rarr;</Text>
                <Box>
                  <Text fontSize="xs" color="gray.500" textTransform="uppercase">
                    File it as
                  </Text>
                  <Input autoFocus size="lg" width="150px" inputMode="decimal"
                    value={editing?.value ?? ""}
                    onChange={(e) => setEditing((v) => ({ ...v, value: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && editValid) { e.preventDefault(); applyEdit(); }
                    }}
                    fontSize="2xl" fontWeight="bold" textAlign="center"
                    style={{ fontVariantNumeric: "tabular-nums" }} />
                </Box>
                <Text fontSize="md" color="gray.600">{preview?.weightUnit}</Text>
              </Flex>

              {!editValid && String(editing?.value ?? "").trim() !== "" && (
                <Text fontSize="sm" color="red.600" mb={2}>
                  Pounds, with at most three decimal places.
                </Text>
              )}

              <Text fontSize="sm">
                The sheet passed its own totals, so this is a deliberate override
                of one box. {show(sheetSaid)} is kept against it and prints on the
                manifest beside the corrected figure.
              </Text>
              {editValid && !editChangesIt && (
                <Text fontSize="xs" color="gray.600" mt={2}>
                  That is what the sheet already says — confirming leaves it alone.
                </Text>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelEditRef} onClick={() => setEditing(null)}>
                Leave it
              </Button>
              <Button colorScheme="yellow" onClick={applyEdit} isDisabled={!editValid}>
                {editChangesIt ? "Correct this box" : "Keep the sheet's figure"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </FloatingWindow>
  );
};

export default ImportTally;
