// Editing an open manifest: its heading and each box.

import { useEffect, useRef, useState } from "react";
import upperInput from "../../../utils/upperInput";
import { Box, Flex, Text, Button, Badge, Input, Textarea, Alert, AlertIcon, useToast, AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader, AlertDialogContent, AlertDialogOverlay } from "@chakra-ui/react";
import axiosInstance from "../../../utils/axiosInstance";
import { fmtDate, today } from "../../common/shared";
import getRole from "../../../utils/getRole";
import LotPicker from "../../lots/LotPicker";

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

const lotOf = (d) => ({ lotId: d.lot_id ?? null, lotNumber: d.lot_number || "" });

const ManifestEditor = ({ batchId, detail, onChanged, onReopened }) => {
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

  // The lot is a registry pick, not text, so it is held apart from the draft.
  const [lot, setLot] = useState(() => lotOf(detail));
  // "" = the day the session was opened; a date = weighed on that day instead.
  const [weighedOn, setWeighedOn] = useState(() => detail.weighed_on || "");

  // Re-seed when a different session is expanded, or the detail is refetched.
  useEffect(() => {
    setDraft(fromDetail(detail)); setLot(lotOf(detail));
    setWeighedOn(detail.weighed_on || ""); setEditing(false);
  }, [detail, batchId]);

  // Read here rather than passed down: this component is rendered per row, and
  // threading the role through every one of them only creates a chance for the
  // two to disagree. Courtesy only — the server decides.
  const isAdmin = getRole() === "admin";
  const mayEdit = detail.status !== "closed" || isAdmin;
  const original = fromDetail(detail);
  const lotChanged = lot.lotId !== null && lot.lotId !== (detail.lot_id ?? null);
  const dateChanged = weighedOn !== (detail.weighed_on || "");
  const dirty = lotChanged || dateChanged
    || Object.keys(draft).some((k) => draft[k].trim() !== original[k].trim());

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: upperInput(e) }));

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
      if (lotChanged) changed.lotId = lot.lotId;
      if (dateChanged) changed.weighedOn = weighedOn || null;
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
      // Straight into the scanner, on this session. Reopening is never the goal
      // in itself — scanning the missing boxes is — so making someone open the
      // scanner and find the lot again is a step with no purpose.
      onReopened(batchId);
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
          <Badge colorScheme={mayEdit ? "blue" : "gray"} fontSize="9px">
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
          <Box mb={3} maxW="420px">
            <Text fontSize="10px" color="gray.500" textTransform="uppercase" mb={1}>
              Lot
            </Text>
            <LotPicker
              allowCreate
              value={lot.lotId}
              lotNumber={lot.lotNumber}
              onChange={(picked) => setLot(picked
                ? { lotId: picked.lotId, lotNumber: picked.lotNumber }
                : lotOf(detail))}
            />
            {/* Said up front: the server refuses the move, and names the holder. */}
            {lotChanged && (
              <Text fontSize="xs" color="gray.600" mt={1}>
                Moves every box on this session to {lot.lotNumber}. Refused while a
                registration form, a load or a merged manifest still counts it —
                untie it there first.
              </Text>
            )}
          </Box>
          {/* For a session entered after the fact: the day the boxes were on the
              scale, which is what prints and what the lot counts. */}
          <Box mb={3} maxW="220px">
            <Text fontSize="10px" color="gray.500" textTransform="uppercase" mb={1}>
              Weighed on
            </Text>
            {/* Blank shows the day it was OPENED — not weighedDay(), which
                would still show the saved date and ignore the reset below. */}
            <Input type="date" size="sm" bg="white" max={today()}
              value={weighedOn || (detail.created_at ? today(new Date(detail.created_at)) : "")}
              onChange={(e) => setWeighedOn(e.target.value)} />
            {weighedOn && (
              <Button size="xs" variant="link" colorScheme="blue" mt={1}
                onClick={() => setWeighedOn("")}>
                Use the day it was opened
              </Button>
            )}
          </Box>
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
              onClick={() => {
                setDraft(fromDetail(detail)); setLot(lotOf(detail));
                setWeighedOn(detail.weighed_on || ""); setEditing(false);
              }}>
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
            ["Remarks", original.remarks],
            // Only worth saying when someone set it; otherwise it is the date
            // already on the row above.
            ["Weighed on", detail.weighed_on ? fmtDate(detail.weighed_on) : ""]]
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
      {/* Open to everyone: closing a pallet too early is the operator's own
          mistake, and they cannot fix it alone if this is admin-only. The
          server refuses once the session is on a merged manifest, a
          registration form or a load — that refusal is the control, not this. */}
      <Flex gap={3} align="center" mt={3} pt={3} wrap="wrap"
          borderTop="1px solid" borderColor="gray.200">
          {detail.status === "closed" ? (
            <>
              <Button size="sm" colorScheme="yellow" variant="outline"
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
              <Button colorScheme="yellow" isLoading={reopening} onClick={reopen}>
                Reopen
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
};

export { HEADER_FIELDS, fromDetail, lotOf, ManifestEditor };
