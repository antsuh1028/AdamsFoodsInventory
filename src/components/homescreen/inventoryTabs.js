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
  selectedItem,
}) => {
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!scrollContainerRef.current) return;
      const scrollAmount = 150;
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          scrollContainerRef.current.scrollBy({ top: -scrollAmount, behavior: "smooth" });
          break;
        case "ArrowDown":
          event.preventDefault();
          scrollContainerRef.current.scrollBy({ top: scrollAmount, behavior: "smooth" });
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const getFilterCondition = (item) => {
    if (level === 3) return item.location[1] !== "1" && item.location[1] !== "2";
    return item.location[1] === String(level);
  };

  const groupedItems = items
    .filter(getFilterCondition)
    .reduce((groups, item) => {
      const prefix = item.location[0];
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(item);
      return groups;
    }, {});

  return (
    <TabPanel height="100%" p={0}>
      <Flex
        ref={scrollContainerRef}
        width="100%"
        height="100%"
        direction="column"
        overflowY="auto"
        px={3}
        py={2}
      >
        <List spacing={2} width="100%">
          {Object.entries(groupedItems)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([prefix, groupItems]) => (
              <ListItem key={prefix}>
                <Box
                  pl={1}
                  pt={2}
                  pb={1}
                >
                  <Text fontSize="xs" fontWeight="bold" color="gray.400" letterSpacing="wider" textTransform="uppercase">
                    {prefix}{level}
                  </Text>
                </Box>
                <List spacing={1}>
                  {groupItems.map((item, index) => {
                    const isSelected = selectedItem?.location === item.location;
                    return (
                      <ListItem
                        key={`${item.location}-${index}`}
                        onClick={() => handleItemClick(item)}
                      >
                        <Box
                          px={3}
                          py={2}
                          borderRadius="md"
                          border="1px"
                          borderColor={isSelected ? "blue.300" : "gray.100"}
                          bg={isSelected ? "blue.50" : "white"}
                          cursor="pointer"
                          _hover={{ bg: isSelected ? "blue.100" : "gray.50", borderColor: "blue.200" }}
                          transition="all 0.15s"
                        >
                          <Flex justify="space-between" align="center">
                            <Text fontSize="sm" fontWeight="semibold" color={isSelected ? "blue.700" : "gray.700"}>
                              {item.location}
                            </Text>
                            <Text fontSize="xs" color="gray.400">
                              {item.quantity} bx
                            </Text>
                          </Flex>
                          <Text fontSize="xs" color="gray.500" noOfLines={1} mt={0.5}>
                            {item.description}
                          </Text>
                        </Box>
                      </ListItem>
                    );
                  })}
                </List>
              </ListItem>
            ))}
        </List>
      </Flex>
    </TabPanel>
  );
};

const InventoryTabs = ({
  items,
  handleItemClick,
  handleTabClick,
  selectedItem,
}) => {
  return (
    <Tabs variant="enclosed" width="100%" height="100%" display="flex" flexDirection="column">
      <TabList borderBottom="2px" borderColor="gray.100" px={2} pt={1}>
        {[1, 2, 3].map((level) => (
          <Tab
            key={`level-${level}`}
            fontWeight="semibold"
            fontSize="sm"
            _hover={{ bg: "blue.50" }}
            onClick={handleTabClick}
            _selected={{
              color: "blue.600",
              borderColor: "blue.500",
              borderBottomColor: "white",
            }}
          >
            Level {level}
          </Tab>
        ))}
      </TabList>

      <TabPanels flex={1} minH={0} border="0">
        {[1, 2, 3].map((level) => (
          <InventoryLevelPanel
            key={`panel-${level}`}
            items={items}
            handleItemClick={handleItemClick}
            level={level}
            selectedItem={selectedItem}
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
      quantity: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    })
  ).isRequired,
  handleItemClick: PropTypes.func.isRequired,
  handleTabClick: PropTypes.func.isRequired,
  selectedItem: PropTypes.object,
};

InventoryLevelPanel.propTypes = {
  items: PropTypes.array.isRequired,
  handleItemClick: PropTypes.func.isRequired,
  level: PropTypes.number.isRequired,
  selectedItem: PropTypes.object,
};

export default InventoryTabs;
