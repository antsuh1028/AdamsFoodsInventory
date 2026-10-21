// A merged manifest, opening to every box in one sheet.

import React from "react";
import { Badge, Box, Button, Flex, IconButton, Spinner, Text } from "@chakra-ui/react";
import { COLUMNS } from "../constants";
import { ChevronDownIcon, ChevronUpIcon } from "@chakra-ui/icons";
import ScanSheet from "../../../../components/navbar/ScanSheet";

const MergedRow = ({ expandedGroupId, groupDetails, i, isAdmin, isUnseen, printGroup, row, setConfirmDeleteGroup, toggleGroup }) => {
  const g = row.group;
  const gOpen = expandedGroupId === g.group_id;
  const gDetail = groupDetails[g.group_id];
  return (
    <React.Fragment key={row.key}>
      <Box as="tr" bg={i % 2 ? "teal.50" : "white"}
        _hover={{ bg: "teal.100" }} cursor="pointer"
        onDoubleClick={() => toggleGroup(g)}>
        <Box as="td" px={2} py={2} borderBottom="1px solid" borderColor="gray.100" />
        <Box as="td" px={3} py={2} fontSize="sm" fontWeight="600" color="teal.800"
          borderBottom="1px solid" borderColor="gray.100"
          borderLeft="4px solid" borderLeftColor="teal.500">
          <Flex align="center" gap={2}>
            <IconButton
              aria-label={gOpen ? "Collapse" : "Expand"}
              icon={gOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
              size="xs" variant="ghost" colorScheme={gOpen ? "teal" : "gray"}
              onClick={(e) => { e.stopPropagation(); toggleGroup(g); }}
              onDoubleClick={(e) => e.stopPropagation()}
            />
            {/* The teal left edge is what marks a row as a
                merged manifest, so an unseen one takes the dot
                and the pill and leaves that edge alone. */}
            {isUnseen(row.key) && (
              <Box as="span" width="7px" height="7px" borderRadius="full"
                bg="blue.500" flexShrink={0} title="Not opened on this device yet" />
            )}
            <Text as="span">{g.name || g.lot_number || `Manifest ${g.group_id}`}</Text>
            {isUnseen(row.key) && (
              <Badge colorScheme="blue" fontSize="9px" px={1.5} borderRadius="full">
                NEW
              </Badge>
            )}
          </Flex>
        </Box>
        <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
          borderBottom="1px solid" borderColor="gray.100">{g.vendor || "—"}</Box>
        <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
          borderBottom="1px solid" borderColor="gray.100">{g.item_description || "—"}</Box>
        <Box as="td" px={3} py={2} fontSize="sm" color="gray.700" whiteSpace="nowrap"
          borderBottom="1px solid" borderColor="gray.100">
          {row.at ? new Date(row.at).toLocaleString() : "—"}
        </Box>
        <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
          borderBottom="1px solid" borderColor="gray.100">{g.box_count}</Box>
        <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
          whiteSpace="nowrap" style={{ fontVariantNumeric: "tabular-nums" }}
          borderBottom="1px solid" borderColor="gray.100">{g.total} LB</Box>
        <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100">
          <Badge colorScheme="teal" fontSize="10px">
            Merged · {g.session_count}
          </Badge>
        </Box>
        <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100"
          textAlign="right">
          <Flex gap={2} justify="flex-end">
            <Button size="xs" variant="outline" colorScheme="blue"
              onClick={(e) => { e.stopPropagation(); printGroup(g); }}>
              Print
            </Button>
            {isAdmin && (
              <Button size="xs" variant="ghost" colorScheme="red"
                title="Unmerge — the sessions come back as their own rows"
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteGroup(g); }}>
                Unmerge
              </Button>
            )}
          </Flex>
        </Box>
      </Box>

      {gOpen && (
        <Box as="tr">
          <Box as="td" colSpan={COLUMNS.length + 2} style={{ padding: 0 }}
            bg="teal.50" borderTop="2px solid" borderColor="teal.300">
            <Box p={4}>
              {!gDetail ? (
                <Flex justify="center" py={6}><Spinner size="sm" color="teal.500" /></Flex>
              ) : (
                <>
                  <Text fontSize="xs" color="gray.600" mb={2}>
                    {gDetail.sessions.length} session
                    {gDetail.sessions.length === 1 ? "" : "s"} merged —
                    {" "}{gDetail.sessions.map((x) => x.lot_number || `batch ${x.batch_id}`).join(", ")}
                  </Text>
                  <ScanSheet scans={gDetail.items} />
                </>
              )}
            </Box>
          </Box>
        </Box>
      )}
    </React.Fragment>
  );
};

export default MergedRow;
