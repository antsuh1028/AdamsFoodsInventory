// Confirming a merge, with its heading checked first.

import { Alert, AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, AlertIcon, Badge, Box, Button, Flex, Input, Text } from "@chakra-ui/react";
import { totalsText } from "../constants";
import upperInput from "../../../utils/upperInput";

const MergeDialog = ({ cancelMergeRef, confirmMerge, createGroup, mergeHeader, merging, selected, setConfirmMerge, setMergeHeader, visible }) => (
  <AlertDialog isOpen={confirmMerge} leastDestructiveRef={cancelMergeRef}
    onClose={() => setConfirmMerge(false)} isCentered>
    <AlertDialogOverlay>
      <AlertDialogContent>
        <AlertDialogHeader fontSize="lg" fontWeight="bold">
          Combine these into one manifest
        </AlertDialogHeader>
        <AlertDialogBody>
          <Text fontSize="sm" mb={3}>
            These sessions will print as a single tally sheet. Nothing is
            copied — correcting a box in a session afterwards will show on
            the next print of this manifest.
          </Text>

          {/* The heading, confirmed rather than assumed. Anywhere the
              sessions disagree is marked and the alternatives listed, so a
              vendor or BOL cannot be dropped without someone choosing. */}
          {mergeHeader && (
            <Box mb={3}>
              {Object.values(mergeHeader.conflicts).some((c) => c.conflict) && (
                <Alert status="warning" borderRadius="md" fontSize="xs" mb={2} py={2}>
                  <AlertIcon boxSize={3} />
                  These sessions do not agree on every field. Confirm what the
                  manifest should say.
                </Alert>
              )}

              {[
                ["lotNumber", "Lot #", "lot_number"],
                ["vendor", "Vendor", "vendor"],
                ["itemDescription", "Item description", "item_description"],
                ["billOfLading", "Vendor Lot #/IC#", "bill_of_lading"],
              ].map(([key, label, conflictKey]) => {
                const c = mergeHeader.conflicts[conflictKey];
                return (
                  <Box key={key} mb={2}>
                    <Flex align="baseline" gap={2} mb={1}>
                      <Text fontSize="xs" color="gray.500" textTransform="uppercase"
                        letterSpacing="wide">{label}</Text>
                      {c.conflict && (
                        <Badge colorScheme="yellow" fontSize="9px">
                          {c.values.length} different values
                        </Badge>
                      )}
                    </Flex>
                    <Input
                      size="sm"
                      bg={c.conflict ? "yellow.50" : "white"}
                      borderColor={c.conflict ? "yellow.300" : "gray.200"}
                      value={mergeHeader[key]}
                      onChange={(e) => setMergeHeader((h) => ({ ...h, [key]: upperInput(e) }))}
                    />
                    {c.conflict && (
                      <Flex gap={1} mt={1} wrap="wrap">
                        {c.values.map((v) => (
                          <Button key={v} size="xs" variant="outline" colorScheme="yellow"
                            fontWeight="400"
                            onClick={() => setMergeHeader((h) => ({ ...h, [key]: v }))}>
                            {v}
                          </Button>
                        ))}
                      </Flex>
                    )}
                  </Box>
                );
              })}

              <Box mb={2}>
                <Text fontSize="xs" color="gray.500" textTransform="uppercase"
                  letterSpacing="wide" mb={1}>Name (optional)</Text>
                <Input size="sm" bg="white" placeholder="e.g. PALLETS 1-3"
                  value={mergeHeader.name}
                  onChange={(e) => setMergeHeader((h) => ({ ...h, name: upperInput(e) }))} />
              </Box>
            </Box>
          )}
          <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden">
            {visible.filter((b) => selected.has(b.batch_id)).map((b, i) => (
              <Flex key={b.batch_id} px={3} py={2} gap={3} align="baseline"
                bg={i % 2 ? "gray.50" : "white"} wrap="wrap">
                <Text fontSize="sm" fontWeight="bold" color="red.800">
                  {b.lot_number || `Batch ${b.batch_id}`}
                </Text>
                <Text fontSize="sm" color="gray.600">{b.vendor || "—"}</Text>
                <Text fontSize="sm" color="gray.700" ml="auto">
                  {b.box_count} boxes · {totalsText(b.totals)}
                </Text>
              </Flex>
            ))}
          </Box>
        </AlertDialogBody>
        <AlertDialogFooter gap={2}>
          <Button ref={cancelMergeRef} onClick={() => setConfirmMerge(false)}>
            Go back
          </Button>
          <Button colorScheme="teal" onClick={createGroup} isLoading={merging}>
            Combine
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogOverlay>
  </AlertDialog>
);

export default MergeDialog;
