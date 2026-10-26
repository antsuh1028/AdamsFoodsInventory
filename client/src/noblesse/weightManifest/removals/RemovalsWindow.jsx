// Everything taken off a tally: voids, restores, deleted sessions, unmerged manifests.

import { Badge, Box, Button, Flex, IconButton, Spinner, Text } from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon } from "@chakra-ui/icons";
import { DeletedBoxes } from "./DeletedBoxes";
import { DetailGrid } from "./DetailGrid";
import FloatingWindow from "../../../components/FloatingWindow";
import { MemberSessions } from "../dialogs/MemberSessions";
import { REMOVAL_COLOR, REMOVAL_LABEL } from "../constants";

const RemovalsWindow = ({ expandedRemovalId, loadRemovals, removals, setExpandedRemovalId, setShowRemovals, showRemovals }) => (
  <FloatingWindow
    isOpen={showRemovals}
    onClose={() => setShowRemovals(false)}
    title="Removal history"
    width={860}
    footer={
      <Flex justify="space-between" width="100%" gap={2} wrap="wrap">
        <Button size="sm" variant="outline" onClick={loadRemovals}>Refresh</Button>
        <Button size="sm" onClick={() => setShowRemovals(false)}>Close</Button>
      </Flex>
    }
  >
    {removals === null ? (
      <Flex justify="center" py={8}><Spinner size="md" color="blue.500" /></Flex>
    ) : removals.length === 0 ? (
      <Box p={4} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
        <Text fontSize="sm" color="gray.600">
          Nothing has been removed yet. From here on, every void, erased box,
          deleted session and removed manifest is recorded here.
        </Text>
      </Box>
    ) : (
      <>
      <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden">
        {removals.map((r, i) => {
          const d = r.details || null;
          // Three shapes reach this: a session delete logs
          // { batch, items }, a manifest removal { group, batches }, and a
          // single box logs the row itself.
          const items  = Array.isArray(d?.items) ? d.items : null;
          const members = Array.isArray(d?.batches) ? d.batches : null;
          const head = d?.batch || d?.group || (items || members ? null : d);
          const open = expandedRemovalId === r.id;
          return (
            <Box key={r.id} bg={i % 2 ? "gray.50" : "white"}
              borderBottom={i === removals.length - 1 ? "none" : "1px solid"}
              borderColor="gray.100">
              <Flex px={3} py={2} gap={3} align="baseline" wrap="wrap"
                cursor={d ? "pointer" : "default"}
                onClick={() => d && setExpandedRemovalId(open ? null : r.id)}>
                {d ? (
                  <IconButton
                    aria-label={open ? "Hide what was recorded" : "Show what was recorded"}
                    icon={open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                    size="xs" variant="ghost" alignSelf="center"
                    colorScheme={open ? "blue" : "gray"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedRemovalId(open ? null : r.id);
                    }}
                  />
                ) : (
                  <Box width="24px" />
                )}
                <Badge fontSize="9px" colorScheme={REMOVAL_COLOR[r.action] || "gray"}>
                  {REMOVAL_LABEL[r.action] || r.action}
                </Badge>
                {r.lot_number && (
                  <Text fontSize="sm" fontWeight="600" color="gray.700">{r.lot_number}</Text>
                )}
                <Text fontSize="sm" color="gray.700">{r.summary}</Text>
                {r.reason && (
                  <Text fontSize="xs" color="gray.500" fontStyle="italic">“{r.reason}”</Text>
                )}
                <Text fontSize="xs" color="gray.500" ml="auto" whiteSpace="nowrap">
                  {r.performed_by ? `${r.performed_by} · ` : ""}
                  {new Date(r.created_at).toLocaleString()}
                </Text>
              </Flex>

              {open && d && (
                <Box px={4} pb={3} pt={2} bg="white"
                  borderTop="1px solid" borderColor="gray.200">
                  {head && <DetailGrid data={head} />}
                  {items && <DeletedBoxes items={items} />}
                  {members && <MemberSessions rows={members} />}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Text fontSize="xs" color="gray.400" mt={2}>
        Expand an entry to see everything that was recorded — for a deleted
        session, that includes every box weight, and it is the only copy left.
      </Text>
      </>
    )}
  </FloatingWindow>
);

export default RemovalsWindow;
