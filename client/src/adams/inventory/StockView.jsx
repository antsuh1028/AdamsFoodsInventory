import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, AlertIcon, Badge, Box, Button, ButtonGroup, Collapse, Flex, Input, InputGroup, InputLeftElement,
  Spinner, Table, Tbody, Td, Text, Th, Thead, Tr,
} from "@chakra-ui/react";
import { SearchIcon, RepeatIcon, ChevronDownIcon, ChevronRightIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import FloatingWindow from "../../components/FloatingWindow";
import { sumWeights, toDisplay } from "../../utils/weight";

// The Stock tab: every box still here, by lot or by location, with the old inventory rows marked old.

const WEIGHT_RE = /^\d{1,7}(\.\d{1,3})?$/;
const NOT_PUT_AWAY = "NOT PUT AWAY";

// Exact pound total of weight strings; unreadable ones are skipped.
const lbOf = (weights) => {
  const ok = weights.map((w) => String(w ?? "").trim()).filter((w) => WEIGHT_RE.test(w));
  return ok.length ? toDisplay(sumWeights(ok)) : "0.00";
};
const dollars = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d || "");

// Same bands as the level tabs: under 30 days green, under 90 yellow, then red.
const ageColor = (dateStr) => {
  if (!dateStr) return "gray.300";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "gray.300";
  const days = Math.floor((Date.now() - d) / 86400000);
  return days < 30 ? "green.400" : days < 90 ? "yellow.400" : "red.400";
};
const Dot = ({ date }) => <Box w="8px" h="8px" borderRadius="full" bg={ageColor(date)} flexShrink={0} />;

// Locations in freezer order, numbers compared as numbers; pallets not put away first.
const byLocation = (a, b) => (a === NOT_PUT_AWAY ? -1 : b === NOT_PUT_AWAY ? 1
  : a.localeCompare(b, undefined, { numeric: true }));

const lineText = (lot, line) => [lot.lotNumber, lot.vendor, line.item, line.location, ...line.codes, ...line.packDates]
  .join(" ").toUpperCase();
const oldText = (r) => [r.location, r.lot, r.vendor, r.brand, r.species, r.description, r.packdate, r.date_recvd]
  .join(" ").toUpperCase();

