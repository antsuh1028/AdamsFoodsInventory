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
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
} from "@chakra-ui/react";
import { SearchIcon, CloseIcon } from "@chakra-ui/icons";

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

  const getFilterCondition = (item) => item.location[1] === String(level);

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
                                <Box flexShrink={0} onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    size="sm"
                                    colorScheme="red"
                                    isChecked={isChecked}
                                    onChange={() => { if (item._id) onToggleSelect(item._id); }}
                                    opacity={isChecked ? 1 : 0.45}
                                    _hover={{ opacity: 1 }}
                                  />
                                </Box>
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

const InventoryOtherPanel = ({
  items,
  handleItemClick,
  selectedItem,
  flashLocation,
  selectedIds,
  onToggleSelect,
  onToggleGroup,
}) => {
  const scrollContainerRef = useRef(null);

  const otherItems = items.filter(
    (item) => !["1", "2", "3"].includes(item.location[1]) && item.location?.toUpperCase() !== "NOBLESSE TRADING"
  );

  const groupedItems = otherItems.reduce((groups, item) => {
    const key = item.location;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
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
        {otherItems.length === 0 ? (
          <Text fontSize="sm" color="gray.300" mt={4} textAlign="center">No items</Text>
        ) : (
          <List spacing={2} width="100%">
            {Object.entries(groupedItems)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([locationKey, groupItems]) => {
                const groupIds = groupItems.map((i) => i._id).filter(Boolean);
                const allSelected = groupIds.length > 0 && groupIds.every((id) => selectedIds.has(id));
                return (
                  <ListItem key={locationKey}>
                    <Box pl={1} pt={2} pb={1}>
                      <Flex align="center" justify="space-between">
                        <Text fontSize="xs" fontWeight="bold" color="gray.400" letterSpacing="wider" textTransform="uppercase">
                          {locationKey}
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
                        const isSelected = selectedItem?.location === item.location && selectedItem?._id === item._id;
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
                                  <Box flexShrink={0} onClick={(e) => e.stopPropagation()}>
                                    <Checkbox
                                      size="sm"
                                      colorScheme="red"
                                      isChecked={isChecked}
                                      onChange={() => { if (item._id) onToggleSelect(item._id); }}
                                      opacity={isChecked ? 1 : 0.45}
                                      _hover={{ opacity: 1 }}
                                    />
                                  </Box>
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
        )}
      </Flex>
    </TabPanel>
  );
};

const NoblessePanel = ({ items, handleItemClick, selectedItem, selectedIds, onToggleSelect }) => {
  const scrollRef = useRef(null);
  return (
    <Flex ref={scrollRef} width="100%" height="100%" direction="column" overflowY="auto" px={3} py={2}>
      {items.length === 0 ? (
        <Text fontSize="sm" color="gray.300" mt={4} textAlign="center">No items at Noblesse Trading</Text>
      ) : (
        <>
          <Box pl={1} pt={2} pb={1}>
            <Text fontSize="xs" fontWeight="bold" color="orange.300" letterSpacing="wider" textTransform="uppercase">
              Noblesse Trading · {items.length} item{items.length !== 1 ? "s" : ""}
            </Text>
          </Box>
          <List spacing={1} width="100%">
            {items.map((item, i) => {
              const isSelected = selectedItem?._id === item._id;
              const isChecked = !!(item._id && selectedIds.has(item._id));
              const ageDays = getAgeDays(item.packdate, item.date_recvd);
              const ageColor = getAgeColor(ageDays);
              return (
                <ListItem key={item._id || i} onClick={() => handleItemClick(item)}>
                  <Box
                    px={3} py={2}
                    borderRadius="md"
                    border="1px"
                    borderColor={isChecked ? "red.100" : isSelected ? "orange.300" : "gray.200"}
                    bg={isChecked ? "red.50" : isSelected ? "orange.50" : "white"}
                    cursor="pointer"
                    _hover={{ bg: isSelected ? "orange.100" : "gray.50", borderColor: "orange.200" }}
                    transition="all 0.15s"
                  >
                    <Flex justify="space-between" align="center">
                      <Flex align="center" gap={2} flex={1} minW={0}>
                        <Box flexShrink={0} onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            size="sm"
                            colorScheme="red"
                            isChecked={isChecked}
                            onChange={() => { if (item._id) onToggleSelect(item._id); }}
                            opacity={isChecked ? 1 : 0.45}
                            _hover={{ opacity: 1 }}
                          />
                        </Box>
                        <Text fontSize="sm" fontWeight="semibold" color={isSelected ? "orange.700" : "gray.700"} noOfLines={1}>
                          {item.vendor || item.lot || "—"}
                        </Text>
                      </Flex>
                      <Flex align="center" gap={1.5} flexShrink={0}>
                        <Box w="7px" h="7px" borderRadius="full" bg={ageColor ?? "gray.400"} title={ageDays !== null ? `${ageDays}d old` : undefined} />
                        <Text fontSize="xs" color="gray.400">{item.quantity} bx</Text>
                      </Flex>
                    </Flex>
                    <Text fontSize="xs" color="gray.500" noOfLines={1} mt={0.5}>{item.description}</Text>
                    <Text fontSize="10px" color="gray.400" mt={0.5}>Lot: {item.lot} · {item.weight} lbs</Text>
                  </Box>
                </ListItem>
              );
            })}
          </List>
        </>
      )}
    </Flex>
  );
};

const SEARCH_KEYS = ["location", "lot", "vendor", "brand", "species", "description"];

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
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (flashLocation && flashLocation.length >= 2) {
      if (flashLocation.toUpperCase().startsWith("NOBLESSE")) { setTabIndex(4); return; }
      const level = parseInt(flashLocation[1]);
      if (level >= 1 && level <= 3) setTabIndex(level - 1);
      else setTabIndex(3);
    }
  }, [flashLocation]);

  // Reset search when a new find result comes in
  useEffect(() => {
    setSearch("");
  }, [items]);

  // Prune selections that no longer exist in items
  useEffect(() => {
    const existingIds = new Set(items.map((i) => i._id).filter(Boolean));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => existingIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const filteredItems = search.trim()
    ? items.filter((item) => {
        const q = search.toLowerCase();
        return SEARCH_KEYS.some((k) => String(item[k] ?? "").toLowerCase().includes(q));
      })
    : items;

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

  const handleRowClick = useCallback((item) => {
    if (selectedIds.size > 0) {
      if (item._id) handleToggleSelect(item._id);
    } else {
      handleItemClick(item);
    }
  }, [selectedIds, handleToggleSelect, handleItemClick]);

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
        <Tab
          fontWeight="semibold"
          fontSize="sm"
          _hover={{ bg: "blue.50" }}
          _selected={{
            color: "blue.600",
            borderColor: "blue.500",
            borderBottomColor: "white",
          }}
        >
          Other
        </Tab>
        <Tab
          fontWeight="semibold"
          fontSize="sm"
          _hover={{ bg: "orange.50" }}
          _selected={{
            color: "orange.600",
            borderColor: "orange.500",
            borderBottomColor: "white",
          }}
        >
          To Noblesse
        </Tab>
        <Tab
          fontWeight="semibold"
          fontSize="sm"
          _hover={{ bg: "green.50" }}
          _selected={{
            color: "green.600",
            borderColor: "green.500",
            borderBottomColor: "white",
          }}
        >
          From Noblesse
        </Tab>
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

      {items.length > 0 && (
        <Box px={3} py={1.5} borderBottom="1px" borderColor="gray.100" flexShrink={0}>
          <InputGroup size="xs">
            <InputLeftElement pointerEvents="none">
              <SearchIcon color="gray.400" />
            </InputLeftElement>
            <Input
              placeholder={`Filter ${items.length} result${items.length !== 1 ? "s" : ""}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              borderRadius="md"
              bg="gray.50"
              _focus={{ bg: "white", borderColor: "blue.300" }}
            />
            {search && (
              <InputRightElement cursor="pointer" onClick={() => setSearch("")}>
                <CloseIcon boxSize={2} color="gray.400" />
              </InputRightElement>
            )}
          </InputGroup>
        </Box>
      )}

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
            items={filteredItems}
            handleItemClick={handleRowClick}
            level={level}
            selectedItem={selectedItem}
            flashLocation={flashLocation}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleGroup={handleToggleGroup}
          />
        ))}
        <InventoryOtherPanel
          items={filteredItems}
          handleItemClick={handleRowClick}
          selectedItem={selectedItem}
          flashLocation={flashLocation}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onToggleGroup={handleToggleGroup}
        />

        {/* To Noblesse */}
        <TabPanel height="100%" p={0}>
          <NoblessePanel
            items={filteredItems.filter((i) => i.location?.toUpperCase() === "NOBLESSE TRADING")}
            handleItemClick={handleItemClick}
            selectedItem={selectedItem}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        </TabPanel>

        {/* From Noblesse — placeholder */}
        <TabPanel height="100%" p={0}>
          <Flex height="100%" align="center" justify="center">
            <Text fontSize="sm" color="gray.300">Coming soon</Text>
          </Flex>
        </TabPanel>
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
