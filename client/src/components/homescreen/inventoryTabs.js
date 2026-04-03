import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
  Checkbox,
  Button,
} from "@chakra-ui/react";

const getAgeDays = (packdate, date_recvd) => {
  const str = packdate || date_recvd;
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
};

const AGE_DOT = [
  { max: 30,  color: "green.400" },
  { max: 60,  color: "yellow.400" },
  { max: 90,  color: "orange.400" },
  { max: Infinity, color: "red.400" },
];

const getAgeColor = (days) => {
  if (days === null) return null;
  return AGE_DOT.find((b) => days < b.max)?.color ?? "red.400";
};

const InventoryLevelPanel = ({
  items,
  handleItemClick,
  level,
  selectedItem,
  flashLocation,
  selectedIds,
  onToggleSelect,
  onToggleGroup,
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
            .map(([prefix, groupItems]) => {
              const groupIds = groupItems.map((i) => i._id).filter(Boolean);
              const allSelected = groupIds.length > 0 && groupIds.every((id) => selectedIds.has(id));
              return (
                <ListItem key={prefix}>
                  <Box pl={1} pt={2} pb={1}>
                    <Flex align="center" justify="space-between">
                      <Text fontSize="xs" fontWeight="bold" color="gray.400" letterSpacing="wider" textTransform="uppercase">
                        {prefix}{level}
                      </Text>
                      {groupIds.length > 0 && (
                        <Text
                          fontSize="xs"
                          color={allSelected ? "red.400" : "gray.300"}
                          cursor="pointer"
                          fontWeight="medium"
                          _hover={{ color: "red.400" }}
                          onClick={() => onToggleGroup(groupIds, !allSelected)}
                          userSelect="none"
                        >
                          {allSelected ? "Deselect" : "All"}
                        </Text>
                      )}
                    </Flex>
                  </Box>
                  <List spacing={1}>
                    {groupItems.map((item, index) => {
                      const isSelected = selectedItem?.location === item.location;
                      const isFlashing = flashLocation === item.location;
                      const isChecked = !!(item._id && selectedIds.has(item._id));
                      const ageDays = getAgeDays(item.packdate, item.date_recvd);
                      const ageColor = getAgeColor(ageDays);
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
                            borderColor={isChecked ? "red.100" : isSelected ? "blue.300" : "gray.200"}
                            bg={isChecked ? "red.50" : isSelected ? "blue.50" : "white"}
                            cursor="pointer"
                            _hover={{ bg: isChecked ? "red.50" : isSelected ? "blue.100" : "gray.50", borderColor: isChecked ? "red.200" : "blue.200" }}
                            transition="all 0.15s"
                            sx={isFlashing ? {
                              animation: "itemFlash 2.5s ease-out forwards",
                              "@keyframes itemFlash": {
                                "0%":   { background: "var(--chakra-colors-green-100)", borderColor: "var(--chakra-colors-green-400)" },
                                "60%":  { background: "var(--chakra-colors-green-50)",  borderColor: "var(--chakra-colors-green-200)" },
                                "100%": { background: "var(--chakra-colors-white)",      borderColor: "var(--chakra-colors-gray-100)" },
                              },
                            } : undefined}
                          >
                            <Flex justify="space-between" align="center">
                              <Flex align="center" gap={2} flex={1} minW={0}>
                                <Checkbox
                                  size="sm"
                                  colorScheme="red"
                                  isChecked={isChecked}
                                  onChange={(e) => { e.stopPropagation(); if (item._id) onToggleSelect(item._id); }}
                                  onClick={(e) => e.stopPropagation()}
                                  opacity={isChecked ? 1 : 0.45}
                                  _hover={{ opacity: 1 }}
                                  flexShrink={0}
                                />
                                <Text fontSize="sm" fontWeight="semibold" color={isChecked ? "red.400" : isSelected ? "blue.700" : "gray.700"} noOfLines={1}>
                                  {item.location}
                                </Text>
                              </Flex>
                              <Flex align="center" gap={1.5} flexShrink={0}>
                                  <Box
                                    w="7px"
                                    h="7px"
                                    borderRadius="full"
                                    bg={ageColor ? ageColor : "gray.400"}
                                    flexShrink={0}
                                    title={ageDays !== null ? `${ageDays}d old` : undefined}
                                  />
                                <Text fontSize="xs" color="gray.400">
                                  {item.quantity} bx
                                </Text>
                              </Flex>
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
              );
            })}
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
  flashLocation,
  onBulkRemove,
}) => {
  const [tabIndex, setTabIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set());

  useEffect(() => {
    if (flashLocation && flashLocation.length >= 2) {
      const level = parseInt(flashLocation[1]);
      if (level >= 1 && level <= 3) setTabIndex(level - 1);
    }
  }, [flashLocation]);

  // Prune selections that no longer exist in items
  useEffect(() => {
    const existingIds = new Set(items.map((i) => i._id).filter(Boolean));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => existingIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const handleToggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      if (!prev.has(id) && prev.size >= 10) return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleGroup = useCallback((ids, select) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (select) {
        for (const id of ids) {
          if (next.size >= 10) break;
          next.add(id);
        }
      } else {
        ids.forEach((id) => next.delete(id));
      }
      return next;
    });
  }, []);

  const handleBulkRemove = useCallback(() => {
    const selectedItems = items.filter((item) => item._id && selectedIds.has(item._id));
    onBulkRemove([...selectedIds], selectedItems, () => setSelectedIds(new Set()));
  }, [selectedIds, items, onBulkRemove]);

  return (
    <Tabs variant="enclosed" width="100%" height="100%" display="flex" flexDirection="column" index={tabIndex} onChange={(i) => { setTabIndex(i); handleTabClick(); }}>
      <TabList borderBottom="2px" borderColor="gray.100" px={2} pt={1}>
        {[1, 2, 3].map((level) => (
          <Tab
            key={`level-${level}`}
            fontWeight="semibold"
            fontSize="sm"
            _hover={{ bg: "blue.50" }}
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

      <Flex px={3} py={1} borderBottom="1px" borderColor="gray.100" gap={3} align="center" bg="gray.50" flexShrink={0}>
        {[
          { color: "green.400",  label: "<30d" },
          { color: "yellow.400", label: "30-60d" },
          { color: "orange.400", label: "60-90d" },
          { color: "red.400",    label: "90d+" },
          { color: "gray.400",    label: "N/A" },
        ].map(({ color, label }) => (
          <Flex key={label} align="center" gap={1}>
            <Box w="7px" h="7px" borderRadius="full" bg={color} flexShrink={0} />
            <Text fontSize="10px" color="gray.400">{label}</Text>
          </Flex>
        ))}
      </Flex>

      {selectedIds.size > 0 && (
        <Flex
          px={3}
          py={1.5}
          bg="red.50"
          borderBottom="1px"
          borderColor="red.100"
          align="center"
          justify="space-between"
          flexShrink={0}
        >
          <Text fontSize="xs" color="red.500">
            {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected
          </Text>
          <Flex gap={2}>
            <Button
              size="xs"
              variant="ghost"
              color="gray.400"
              _hover={{ color: "gray.600" }}
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
            <Button
              size="xs"
              colorScheme="red"
              borderRadius="md"
              onClick={handleBulkRemove}
            >
              Remove {selectedIds.size}
            </Button>
          </Flex>
        </Flex>
      )}

      <TabPanels flex={1} minH={0} border="0">
        {[1, 2, 3].map((level) => (
          <InventoryLevelPanel
            key={`panel-${level}`}
            items={items}
            handleItemClick={handleItemClick}
            level={level}
            selectedItem={selectedItem}
            flashLocation={flashLocation}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleGroup={handleToggleGroup}
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
  onBulkRemove: PropTypes.func.isRequired,
};

InventoryLevelPanel.propTypes = {
  items: PropTypes.array.isRequired,
  handleItemClick: PropTypes.func.isRequired,
  level: PropTypes.number.isRequired,
  selectedItem: PropTypes.object,
  selectedIds: PropTypes.instanceOf(Set).isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onToggleGroup: PropTypes.func.isRequired,
};

export default InventoryTabs;
