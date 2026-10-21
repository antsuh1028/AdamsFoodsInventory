// Confirming an unmerge.

import { AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, Box, Button, Text } from "@chakra-ui/react";

const UnmergeDialog = ({ cancelDeleteGroupRef, confirmDeleteGroup, deleteGroup, setConfirmDeleteGroup }) => (
  <AlertDialog
    isOpen={Boolean(confirmDeleteGroup)}
    leastDestructiveRef={cancelDeleteGroupRef}
    onClose={() => setConfirmDeleteGroup(null)}
    isCentered
  >
    <AlertDialogOverlay>
      <AlertDialogContent>
        <AlertDialogHeader fontSize="lg" fontWeight="bold">
          Remove this merged manifest?
        </AlertDialogHeader>
        <AlertDialogBody>
          {confirmDeleteGroup && (
            <>
              <Text fontSize="sm" mb={3}>
                The merged form goes. The weighing sessions it covered, and every
                box in them, are left untouched — only the grouping is removed.
              </Text>
              <Box px={3} py={2} bg="gray.50" borderRadius="md"
                border="1px solid" borderColor="gray.200">
                <Text fontSize="sm" fontWeight="bold" color="red.800">
                  {confirmDeleteGroup.name || confirmDeleteGroup.lot_number
                    || `Manifest ${confirmDeleteGroup.group_id}`}
                </Text>
                <Text fontSize="sm" color="gray.700" mt={1}>
                  {confirmDeleteGroup.session_count} session
                  {confirmDeleteGroup.session_count === 1 ? "" : "s"}
                  {" · "}{confirmDeleteGroup.box_count} boxes
                </Text>
              </Box>
            </>
          )}
        </AlertDialogBody>
        <AlertDialogFooter gap={2}>
          <Button ref={cancelDeleteGroupRef} onClick={() => setConfirmDeleteGroup(null)}>
            Go back
          </Button>
          <Button colorScheme="red" onClick={() => deleteGroup(confirmDeleteGroup)}>
            Unmerge manifest
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogOverlay>
  </AlertDialog>
);

export default UnmergeDialog;
