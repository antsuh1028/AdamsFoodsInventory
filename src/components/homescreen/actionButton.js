import React from "react";
import { Button, Spinner, Flex, useBreakpointValue } from "@chakra-ui/react";

const ActionButtons = ({
  onAdd,
  onFind,
  onUpdate,
  onRemove,
  onClear,
  loading,
}) => {
  const buttonSize = useBreakpointValue({ base: "sm", md: "md" });

  return (
    <Flex width="100%" justifyContent="center" py={2} px={1}>
      <Flex wrap="wrap" gap={2} justifyContent="center" width="100%">
        <Button
          colorScheme="green"
          onClick={onAdd}
          isDisabled={loading}
          size={buttonSize}
          flex={{ base: "1 1 45%", sm: "0 0 auto" }}
        >
          {loading ? <Spinner /> : "Add"}
        </Button>
        <Button
          colorScheme="blue"
          variant="outline"
          onClick={onFind}
          size={buttonSize}
          flex={{ base: "1 1 45%", sm: "0 0 auto" }}
        >
          Find
        </Button>
        <Button
          colorScheme="teal"
          variant="outline"
          onClick={onUpdate}
          type="submit"
          size={buttonSize}
          flex={{ base: "1 1 45%", sm: "0 0 auto" }}
        >
          Update
        </Button>
        <Button
          colorScheme="orange"
          variant="outline"
          onClick={onRemove}
          size={buttonSize}
          flex={{ base: "1 1 45%", sm: "0 0 auto" }}
        >
          Remove
        </Button>
        <Button
          colorScheme="red"
          onClick={onClear}
          size={buttonSize}
          flex={{ base: "1 1 45%", sm: "0 0 auto" }}
        >
          Clear
        </Button>
      </Flex>
    </Flex>
  );
};

export default ActionButtons;