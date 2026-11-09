import { useContext, useEffect, useRef } from "react";
import { Badge, Box, Button, CloseButton, Flex, Text } from "@chakra-ui/react";
import { FormContext } from "../../utils/homescreen/formContext";
import printDetails from "../../utils/printDetails";

// Everything at one freezer location, opened by tapping a cell: beside the map on desktop, under it on the tablet.

const ageOf = (dateStr) => {
  const d = dateStr ? new Date(dateStr) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d) / 86400000));
};
const ageText = (dateStr) => { const a = ageOf(dateStr); return a === null ? "" : `${a} day${a === 1 ? "" : "s"} old`; };

const MapCellPanel = ({ location, news = [], olds = [], onClose, onCloseMap, onMove }) => {
  const { setFormData, setCurrentItem, onScannerAdd } = useContext(FormContext);
  const ref = useRef(null);
  const empty = !news.length && !olds.length;

  // Under the map it can open off screen, so bring it into view.
  useEffect(() => {
    if (location && ref.current) ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [location]);

  // Fills the homescreen form with an old row so it can be updated or removed.
  const setItem = (item) => {
    setFormData({
      location: item.location || "", lot: item.lot || "", vendor: item.vendor || "", brand: item.brand || "",
      species: item.species || "", description: item.description || "", grade: item.grade || "",
      quantity: item.quantity || "", weight: item.weight || "", packdate: item.packdate || "",
      date_recvd: item.date_recvd || "", est: item.est || "", type: item.type || "", price: item.price || "",
    });
    setCurrentItem(item);
    onClose();
    onCloseMap();
  };

  if (!location) return null;

  return (
    <Box ref={ref} w={{ base: "100%", lg: "300px" }} flexShrink={0} alignSelf="flex-start"
      border="1px solid" borderColor="gray.200" borderRadius="md" bg="white" boxShadow="sm"
      maxH={{ lg: "75vh" }} display="flex" flexDirection="column">
      <Flex align="flex-start" justify="space-between" px={3} pt={3} pb={2} borderBottom="1px solid" borderColor="gray.100">
        <Box>
          <Text fontFamily="mono" fontWeight="700" fontSize="lg">{location}</Text>
          <Text fontSize="sm" color="gray.500">
            {empty ? "Empty location" : `${news.length + olds.length} thing${news.length + olds.length === 1 ? "" : "s"} here`}
          </Text>
        </Box>
        <CloseButton size="sm" onClick={onClose} />
      </Flex>
      <Box px={3} py={2} overflowY="auto" flex={1}>
        {news.map((p) => (
          <Box key={`${p.lotId}-${p.palletNo}-${p.item}`} p={3} mb={2} borderRadius="md" border="1px solid" borderColor="teal.200" bg="teal.50">
            <Flex justify="space-between" align="center">
              <Text fontWeight="700">Lot {p.lotNumber}</Text>
              <Badge colorScheme="teal">new</Badge>
            </Flex>
            <Text fontSize="sm">{p.item}</Text>
            <Text fontSize="sm" color="gray.600" style={{ fontVariantNumeric: "tabular-nums" }}>
              Pallet {p.palletNo} · {p.boxes} bx · {p.lb} lb
            </Text>
            <Text fontSize="xs" color="gray.500">{[p.vendor, p.received && `received ${p.received}`, ageText(p.received)].filter(Boolean).join(" · ")}</Text>
            <Button size="xs" mt={2} variant="outline" colorScheme="blue" onClick={() => onMove(p, "new")}>Move pallet</Button>
          </Box>
        ))}
        {olds.map((r) => (
          <Box key={r._id} p={3} mb={2} borderRadius="md" border="1px solid" borderColor="gray.200">
            <Flex justify="space-between" align="center" gap={2}>
              <Text fontWeight="700" noOfLines={1}>{r.lot ? `Lot ${r.lot}` : "No lot"}</Text>
              <Badge colorScheme="gray">old</Badge>
            </Flex>
            <Text fontSize="sm">{r.description}</Text>
            <Text fontSize="sm" color="gray.600" style={{ fontVariantNumeric: "tabular-nums" }}>
              {r.quantity || (r.boxes || []).length} bx · {r.weight || "?"} lb
            </Text>
            <Text fontSize="xs" color="gray.500">
              {[r.vendor, r.brand, r.grade, r.packdate && `packed ${r.packdate}`, ageText(r.packdate || r.date_recvd)].filter(Boolean).join(" · ")}
            </Text>
            <Flex gap={2} mt={2} wrap="wrap">
              <Button size="xs" colorScheme="blue" onClick={() => setItem(r)}>Set in form</Button>
              <Button size="xs" variant="outline" colorScheme="blue" onClick={() => onMove(r, "old")}>Move</Button>
              <Button size="xs" variant="outline" onClick={() => printDetails(r)}>Print</Button>
            </Flex>
          </Box>
        ))}
      </Box>
      {!empty && (
        <Box px={3} pb={3} pt={1}>
          <Button w="full" size="sm" colorScheme="teal" variant="outline"
            onClick={() => { onScannerAdd(location); onClose(); onCloseMap(); }}>
            Find {location} in the list
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default MapCellPanel;
