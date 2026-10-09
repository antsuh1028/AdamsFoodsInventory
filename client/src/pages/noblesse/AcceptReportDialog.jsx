import React, { useEffect, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader,
  AlertDialogBody, AlertDialogFooter, Button, Box, Flex, Text, Select,
} from "@chakra-ui/react";
import { fmtDate, PROCESSING_TYPES } from "./shared";

// Reception's check before a report moves stock: the figures, then an optional type.

const Row = ({ label, children }) => (
  <Flex gap={3} py={1} borderBottom="1px solid" borderColor="gray.100" align="baseline">
    <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide"
      w="120px" flexShrink={0}>{label}</Text>
    <Text fontSize="sm" color="gray.800" style={{ fontVariantNumeric: "tabular-nums" }}>
      {children || "—"}
    </Text>
  </Flex>
);

const AcceptReportDialog = ({ report, isOpen, busy, onCancel, onAccept }) => {
  const cancelRef = useRef(null);
  const [type, setType] = useState("");

  // Starts from whatever the floor chose, so reception only changes it if it is wrong.
  const reportId = report?.reportId;
  const floorType = report?.processingType || "";
  useEffect(() => { if (isOpen) setType(floorType); }, [isOpen, reportId, floorType]);

  if (!report) return null;
  const r = report;
  const time = [r.startTime, r.endTime].filter(Boolean).join(" to ");

  return (
    <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onCancel} isCentered size="lg">
      <AlertDialogOverlay>
        <AlertDialogContent>
          <AlertDialogHeader fontSize="lg" fontWeight="bold">
            Check before accepting
          </AlertDialogHeader>
          <AlertDialogBody>
            <Text fontSize="sm" mb={3}>
              Accepting takes <b>{r.inputCases ?? 0} case{r.inputCases === 1 ? "" : "s"}</b> off
              {" "}<b>{r.lotNumber || "the lot"}</b>
              {r.lotKind === "further"
                ? <> (back from the freezer) and adds a run to <b>{r.parentLotNumber}</b>&apos;s registration form.
                    It does not change {r.parentLotNumber}&apos;s remaining cases.</>
                : " and adds a run to its registration form."}
            </Text>
            <Box mb={4}>
              <Row label="Date">{fmtDate(r.processingDate)}{time ? ` · ${time}` : ""}</Row>
              <Row label="Line">{r.lineNo}</Row>
              <Row label="Cases in / out">{`${r.inputCases ?? "—"} / ${r.outputCases ?? "—"}`}</Row>
              <Row label="Inedible">{r.inedibleWeight ? `${r.inedibleWeight} lb` : null}</Row>
              {/* Accepting also writes the freezer row, so it is checked here with the rest. */}
              {r.fpCases > 0 && (
                <Row label="To the freezer">
                  {`${r.fpCases} cs${r.fpItem ? ` ${r.fpItem}` : ""}, onto `
                    + (r.lotKind === "further" ? r.lotNumber : `FP${String(r.lotNumber || "").slice(1)}`)}
                </Row>
              )}
              <Row label="Pack dates">{(r.packDates || []).map(fmtDate).join(", ")}</Row>
              <Row label="Product">{r.description}</Row>
              <Row label="Ran it">{(r.workers || []).join(", ")}</Row>
              <Row label="Submitted by">{r.submittedBy}</Row>
              {r.notes && <Row label="Notes">{r.notes}</Row>}
            </Box>
            <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide" mb={1}>
              Processing type (optional)
            </Text>
            <Select size="sm" value={type} onChange={(e) => setType(e.target.value)}
              placeholder="Leave blank">
              {PROCESSING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </AlertDialogBody>
          <AlertDialogFooter gap={2}>
            <Button ref={cancelRef} onClick={onCancel}>Go back</Button>
            <Button colorScheme="blue" isLoading={busy} onClick={() => onAccept(type)}>
              Accept and take the cases
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
};

export default AcceptReportDialog;
