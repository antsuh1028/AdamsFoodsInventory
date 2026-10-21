import React from "react";
import { Box, Button, Flex, Text, SimpleGrid, ButtonGroup } from "@chakra-ui/react";
import { kgToLb, toDisplay } from "../../utils/weight";

// An on-screen keypad drawn in the page, not summoned from the OS.

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

// Mirrors the server's DECIMAL_RE.
// because eslint flags the useless escape.
const partialRe = (maxDecimals) => (maxDecimals > 0
  ? new RegExp(`^\\d{0,5}(\\.\\d{0,${maxDecimals}})?$`)
  : /^\d{0,5}$/);
const finalRe = (maxDecimals) => (maxDecimals > 0
  ? new RegExp(`^\\d{1,5}(\\.\\d{1,${maxDecimals}})?$`)
  : /^\d{1,5}$/);

const NumericKeypad = ({
  value = "",
  onChange,
  onSubmit,
  onCancel,
  label = "Weight",
  unit = "LB",
  // Supplying this turns the unit into a control.
  onUnitChange,
  submitLabel = "Save",
  isDisabled = false,
  // 0 turns the pad into a whole-number counter and hides the point key.
  maxDecimals = 3,
  // Lets the caller drive the pad from outside — a batch panel types a count and a
  // weight into the SAME pad rather than putting two of them on a scanning screen.
  hideSubmit = false,
}) => {
  const press = (key) => {
    if (isDisabled) return;
    if (key === "⌫") {
      onChange(value.slice(0, -1));
      return;
    }
    const next = value + key;
    if (partialRe(maxDecimals).test(next)) onChange(next);
  };

  const valid = finalRe(maxDecimals).test(value) && parseFloat(value) > 0;

  return (
    <Box p={3} bg="white" borderRadius="md" border="1px solid" borderColor="gray.300">
      <Flex justify="space-between" align="center" mb={2} gap={2}>
        <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
          {label}
        </Text>
        {onUnitChange ? (
          <ButtonGroup size="xs" isAttached variant="outline">
            {["LB", "KG"].map((u) => (
              <Button
                key={u}
                onClick={() => onUnitChange(u)}
                isDisabled={isDisabled}
                colorScheme={unit === u ? "blue" : "gray"}
                variant={unit === u ? "solid" : "outline"}
                onMouseDown={(e) => e.preventDefault()}
                tabIndex={-1}
                px={3}
              >
                {u}
              </Button>
            ))}
          </ButtonGroup>
        ) : (
          <Text fontSize="xs" color="gray.400">{unit}</Text>
        )}
      </Flex>

      {/* The readout is a div, not an input: focusing an input is what makes
          iPadOS try to open a keyboard in the first place. */}
      <Box
        px={3} py={2} mb={3} minH="48px"
        bg="gray.50" borderRadius="md" border="2px solid"
        borderColor={value && !valid ? "red.300" : "gray.200"}
        fontSize="2xl" fontWeight="bold" textAlign="right"
        color={value ? "gray.800" : "gray.300"}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value || "0"}
      </Box>

      <SimpleGrid columns={3} spacing={2} mb={3}>
        {KEYS.filter((k) => maxDecimals > 0 || k !== ".").map((key) => (
          <Button
            key={key}
            onClick={() => press(key)}
            isDisabled={isDisabled}
            size="lg" height="52px" fontSize="xl"
            variant={key === "⌫" ? "outline" : "solid"}
            colorScheme={key === "⌫" ? "gray" : undefined}
            // A scanner types Enter after every scan.
            onMouseDown={(e) => e.preventDefault()}
            tabIndex={-1}
          >
            {key}
          </Button>
        ))}
      </SimpleGrid>

      {/* Said plainly, because the number the operator types is not the number
          that gets stored — and the manifest is in pounds either way. */}
      {unit === "KG" && valid && (
        <Text fontSize="xs" color="teal.600" mb={2} textAlign="right">
          Stored as {toDisplay(kgToLb(value))} LB
        </Text>
      )}

      <Flex gap={2} display={hideSubmit ? "none" : undefined}>
        {onCancel && (
          <Button flex={1} size="md" variant="ghost" onClick={onCancel} tabIndex={-1}>
            Cancel
          </Button>
        )}
        <Button
          flex={2} size="md" colorScheme="blue"
          onClick={() => onSubmit(value)}
          isDisabled={!valid || isDisabled}
          tabIndex={-1}
        >
          {submitLabel}
        </Button>
      </Flex>
    </Box>
  );
};

export default NumericKeypad;
