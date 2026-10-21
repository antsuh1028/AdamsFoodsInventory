import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Flex, Text, Input, Button, Select, Badge, Spinner, Table, Thead, Tbody, Tr, Th, Td,
  useToast,
} from "@chakra-ui/react";
import { ChevronDownIcon, ChevronRightIcon } from "@chakra-ui/icons";
import FloatingWindow from "../../components/FloatingWindow";
import LotPicker from "../lots/LotPicker";
import axiosInstance from "../../utils/axiosInstance";
import getRole, { canAcceptReports } from "../../utils/getRole";
import { fmtDate, today, fmtWeight } from "../common/shared";
import useLang from "../../hooks/useLang";
import LangToggle from "../../components/LangToggle";
import FpReturnForm from "./FpReturnForm";

// The F.P Tracker: trips to the AF freezer that come back for another run.
// A trip is a pallet weighed out at the dock, or a row entered by hand for one
// that was not weighed. Plus where each FP lot stands, and the returns counted.

const EMPTY = () => ({ lotId: null, lotNumber: "", item: "", cases: "", rawWeight: "", sentOn: today() });

// Who counts returns at the incoming dock. The server's RETURN_ROLES is the control.
const RETURN_ROLES = new Set(["admin", "reception", "ntimanager", "noblesse"]);

const num = { style: { fontVariantNumeric: "tabular-nums" } };

// Where a trip's count came from.
const KindBadge = ({ r, t }) => (r.kind === "weighed" ? (
  <Badge ml={2} colorScheme="green" fontSize="9px" title={t("Weighed out at the dock")}>{t("weighed")}</Badge>
) : (
  <Badge ml={2} colorScheme="gray" fontSize="9px" title={t("Entered by hand, not weighed at the dock")}>{t("by hand")}</Badge>
));

// Where the lot stands: back from the freezer, still in it, and ready to run.
const FreezerCells = ({ r, t }) => (
  <>
    <Td isNumeric {...num}>{r.returned}</Td>
    <Td isNumeric {...num}>
      {r.inFreezer > 0
        ? <Badge colorScheme="blue" fontSize="10px">{r.inFreezer}</Badge>
        : <Text as="span" color="gray.400">0</Text>}
    </Td>
    <Td isNumeric {...num}
      title={t("{back} back, {taken} taken by accepted runs on {lot}", { back: r.returned, taken: r.taken, lot: r.fpLotNumber })}>
      {r.ready < 0
        ? <Text as="span" color="yellow.700" fontWeight="600"
            title={t("Runs have used more than has come back so far")}>{r.ready}</Text>
        : r.ready > 0 ? <Text as="span" fontWeight="600">{r.ready}</Text>
          : <Text as="span" color="gray.400">0</Text>}
    </Td>
  </>
);

