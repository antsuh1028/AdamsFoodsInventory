import React from 'react';
import { FormControl, VStack, HStack, FormLabel, Input } from '@chakra-ui/react';
import { FormField, SPECIES_OPTIONS, GRADE_OPTIONS } from './formField';
import LocationInput from './locationInput';

const InventoryForm = ({
  formData,
  onInputChange,
  badgeState
}) => {
  const {
    location,
    lot,
    vendor,
    brand,
    species,
    description,
    grade,
    quantity,
    weight,
    packdate,
    temp,
    est
  } = formData;

  return (
    <FormControl width="90%">
      <VStack spacing={2} alignItems="center">
        {/* Location and Lot Row */}
        <HStack spacing={2} width="100%">
          <LocationInput
            value={location}
            onChange={(value) => onInputChange('location', value)}
            badgeState={badgeState}
          />
          <FormField
            label="Lot"
            value={lot}
            placeholder="Enter Lot"
            onChange={(e) => onInputChange('lot', e.target.value.toUpperCase())}
            width="25%"
          />
        </HStack>

        {/* Vendor, Brand, Species Row */}
        <HStack spacing={2} width="100%">
          <FormField
            label="Vendor"
            value={vendor}
            placeholder="Enter Vendor"
            onChange={(e) => onInputChange('vendor', e.target.value.toUpperCase())}
            width="33%"
          />
          <FormField
            label="Brand"
            value={brand}
            placeholder="Enter Brand"
            onChange={(e) => onInputChange('brand', e.target.value.toUpperCase())}
            width="33%"
          />
          <FormField
            label="Species"
            value={species}
            type="select"
            placeholder="Select Species"
            options={SPECIES_OPTIONS}
            onChange={(e) => onInputChange('species', e.target.value)}
            width="33%"
          />
        </HStack>

        {/* Description Field */}
        <FormLabel marginTop="5px" marginBottom="5px">Description</FormLabel>
        <Input
          value={description}
          type="text"
          bg="white"
          width="100%"
          size="lg"
          placeholder="Enter Description"
          onChange={(e) => onInputChange('description', e.target.value)}
        />

        {/* Grade, Quantity, Weight Row */}
        <HStack spacing={4} width="100%">
          <FormField
            label="Grade"
            value={grade}
            type="select"
            placeholder="Select Grade"
            options={GRADE_OPTIONS}
            onChange={(e) => onInputChange('grade', e.target.value)}
            width="32%"
          />
          <FormField
            label="Quantity"
            value={quantity}
            type="number"
            placeholder="Enter Quantity"
            onChange={(e) => onInputChange('quantity', e.target.value)}
            width="32%"
          />
          <FormField
            label="Weight"
            value={weight}
            type="number"
            placeholder="Enter Weight"
            onChange={(e) => onInputChange('weight', e.target.value)}
            width="32%"
          />
        </HStack>

        {/* Pack Date, Temperature, EST Row */}
        <HStack spacing={4} width="100%">
          <FormField
            label="Pack Date"
            value={packdate}
            type="date"
            onChange={(e) => onInputChange('packdate', e.target.value)}
            width="32%"
          />
          <FormField
            label="Temperature (°F)"
            value={temp}
            type="number"
            placeholder="Enter Temperature"
            onChange={(e) => onInputChange('temp', e.target.value)}
            width="32%"
          />
          <FormField
            label="EST#"
            value={est}
            placeholder="Enter Est"
            onChange={(e) => onInputChange('est', e.target.value.toUpperCase())}
            width="32%"
          />
        </HStack>
      </VStack>
    </FormControl>
  );
};

export default InventoryForm;