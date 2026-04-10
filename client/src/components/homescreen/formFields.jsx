import React from "react";
import { FormLabel, Input, Select, VStack, useBreakpointValue } from "@chakra-ui/react";

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
  const listId = suggestions ? `${label.toLowerCase().replace(/\s+/g, "-")}-suggestions` : undefined;

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
      ) : (
        <>
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
            list={listId}
            autoComplete="off"
            cursor={isReadOnly ? "default" : undefined}
            _readOnly={{ color: "gray.400", borderColor: "gray.200" }}
            sx={{
              "&::-webkit-calendar-picker-indicator": { display: "none" },
              "&::-webkit-list-button": { display: "none" },
            }}
          />
          {suggestions && (
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </>
      )}
    </VStack>
  );
};

export default FormField;
