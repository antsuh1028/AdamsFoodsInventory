// Scanning one pallet's boxes and printing its tag or manifest. Kept on this device only.

import { useEffect, useState } from "react";
import { Alert, AlertIcon, Box, Button, Flex, Input, Stack, Text } from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import useBarcodeKeys from "../../adams/boxScan/useBarcodeKeys";
import { primeAudio, beepSuccess, beepError } from "../../utils/scanFeedback";
import { toPounds, sumWeights, toDisplay } from "../../utils/weight";
import upperInput from "../../utils/upperInput";
import { fmtDate, today } from "../common/shared";
import printOutgoingTag from "../outgoing/printOutgoingTag";
import printWeightManifest from "./printWeightManifest";
import PalletNumberDialog from "./dialogs/PalletNumberDialog";
import NumericKeypad from "../weighing/NumericKeypad";
import { parseGs1 } from "../../utils/gs1";
import NtiBoxPicker from "./NtiBoxPicker";

const STORE_KEY = "palletScan";

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
};

const PalletScan = ({ isOpen, onClose, company, shipTo, sessions, groups }) => {
  const saved = load();
  const [lot, setLot] = useState(saved?.lot || "");
  const [itemNoField, setItemNoField] = useState(saved?.itemNo || "");
  const [item, setItem] = useState(saved?.item || "");
  const [ntiOpen, setNtiOpen] = useState(false);
  const [boxes, setBoxes] = useState(saved?.boxes || []); // oldest first
  const [problem, setProblem] = useState(null);
  const [ask, setAsk] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [padValue, setPadValue] = useState("");
  const [padUnit, setPadUnit] = useState("LB");
  const [labelText, setLabelText] = useState("");
  const [editing, setEditing] = useState(null); // { id, value }

  // A corrected weight; the first figure is kept so the change shows.
  const saveEdit = () => {
    if (!editing) return;
    try {
      const { weight } = toPounds(editing.value.trim(), "LB");
      if (!(Number(weight) > 0)) throw new Error("zero");
      setBoxes((list) => list.map((b) => (b.id !== editing.id || b.weight === weight ? b
        : { ...b, weight, originalWeight: b.originalWeight || b.weight })));
      setEditing(null);
      setProblem(null);
    } catch {
      setProblem("Type a weight above zero, in lb.");
    }
  };

  // A box typed on the keypad, for a label that will not scan.
  const addTyped = () => {
    try {
      const { weight } = toPounds(padValue, padUnit);
      if (!(Number(weight) > 0)) throw new Error("zero");
      setBoxes((list) => [...list, {
        id: `${Date.now()}-${list.length}`, weight, typedLot: lot.trim(), labelLot: "",
        itemNo: "", packDate: null, typed: true,
      }]);
      setPadValue("");
      setProblem(null);
      beepSuccess();
    } catch {
      beepError();
      setProblem("Type a weight above zero.");
    }
  };

  // Survives a refresh until cleared.
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ lot, itemNo: itemNoField, item, boxes })); } catch { /* not kept */ }
  }, [lot, itemNoField, item, boxes]);

  // Boxes chosen from a pallet NTI weighed, under that pallet's lot.
  const addFromNti = (rows, ntiLot) => {
    setBoxes((list) => [...list, ...rows.map((r, i) => ({
      id: `${Date.now()}-${list.length + i}`, weight: r.weight, typedLot: ntiLot || lot.trim(),
      labelLot: "", itemNo: "", packDate: r.packDate, ntiKey: r.key,
    }))]);
    setProblem(null);
  };
  const takenNti = new Set(boxes.map((b) => b.ntiKey).filter(Boolean));

  // One read label, scanned or typed. Returns whether it was added.
  const addParsed = (p, raw, typed = false) => {
    try {
      const { weight } = toPounds(p.weight.value, p.weight.unit);
      // The typed Lot # at scan time wins; the label's (10) is the fallback.
      setBoxes((list) => [...list, {
        id: `${Date.now()}-${list.length}`, weight,
        typedLot: lot.trim(), labelLot: (p.lot || "").trim().toUpperCase(),
        // Shabuya's item number, from the label's (241).
        itemNo: (p.customerPart || "").trim(),
        packDate: p.productionDate || p.packagingDate || null, raw, typed,
      }]);
      setProblem(null);
      beepSuccess();
      return true;
    } catch {
      beepError();
      setProblem("That label's weight could not be read.");
      return false;
    }
  };

  useBarcodeKeys(isOpen && !ask, (result) => {
    if (result.type !== "scan") {
      beepError();
      setProblem(`Not read: ${result.reason || result.code}`);
      return;
    }
    addParsed(result.parsed, result.raw);
  });

  // The numbers printed under the barcode, typed in; spaces ignored.
  const addLabelText = () => {
    const raw = labelText.replace(/\s+/g, "");
    if (!raw) return;
    try {
      if (addParsed(parseGs1(raw), raw, true)) setLabelText("");
    } catch (err) {
      beepError();
      setProblem(err.code === "NO_WEIGHT_AI"
        ? "No weight in that. Include the (3202) part, or use the keypad."
        : `Could not read that: ${err.message}`);
    }
  };

  const lbOf = (list) => (list.length ? toDisplay(sumWeights(list.map((b) => b.weight))) : "0.00");
  const total = lbOf(boxes);

  // Each lot's boxes, in the order the lot was first scanned.
  // A box scanned with no lot at all follows the field.
  const lotOf = (b) => b.typedLot || b.labelLot || b.lot || lot.trim() || "No lot";
  const setAllLots = () => setBoxes((list) => list.map((b) => ({ ...b, typedLot: lot.trim() })));
  const someDiffer = lot.trim() !== "" && boxes.some((b) => lotOf(b) !== lot.trim());
  // A box without a label item number takes the Item # field.
  const itemOf = (b) => b.itemNo || itemNoField.trim();
  // Each item and lot's boxes, in the order first scanned.
  const byLot = [];
  boxes.forEach((b) => {
    const itemNo = itemOf(b);
    const k = lotOf(b);
    let g = byLot.find((x) => x.lot === k && x.itemNo === itemNo);
    if (!g) { g = { lot: k, itemNo, label: [itemNo, k].filter(Boolean).join(" · "), boxes: [] }; byLot.push(g); }
    g.boxes.push(b);
  });
  const mixed = byLot.length > 1;
  const lots = [...new Set(byLot.map((g) => g.lot))];
  const itemNos = [...new Set(byLot.map((g) => g.itemNo).filter(Boolean))];

  // Printed grouped by item and lot, each group's count and weight on the memo line.
  const scans = byLot.flatMap((g) => g.boxes).map((b) => ({ weight: b.weight, weightUnit: "LB" }));
  const heading = {
    lotNumber: lots.join(", ") || lot, date: fmtDate(today()),
    shipTo, itemDescription: [itemNos.join(", "), item].filter(Boolean).join(" "), company,
    memo: mixed ? byLot.map((g) => `${g.label}: ${g.boxes.length} cs, ${lbOf(g.boxes)} lb`).join("  |  ") : "",
  };

  const printTag = (palletNo) => printOutgoingTag({ ...heading, boxes: scans, palletNo });
  const printManifest = (palletNo) => printWeightManifest({ ...heading, scans, palletNo });

  const clear = () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setBoxes([]); setLot(""); setItemNoField(""); setItem(""); setProblem(null); setConfirmClear(false);
  };

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title="Scan a pallet" width={640}>
      <Stack spacing={3} onClick={() => primeAudio()}>
        <Flex gap={2} wrap="wrap">
          <Input size="sm" w="160px" placeholder="Lot #" value={lot}
            onChange={(e) => setLot(upperInput(e))}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          <Input size="sm" w="110px" placeholder="Item #" value={itemNoField}
            title="Used for boxes whose label has no (241) item number"
            onChange={(e) => setItemNoField(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          <Input size="sm" flex={1} minW="200px" placeholder="Item description" value={item}
            onChange={(e) => setItem(upperInput(e))}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        </Flex>

        <Flex justify="space-between" align="center" p={3} bg="blue.50" borderRadius="md"
          border="1px solid" borderColor="blue.200">
          <Text fontSize="sm" color="gray.700">
            {problem ? "" : "Click an empty spot, then scan each box label."}
          </Text>
          <Box textAlign="right" style={{ fontVariantNumeric: "tabular-nums" }}>
            <Text fontSize="3xl" fontWeight="800" lineHeight="1">{boxes.length}</Text>
            <Text fontSize="xs" color="gray.600">boxes · {total} lb</Text>
          </Box>
        </Flex>

        <Text fontSize="xs" color="gray.500">
          Each box takes the Lot # above at the moment it is scanned. Leave it empty to use
          the lot on the label instead.
        </Text>

        {someDiffer && (
          <Button size="xs" variant="outline" colorScheme="blue" alignSelf="flex-start" tabIndex={-1}
            onClick={setAllLots}>
            Use {lot.trim()} for all {boxes.length} boxes
          </Button>
        )}

        {mixed && (
          <Flex gap={2} wrap="wrap">
            {byLot.map((g) => (
              <Box key={g.label} px={2} py={1} bg="gray.50" border="1px solid" borderColor="gray.200"
                borderRadius="md" fontSize="xs" style={{ fontVariantNumeric: "tabular-nums" }}>
                <b>{g.label}</b> · {g.boxes.length} cs · {lbOf(g.boxes)} lb
              </Box>
            ))}
          </Flex>
        )}

        {problem && <Alert status="error" borderRadius="md" py={2}><AlertIcon />{problem}</Alert>}

        {/* No scanner: type the numbers printed under the barcode. */}
        <Flex gap={2}>
          <Input size="sm" flex={1} fontFamily="mono" value={labelText}
            placeholder="Type the label: (13)261013(3202)004315(241)102917(10)N26280-05"
            onChange={(e) => setLabelText(upperInput(e))}
            onKeyDown={(e) => { if (e.key === "Enter") addLabelText(); }} />
          <Button size="sm" colorScheme="blue" variant="outline" onClick={addLabelText}
            isDisabled={!labelText.trim()}>Add</Button>
        </Flex>

        <Flex gap={2}>
          <Button size="xs" variant="outline" tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()} onClick={() => setNtiOpen((o) => !o)}>
            {ntiOpen ? "Hide NTI's record" : "From NTI's record"}
          </Button>
          <Button size="xs" variant="outline" tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()} onClick={() => setPadOpen((o) => !o)}>
            {padOpen ? "Hide keypad" : "Keypad"}
          </Button>
        </Flex>
        {ntiOpen && (
          <NtiBoxPicker sessions={sessions} groups={groups} taken={takenNti} onAdd={addFromNti} />
        )}
        {padOpen && (
          <Box maxW="280px">
            <NumericKeypad value={padValue} onChange={setPadValue} onSubmit={addTyped}
              unit={padUnit} onUnitChange={setPadUnit} submitLabel="Add box" />
          </Box>
        )}

        <Stack spacing={1} maxH="300px" overflowY="auto">
          {[...boxes].reverse().map((b, i) => (
            <Flex key={b.id} align="center" gap={3} px={3} py={1} border="1px solid" borderColor="gray.100"
              borderRadius="md" style={{ fontVariantNumeric: "tabular-nums" }}>
              <Text fontSize="xs" color="gray.400" minW="28px">{boxes.length - i}</Text>
              {editing?.id === b.id ? (
                <Input size="xs" w="80px" autoFocus value={editing.value}
                  onChange={(e) => setEditing({ id: b.id, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  onBlur={saveEdit} />
              ) : (
                <Text fontWeight="700" minW="80px" cursor="pointer" title="Click to correct the weight"
                  _hover={{ color: "blue.600" }}
                  onClick={() => setEditing({ id: b.id, value: String(b.weight) })}>
                  {b.weight} lb
                </Text>
              )}
              <Text fontSize="xs" fontWeight="600" color="blue.700" minW="90px">{lotOf(b)}</Text>
              <Text fontSize="xs" color="gray.500" flex={1}>
                {[itemOf(b) ? `item ${itemOf(b)}` : null, b.ntiKey ? "NTI record" : null,
                  b.originalWeight ? `corrected from ${b.originalWeight}` : null,
                  b.typed ? "typed" : null, b.packDate ? `packed ${b.packDate}` : null,
                  b.labelLot && b.labelLot !== lotOf(b) ? `label lot ${b.labelLot}` : null]
                  .filter(Boolean).join(" · ")}
              </Text>
              <Button size="xs" variant="ghost" colorScheme="red" tabIndex={-1}
                onClick={() => setBoxes((list) => list.filter((x) => x.id !== b.id))}>Remove</Button>
            </Flex>
          ))}
        </Stack>

        <Flex gap={2} justify="space-between" wrap="wrap">
          <Button size="sm" variant="ghost" colorScheme="red" tabIndex={-1} onClick={clear}
            onBlur={() => setConfirmClear(false)} isDisabled={!boxes.length && !lot}>
            {confirmClear ? "Click again to clear" : "Clear"}
          </Button>
          <Flex gap={2}>
            <Button size="sm" variant="outline" colorScheme="blue" tabIndex={-1} isDisabled={!boxes.length}
              onClick={() => setAsk({ kind: "manifest", lotNumber: lot, run: printManifest })}>
              Manifest
            </Button>
            <Button size="sm" colorScheme="blue" tabIndex={-1} isDisabled={!boxes.length}
              onClick={() => setAsk({ kind: "tag", lotNumber: lot, run: printTag })}>
              Pallet tag
            </Button>
          </Flex>
        </Flex>
      </Stack>

      <PalletNumberDialog ask={ask} onClose={() => setAsk(null)}
        onPrint={(palletNo) => { const a = ask; setAsk(null); a.run(palletNo); }} />
    </FloatingWindow>
  );
};

export default PalletScan;
