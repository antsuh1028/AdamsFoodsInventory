import React, { useRef, useState } from "react";
import {
  Button, Text, Textarea, Alert, AlertIcon, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import { translator } from "../../utils/i18n";

// "This one is wrong" — raised at the bench, acted on by an admin.
//
// Lives in both the Weight Manifests tab and Outgoing, so it owns its own
// button, dialog and request rather than each tab keeping a copy of all three.
//
// A flag REMOVES NOTHING. The session keeps counting in every total and on
// every printed manifest until somebody with the authority to delete it does.
// Deleting is admin-only; if flagging took weight out of a total it would be
// that gate under another name.

// A prop rather than the shared language, like LotTimeline: Outgoing passes its
// own and the Weight Manifests tab stays English.
const ENGLISH = translator("en");

const FlagSession = ({ batch, onChanged, size = "xs", t = ENGLISH }) => {
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
        title: clear ? t("Flag cleared") : t("Flagged"),
        description: clear
          ? t("The session is back to normal.")
          : t("Nothing was removed — an admin decides what happens to it."),
      });
      setOpen(false);
      setReason("");
      if (onChanged) await onChanged();
    } catch (err) {
      toast({
        status: "error", position: "top", duration: 6000, isClosable: true,
        title: clear ? t("Could not clear the flag") : t("Could not flag it"),
        description: err.response?.data?.error || err.message,
      });
    } finally { setBusy(false); }
  };

  const tooltip = flagged
    ? [
        batch.flagged_by
          ? t("Flagged by {who}", { who: batch.flagged_by })
          : t("Flagged"),
        batch.flag_reason || null,
      ].filter(Boolean).join(" — ")
    : t("Flag this session as a mistake");

  return (
    <>
      <Button
        size={size}
        variant={flagged ? "solid" : "ghost"}
        colorScheme={flagged ? "red" : "gray"}
        title={tooltip}
        onClick={(e) => {
          e.stopPropagation();
          setReason(batch.flag_reason || "");
          setOpen(true);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {flagged ? t("Flagged") : t("Flag")}
      </Button>

      <AlertDialog isOpen={open} leastDestructiveRef={cancelRef}
        onClose={() => setOpen(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {flagged ? t("This session is flagged") : t("Flag this session?")}
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={3}>
                <b>{batch.lot_number || t("Session {id}", { id: batch.batch_id })}</b>
                {batch.box_count != null && (
                  <> — {t(Number(batch.box_count) === 1 ? "{n} box" : "{n} boxes",
                    { n: batch.box_count })}</>
                )}
              </Text>

              {flagged ? (
                <Alert status="warning" borderRadius="md" fontSize="sm" py={2} mb={3}>
                  <AlertIcon />
                  <Text>
                    {batch.flagged_by
                      ? t("Raised by {who}.", { who: batch.flagged_by })
                      : t("Already flagged.")}
                    {batch.flag_reason
                      ? ` ${t("Reason: {reason}", { reason: batch.flag_reason })}`
                      : null}
                  </Text>
                </Alert>
              ) : (
                <Alert status="info" borderRadius="md" fontSize="sm" py={2} mb={3}>
                  <AlertIcon />
                  <Text>
                    {t("This removes nothing. The session keeps counting until an admin looks at it — it just shows up in red, and on the daily report, so somebody does.")}
                  </Text>
                </Alert>
              )}

              <Text fontSize="xs" color="gray.500" textTransform="uppercase" mb={1}>
                {t("What is wrong with it?")}
              </Text>
              <Textarea size="sm" rows={2} value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("Weighed the wrong pallet, double-counted, wrong lot…")} />
            </AlertDialogBody>
            <AlertDialogFooter gap={2} flexWrap="wrap">
              <Button ref={cancelRef} onClick={() => setOpen(false)}>
                {t("Cancel")}
              </Button>
              {flagged && (
                <Button variant="outline" onClick={() => send(true)} isDisabled={busy}>
                  {t("Clear the flag")}
                </Button>
              )}
              <Button colorScheme="red" onClick={() => send(false)} isLoading={busy}>
                {flagged ? t("Update the reason") : t("Flag it")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
};

export default FlagSession;
