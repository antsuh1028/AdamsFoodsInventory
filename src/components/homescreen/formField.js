// src/components/homescreen/FormField.js
import React from 'react';
import { FormLabel, Input, Select, VStack } from '@chakra-ui/react';

export const SPECIES_OPTIONS = [
  { value: "Beef", label: "Beef" },
  { value: "Pork", label: "Pork" },
  { value: "Chicken", label: "Chicken" },
  { value: "Lamb", label: "Lamb" }
];

export const GRADE_OPTIONS = [
  { value: "Wagyu", label: "Wagyu" },
  { value: "Prime", label: "Prime" },
  { value: "Choice", label: "Choice" },
  { value: "No Roll/Ongrade", label: "No Roll/Ongrade" },
  { value: "Select", label: "Select" },
  { value: "N/A", label: "N/A" },
  { value: "Other", label: "Other" }
];

export const FormField = ({ 
  label, 
  value, 
  type = "text", 
  placeholder, 
  onChange, 
  width = "100%",
  options,
  bg = "white"
}) => {
  return (
    <VStack spacing={1} width={width}>
      <FormLabel marginTop="5px" marginBottom="5px">
        {label}
      </FormLabel>
      {type === "select" ? (
        <Select
          value={value}
          bg={bg}
          width="100%"
          placeholder={placeholder}
          onChange={onChange}
        >
          {options?.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          value={value}
          type={type}
          bg={bg}
          width="100%"
          placeholder={placeholder}
          onChange={onChange}
        />
      )}
    </VStack>
  );
};

export default FormField;