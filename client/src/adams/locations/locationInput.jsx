import upperInput from "../../utils/upperInput";
import React from "react";
import {
  InputGroup,
  Input,
  InputRightElement,
  Badge,
  VStack,
  FormLabel,
} from "@chakra-ui/react";

const LocationInput = ({ value, onChange, badgeState, isInvalid = false }) => {
  const inputSize = "sm";
  const getBadgeProps = (state) => {
    switch (state) {
      case "in":
        return { colorScheme: "gray", children: "Occupied" };
      case "out":
        return { colorScheme: "green", children: "Empty" };
      case "error":
        return { colorScheme: "red", children: "Invalid" };
      default:
        return null;
    }
  };

  return (
    <VStack spacing={0.5} width="100%" align="stretch">
      <FormLabel m={0} fontSize="xs" color={isInvalid ? "red.500" : "gray.600"}>
        Location
      </FormLabel>
      <InputGroup size={inputSize}>
        <Input
          required
          value={value}
          type="text"
          bg="white"
          width="100%"
          placeholder="Enter Location"
          onChange={(e) => onChange(upperInput(e))}
          isInvalid={isInvalid}
          autoComplete="off"
        />
        <InputRightElement width="auto" marginRight="5px">
          {badgeState && <Badge {...getBadgeProps(badgeState)} px={2} />}
        </InputRightElement>
      </InputGroup>
    </VStack>
  );
};

export default LocationInput;
