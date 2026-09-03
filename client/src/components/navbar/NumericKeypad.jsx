import React from "react";
import { Box, Button, Flex, Text, SimpleGrid, ButtonGroup } from "@chakra-ui/react";
import { kgToLb } from "../../utils/weight";

// An on-screen keypad drawn in the page, not summoned from the OS.
//
// A Bluetooth barcode scanner pairs as a hardware keyboard, and iPadOS hides
// the software keyboard whenever one is connected. That is correct behaviour
// for a real keyboard and useless here: the operator cannot type a weight
// without unpairing the scanner they are holding.
//
// These are buttons, so nothing depends on the OS keyboard existing. They are
// also large enough to hit wearing freezer gloves, which the iPadOS keyboard
// is not.

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

// Mirrors the server's DECIMAL_RE. Typing is constrained as it happens rather
// than validated afterwards, so an impossible weight cannot be assembled — a
// second decimal point or a fourth decimal place is simply not accepted.
const wouldBeValid = (next) => next === "" || /^\d{0,5}(\.\d{0,3})?$/.test(next);

const NumericKeypad = ({
  value = "",
  onChange,
  onSubmit,
  onCancel,
  label = "Weight",
  unit = "LB",
  // Supplying this turns the unit into a control. A box labelled in kilograms
  // has to be enterable as kilograms — making the operator convert 34.5 kg in
  // their head is how a wrong weight ends up on a manifest.
  onUnitChange,
  submitLabel = "Save",
  isDisabled = false,
}) => {
  const press = (key) => {
    if (isDisabled) return;
    if (key === "⌫") {
      onChange(value.slice(0, -1));
      return;
    }
    const next = value + key;
    if (wouldBeValid(next)) onChange(next);
  };

  const valid = /^\d{1,5}(\.\d{1,3})?$/.test(value) && parseFloat(value) > 0;

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
        {KEYS.map((key) => (
          <Button
            key={key}
            onClick={() => press(key)}
            isDisabled={isDisabled}
            size="lg" height="52px" fontSize="xl"
            variant={key === "⌫" ? "outline" : "solid"}
            colorScheme={key === "⌫" ? "gray" : undefined}
            // A scanner types Enter after every scan. Without this the keypad
            // buttons keep focus and a scan would re-press whichever was last
            // touched instead of registering as a scan.
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
          Stored as {kgToLb(value)} LB
        </Text>
      )}

      <Flex gap={2}>
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
