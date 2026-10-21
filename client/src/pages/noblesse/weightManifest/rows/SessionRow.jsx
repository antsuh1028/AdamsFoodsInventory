// One weighing session, opening to its boxes and editor.

import React from "react";
import { Badge, Box, Button, Checkbox, Flex, IconButton, Spinner, Text } from "@chakra-ui/react";
import { COLUMNS, totalsText } from "../constants";
import { ChevronDownIcon, ChevronUpIcon } from "@chakra-ui/icons";
import FlagSession from "../../FlagSession";
import { ManifestEditor } from "../editor/ManifestEditor";
import ScanSheet from "../../../../components/navbar/ScanSheet";
import axiosInstance from "../../../../utils/axiosInstance";
import { fmtDate, fmtDateTime } from "../../shared";

const SessionRow = ({ details, expandedId, fetchBatches, handlersFor, i, isAdmin, isToday, isUnseen, loadingId, print, row, rowBusy, selected, setConfirmDeleteBatch, setDetails, setScannerAdopt, setScannerOpen, toggleExpand, toggleSelected }) => {
  const b = row.batch;
  const open = expandedId === b.batch_id;
  const detail = details[b.batch_id];
  // Composed with today's green rather than competing with it: a
  // row is often BOTH. Today keeps the background and the left
  // edge; unseen adds the dot and the NEW pill, and only claims
  // the left edge when today has not.
  const isNew = isUnseen(row.key);
  return (
    <React.Fragment key={row.key}>
      {/* Flagged wins over today's green: the whole point is that
          it is the row that stands out. It still counts in every
          total — a flag is a request, not a removal. */}
      <Box as="tr"
        bg={b.flagged_at ? "red.50" : isToday(b) ? "green.50" : i % 2 ? "gray.50" : "white"}
        _hover={{ bg: b.flagged_at ? "red.100" : isToday(b) ? "green.100" : "blue.50" }}
        cursor="pointer" onDoubleClick={() => toggleExpand(b)}>
        {/* Centred on the td, not the Checkbox: Chakra renders the
            control as an inline-flex label, so textAlign is what
            moves it. alignSelf does nothing here — a table cell is
            not a flex container for it to align against. */}
        <Box as="td" px={2} py={2} textAlign="center"
          borderBottom="1px solid" borderColor="gray.100"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}>
          <Checkbox size="sm" isChecked={selected.has(b.batch_id)} borderColor="gray.500"
            onChange={() => toggleSelected(b.batch_id)}
            aria-label={`Select ${b.lot_number || b.batch_id}`} />
        </Box>
        <Box as="td" px={3} pl={row.child ? 10 : 3} py={2} fontSize="sm" fontWeight="600" color="blue.700"
          borderBottom="1px solid" borderColor="gray.100"
          borderLeft={isToday(b) || isNew ? "4px solid" : undefined}
          borderLeftColor={isToday(b) ? "green.500" : isNew ? "blue.400" : undefined}>
          <Flex align="center" gap={2}>
            <IconButton
              aria-label={open ? "Collapse" : "Expand"}
              title={open ? "Collapse" : "Expand"}
              icon={open ? <ChevronUpIcon /> : <ChevronDownIcon />}
              size="xs" variant="ghost"
              colorScheme={open ? "blue" : "gray"}
              onClick={(e) => { e.stopPropagation(); toggleExpand(b); }}
              onDoubleClick={(e) => e.stopPropagation()}
            />
            {/* A dot rather than more colour on the row: a NEW row
                that is also today's must still read as today's. */}
            {isNew && (
              <Box as="span" width="7px" height="7px" borderRadius="full"
                bg="blue.500" flexShrink={0} title="Not opened on this device yet" />
            )}
            <Text as="span">{b.lot_number || `Batch ${b.batch_id}`}</Text>
            {isNew && (
              <Badge colorScheme="blue" fontSize="9px" px={1.5} borderRadius="full">
                NEW
              </Badge>
            )}
          </Flex>
        </Box>
        <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
          borderBottom="1px solid" borderColor="gray.100">{b.vendor || "—"}</Box>
        <Box as="td" px={3} py={2} fontSize="sm" color="gray.700"
          borderBottom="1px solid" borderColor="gray.100">{b.item_description || "—"}</Box>
        <Box as="td" px={3} py={2} fontSize="sm" color="gray.700" whiteSpace="nowrap"
          borderBottom="1px solid" borderColor="gray.100"
          title={b.weighed_on ? `Entered ${fmtDateTime(b.created_at)}` : undefined}>
          {/* The day weighed, when set after the fact; else when opened. */}
          {b.weighed_on ? fmtDate(b.weighed_on) : fmtDateTime(b.created_at)}
          {isToday(b) && (
            <Badge ml={2} colorScheme="green" fontSize="9px" px={1.5} borderRadius="full">TODAY</Badge>
          )}
        </Box>
        <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
          borderBottom="1px solid" borderColor="gray.100">{b.box_count}</Box>
        <Box as="td" px={3} py={2} fontSize="sm" textAlign="right" color="gray.700"
          whiteSpace="nowrap" style={{ fontVariantNumeric: "tabular-nums" }}
          borderBottom="1px solid" borderColor="gray.100">{totalsText(b.totals)}</Box>
        <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100">
          <Flex gap={1} wrap="wrap">
            <Badge colorScheme={b.status === "closed" ? "green" : "yellow"} fontSize="10px">
              {b.status === "closed" ? "Closed" : "Open"}
            </Badge>
            {/* A barcode-verified lot and one keyed in by hand
                carry different confidence. */}
            {b.source === "imported" && (
              <Badge colorScheme="teal" fontSize="10px">Imported</Badge>
            )}
          </Flex>
        </Box>
        <Box as="td" px={3} py={2} borderBottom="1px solid" borderColor="gray.100" textAlign="right">
          <Flex gap={2} justify="flex-end">
            <Button size="xs" variant="outline" colorScheme="blue"
              isDisabled={!b.box_count}
              onClick={(e) => { e.stopPropagation(); print(b); }}>
              Print
            </Button>
            {/* Anyone may raise it — the person who noticed is
                usually the one who weighed it, and they cannot
                delete. Clearing is open for the same reason. */}
            <FlagSession batch={b} onChanged={fetchBatches} />
            {/* Deletes the whole session, boxes and all. Admin
                only, and gated server-side too. */}
            {isAdmin && (
              <Button size="xs" variant="ghost" colorScheme="red"
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteBatch(b); }}>
                Delete
              </Button>
            )}
          </Flex>
        </Box>
      </Box>

      {open && (
        <Box as="tr">
          <Box as="td" colSpan={COLUMNS.length + 2} style={{ padding: 0 }}
            bg="blue.50" borderTop="2px solid" borderColor="blue.300">
            <Box p={4}>
              {loadingId === b.batch_id ? (
                <Flex justify="center" py={6}><Spinner size="sm" color="blue.500" /></Flex>
              ) : detail ? (
                <>
                  {/* Brand, EST and grade are captured at weighing
                      and deliberately kept OFF the printed
                      manifest, so this is the only place they can
                      be read back. Without it they would be
                      write-only — recorded and unreachable.
                      Hidden entirely when none were entered,
                      rather than showing a row of dashes. */}
                  <ManifestEditor
                    batchId={b.batch_id}
                    detail={detail}
                    onReopened={(id) => {
                      // Hand the reopened session straight to the
                      // scanner, already loaded.
                      setScannerAdopt(id);
                      setScannerOpen(true);
                    }}
                    onChanged={async () => {
                      // The heading, the boxes and the row's own
                      // count and total can all have moved, so
                      // both the detail and the listing reload.
                      const { data } = await axiosInstance
                        .get(`/box-batches/${b.batch_id}`);
                      setDetails((prev) => ({ ...prev, [b.batch_id]: data }));
                      await fetchBatches();
                    }}
                  />
                  <ScanSheet scans={detail.items}
                    busyId={rowBusy} {...handlersFor(b)} />
                </>
              ) : null}
            </Box>
          </Box>
        </Box>
      )}
    </React.Fragment>
  );
};

export default SessionRow;
