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
}) => {
  const { t } = useLang();
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axiosInstance.get("/item-descriptions");
        if (!cancelled) setItems(data || []);
      } catch {
        // The list is a convenience; the field still works as plain text without it.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const names = useMemo(() => items.map((i) => i.name), [items]);
  // The most used float to the top of the tap list.
  const top = useMemo(() => items.filter((i) => i.uses > 0).slice(0, 8), [items]);
  const alpha = useMemo(() => [...names].sort(), [names]);
  const match = useMemo(() => matchDescription(value, names), [value, names]);

  return (
    <Box width="100%">
      {!compact && names.length > 0 && (
        <Select size={size} bg="white" mb={2}
          placeholder={t("Pick from the list…")}
          value={match.kind === "exact" ? match.name : ""}
          onChange={(e) => { if (e.target.value) onChange(e.target.value); e.target.blur(); }}>
          {top.length > 0 && (
            <optgroup label={t("Most used")}>
              {top.map((i) => <option key={`top-${i.id}`} value={i.name}>{i.name}</option>)}
            </optgroup>
          )}
          <optgroup label={t("All items")}>
            {alpha.map((n) => <option key={n} value={n}>{n}</option>)}
          </optgroup>
        </Select>
      )}

      <Input size={size} bg="white" autoComplete="off" list={listId}
        placeholder={compact ? "" : t(placeholder)}
        value={value} onChange={(e) => onChange(upperInput(e))} />
      <datalist id={listId}>
        {names.map((n) => <option key={n} value={n} />)}
      </datalist>

      {(match.kind === "spelling" || match.kind === "near") && (
        <Flex align="center" gap={2} mt={1} wrap="wrap">
          <Text fontSize="xs" color="yellow.800">
            {match.kind === "spelling"
              ? t("The list spells it {name}", { name: match.name })
              : t("Did you mean {name}?", { name: match.name })}
          </Text>
          <Button size="xs" colorScheme="yellow" variant="outline" {...noFocus}
            onClick={() => onChange(match.name)}>
            {t("Use it")}
          </Button>
        </Flex>
      )}
      {match.kind === "none" && names.length > 0 && (
        <Text fontSize="xs" color="gray.500" mt={1}>{t("Not on the item list")}</Text>
      )}
    </Box>
  );
};

export default ItemDescriptionInput;
