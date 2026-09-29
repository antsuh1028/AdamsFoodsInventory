import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex, Text, Input, Select, Button, useToast } from "@chakra-ui/react";
import axiosInstance from "../utils/axiosInstance";
import useLang from "../hooks/useLang";
import { canManageItems } from "../utils/getRole";
import { matchDescription, normaliseName } from "../utils/descriptionMatch";

// An item description picked from the standard list, or typed.
//
// Suggested, not enforced, like VendorInput: a new product still gets typed.
// The select is for tapping on an iPad, where a paired scanner hides the
// keyboard; the input keeps a native datalist because it never captures Enter.
// Nothing here is focusable beyond those two, so no button can eat a scan.

// Keeps a button from taking focus, so a scanner's Enter cannot press it.
const noFocus = { tabIndex: -1, onMouseDown: (e) => e.preventDefault() };

const ItemDescriptionInput = ({
  value, onChange, direction, size = "md", compact = false,
  listId, placeholder = "e.g. HUMERUS BONE", inputProps = {},
}) => {
  const { t } = useLang();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [adding, setAdding] = useState(false);
  const manager = canManageItems();

  const load = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/item-descriptions", { params: { direction } });
      setItems(data || []);
    } catch {
      // The list is a convenience; the field still works as plain text without it.
    }
  }, [direction]);

  useEffect(() => { load(); }, [load]);

  const names = useMemo(() => items.map((i) => i.name), [items]);
  // The most used float to the top of the tap list.
  const top = useMemo(() => items.filter((i) => i.uses > 0).slice(0, 8), [items]);
  const alpha = useMemo(() => [...names].sort(), [names]);
  const match = useMemo(() => matchDescription(value, names), [value, names]);

  const addToList = async () => {
    setAdding(true);
    try {
      const { data } = await axiosInstance.post("/item-descriptions",
        { direction, name: normaliseName(value) });
      onChange(data.name);
      await load();
      toast({ title: t("Added to the item list"), status: "success", duration: 2500, position: "top" });
    } catch (err) {
      toast({ title: t("Could not add it"), description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    } finally {
      setAdding(false);
    }
  };

  const id = listId || `item-descriptions-${direction}`;

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

      <Input size={size} bg="white" autoComplete="off" list={id}
        placeholder={compact ? "" : t(placeholder)} {...inputProps}
        value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <datalist id={id}>
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
        <Flex align="center" gap={2} mt={1} wrap="wrap">
          <Text fontSize="xs" color="gray.500">{t("Not on the item list")}</Text>
          {manager && (
            <Button size="xs" variant="ghost" colorScheme="blue" isLoading={adding}
              {...noFocus} onClick={addToList}>
              {t("Add to list")}
            </Button>
          )}
        </Flex>
      )}
    </Box>
  );
};

export default ItemDescriptionInput;
