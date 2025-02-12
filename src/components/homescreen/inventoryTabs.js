import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import {
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Text,
  Flex,
  List,
  ListItem,
  Box,
} from "@chakra-ui/react";

const InventoryLevelPanel = ({
  items,
  handleItemClick,
  level,
  DetailsPanel,
  selectedItem,
  handleSet,
}) => {
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!scrollContainerRef.current) return;

      const scrollAmount = 150;

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          scrollContainerRef.current.scrollBy({
            top: -scrollAmount,
            behavior: "smooth",
          });
          break;
        case "ArrowDown":
          event.preventDefault();
          scrollContainerRef.current.scrollBy({
            top: scrollAmount,
            behavior: "smooth",
          });
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleItemClickAndScroll = (item) => {
    handleItemClick(item);
    if (scrollContainerRef.current) {
      setTimeout(() => {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 50);
    }
  };

  const getFilterCondition = (item) => {
    if (level === 3) {
      return item.location[1] !== "1" && item.location[1] !== "2";
    }
    return item.location[1] === String(level);
  };

  const groupedItems = items
    .filter(getFilterCondition)
    .reduce((groups, item) => {
      const prefix = item.location[0];
      if (!groups[prefix]) {
        groups[prefix] = [];
      }
      groups[prefix].push(item);
      return groups;
    }, {});

  return (
    <TabPanel height="100%">
      <Flex
        ref={scrollContainerRef}
        bg="lightblue"
        width="100%"
        height="100%"
        direction="column"
        justifyContent="flex-start"
        alignItems="center"
        overflowY="auto"
      >
        <List spacing={3} width="90%" borderBottom="1px">
          {Object.entries(groupedItems)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([prefix, groupItems]) => (
              <ListItem key={prefix}>
                <Box
                  borderTop="1px"
                  borderBottom="1px"
                  display="flex"
                  justifyContent="flex-start"
                  alignItems="center"
                  pl={4}
                  height="5vh"
                >
                  <Text fontSize="xl" fontWeight="bold" mt={4} mb={2}>
                    {prefix}
                    {level}:
                  </Text>
                </Box>
                <List spacing={2}>
                  {groupItems.map((item, index) => (
                    <ListItem
                      key={`${item.location}-${index}`}
                      onClick={() => handleItemClickAndScroll(item)}
                    >
                      <Box
                        p={3}
                        shadow="md"
                        marginTop="10px"
                        borderWidth="1px"
                        borderRadius="md"
                        bg="white"
                        cursor="pointer"
                        _hover={{ bg: "gray.200" }}
                      >
                        <Text
                          as="span"
                          fontWeight="bold"
                        >{`${item.location}`}</Text>
                        {` - ${item.description} ${
                          level === 3
                            ? `: ${item.quantity} bx(s)`
                            : `- ${item.quantity} bx(s)`
                        }`}
                      </Box>
                    </ListItem>
                  ))}
                </List>
              </ListItem>
            ))}
          <Box></Box>
        </List>
        <DetailsPanel item={selectedItem} onSet={handleSet} />
      </Flex>
    </TabPanel>
  );
};

const InventoryTabs = ({
  items,
  handleItemClick,
  handleTabClick,
  DetailsPanel,
  selectedItem,
  handleSet,
}) => {
  return (
    <Tabs variant="enclosed" width="100%" height="100%">
      <TabList>
        {[1, 2, 3].map((level) => (
          <Tab
            key={`level-${level}`}
            bg="lightblue"
            border="1px"
            _hover={{ bg: "blue.100" }}
            onClick={handleTabClick}
            _selected={{
              bg: "blue.100",
              border: "1px solid gray",
            }}
          >
            Level {level}
          </Tab>
        ))}
      </TabList>

      <TabPanels border="1px" height="90%">
        {[1, 2, 3].map((level) => (
          <InventoryLevelPanel
            key={`panel-${level}`}
            items={items}
            handleItemClick={handleItemClick}
            level={level}
            DetailsPanel={DetailsPanel}
            selectedItem={selectedItem}
            handleSet={handleSet}
          />
        ))}
      </TabPanels>
    </Tabs>
  );
};

InventoryTabs.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      location: PropTypes.string.isRequired,
      description: PropTypes.string.isRequired,
      quantity: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
        .isRequired,
    })
  ).isRequired,
  handleItemClick: PropTypes.func.isRequired,
  handleTabClick: PropTypes.func.isRequired,
  DetailsPanel: PropTypes.elementType.isRequired,
  selectedItem: PropTypes.object,
  handleSet: PropTypes.func.isRequired,
};

InventoryLevelPanel.propTypes = {
  items: PropTypes.array.isRequired,
  handleItemClick: PropTypes.func.isRequired,
  level: PropTypes.number.isRequired,
  DetailsPanel: PropTypes.elementType.isRequired,
  selectedItem: PropTypes.object,
  handleSet: PropTypes.func.isRequired,
};

export default InventoryTabs;
