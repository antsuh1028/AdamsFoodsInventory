import React, { useState, useRef, useCallback } from "react";
import { FormLabel, Input, Select, VStack, Box, Text, useBreakpointValue } from "@chakra-ui/react";

export const SPECIES_OPTIONS = [
  { value: "Beef", label: "Beef" },
  { value: "Pork", label: "Pork" },
  { value: "Chicken", label: "Chicken" },
  { value: "Lamb", label: "Lamb" },
];

export const TYPE_OPTIONS = [
  { value: "raw", label: "Raw" },
  { value: "prc", label: "Processed" },
];

export const GRADE_OPTIONS = [
  { value: "Wagyu", label: "Wagyu" },
  { value: "Prime", label: "Prime" },
  { value: "Choice", label: "Choice" },
  { value: "No Roll/Ongrade", label: "No Roll/Ongrade" },
  { value: "Select", label: "Select" },
  { value: "N/A", label: "N/A" },
  { value: "Other", label: "Other" },
];

const MAX_SUGGESTIONS = 6;

export const AutocompleteInput = ({ value, suggestions, onChange, inputSize, bg, isInvalid, isReadOnly, placeholder, type }) => {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);

  const filtered = value.trim()
    ? suggestions.filter((s) => s.toLowerCase().includes(value.toLowerCase())).slice(0, MAX_SUGGESTIONS)
    : suggestions.slice(0, MAX_SUGGESTIONS);

  const handleChange = (e) => {
    onChange(e);
    setOpen(true);
  };

  const handleFocus = () => {
    setOpen(true);
  };

  const handleSelect = useCallback((s) => {
    onChange({ target: { value: s } });
    setOpen(false);
  }, [onChange]);

  const handleBlur = () => {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const handleMouseDown = () => {
    clearTimeout(blurTimer.current);
  };

  return (
    <Box position="relative" width="100%">
      <Input
        value={value}
        type={type}
        bg={bg}
        width="100%"
        size={inputSize}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        isInvalid={isInvalid}
        isReadOnly={isReadOnly}
        autoComplete="off"
        cursor={isReadOnly ? "default" : undefined}
        _readOnly={{ color: "gray.400", borderColor: "gray.200" }}
        sx={{ "&::-webkit-calendar-picker-indicator": { display: "none" } }}
      />
      {open && filtered.length > 0 && (
        <Box
          position="absolute"
          top="100%"
          left={0}
          right={0}
          zIndex={999}
          bg="white"
          border="1px"
          borderColor="gray.200"
          borderRadius="md"
          boxShadow="md"
          mt="2px"
          onMouseDown={handleMouseDown}
        >
          {filtered.map((s) => (
            <Box
              key={s}
              px={3}
              py={1.5}
              fontSize="sm"
              cursor="pointer"
              _hover={{ bg: "blue.50" }}
              onClick={() => handleSelect(s)}
            >
              <Text noOfLines={1}>{s}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export const FormField = ({
  label,
  value,
  type = "text",
  placeholder,
  onChange,
  width = "100%",
  options,
  bg = "white",
  isInvalid = false,
  isReadOnly = false,
  suggestions,
}) => {
  const inputSize = useBreakpointValue({ base: "sm", md: "md" });

  return (
    <VStack spacing={1} width={width}>
      <FormLabel marginTop="5px" marginBottom="5px" fontSize={{ base: "sm", md: "md" }} color={isInvalid ? "red.500" : undefined}>
        {label}
      </FormLabel>
      {type === "select" ? (
        <Select
          value={value}
          bg={bg}
          width="100%"
          size={inputSize}
          placeholder={placeholder}
          onChange={onChange}
          isInvalid={isInvalid}
          borderColor={isInvalid ? "red.400" : undefined}
          _hover={isInvalid ? { borderColor: "red.500" } : undefined}
        >
          {options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : suggestions ? (
        <AutocompleteInput
          value={value}
          suggestions={suggestions}
          onChange={onChange}
          inputSize={inputSize}
          bg={bg}
          isInvalid={isInvalid}
          isReadOnly={isReadOnly}
          placeholder={placeholder}
          type={type}
        />
      ) : (
        <Input
          value={value}
          type={type}
          bg={bg}
          width="100%"
          size={inputSize}
          placeholder={placeholder}
          onChange={onChange}
          isInvalid={isInvalid}
          isReadOnly={isReadOnly}
          autoComplete="off"
          cursor={isReadOnly ? "default" : undefined}
          _readOnly={{ color: "gray.400", borderColor: "gray.200" }}
          sx={{ "&::-webkit-calendar-picker-indicator": { display: "none" } }}
        />
      )}
    </VStack>
  );
};

export default FormField;
