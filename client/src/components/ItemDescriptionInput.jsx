import upperInput from "../utils/upperInput";
import React, { useEffect, useMemo, useState } from "react";
import { Box, Flex, Text, Input, Select, Button } from "@chakra-ui/react";
import axiosInstance from "../utils/axiosInstance";
import useLang from "../hooks/useLang";
import { matchDescription } from "../utils/descriptionMatch";

// An outgoing item description, picked from the standard list or typed.
//
// Suggested, not enforced, like VendorInput: a new product still gets typed.
// The select is for tapping on an iPad, where a paired scanner hides the
// keyboard; the input keeps a native datalist because it never captures Enter.
// Adding to the list is the Item List screen's job, where a typo is checked.

// Keeps a button from taking focus, so a scanner's Enter cannot press it.
const noFocus = { tabIndex: -1, onMouseDown: (e) => e.preventDefault() };

const ItemDescriptionInput = ({
  value, onChange, size = "md", compact = false,
  listId = "item-descriptions", placeholder = "e.g. HUMERUS BONE",
  endpoint = "/item-descriptions", allLabel = "All items", notOnList = "Not on the item list",
  // Told true when the user undoes a correction, so the server keeps it as typed too.
  onKeepChange,
}) => {
  const { t } = useLang();
  const [items, setItems] = useState([]);
  // What was typed before a correction, while the corrected name is still in the field.
  const [fixedFrom, setFixedFrom] = useState(null);
  const [kept, setKept] = useState(false);

  const setKeep = (v) => { setKept(v); if (onKeepChange) onKeepChange(v); };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axiosInstance.get(endpoint);
        if (!cancelled) setItems(data || []);
      } catch {
        // The list is a convenience; the field still works as plain text without it.
      }
    })();
    return () => { cancelled = true; };
  }, [endpoint]);

  const names = useMemo(() => items.map((i) => i.name), [items]);
  // The most used float to the top of the tap list.
  const top = useMemo(() => items.filter((i) => i.uses > 0).slice(0, 8), [items]);
  const alpha = useMemo(() => [...names].sort(), [names]);
  const match = useMemo(() => matchDescription(value, names), [value, names]);

  // A clear typo takes the list's spelling as soon as the field is left.
  const autoCorrect = () => {
    if (kept || (match.kind !== "spelling" && match.kind !== "near")) return;
    setFixedFrom(String(value || "").trim().toUpperCase());
    onChange(match.name);
  };

  const undo = () => {
    onChange(fixedFrom);
    setFixedFrom(null);
    setKeep(true);
  };

  const showFixed = fixedFrom && value === match.name && match.kind === "exact";

  return (
    <Box width="100%">
      {!compact && names.length > 0 && (
        <Select size={size} bg="white" mb={2}
          placeholder={t("Pick from the list…")}
          value={match.kind === "exact" ? match.name : ""}
          onChange={(e) => {
            if (e.target.value) { onChange(e.target.value); setFixedFrom(null); if (kept) setKeep(false); }
            e.target.blur();
          }}>
          {top.length > 0 && (
            <optgroup label={t("Most used")}>
              {top.map((i) => <option key={`top-${i.id}`} value={i.name}>{i.name}</option>)}
            </optgroup>
          )}
          <optgroup label={t(allLabel)}>
            {alpha.map((n) => <option key={n} value={n}>{n}</option>)}
          </optgroup>
        </Select>
      )}

      <Input size={size} bg="white" autoComplete="off" list={listId}
        placeholder={compact ? "" : t(placeholder)}
        value={value} onBlur={autoCorrect}
        onChange={(e) => {
          onChange(upperInput(e));
          setFixedFrom(null);
          if (kept) setKeep(false);
        }} />
      <datalist id={listId}>
        {names.map((n) => <option key={n} value={n} />)}
      </datalist>

      {showFixed && (
        <Flex align="center" gap={2} mt={1} wrap="wrap">
          <Text fontSize="xs" color="green.700">
            {t("Corrected from {from}", { from: fixedFrom })}
          </Text>
          <Button size="xs" variant="ghost" colorScheme="gray" {...noFocus} onClick={undo}>
            {t("Undo")}
          </Button>
        </Flex>
      )}
      {kept && match.kind !== "exact" && (
        <Text fontSize="xs" color="gray.600" mt={1}>{t("Kept as typed")}</Text>
      )}

      {!kept && (match.kind === "spelling" || match.kind === "near") && (
        <Flex align="center" gap={2} mt={1} wrap="wrap">
          <Text fontSize="xs" color="yellow.800">
            {match.kind === "spelling"
              ? t("The list spells it {name}", { name: match.name })
              : t("Did you mean {name}?", { name: match.name })}
          </Text>
          <Button size="xs" colorScheme="yellow" variant="outline" {...noFocus}
            onClick={() => { onChange(match.name); if (kept) setKeep(false); }}>
            {t("Use it")}
          </Button>
        </Flex>
      )}
      {!kept && match.kind === "none" && names.length > 0 && (
        <Text fontSize="xs" color="gray.500" mt={1}>{t(notOnList)}</Text>
      )}
    </Box>
  );
};

export default ItemDescriptionInput;
