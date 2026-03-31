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
  const buttonMargin = useBreakpointValue({ base: "8px", md: "20px" });
  const buttonDirection = useBreakpointValue({ base: "column", sm: "row" });
  const containerWidth = useBreakpointValue({ base: "100%", sm: "auto" });
  
  return (
    <Flex
      direction={buttonDirection}
      overflowX="auto"
      width="100%"
      justifyContent="center"
      py={2}
    >
      <Flex
        direction={buttonDirection}
        wrap="nowrap"
        width={containerWidth}
        overflowX="auto"
        overflowY="hidden"
        css={{
          '&::-webkit-scrollbar': { height: '8px' },
          '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }
        }}
      >
        <Button
          colorScheme="green"
          margin={buttonMargin}
          onClick={onAdd}
          isDisabled={loading}
          size={buttonSize}
          flexShrink={0}
        >
          {loading ? <Spinner /> : "Add"}
        </Button>
        <Button
          colorScheme="blue"
          variant="outline"
          margin={buttonMargin}
          onClick={onFind}
          size={buttonSize}
          flexShrink={0}
        >
          Find
        </Button>
        <Button
          colorScheme="teal"
          variant="outline"
          margin={buttonMargin}
          onClick={onUpdate}
          type="submit"
          size={buttonSize}
          flexShrink={0}
        >
          Update
        </Button>
        <Button
          colorScheme="orange"
          variant="outline"
          margin={buttonMargin}
          onClick={onRemove}
          size={buttonSize}
          flexShrink={0}
        >
          Remove
        </Button>
        <Button
          colorScheme="red"
          margin={buttonMargin}
          onClick={onClear}
          size={buttonSize}
          flexShrink={0}
        >
          Clear
        </Button>
      </Flex>
    </Flex>
  );
};

export default ActionButtons;