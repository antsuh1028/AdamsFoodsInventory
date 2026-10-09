import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Flex, Text, Input, Button, Select, Badge, Spinner, Table, Thead, Tbody, Tr, Th, Td,
  useToast,
} from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import LotPicker from "../../components/LotPicker";
import axiosInstance from "../../utils/axiosInstance";
import { canAcceptReports } from "../../utils/getRole";
import { fmtDate, today, fmtWeight } from "./shared";

// Reception's F.P Tracker: product sent to the AF freezer that comes back for
// another run. The Excel sheet's columns, plus what its FP lot still has waiting.

const EMPTY = () => ({ lotId: null, lotNumber: "", item: "", cases: "", rawWeight: "", sentOn: today() });

// Boxes the dock labelled for this N lot, checked against the cases sent. Paperwork only.
const LabelledCell = ({ r }) => {
  if (r.labelled == null) return <Td isNumeric>—</Td>;
  const off = r.labelled !== r.sent;
  return (
    <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}
      title={off
        ? `The dock labelled ${r.labelled} boxes for the freezer; ${r.sent} cases were sent. One of the two is wrong.`
        : "Matches the cases sent."}>
      <Text as="span" color={off ? "red.600" : "gray.600"} fontWeight={off ? "700" : "400"}>
        {r.labelled}{off ? " ≠" : ""}
      </Text>
    </Td>
  );
};

