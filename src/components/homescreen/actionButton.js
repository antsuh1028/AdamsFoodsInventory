import React from "react";
import { Button, HStack, Spinner } from "@chakra-ui/react";

const ActionButtons = ({
  onAdd,
  onFind,
  onUpdate,
  onRemove,
  onClear,
  loading,
}) => {
  return (
    <HStack spacing="5">
      <Button bg="green.200" _hover={{bg: "green.300", color:"white"}} margin="20px" onClick={onAdd} isDisabled={loading}>
        {loading ? <Spinner /> : "Add"}
      </Button>
      <Button bg="white" margin="20px" onClick={onFind}>
        Find
      </Button>
      <Button bg="white" margin="20px" onClick={onUpdate} type="submit">
        Update
      </Button>
      <Button bg="white" margin="20px" onClick={onRemove}>
        Remove
      </Button>
      <Button bg="red.200" _hover={{bg: "red.300", color:"white"}} margin="20px" onClick={onClear}>
        Clear
      </Button>
    </HStack>
  );
};

export default ActionButtons;
