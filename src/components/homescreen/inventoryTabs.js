import React from 'react';
import PropTypes from 'prop-types';
import {
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Flex,
  List,
  ListItem,
  Box,
} from '@chakra-ui/react';

const InventoryLevelPanel = ({ items, handleItemClick, level, DetailsPanel, selectedItem, handleSet }) => {
  const getFilterCondition = (item) => {
    if (level === 3) {
      return item.location[1] !== '1' && item.location[1] !== '2';
    }
    return item.location[1] === String(level);
  };

  return (
    <TabPanel height="100%">
      <Flex
        bg="lightblue"
        width="100%"
        height="100%"
        direction="column"
        justifyContent="flex-start"
        alignItems="center"
        overflowY="auto"
      >
        <List spacing={3} width="90%">
          {items
            .filter(getFilterCondition)
            .map((item, index) => (
              <ListItem
                key={`${item.location}-${index}`}
                onClick={() => handleItemClick(item)}
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
                  {`Level ${level}: ${item.location} - ${item.description} ${level === 3 ? `: ${item.quantity} bx(s)` : `- ${item.quantity}`}`}
                </Box>
              </ListItem>
            ))}
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
  handleSet 
}) => {
  return (
    <Tabs variant="enclosed" width="100%" height="100%">
      <TabList>
        {[1, 2, 3].map((level) => (
          <Tab 
            key={`level-${level}`}
            bg="lightblue" 
            border="1px" 
            onClick={handleTabClick}
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
      quantity: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
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