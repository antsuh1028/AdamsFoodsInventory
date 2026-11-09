import { Badge, Button, Flex, IconButton, Input, Tooltip } from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from "@chakra-ui/icons";
import upperInput from "../../utils/upperInput";

// The homescreen's one-line find: location, lot and item, with the full form folded away until needed.

const QUICK = ["location", "lot", "description"];

// onPopOut: shows a pop-out icon; onToggleForm: shows the fold-out toggle (left off inside the window).
const FindBar = ({ formData, onInputChange, onFind, onClear, formOpen, onToggleForm, onPopOut }) => {
  // Other fields filled in the folded form still narrow a Find, so say how many.
  const hidden = Object.entries(formData)
    .filter(([k, v]) => !QUICK.includes(k) && String(v ?? "").trim()).length;
  const enter = (e) => { if (e.key === "Enter") onFind(); };

  return (
    <Flex gap={2} wrap="wrap" align="center">
      <Input size="sm" bg="white" flex={{ base: "1 1 30%", md: "0 0 130px" }} placeholder="Location"
        value={formData.location} onChange={(e) => onInputChange("location", upperInput(e))} onKeyDown={enter} autoComplete="off" />
      <Input size="sm" bg="white" flex={{ base: "1 1 30%", md: "0 0 130px" }} placeholder="Lot"
        value={formData.lot} onChange={(e) => onInputChange("lot", e.target.value)} onKeyDown={enter} autoComplete="off" />
      <Input size="sm" bg="white" flex="1 1 200px" placeholder="Item description"
        value={formData.description} onChange={(e) => onInputChange("description", e.target.value)} onKeyDown={enter} autoComplete="off" />
      <Button size="sm" colorScheme="blue" onClick={onFind}>Find</Button>
      <Button size="sm" variant="ghost" colorScheme="red" onClick={onClear}>Clear</Button>
      {onToggleForm && (
        <Button size="sm" variant="outline" onClick={onToggleForm}
          rightIcon={formOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}>
          {formOpen ? "Hide form" : "Full form"}
          {!formOpen && hidden > 0 && <Badge ml={2} colorScheme="blue">+{hidden}</Badge>}
        </Button>
      )}
      {onPopOut && (
        <Tooltip label="Pop out into a window">
          <IconButton size="sm" variant="ghost" aria-label="Pop out into a window" icon={<ExternalLinkIcon />} onClick={onPopOut} />
        </Tooltip>
      )}
    </Flex>
  );
};

export default FindBar;
