// One lot whose sessions its registration form ties together.

import { Badge, Box, Button, Flex, IconButton, Text } from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon } from "@chakra-ui/icons";
import LotMenu from "../../lots/LotMenu";

const LotRow = ({ i, openFormId, printGroup, row, rowUnseen, toggleFormGroup }) => {
  const g = row.group;
  const fOpen = openFormId === g.form_id;
  const fNew = rowUnseen(row);
  const cell = { px: 3, py: 2, fontSize: "sm", color: "gray.700",
    borderBottom: "1px solid", borderColor: "gray.100" };
  return (
    <Box as="tr" key={row.key} bg={i % 2 ? "teal.50" : "white"}
      _hover={{ bg: "teal.100" }} cursor="pointer"
      onDoubleClick={() => toggleFormGroup(g)}>
      <Box as="td" px={2} py={2} borderBottom="1px solid" borderColor="gray.100" />
      <Box as="td" {...cell} fontWeight="600" color="teal.800"
        borderLeft="4px solid" borderLeftColor="teal.500">
        <Flex align="center" gap={2}>
          <IconButton
            aria-label={fOpen ? "Collapse" : "Expand"}
            icon={fOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
            size="xs" variant="ghost" colorScheme={fOpen ? "teal" : "gray"}
            onClick={(e) => { e.stopPropagation(); toggleFormGroup(g); }}
            onDoubleClick={(e) => e.stopPropagation()}
          />
          {fNew && (
            <Box as="span" width="7px" height="7px" borderRadius="full"
              bg="blue.500" flexShrink={0} title="Not opened on this device yet" />
          )}
          {g.lot_number
            ? <LotMenu lotNumber={g.lot_number} lotId={g.lot_id ?? null} color="teal.800" />
            : <Text as="span">{`Form ${g.form_id}`}</Text>}
          {fNew && (
            <Badge colorScheme="blue" fontSize="9px" px={1.5} borderRadius="full">NEW</Badge>
          )}
        </Flex>
      </Box>
      <Box as="td" {...cell}>{g.vendor || "—"}</Box>
      <Box as="td" {...cell}>{g.item_description || "—"}</Box>
      <Box as="td" {...cell} whiteSpace="nowrap">
        {row.at ? new Date(row.at).toLocaleString() : "—"}
      </Box>
      <Box as="td" {...cell} textAlign="right">{g.box_count}</Box>
      <Box as="td" {...cell} textAlign="right" whiteSpace="nowrap"
        style={{ fontVariantNumeric: "tabular-nums" }}>{g.total} LB</Box>
      <Box as="td" {...cell}>
        <Badge colorScheme="teal" fontSize="10px"
          title={`Tied together on registration form #${g.form_id}. Untie a session there to split it back out.`}>
          One lot · {g.session_count} sessions
        </Badge>
      </Box>
      <Box as="td" {...cell} textAlign="right">
        <Button size="xs" variant="outline" colorScheme="blue"
          onClick={(e) => { e.stopPropagation(); printGroup(g); }}>
          Print
        </Button>
      </Box>
    </Box>
  );
};

export default LotRow;
