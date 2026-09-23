import React, { useRef, useState } from "react";
import {
  Button, Text, Textarea, Alert, AlertIcon, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";

// "This one is wrong" — raised at the bench, acted on by an admin.
//
// Lives in both the Weight Manifests tab and Outgoing, so it owns its own
// button, dialog and request rather than each tab keeping a copy of all three.
//
// A flag REMOVES NOTHING. The session keeps counting in every total and on
// every printed manifest until somebody with the authority to delete it does.
// Deleting is admin-only; if flagging took weight out of a total it would be
// that gate under another name.

const FlagSession = ({ batch, onChanged, size = "xs" }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(null);
  const toast = useToast();

  if (!batch) return null;
  const flagged = Boolean(batch.flagged_at);

  const send = async (clear) => {
    setBusy(true);
    try {
      await axiosInstance.post(`/box-batches/${batch.batch_id}/flag`,
        clear ? { clear: true } : { reason: reason.trim() || null });
      toast({
        status: clear ? "info" : "success", position: "top", duration: 4000,
        title: clear ? "Flag cleared" : "Marked as a mistake",
        description: clear
          ? "The session is back to normal."
          : "Nothing was removed — an admin decides what happens to it.",
      });
      setOpen(false);
      setReason("");
      if (onChanged) await onChanged();
    } catch (err) {
      toast({
        status: "error", position: "top", duration: 6000, isClosable: true,
        title: clear ? "Could not clear the flag" : "Could not mark it",
        description: err.response?.data?.error || err.message,
      });
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button
        size={size}
        variant={flagged ? "solid" : "ghost"}
        colorScheme={flagged ? "red" : "gray"}
        title={flagged
          ? `Flagged${batch.flagged_by ? ` by ${batch.flagged_by}` : ""}`
            + `${batch.flag_reason ? `: ${batch.flag_reason}` : ""}`
          : "Mark this session as a mistake"}
        onClick={(e) => { e.stopPropagation(); setReason(batch.flag_reason || ""); setOpen(true); }}
      >
        {flagged ? "Flagged" : "Mistake?"}
      </Button>

      <AlertDialog isOpen={open} leastDestructiveRef={cancelRef}
        onClose={() => setOpen(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {flagged ? "This session is flagged" : "Mark this session as a mistake?"}
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={3}>
                <b>{batch.lot_number || `Session ${batch.batch_id}`}</b>
                {batch.box_count != null && ` — ${batch.box_count} boxes`}
              </Text>

              {flagged ? (
                <Alert status="warning" borderRadius="md" fontSize="sm" py={2} mb={3}>
                  <AlertIcon />
                  <Text>
                    Raised{batch.flagged_by ? <> by <b>{batch.flagged_by}</b></> : null}.
                    {batch.flag_reason ? <> Reason: “{batch.flag_reason}”.</> : null}
                  </Text>
                </Alert>
              ) : (
                <Alert status="info" borderRadius="md" fontSize="sm" py={2} mb={3}>
                  <AlertIcon />
                  <Text>
                    This <b>removes nothing</b>. The session keeps counting until an
                    admin looks at it — it just shows up in red, and on the daily
                    report, so somebody does.
                  </Text>
                </Alert>
              )}

              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>
                What is wrong with it?
              </Text>
              <Textarea size="sm" rows={2} value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Weighed the wrong pallet, double-counted, wrong lot…" />
            </AlertDialogBody>
            <AlertDialogFooter gap={2} flexWrap="wrap">
              <Button ref={cancelRef} onClick={() => setOpen(false)}>Cancel</Button>
              {flagged && (
                <Button variant="outline" onClick={() => send(true)} isDisabled={busy}>
                  Clear the flag
                </Button>
              )}
              <Button colorScheme="red" onClick={() => send(false)} isLoading={busy}>
                {flagged ? "Update the reason" : "Mark as a mistake"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
};

export default FlagSession;
