import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Alert, AlertIcon, Input, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import { fmtDate } from "./shared";
import getRole from "../../utils/getRole";

// Reception's side of the processing report.
//
// Unlike BoxWeightLink, which fills the draft and waits for a human to save,
// Accept PERSISTS IMMEDIATELY — it takes cases off the lot, so it cannot sit in
// an unsaved draft.
const ProcessingReportLink = ({ lotId, formId, onApplied }) => {
  const toast = useToast();
  const isAdmin = getRole() === "admin";
  const [reports, setReports] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!lotId) { setReports([]); return; }
    try {
      const { data } = await axiosInstance.get("/processing-reports", { params: { lotId } });
      setReports(data || []);
    } catch {
      // A reports failure must not block filling in the form itself.
    }
  }, [lotId]);

  useEffect(() => { load(); }, [load]);

  const waiting = reports.filter((r) => r.status === "submitted");
  const accepted = reports.filter((r) => r.status === "accepted");

  const run = async (report, path, body) => {
    setBusyId(report.reportId);
    try {
      await axiosInstance.post(`/processing-reports/${report.reportId}/${path}`, body || {});
      await load();
      if (onApplied) await onApplied();
      return true;
    } catch (err) {
      toast({
        status: "error", position: "top", duration: 8000, isClosable: true,
        title: path === "accept" ? "Could not accept" : "Could not update",
        description: err.response?.data?.error || err.message,
      });
      return false;
    } finally { setBusyId(null); }
  };

  if (!lotId) {
    return (
      <Text fontSize="xs" color="gray.500">
        Pick a lot to see processing reports for it.
      </Text>
    );
  }

  return (
    <Box>
      {waiting.length > 0 && (
        <Alert status="warning" borderRadius="md" fontSize="xs" mb={2} py={2}>
          <AlertIcon boxSize={3} />
          {waiting.length} processing report{waiting.length === 1 ? "" : "s"} waiting.
          {" "}Accepting takes the cases off this lot.
        </Alert>
      )}

      <Flex direction="column" gap={1} mb={2}>
        {waiting.map((r) => (
          <Box key={r.reportId} px={2} py={2} bg="white" borderRadius="sm"
            border="1px solid" borderColor="yellow.200">
            <Flex align="baseline" gap={2} wrap="wrap">
              <Text fontSize="sm" fontWeight="600" color="gray.800"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {r.inputCases} cases
              </Text>
              <Text fontSize="xs" color="gray.500">{fmtDate(r.processingDate)}</Text>
              {r.lineNo && <Badge colorScheme="gray" fontSize="9px">Line {r.lineNo}</Badge>}
              {r.workers.length > 0 && (
                <Text fontSize="xs" color="gray.500">{r.workers.join(", ")}</Text>
              )}
              <Box flex={1} />
              <Button size="xs" variant="ghost" isLoading={busyId === r.reportId}
                onClick={() => { setRejecting(r.reportId); setReason(""); }}>
                Send back
              </Button>
              <Button size="xs" colorScheme="blue" isLoading={busyId === r.reportId}
                onClick={() => run(r, "accept")}>
                Accept
              </Button>
            </Flex>
            {r.inedibleWeight && (
              <Text fontSize="xs" color="gray.500" mt={1}>
                {r.inedibleWeight} lb inedible
              </Text>
            )}
            {rejecting === r.reportId && (
              <Flex gap={2} mt={2}>
                <Input size="xs" placeholder="What is wrong with it?"
                  value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button size="xs" colorScheme="red" onClick={async () => {
                  if (await run(r, "reject", { reason: reason.trim() || null })) setRejecting(null);
                }}>
                  Send back
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
              </Flex>
            )}
          </Box>
        ))}
      </Flex>

      {accepted.length > 0 && (
        <Box>
          <Text fontSize="xs" color="gray.500" mb={1}>
            {accepted.length} accepted — each one added a row above.
          </Text>
          <Flex direction="column" gap={1}>
            {accepted.map((r) => (
              <Flex key={r.reportId} align="baseline" gap={2} wrap="wrap"
                px={2} py={1} bg="green.50" borderRadius="sm">
                <Text fontSize="xs" fontWeight="600" color="green.800"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {r.inputCases} cases
                </Text>
                <Text fontSize="xs" color="gray.600">{fmtDate(r.processingDate)}</Text>
                <Box flex={1} />
                {/* The only undo once cases have moved. */}
                {isAdmin && (
                  <Button size="xs" variant="ghost" colorScheme="red"
                    isLoading={busyId === r.reportId}
                    onClick={() => run(r, "unaccept")}>
                    Un-accept
                  </Button>
                )}
              </Flex>
            ))}
          </Flex>
        </Box>
      )}

      {reports.length === 0 && (
        <Text fontSize="xs" color="gray.500">No processing reports for this lot yet.</Text>
      )}
    </Box>
  );
};

export default ProcessingReportLink;