// Every box of one new lot, read-only.
const LotBoxes = ({ lot, onClose }) => {
  const [boxes, setBoxes] = useState(null);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    if (!lot) return;
    setBoxes(null);
    axiosInstance.get(`/af-lots/${lot.id}`)
      .then(({ data }) => {
        const items = Object.fromEntries((data.items || []).map((i) => [i.id, i.description]));
        setBoxes((data.boxes || []).filter((b) => !b.removedAt && b.status === "in_stock")
          .map((b) => ({ ...b, item: items[b.itemId] || "No item" })));
      })
      .catch((err) => setProblem(err.response?.data?.error || err.message));
  }, [lot]);
  return (
    <FloatingWindow isOpen={Boolean(lot)} onClose={onClose} title={lot ? `Lot ${lot.lotNumber} boxes` : ""} width={760}>
      {problem && <Alert status="error" borderRadius="md" py={2} mb={2}><AlertIcon />{problem}</Alert>}
      {!boxes ? <Spinner size="sm" /> : (
        <Box overflowX="auto">
          <Table size="sm" minW="620px">
            <Thead><Tr>
              <Th>Pallet</Th><Th>Item</Th><Th isNumeric>Lb</Th><Th>Pack date</Th><Th>Item code</Th><Th>Serial</Th>
            </Tr></Thead>
            <Tbody style={{ fontVariantNumeric: "tabular-nums" }}>
              {boxes.map((b) => (
                <Tr key={b.id}>
                  <Td>{b.palletNo}</Td>
                  <Td>{b.item}</Td>
                  <Td isNumeric fontWeight="600">
                    {b.weight}{b.entryMethod === "typed" && <Badge ml={1} fontSize="9px" colorScheme="yellow">typed</Badge>}
                  </Td>
                  <Td>{b.packDate || ""}</Td>
                  <Td>{b.itemCode || b.customerPart || ""}</Td>
                  <Td fontSize="xs">{b.serial || ""}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}
    </FloatingWindow>
  );
};

// One old inventory row, tappable to open it in the details panel.
const OldRow = ({ row, onOpen, showLocation }) => (
  <Flex px={3} py={1.5} gap={2} align="center" cursor="pointer" _hover={{ bg: "gray.50" }}
    borderTop="1px solid" borderColor="gray.100" onClick={() => onOpen(row)}>
    <Dot date={row.packdate || row.date_recvd} />
    <Badge fontSize="9px" colorScheme="gray" flexShrink={0}>old</Badge>
    <Box minW={0} flex={1}>
      <Text fontSize="sm" noOfLines={1}>{row.description || "(no description)"}</Text>
      <Text fontSize="xs" color="gray.500" noOfLines={1}>
        {[showLocation && row.location, row.lot && `Lot ${row.lot}`, row.vendor].filter(Boolean).join(" · ")}
      </Text>
    </Box>
    <Text fontSize="xs" color="gray.600" flexShrink={0} style={{ fontVariantNumeric: "tabular-nums" }}>
      {row.quantity || row.boxCount} bx · {row.weight || "?"} lb
    </Text>
  </Flex>
);

// Rows drawn per "Show more": old rows in By lot, locations in By location.
const OLD_PAGE = 50;
const PLACE_PAGE = 30;

const ShowMore = ({ shown, total, step, noun, onMore }) => (total > shown ? (
  <Flex px={3} py={3} gap={3} align="center" justify="center">
    <Text fontSize="xs" color="gray.500" style={{ fontVariantNumeric: "tabular-nums" }}>{shown} of {total} {noun}</Text>
    <Button size="sm" variant="outline" onClick={onMore}>Show {Math.min(step, total - shown)} more</Button>
  </Flex>
) : null);

const StockView = ({ active, onOpenOld, onShowOnMap }) => {
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("lot");
  const [open, setOpen] = useState(() => new Set());
  const [boxesOf, setBoxesOf] = useState(null);
  // How many pages are drawn; back to one whenever the list changes.
  const [pages, setPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await axiosInstance.get("/af-stock");
      setData(d);
      setProblem(null);
    } catch (err) {
      setProblem(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  // Loads each time the tab is shown; Refresh reloads.
  useEffect(() => { if (active) load(); }, [active, load]);

  const term = search.trim().toUpperCase();

  // New lots with only the lines that match; a lot-level match keeps every line.
  const lots = useMemo(() => (data ? data.lots : [])
    .map((lot) => ({ ...lot, lines: lot.lines.filter((line) => !term || lineText(lot, line).includes(term)) }))
    .filter((lot) => lot.lines.length), [data, term]);
  const old = useMemo(() => (data ? data.old : []).filter((r) => !term || oldText(r).includes(term)), [data, term]);
  const oldByLot = useMemo(() => [...old].sort((a, b) => String(b.lot).localeCompare(String(a.lot))), [old]);

  useEffect(() => { setPages(1); }, [term, group, data]);
  const oldShown = Math.min(oldByLot.length, pages * OLD_PAGE);

  const toggle = (key) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const lotTotals = (lot) => {
    const boxes = lot.lines.reduce((n, l) => n + l.boxes, 0);
    const value = data?.withValue ? lot.lines.reduce((v, l) => v + (l.value ? Number(l.value) : 0), 0) : 0;
    return { boxes, lb: lbOf(lot.lines.map((l) => l.lb)), value };
  };

  // Location -> its new pallet lines and old rows.
  const places = useMemo(() => {
    const m = {};
    const at = (loc) => (m[loc] = m[loc] || { news: [], olds: [] });
    lots.forEach((lot) => lot.lines.forEach((line) => at(line.location || NOT_PUT_AWAY).news.push({ lot, line })));
    old.forEach((r) => at(r.location || "NO LOCATION").olds.push(r));
    return Object.keys(m).sort(byLocation).map((loc) => ({ loc, ...m[loc] }));
  }, [lots, old]);
  const placesShown = Math.min(places.length, pages * PLACE_PAGE);

  const newBoxes = lots.reduce((n, lot) => n + lotTotals(lot).boxes, 0);
  const newLb = lbOf(lots.flatMap((lot) => lot.lines.map((l) => l.lb)));
  const oldLb = lbOf(old.map((r) => r.weight));

  return (
    <Flex direction="column" h="100%" minH={0}>
      <Flex px={3} py={2} gap={2} align="center" wrap="wrap" borderBottom="1px" borderColor="gray.100" flexShrink={0}>
        <InputGroup size="sm" flex="1 1 180px">
          <InputLeftElement pointerEvents="none"><SearchIcon color="gray.400" /></InputLeftElement>
          <Input placeholder="Lot, item, vendor, location, code, date" value={search}
            onChange={(e) => setSearch(e.target.value)} borderRadius="md" />
        </InputGroup>
        <ButtonGroup size="sm" isAttached variant="outline">
          <Button colorScheme={group === "lot" ? "blue" : "gray"} variant={group === "lot" ? "solid" : "outline"}
            onClick={() => setGroup("lot")}>By lot</Button>
          <Button colorScheme={group === "location" ? "blue" : "gray"} variant={group === "location" ? "solid" : "outline"}
            onClick={() => setGroup("location")}>By location</Button>
        </ButtonGroup>
        <Button size="sm" variant="ghost" onClick={load} isLoading={loading} aria-label="Refresh"><RepeatIcon /></Button>
      </Flex>

      {data && (
        <Text px={3} py={1} fontSize="xs" color="gray.500" bg="gray.50" flexShrink={0} style={{ fontVariantNumeric: "tabular-nums" }}>
          New: {lots.length} lot{lots.length === 1 ? "" : "s"} · {newBoxes} bx · {newLb} lb
          {"  |  "}Old: {old.length} row{old.length === 1 ? "" : "s"} · {oldLb} lb
        </Text>
      )}
      {problem && <Alert status="error" py={2}><AlertIcon />{problem}</Alert>}

      <Box flex={1} minH={0} overflowY="auto">
        {!data ? <Flex justify="center" py={6}><Spinner /></Flex> : group === "lot" ? (
          <>
            {lots.map((lot) => {
              const t = lotTotals(lot);
              const key = `lot-${lot.id}`;
              const pallets = [...new Set(lot.lines.map((l) => l.palletNo))].sort((a, b) => a - b);
              return (
                <Box key={key} borderBottom="1px solid" borderColor="gray.100">
                  <Flex px={3} py={2} gap={2} align="center" cursor="pointer" _hover={{ bg: "blue.50" }} onClick={() => toggle(key)}>
                    {open.has(key) ? <ChevronDownIcon /> : <ChevronRightIcon color="gray.400" />}
                    <Dot date={lot.received} />
                    <Box minW={0} flex={1}>
                      <Text fontSize="sm" fontWeight="700">{lot.lotNumber}
                        <Text as="span" fontWeight="400" color="gray.500"> · {lot.vendor || "no vendor"} · {shortDate(lot.received)}</Text>
                      </Text>
                      <Text fontSize="xs" color="gray.500" noOfLines={1}>{[...new Set(lot.lines.map((l) => l.item))].join(", ")}</Text>
                    </Box>
                    <Text fontSize="xs" color="gray.700" textAlign="right" flexShrink={0} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {t.boxes} bx · {t.lb} lb{t.value ? <><br />{dollars(t.value)}</> : null}
                    </Text>
                  </Flex>
                  <Collapse in={open.has(key)} animateOpacity>
                    <Box px={3} pb={2} pl={9}>
                      {pallets.map((p) => {
                        const lines = lot.lines.filter((l) => l.palletNo === p);
                        return (
                          <Box key={p} py={1} borderTop="1px dashed" borderColor="gray.100">
                            <Flex align="center" gap={2}>
                              <Text fontSize="xs" fontWeight="600" color={lines[0].location ? "blue.700" : "yellow.700"}>
                                Pallet {p} {lines[0].location ? `@ ${lines[0].location}` : "· not put away"}
                              </Text>
                              {lines[0].location && (
                                <Button size="xs" variant="link" colorScheme="teal" onClick={() => onShowOnMap(lines[0].location)}>
                                  Show on map
                                </Button>
                              )}
                            </Flex>
                            {lines.map((l) => (
                              <Flex key={l.itemId} justify="space-between" fontSize="xs" color="gray.600" style={{ fontVariantNumeric: "tabular-nums" }}>
                                <Text noOfLines={1}>{l.item}{l.codes.length ? ` (${l.codes.join(", ")})` : ""}</Text>
                                <Text flexShrink={0} ml={2}>{l.boxes} bx · {toDisplay(l.lb)} lb</Text>
                              </Flex>
                            ))}
                          </Box>
                        );
                      })}
                      <Button size="xs" mt={1} variant="outline" onClick={() => setBoxesOf(lot)}>View boxes</Button>
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
            {oldByLot.slice(0, oldShown).map((r) => (
              <OldRow key={r._id} row={r} onOpen={onOpenOld} showLocation />
            ))}
            <ShowMore shown={oldShown} total={oldByLot.length} step={OLD_PAGE} noun="old rows" onMore={() => setPages((n) => n + 1)} />
            {!lots.length && !old.length && <Text p={4} fontSize="sm" color="gray.500">Nothing matches "{search.trim()}".</Text>}
          </>
        ) : (
          <>
            {places.slice(0, placesShown).map(({ loc, news, olds }) => (
              <Box key={loc} borderBottom="1px solid" borderColor="gray.200">
                <Flex px={3} py={1.5} bg={loc === NOT_PUT_AWAY ? "yellow.50" : "gray.50"} justify="space-between" align="center">
                  <Flex align="center" gap={2}>
                    <Text fontSize="sm" fontWeight="700" fontFamily="mono">{loc}</Text>
                    {loc !== NOT_PUT_AWAY && loc !== "NO LOCATION" && (
                      <Button size="xs" variant="link" colorScheme="teal" onClick={() => onShowOnMap(loc)}>Show on map</Button>
                    )}
                  </Flex>
                  <Text fontSize="xs" color="gray.600" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {news.reduce((n, x) => n + x.line.boxes, 0) + olds.reduce((n, r) => n + (Number(r.quantity) || r.boxCount || 0), 0)} bx
                    {" · "}{lbOf([...news.map((x) => x.line.lb), ...olds.map((r) => r.weight)])} lb
                  </Text>
                </Flex>
                {news.map(({ lot, line }) => (
                  <Flex key={`${lot.id}-${line.palletNo}-${line.itemId}`} px={3} py={1.5} gap={2} align="center"
                    borderTop="1px solid" borderColor="gray.100" cursor="pointer" _hover={{ bg: "blue.50" }}
                    onClick={() => setBoxesOf(lot)}>
                    <Dot date={lot.received} />
                    <Box minW={0} flex={1}>
                      <Text fontSize="sm" noOfLines={1}>{line.item}</Text>
                      <Text fontSize="xs" color="gray.500" noOfLines={1}>
                        Lot {lot.lotNumber} · Pallet {line.palletNo}{lot.vendor ? ` · ${lot.vendor}` : ""}
                      </Text>
                    </Box>
                    <Text fontSize="xs" color="gray.600" flexShrink={0} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {line.boxes} bx · {toDisplay(line.lb)} lb
                    </Text>
                  </Flex>
                ))}
                {olds.map((r) => <OldRow key={r._id} row={r} onOpen={onOpenOld} />)}
              </Box>
            ))}
            <ShowMore shown={placesShown} total={places.length} step={PLACE_PAGE} noun="locations" onMore={() => setPages((n) => n + 1)} />
            {!places.length && <Text p={4} fontSize="sm" color="gray.500">Nothing matches "{search.trim()}".</Text>}
          </>
        )}
      </Box>

      <LotBoxes lot={boxesOf} onClose={() => setBoxesOf(null)} />
    </Flex>
  );
};

export default StockView;
