// src/components/homescreen/LocationInput.js
import React from 'react';
import { 
  InputGroup, 
  Input, 
  InputRightElement, 
  Badge, 
  VStack,
  FormLabel 
} from '@chakra-ui/react';

const LocationInput = ({ 
  value, 
  onChange, 
  badgeState 
}) => {
  const getBadgeProps = (state) => {
    switch(state) {
      case 'in':
        return { colorScheme: 'gray', children: 'Occupied' };
      case 'out':
        return { colorScheme: 'green', children: 'Empty' };
      case 'error':
        return { colorScheme: 'red', children: 'Invalid' };
      default:
        return null;
    }
  };

  return (
    <VStack spacing={1} width="75%">
      <FormLabel marginTop="5px" textAlign="left" marginBottom="5px">
        Location
      </FormLabel>
      <InputGroup size="md">
        <Input
          required
          value={value}
          type="text"
          bg="white"
          width="100%"
          placeholder="Enter Location"
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <InputRightElement width="auto" marginRight="5px">
          {badgeState && (
            <Badge {...getBadgeProps(badgeState)} p="2" />
          )}
        </InputRightElement>
      </InputGroup>
    </VStack>
  );
};

export default LocationInput;