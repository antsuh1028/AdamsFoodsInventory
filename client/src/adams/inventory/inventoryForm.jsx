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
} from "@chakra-ui/react";
import { FormField, SPECIES_OPTIONS, GRADE_OPTIONS, TYPE_OPTIONS } from "./formFields";
import LocationInput from "../locations/locationInput";

const InventoryForm = memo(({ formData, onInputChange, badgeState, validationErrors = {}, suggestions = {} }) => {
  const inputSize = "sm";
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
    type,
  } = formData;

  return (
    <FormControl width="100%">
      <Grid
        templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)", xl: "repeat(6, 1fr)" }}
        gap={2}
        width="100%"
        alignItems="start"
      >
        <GridItem colSpan={2}>
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
            onChange={(e) => onInputChange("lot", e.target.value)}
            isInvalid={validationErrors.lot}
          />
        </GridItem>

        {/* Vendor/Brand */}
        <GridItem colSpan={1}>
          <FormField
            label="Vendor/Brand"
            value={vendor}
            placeholder="Enter Vendor/Brand"
            onChange={(e) => onInputChange("vendor", e.target.value)}
            suggestions={suggestions.vendors}
          />
        </GridItem>

        {/* Brand */}
        <GridItem colSpan={1}>
          <FormField
            label="Brand"
            value={brand}
            placeholder="Enter Brand"
            onChange={(e) => onInputChange("brand", e.target.value)}
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

        <GridItem colSpan={{ base: 2, xl: 3 }}>
          <FormLabel m={0} mb={0.5} fontSize="xs" color={validationErrors.description ? "red.500" : "gray.600"}>
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

        {/* Type */}
        <GridItem colSpan={1}>
          <FormField
            label="Type"
            value={type}
            type="select"
            placeholder="Select Type"
            options={TYPE_OPTIONS}
            onChange={(e) => onInputChange("type", e.target.value)}
          />
        </GridItem>

        {/* Quantity — auto-calculated from box count */}
        <GridItem colSpan={1}>
          <FormField
            label="Quantity (auto)"
            value={quantity}
            type="number"
            placeholder="Set via boxes"
            onChange={() => {}}
            isReadOnly
            bg="gray.50"
          />
        </GridItem>

        {/* Weight — read-only, driven by box management in the details panel */}
        <GridItem colSpan={1}>
          <FormField
            label="Weight (auto)"
            value={weight}
            type="number"
            placeholder="Set via boxes"
            onChange={() => {}}
            isInvalid={validationErrors.weight}
            isReadOnly
            bg="gray.50"
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

        <GridItem colSpan={1}>
          <VStack spacing={0.5} width="100%" align="stretch">
            <FormLabel m={0} fontSize="xs" color="gray.600">
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
