import React, { memo } from "react";
import {
  FormControl,
  Grid,
  GridItem,
  FormLabel,
  Input,
  InputGroup,
  InputLeftElement,
  VStack,
  useBreakpointValue,
} from "@chakra-ui/react";
import { FormField, SPECIES_OPTIONS, GRADE_OPTIONS } from "./formFields";
import LocationInput from "./locationInput";

const InventoryForm = memo(({ formData, onInputChange, badgeState, validationErrors = {}, suggestions = {} }) => {
  const inputSize = useBreakpointValue({ base: "sm", md: "lg" });
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
    date_recvd,
    est,
    price,
  } = formData;

  return (
    <FormControl width="90%">
      <Grid
        templateColumns={{ base: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
        gap={2}
        width="100%"
        alignItems="start"
      >
        {/* Location — 2/3 on xl, full width on mobile */}
        <GridItem colSpan={{ base: 2, xl: 2 }}>
          <LocationInput
            value={location}
            onChange={(value) => onInputChange("location", value)}
            badgeState={badgeState}
            isInvalid={validationErrors.location}
          />
        </GridItem>

        {/* Lot — pairs with Vendor on mobile, sits next to Location on xl */}
        <GridItem colSpan={1}>
          <FormField
            label="Lot"
            value={lot}
            placeholder="Enter Lot"
            onChange={(e) => onInputChange("lot", e.target.value.toUpperCase())}
            isInvalid={validationErrors.lot}
          />
        </GridItem>

        {/* Vendor */}
        <GridItem colSpan={1}>
          <FormField
            label="Vendor"
            value={vendor}
            placeholder="Enter Vendor"
            onChange={(e) => onInputChange("vendor", e.target.value.toUpperCase())}
            suggestions={suggestions.vendors}
          />
        </GridItem>

        {/* Brand */}
        <GridItem colSpan={1}>
          <FormField
            label="Brand"
            value={brand}
            placeholder="Enter Brand"
            onChange={(e) => onInputChange("brand", e.target.value.toUpperCase())}
            isInvalid={validationErrors.brand}
            suggestions={suggestions.brands}
          />
        </GridItem>

        {/* Species */}
        <GridItem colSpan={1}>
          <FormField
            label="Species"
            value={species}
            type="select"
            placeholder="Select Species"
            options={SPECIES_OPTIONS}
            onChange={(e) => onInputChange("species", e.target.value)}
            isInvalid={validationErrors.species}
          />
        </GridItem>

        {/* Description — full width on both */}
        <GridItem colSpan={{ base: 2, xl: 3 }}>
          <FormLabel
            marginTop="5px"
            marginBottom="5px"
            textAlign="center"
            fontSize={{ base: "sm", md: "md" }}
            color={validationErrors.description ? "red.500" : undefined}
          >
            Description
          </FormLabel>
          <Input
            value={description}
            type="text"
            bg="white"
            width="100%"
            size={inputSize}
            placeholder="Enter Description"
            onChange={(e) => onInputChange("description", e.target.value)}
            isInvalid={validationErrors.description}
            autoComplete="off"
          />
        </GridItem>

        {/* Grade */}
        <GridItem colSpan={1}>
          <FormField
            label="Grade"
            value={grade}
            type="select"
            placeholder="Select Grade"
            options={GRADE_OPTIONS}
            onChange={(e) => onInputChange("grade", e.target.value)}
            isInvalid={validationErrors.grade}
          />
        </GridItem>

        {/* Quantity */}
        <GridItem colSpan={1}>
          <FormField
            label="Quantity"
            value={quantity}
            type="number"
            placeholder="Enter Quantity"
            onChange={(e) => onInputChange("quantity", e.target.value)}
            isInvalid={validationErrors.quantity}
          />
        </GridItem>

        {/* Weight — pairs with Pack Date on mobile, completes Grade/Qty/Weight row on xl */}
        <GridItem colSpan={1}>
          <FormField
            label="Weight"
            value={weight}
            type="number"
            placeholder="Enter Weight"
            onChange={(e) => onInputChange("weight", e.target.value)}
            isInvalid={validationErrors.weight}
          />
        </GridItem>

        {/* Pack Date | Recv Date | EST# */}
        <GridItem colSpan={1}>
          <FormField
            label="Pack Date"
            value={packdate}
            type="date"
            onChange={(e) => onInputChange("packdate", e.target.value)}
          />
        </GridItem>

        <GridItem colSpan={1}>
          <FormField
            label="Received Date"
            value={date_recvd}
            type="date"
            onChange={(e) => onInputChange("date_recvd", e.target.value)}
          />
        </GridItem>

        <GridItem colSpan={1}>
          <FormField
            label="EST#"
            value={est}
            placeholder="Enter Est"
            onChange={(e) => onInputChange("est", e.target.value)}
          />
        </GridItem>

        {/* Price — centered (middle column) on xl, full width on mobile */}
        <GridItem
          colSpan={{ base: 2, xl: 1 }}
          colStart={{ base: 1, xl: 2 }}
        >
          <VStack spacing={1} width="100%">
            <FormLabel marginTop="5px" marginBottom="5px" fontSize={{ base: "sm", md: "md" }}>
              Price / lb
            </FormLabel>
            <InputGroup size={inputSize} width="100%">
              <InputLeftElement pointerEvents="none" color="gray.400" fontSize="sm">
                $
              </InputLeftElement>
              <Input
                value={price}
                type="number"
                min="0"
                step="0.01"
                bg="white"
                placeholder="0.00"
                onChange={(e) => onInputChange("price", e.target.value)}
                autoComplete="off"
              />
            </InputGroup>
          </VStack>
        </GridItem>
      </Grid>
    </FormControl>
  );
});

export default InventoryForm;