const FpTracker = ({ isOpen, onClose }) => {
  const toast = useToast();
  const canEdit = canAcceptReports();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null);   // { fpId, item, cases, rawWeight, sentOn }
  const [confirming, setConfirming] = useState(null);

  const fail = (title) => (err) => toast({ title, description: err.response?.data?.error || err.message,
    status: "error", duration: 6000, position: "top", isClosable: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axiosInstance.get("/fp-tracker", { params: { status, q: q || undefined } });
      setRows(data || []);
    } catch (err) {
      fail("Could not load the F.P Tracker")(err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, q]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  // Items typed before, so the same product is spelled the same way.
  const items = useMemo(() => [...new Set(rows.map((r) => r.item))].sort(), [rows]);

  const act = async (key, run, done) => {
    setBusy(key);
    try {
      await run();
      if (done) done();
      await load();
    } catch (err) {
      fail("That did not save")(err);
    } finally {
      setBusy(null);
    }
  };

  const add = () => act("new", async () => {
    const { data } = await axiosInstance.post("/fp-tracker", {
      lotId: draft.lotId, item: draft.item, cases: draft.cases,
      rawWeight: draft.rawWeight.trim() || null, sentOn: draft.sentOn,
    });
    if (data.fpLotCreated) {
      toast({ title: `${data.fpLotNumber} created`, status: "success", duration: 6000, position: "top",
        description: `The floor can now pick ${data.fpLotNumber} for a run on this product.` });
    }
  }, () => setDraft(EMPTY()));

  const setReturned = (r, value) => act(r.fpId,
    () => axiosInstance.patch(`/fp-tracker/${r.fpId}`, { returnedOn: value }));

  const saveEdit = () => act(editing.fpId, () => axiosInstance.patch(`/fp-tracker/${editing.fpId}`, {
    item: editing.item, cases: editing.cases,
    rawWeight: String(editing.rawWeight || "").trim() || null, sentOn: editing.sentOn,
  }), () => setEditing(null));

  const voidRow = (r) => act(r.fpId, () => axiosInstance.post(`/fp-tracker/${r.fpId}/void`));

  const ready = draft.lotId && draft.item.trim() && Number(draft.cases) > 0;
  const cellInput = { size: "xs", bg: "white" };

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title="F.P Tracker" width={1100}>
      <Text fontSize="xs" color="gray.500" mb={3}>
        Product sent to the AF freezer that comes back for another run. The first row
        for a lot creates its FP lot (N26237-04 becomes FP26237-04). A run on that product
        picks the FP lot on the Processing tab, and its cases come off what is waiting here.
      </Text>

      {canEdit && (
        <Flex gap={2} wrap="wrap" align="flex-end" mb={4} p={3} bg="gray.50" borderRadius="md"
          border="1px solid" borderColor="gray.200">
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>Date sent out</Text>
            <Input {...cellInput} size="sm" type="date" max={today()} width="150px"
              value={draft.sentOn} onChange={(e) => setDraft({ ...draft, sentOn: e.target.value })} />
          </Box>
          <Box minW="220px">
            <Text fontSize="xs" color="gray.500" mb={1}>Lot #</Text>
            <LotPicker size="sm" value={draft.lotId} lotNumber={draft.lotNumber}
              onChange={(l) => setDraft({ ...draft, lotId: l ? l.lotId : null, lotNumber: l ? l.lotNumber : "" })} />
          </Box>
          <Box flex="1 1 260px">
            <Text fontSize="xs" color="gray.500" mb={1}>Item description</Text>
            <Input {...cellInput} size="sm" list="fp-items" textTransform="uppercase" autoComplete="off"
              value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} />
            <datalist id="fp-items">{items.map((i) => <option key={i} value={i} />)}</datalist>
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>Qty (cases)</Text>
            <Input {...cellInput} size="sm" width="90px" inputMode="numeric"
              value={draft.cases} onChange={(e) => setDraft({ ...draft, cases: e.target.value.replace(/\D/g, "") })} />
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>Raw weights</Text>
            <Input {...cellInput} size="sm" width="110px" inputMode="decimal" placeholder="optional"
              value={draft.rawWeight} onChange={(e) => setDraft({ ...draft, rawWeight: e.target.value })} />
          </Box>
          <Button size="sm" colorScheme="blue" onClick={add} isLoading={busy === "new"} isDisabled={!ready}>
            Add
          </Button>
        </Flex>
      )}

      <Flex gap={2} mb={2} wrap="wrap">
        <Select size="sm" width="190px" bg="white" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All</option>
          <option value="out">Still in the freezer</option>
          <option value="back">Returned</option>
        </Select>
        <Input size="sm" flex="1 1 200px" bg="white" placeholder="Search lot or item"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </Flex>

      <Box overflowX="auto" border="1px solid" borderColor="gray.200" borderRadius="md" bg="white">
        <Table size="sm" minWidth="900px">
          <Thead>
            <Tr>
              <Th>Date sent out</Th><Th>Date returned</Th><Th>Lot #</Th><Th>FP lot</Th><Th>Item description</Th>
              <Th isNumeric>Qty (cases)</Th><Th isNumeric>Raw weights</Th><Th isNumeric>Waiting</Th>
              <Th isNumeric title="Boxes the dock weighed and labelled for the freezer, against the cases sent">Labelled at dock</Th>
              {canEdit && <Th />}
            </Tr>
          </Thead>
          <Tbody>
            {loading && rows.length === 0 && (
              <Tr><Td colSpan={10}><Flex justify="center" py={4}><Spinner size="sm" /></Flex></Td></Tr>
            )}
            {!loading && rows.length === 0 && (
              <Tr><Td colSpan={10}><Text fontSize="sm" color="gray.500" py={2}>Nothing here yet.</Text></Td></Tr>
            )}
            {rows.map((r) => (editing?.fpId === r.fpId ? (
              <Tr key={r.fpId} bg="blue.50">
                <Td><Input {...cellInput} type="date" max={today()} value={editing.sentOn}
                  onChange={(e) => setEditing({ ...editing, sentOn: e.target.value })} /></Td>
                <Td>{r.returnedOn ? fmtDate(r.returnedOn) : "—"}</Td>
                <Td fontWeight="600">{r.lotNumber}</Td>
                <Td>{r.fpLotNumber}</Td>
                <Td><Input {...cellInput} list="fp-items" textTransform="uppercase" value={editing.item}
                  onChange={(e) => setEditing({ ...editing, item: e.target.value })} /></Td>
                <Td isNumeric><Input {...cellInput} width="70px" inputMode="numeric" value={editing.cases}
                  onChange={(e) => setEditing({ ...editing, cases: e.target.value.replace(/\D/g, "") })} /></Td>
                <Td isNumeric><Input {...cellInput} width="90px" inputMode="decimal" value={editing.rawWeight}
                  onChange={(e) => setEditing({ ...editing, rawWeight: e.target.value })} /></Td>
                <Td isNumeric>{r.waiting}</Td>
                <LabelledCell r={r} />
                <Td>
                  <Flex gap={1} justify="flex-end">
                    <Button size="xs" colorScheme="blue" onClick={saveEdit} isLoading={busy === r.fpId}>Save</Button>
                    <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </Flex>
                </Td>
              </Tr>
            ) : (
              <Tr key={r.fpId}>
                <Td whiteSpace="nowrap">{fmtDate(r.sentOn)}</Td>
                <Td whiteSpace="nowrap">
                  {r.returnedOn ? fmtDate(r.returnedOn) : <Badge colorScheme="blue" fontSize="9px">in the freezer</Badge>}
                </Td>
                <Td fontWeight="600" color="blue.700">{r.lotNumber}</Td>
                <Td whiteSpace="nowrap">{r.fpLotNumber}</Td>
                <Td>
                  {r.item}
                  {r.sourceReportId && (
                    <Badge ml={2} colorScheme="gray" fontSize="9px" title="Written when that processing report was accepted">
                      report {r.sourceReportId}
                    </Badge>
                  )}
                </Td>
                <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}>{r.cases}</Td>
                <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}>
                  {r.rawWeight ? `${fmtWeight(r.rawWeight)} lb` : "—"}
                </Td>
                <Td isNumeric style={{ fontVariantNumeric: "tabular-nums" }}
                  title={`${r.sent} sent to the freezer for ${r.lotNumber}, ${r.taken} taken by accepted runs on ${r.fpLotNumber}`}>
                  {r.waiting > 0 ? <Text as="span" fontWeight="600">{r.waiting}</Text>
                    : <Text as="span" color="gray.400">done</Text>}
                </Td>
                <LabelledCell r={r} />
                {canEdit && (
                  <Td>
                    <Flex gap={1} justify="flex-end" wrap="wrap">
                      {r.returnedOn ? (
                        <Button size="xs" variant="ghost" isLoading={busy === r.fpId}
                          onClick={() => setReturned(r, null)}>Not back</Button>
                      ) : (
                        <Button size="xs" variant="outline" colorScheme="green" isLoading={busy === r.fpId}
                          onClick={() => setReturned(r, today())}>Returned today</Button>
                      )}
                      <Button size="xs" variant="ghost" colorScheme="blue"
                        onClick={() => setEditing({ fpId: r.fpId, item: r.item, cases: String(r.cases),
                          rawWeight: r.rawWeight ? fmtWeight(r.rawWeight) : "", sentOn: r.sentOn })}>
                        Edit
                      </Button>
                      {/* Asked once: a voided row cannot be brought back from here. */}
                      {confirming === r.fpId ? (
                        <>
                          <Text fontSize="xs" color="red.600" alignSelf="center">Void?</Text>
                          <Button size="xs" colorScheme="red" isLoading={busy === r.fpId}
                            onClick={() => { setConfirming(null); voidRow(r); }}>Yes</Button>
                          <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>No</Button>
                        </>
                      ) : (
                        <Button size="xs" variant="ghost" colorScheme="red"
                          onClick={() => setConfirming(r.fpId)}>Void</Button>
                      )}
                    </Flex>
                  </Td>
                )}
              </Tr>
            )))}
          </Tbody>
        </Table>
      </Box>
    </FloatingWindow>
  );
};

export default FpTracker;
