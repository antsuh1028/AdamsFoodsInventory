import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Alert, AlertIcon, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";

// Deleting a whole weighing session, from the manifest list or from Outgoing.
//
// Shared rather than copied because the BLOCKER LIST is the point: the server
// refuses while a merged manifest, a registration form or a shipment still
// references the session, and this says which and where to go. A second copy
// is how one screen ends up missing the blocker that was added last and hands
// someone a bare 409 with nowhere to go.

const totalsText = (totals) =>
  Array.isArray(totals) && totals.length
    ? totals.map((t) => `${t.total} ${t.unit}`).join("  ·  ")
    : "—";

const DeleteBatchDialog = ({ batch, onClose, onDeleted, shipmentHint }) => {
  const toast = useToast();
  const cancelRef = useRef(null);
  const [deleting, setDeleting] = useState(false);
  // null while loading, so the button waits rather than reading "nothing found
  // yet" as "nothing holds it".
  const [blockers, setBlockers] = useState(null);

  const batchId = batch && batch.batch_id;

  const load = useCallback(async () => {
    if (!batchId) return;
    setBlockers(null);
    try {
      const { data } = await axiosInstance.get(`/box-batches/${batchId}/references`);
      setBlockers(data);
    } catch {
      // The delete is guarded server-side and will say no, so a failed lookup
      // leaves the button live rather than trapping someone behind it.
      setBlockers({ groups: [], forms: [], shipments: [], deletable: true, unknown: true });
    }
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    setDeleting(true);
    try {
      const { data } = await axiosInstance.delete(`/box-batches/${batchId}`);
      toast({
        title: "Session deleted",
        description: `${batch.lot_number || `Batch ${batchId}`} and its ${data.boxesDeleted} box(es) are gone.`,
        status: "success", duration: 4000, position: "top",
      });
      onClose();
      if (onDeleted) await onDeleted(batchId);
    } catch (err) {
      toast({
        title: "Could not delete that session",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 8000, position: "top", isClosable: true,
      });
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog isOpen={Boolean(batch)} leastDestructiveRef={cancelRef}
      onClose={onClose} isCentered>
      <AlertDialogOverlay>
        <AlertDialogContent>
          <AlertDialogHeader fontSize="lg" fontWeight="bold">
            Delete this whole session?
          </AlertDialogHeader>
          <AlertDialogBody>
            {batch && (
              <>
                <Text fontSize="sm" mb={3}>
                  This removes the session and every box weighed in it. It cannot
                  be undone.
                </Text>
                <Box px={3} py={2} bg="gray.50" borderRadius="md"
                  border="1px solid" borderColor="gray.200">
                  <Flex gap={3} align="baseline" wrap="wrap">
                    <Text fontSize="sm" fontWeight="bold" color="red.800">
                      {batch.lot_number || `Batch ${batchId}`}
                    </Text>
                    {batch.vendor && (
                      <Text fontSize="sm" color="gray.600">{batch.vendor}</Text>
                    )}
                    {batch.item_description && (
                      <Text fontSize="sm" color="gray.600">{batch.item_description}</Text>
                    )}
                  </Flex>
                  <Text fontSize="sm" color="gray.700" mt={1}>
                    {batch.box_count} box{batch.box_count === 1 ? "" : "es"}
                    {" · "}{totalsText(batch.totals)}
                  </Text>
                </Box>
                {batch.status === "open" && (
                  <Text fontSize="sm" color="yellow.800" mt={3}>
                    This session is still open. If someone is weighing into it
                    right now, their work goes too.
                  </Text>
                )}

                {/* What is holding it, and where to go and undo that. Closing a
                    session does NOT clear any of these — its status and what
                    references it are separate questions, and conflating them is
                    what sends people looking in the wrong place. */}
                {blockers && !blockers.deletable && (
                  <Alert status="warning" borderRadius="md" mt={3}
                    alignItems="flex-start" py={2}>
                    <AlertIcon />
                    <Box minW={0}>
                      <Text fontSize="sm" fontWeight="600" mb={1}>
                        This cannot be deleted yet
                      </Text>
                      {blockers.groups.map((g) => (
                        <Text key={`g${g.group_id}`} fontSize="xs" color="gray.700">
                          On merged manifest <b>{g.name || g.lot_number || `#${g.group_id}`}</b>
                          {" "}— remove it from that manifest first.
                        </Text>
                      ))}
                      {blockers.forms.map((f) => (
                        <Text key={`f${f.id}`} fontSize="xs" color="gray.700">
                          Tied to registration form <b>{f.lot_number || `#${f.id}`}</b>
                          {" "}— untie it there first.
                        </Text>
                      ))}
                      {blockers.shipments.map((s) => (
                        <Text key={`s${s.shipment_id}`} fontSize="xs" color="gray.700">
                          On shipment <b>#{s.shipment_id} {s.destination_name}</b>
                          {" "}({s.status}) —{" "}
                          {s.status === "draft"
                            ? (shipmentHint || "untie it in Outgoing, or delete that draft.")
                            : "a shipped load must be cancelled first."}
                        </Text>
                      ))}
                    </Box>
                  </Alert>
                )}
              </>
            )}
          </AlertDialogBody>
          <AlertDialogFooter gap={2}>
            <Button ref={cancelRef} onClick={onClose}>Go back</Button>
            <Button colorScheme="red" onClick={remove}
              isLoading={deleting || blockers === null}
              isDisabled={Boolean(blockers && !blockers.deletable)}>
              Delete session
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
};

export default DeleteBatchDialog;