const FpTracker = ({ isOpen, onClose }) => {
  const toast = useToast();
  const { lang, t, toggle: toggleLang } = useLang();
  const canEdit = canAcceptReports();
  const canReturn = RETURN_ROLES.has(getRole());
  const [rows, setRows] = useState([]);
  const [fpLots, setFpLots] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("out");
  const [openLots, setOpenLots] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null);   // { fpId, item, cases, rawWeight, sentOn }
  const [confirming, setConfirming] = useState(null);
  // The server's warning that the dock already weighed this lot to the freezer that day.
  const [sameDay, setSameDay] = useState(null);

  const fail = (title) => (err) => toast({ title, description: err.response?.data?.error || err.message,
    status: "error", duration: 6000, position: "top", isClosable: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, l, x] = await Promise.all([
        axiosInstance.get("/fp-tracker", { params: { status, q: q || undefined } }),
        axiosInstance.get("/fp-lots"),
        axiosInstance.get("/fp-returns"),
      ]);
      setRows(t.data || []);
      setFpLots(l.data || []);
      setReturns(x.data || []);
    } catch (err) {
      fail(t("Could not load the F.P Tracker"))(err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, q]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  // Items typed before, so the same product is spelled the same way.
  const items = useMemo(() => [...new Set(rows.map((r) => r.item))].sort(), [rows]);

  // One entry per lot, newest trip first; every trip carries the same lot figures.
  const lots = useMemo(() => {
    const byLot = new Map();
    for (const r of rows) {
      if (!byLot.has(r.lotId)) {
        byLot.set(r.lotId, { lotId: r.lotId, lotNumber: r.lotNumber, fpLotNumber: r.fpLotNumber,
          lastSent: r.sentOn, figures: r, trips: [] });
      }
      byLot.get(r.lotId).trips.push(r);
    }
    return [...byLot.values()];
  }, [rows]);

  // Returns per lot, newest first.
  const returnsByLot = useMemo(() => {
    const m = new Map();
    for (const x of returns) {
      if (!m.has(x.lotId)) m.set(x.lotId, []);
      m.get(x.lotId).push(x);
    }
    return m;
  }, [returns]);

  const toggleLot = (lotId) => setOpenLots((prev) => {
    const next = new Set(prev);
    if (next.has(lotId)) next.delete(lotId); else next.add(lotId);
    return next;
  });

  const act = async (key, run, done) => {
    setBusy(key);
    try {
      await run();
      if (done) done();
      await load();
    } catch (err) {
      fail(t("That did not save"))(err);
    } finally {
      setBusy(null);
    }
  };

  const add = async (confirmNotWeighed = false) => {
    setBusy("new");
    try {
      const { data } = await axiosInstance.post("/fp-tracker", {
        lotId: draft.lotId, item: draft.item, cases: draft.cases,
        rawWeight: draft.rawWeight.trim() || null, sentOn: draft.sentOn, confirmNotWeighed,
      });
      setSameDay(null);
      setDraft(EMPTY());
      if (data.fpLotCreated) {
        toast({ title: t("{lot} created", { lot: data.fpLotNumber }), status: "success", duration: 6000, position: "top",
          description: t("The floor can now pick {lot} for a run on this product.", { lot: data.fpLotNumber }) });
      }
      await load();
    } catch (err) {
      if (err.response?.data?.code === "WEIGHED_SAME_DAY") setSameDay(err.response.data.error);
      else fail(t("That did not save"))(err);
    } finally {
      setBusy(null);
    }
  };

  const voidReturn = (x) => act(`r${x.returnId}`, () => axiosInstance.post(`/fp-returns/${x.returnId}/void`));

  const saveEdit = () => act(editing.fpId, () => axiosInstance.patch(`/fp-tracker/${editing.fpId}`, {
    item: editing.item, cases: editing.cases,
    rawWeight: String(editing.rawWeight || "").trim() || null, sentOn: editing.sentOn,
  }), () => setEditing(null));

  const voidRow = (r) => act(r.fpId, () => axiosInstance.post(`/fp-tracker/${r.fpId}/void`));

  const ready = draft.lotId && draft.item.trim() && Number(draft.cases) > 0;
  const cellInput = { size: "xs", bg: "white" };

  // One trip inside an open lot; a hand row edits in place.
  const tripRow = (r) => (r.kind === "hand" && editing?.fpId === r.fpId ? (
    <Tr key={r.key} bg="blue.50">
      <Td><Input {...cellInput} type="date" max={today()} value={editing.sentOn}
        onChange={(e) => setEditing({ ...editing, sentOn: e.target.value })} /></Td>
      <Td><Input {...cellInput} list="fp-items" textTransform="uppercase" value={editing.item}
        onChange={(e) => setEditing({ ...editing, item: e.target.value })} /></Td>
      <Td isNumeric><Input {...cellInput} width="70px" inputMode="numeric" value={editing.cases}
        onChange={(e) => setEditing({ ...editing, cases: e.target.value.replace(/\D/g, "") })} /></Td>
      <Td isNumeric><Input {...cellInput} width="90px" inputMode="decimal" value={editing.rawWeight}
        onChange={(e) => setEditing({ ...editing, rawWeight: e.target.value })} /></Td>
      <Td>
        <Flex gap={1} justify="flex-end">
          <Button size="xs" colorScheme="blue" onClick={saveEdit} isLoading={busy === r.fpId}>{t("Save")}</Button>
          <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>{t("Cancel")}</Button>
        </Flex>
      </Td>
    </Tr>
  ) : (
    <Tr key={r.key}>
      <Td whiteSpace="nowrap">{fmtDate(r.sentOn)}</Td>
      <Td>
        {r.item || "—"}
        <KindBadge r={r} t={t} />
        {r.sourceReportId && (
          <Badge ml={2} colorScheme="gray" fontSize="9px" title={t("Written when that processing report was accepted")}>
            {t("report {id}", { id: r.sourceReportId })}
          </Badge>
        )}
      </Td>
      <Td isNumeric {...num}>{r.cases}</Td>
      <Td isNumeric {...num}>{r.weight ? fmtWeight(r.weight) : "—"}</Td>
      {/* A weighed trip is corrected in its weighing session, not here. */}
      {canEdit && r.kind === "weighed" && <Td />}
      {canEdit && r.kind === "hand" && (
        <Td>
          <Flex gap={1} justify="flex-end" wrap="wrap">
            <Button size="xs" variant="ghost" colorScheme="blue"
              onClick={() => setEditing({ fpId: r.fpId, item: r.item, cases: String(r.cases),
                rawWeight: r.weight ? fmtWeight(r.weight) : "", sentOn: r.sentOn })}>
              {t("Edit")}
            </Button>
            {/* Asked once: a voided row cannot be brought back from here. */}
            {confirming === r.fpId ? (
              <>
                <Text fontSize="xs" color="red.600" alignSelf="center">{t("Void?")}</Text>
                <Button size="xs" colorScheme="red" isLoading={busy === r.fpId}
                  onClick={() => { setConfirming(null); voidRow(r); }}>{t("Yes")}</Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>{t("No")}</Button>
              </>
            ) : (
              <Button size="xs" variant="ghost" colorScheme="red"
                onClick={() => setConfirming(r.fpId)}>{t("Void")}</Button>
            )}
          </Flex>
        </Td>
      )}
    </Tr>
  ));

  // One count back in, so a partial return can be traced and a mistaken one voided.
  const returnRow = (x) => (
    <Tr key={x.returnId}>
      <Td whiteSpace="nowrap">{fmtDate(x.returnedOn)}</Td>
      <Td isNumeric {...num}>{x.cases}</Td>
      <Td>{x.notes || ""}</Td>
      <Td fontSize="xs" color="gray.500">{x.createdBy || ""}</Td>
      {canReturn && (
        <Td>
          {confirming === `r${x.returnId}` ? (
            <Flex gap={1} justify="flex-end">
              <Text fontSize="xs" color="red.600" alignSelf="center">{t("Void?")}</Text>
              <Button size="xs" colorScheme="red" isLoading={busy === `r${x.returnId}`}
                onClick={() => { setConfirming(null); voidReturn(x); }}>{t("Yes")}</Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>{t("No")}</Button>
            </Flex>
          ) : (
            <Button size="xs" variant="ghost" colorScheme="red"
              onClick={() => setConfirming(`r${x.returnId}`)}>{t("Void")}</Button>
          )}
        </Td>
      )}
    </Tr>
  );

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title={t("F.P Tracker")} width={1150}
      headerActions={<LangToggle lang={lang} onToggle={toggleLang} />}>
      <Text fontSize="xs" color="gray.500" mb={3}>
        {t("Product sent to the AF freezer that comes back for another run. Pallets the dock weighs out with \"Going to the AF freezer\" ticked appear here on their own, and the first one for a lot creates its FP lot (N26237-04 becomes FP26237-04). What comes back is counted at the incoming dock below; a run on it picks the FP lot on the Processing tab.")}
      </Text>

      {canEdit && (
        <Flex gap={2} wrap="wrap" align="flex-end" mb={3} p={3} bg="gray.50" borderRadius="md"
          border="1px solid" borderColor="gray.200">
          <Text fontSize="xs" fontWeight="700" color="gray.600" textTransform="uppercase" w="100%">
            {t("Add a trip the dock did not weigh")}
          </Text>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>{t("Date sent out")}</Text>
            <Input {...cellInput} size="sm" type="date" max={today()} width="150px"
              value={draft.sentOn} onChange={(e) => setDraft({ ...draft, sentOn: e.target.value })} />
          </Box>
          <Box minW="220px">
            <Text fontSize="xs" color="gray.500" mb={1}>{t("Lot #")}</Text>
            <LotPicker size="sm" value={draft.lotId} lotNumber={draft.lotNumber}
              onChange={(l) => setDraft({ ...draft, lotId: l ? l.lotId : null, lotNumber: l ? l.lotNumber : "" })} />
          </Box>
          <Box flex="1 1 260px">
            <Text fontSize="xs" color="gray.500" mb={1}>{t("Item description")}</Text>
            <Input {...cellInput} size="sm" list="fp-items" textTransform="uppercase" autoComplete="off"
              value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} />
            <datalist id="fp-items">{items.map((i) => <option key={i} value={i} />)}</datalist>
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>{t("Qty (cases)")}</Text>
            <Input {...cellInput} size="sm" width="90px" inputMode="numeric"
              value={draft.cases} onChange={(e) => setDraft({ ...draft, cases: e.target.value.replace(/\D/g, "") })} />
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>{t("Raw weights")}</Text>
            <Input {...cellInput} size="sm" width="110px" inputMode="decimal" placeholder={t("optional")}
              value={draft.rawWeight} onChange={(e) => setDraft({ ...draft, rawWeight: e.target.value })} />
          </Box>
          <Button size="sm" colorScheme="blue" onClick={() => add(false)} isLoading={busy === "new"} isDisabled={!ready}>
            {t("Add")}
          </Button>
          {/* The same trip typed after the dock weighed it would count twice. */}
          {sameDay && (
            <Flex w="100%" gap={2} align="center" wrap="wrap" p={2} bg="yellow.50" borderRadius="md"
              border="1px solid" borderColor="yellow.300">
              <Text fontSize="xs" color="yellow.900" flex="1 1 300px">{sameDay}</Text>
              <Button size="xs" colorScheme="yellow" onClick={() => add(true)} isLoading={busy === "new"}>
                {t("Add anyway")}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setSameDay(null)}>{t("Cancel")}</Button>
            </Flex>
          )}
        </Flex>
      )}

      {canReturn && <Box mb={4}><FpReturnForm fpLots={fpLots} onRecorded={load} /></Box>}

      <Flex gap={2} mb={2} wrap="wrap">
        <Select size="sm" width="190px" bg="white" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">{t("All")}</option>
          <option value="out">{t("Still in the freezer")}</option>
          <option value="back">{t("All back")}</option>
        </Select>
        <Input size="sm" flex="1 1 200px" bg="white" placeholder={t("Search lot or item")}
          value={q} onChange={(e) => setQ(e.target.value)} />
      </Flex>

      <Box overflowX="auto" border="1px solid" borderColor="gray.200" borderRadius="md" bg="white">
        <Table size="sm" minWidth="900px">
          <Thead>
            <Tr>
              <Th w="28px" /><Th>{t("Lot #")}</Th><Th>{t("FP lot")}</Th>
              <Th>{t("Last sent out")}</Th><Th>{t("Last back")}</Th>
              <Th isNumeric title={t("Sent to the freezer, for the whole lot")}>{t("Sent")}</Th>
              <Th isNumeric title={t("Counted back in at the incoming dock, for the whole lot")}>{t("Back")}</Th>
              <Th isNumeric title={t("Sent and not yet back, for the whole lot")}>{t("In freezer")}</Th>
              <Th isNumeric title={t("Back and not yet used by an accepted run")}>{t("Ready")}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading && lots.length === 0 && (
              <Tr><Td colSpan={9}><Flex justify="center" py={4}><Spinner size="sm" /></Flex></Td></Tr>
            )}
            {!loading && lots.length === 0 && (
              <Tr><Td colSpan={9}><Text fontSize="sm" color="gray.500" py={2}>{t("Nothing here yet.")}</Text></Td></Tr>
            )}
            {lots.map((lot) => {
              const isOpen = openLots.has(lot.lotId);
              const back = returnsByLot.get(lot.lotId) || [];
              return (
                <React.Fragment key={lot.lotId}>
                  <Tr cursor="pointer" bg={isOpen ? "blue.50" : undefined} _hover={{ bg: "blue.50" }}
                    onClick={() => toggleLot(lot.lotId)}>
                    <Td px={2}>{isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}</Td>
                    <Td fontWeight="600" color="blue.700">{lot.lotNumber}</Td>
                    <Td whiteSpace="nowrap">{lot.fpLotNumber || "—"}</Td>
                    <Td whiteSpace="nowrap">{fmtDate(lot.lastSent)}</Td>
                    <Td whiteSpace="nowrap">{back.length ? fmtDate(back[0].returnedOn) : "—"}</Td>
                    <Td isNumeric {...num}>{lot.figures.sent}</Td>
                    <FreezerCells r={lot.figures} t={t} />
                  </Tr>
                  {isOpen && (
                    <Tr>
                      <Td colSpan={9} bg="gray.50" p={3}>
                        <Flex gap={4} wrap="wrap" align="flex-start">
                          <Box flex="3 1 480px">
                            <Text fontSize="xs" fontWeight="700" color="gray.600" textTransform="uppercase" mb={1}>
                              {t("Sent out")}
                            </Text>
                            <Box border="1px solid" borderColor="gray.200" borderRadius="md" bg="white" overflowX="auto">
                              <Table size="sm">
                                <Thead>
                                  <Tr>
                                    <Th>{t("Date sent out")}</Th><Th>{t("Item description")}</Th>
                                    <Th isNumeric>{t("Qty (cases)")}</Th><Th isNumeric>{t("Weight (lb)")}</Th>
                                    {canEdit && <Th />}
                                  </Tr>
                                </Thead>
                                <Tbody>{lot.trips.map(tripRow)}</Tbody>
                              </Table>
                            </Box>
                          </Box>
                          <Box flex="2 1 320px">
                            <Text fontSize="xs" fontWeight="700" color="gray.600" textTransform="uppercase" mb={1}>
                              {t("Came back")}
                            </Text>
                            <Box border="1px solid" borderColor="gray.200" borderRadius="md" bg="white" overflowX="auto">
                              {back.length === 0 ? (
                                <Text fontSize="sm" color="gray.500" p={3}>{t("Nothing counted back yet.")}</Text>
                              ) : (
                                <Table size="sm">
                                  <Thead>
                                    <Tr><Th>{t("Date back")}</Th><Th isNumeric>{t("Cases")}</Th><Th>{t("Note")}</Th><Th>{t("By")}</Th>{canReturn && <Th />}</Tr>
                                  </Thead>
                                  <Tbody>{back.map(returnRow)}</Tbody>
                                </Table>
                              )}
                            </Box>
                          </Box>
                        </Flex>
                      </Td>
                    </Tr>
                  )}
                </React.Fragment>
              );
            })}
          </Tbody>
        </Table>
      </Box>
    </FloatingWindow>
  );
};

export default FpTracker;
