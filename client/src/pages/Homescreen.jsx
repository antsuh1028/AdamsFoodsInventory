import { useState, useEffect, useCallback, useRef } from "react";
import {
  Flex, Box, useToast, Text, Grid, GridItem, Divider, Collapse,
  AlertDialog, AlertDialogOverlay, AlertDialogContent,
  AlertDialogBody, AlertDialogFooter,
  Button,
} from "@chakra-ui/react";
import Navbar from "../components/layout/Navbar";
import ShowMap from "../components/navbar/locationMap";
import axiosInstance from "../utils/axiosInstance";

import { FormContext } from "../utils/homescreen/formContext";

import addItem from "../utils/homescreen/addItem";
import findItem from "../utils/homescreen/findItem";
import removeItem from "../utils/homescreen/removeItem";
import updateItem from "../utils/homescreen/updateItem";
import getDistinct from "../utils/homescreen/getDistinct";

import InventoryTabs from "../components/homescreen/inventoryTabs";
import InventoryForm from "../components/homescreen/inventoryForm";
import ActionButtons from "../components/homescreen/actionButton";
import DetailsPanel from "../components/homescreen/detailsPanel";

const REQUIRED_FIELDS = ["location", "lot", "species"];

const RemoveField = ({ label, value }) => {
  if (!value) return null;
  return (
    <GridItem>
      <Text fontSize="xs" color="gray.400" fontWeight="medium" textTransform="uppercase" letterSpacing="wide">
        {label}
      </Text>
      <Text fontSize="sm" color="gray.700" fontWeight="medium">
        {value}
      </Text>
    </GridItem>
  );
};

const Homescreen = () => {
  // Form state using single state object
  const [formData, setFormData] = useState({
    location: "",
    lot: "",
    vendor: "",
    brand: "",
    species: "",
    description: "",
    grade: "",
    quantity: "",
    weight: "",
    packdate: "",
    date_recvd: "",
    est: "",
    price: "",
  });

  // Display state
  const [items, setItems] = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [currentItem, setCurrentItem] = useState(null);
  const [badgeState, setBadgeState] = useState(null);
  const [locateMapOpen, setLocateMapOpen] = useState(false);
  const [locateLocation, setLocateLocation] = useState(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeExpanded, setRemoveExpanded] = useState(false);
  const cancelRemoveRef = useRef();
  const [bulkRemoveDialog, setBulkRemoveDialog] = useState({ open: false, ids: [], items: [], onSuccess: null });
  const cancelBulkRemoveRef = useRef();
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateExpanded, setUpdateExpanded] = useState(false);
  const cancelUpdateRef = useRef();
  const [occupiedDialog, setOccupiedDialog] = useState({ open: false, message: "", onConfirm: null, existingItems: [] });
  const cancelOccupiedRef = useRef();
  const [overwriteDialog, setOverwriteDialog] = useState({ open: false, existingItems: [] });
  const cancelOverwriteRef = useRef();
  const [flashLocation, setFlashLocation] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [suggestions, setSuggestions] = useState({ vendors: [], brands: [] });

  const refreshSuggestions = useCallback(() => {
    getDistinct().then(setSuggestions).catch(() => {});
  }, []);

  useEffect(() => {
    refreshSuggestions();
  }, [refreshSuggestions]);

  const toast = useToast();

  const handleInputChange = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (REQUIRED_FIELDS.includes(field)) {
      setValidationErrors((prev) => ({ ...prev, [field]: false }));
    }
  }, []);

  const handleClear = useCallback(() => {
    setFormData({
      location: "",
      lot: "",
      vendor: "",
      brand: "",
      species: "",
      description: "",
      grade: "",
      quantity: "",
      weight: "",
      packdate: "",
      date_recvd: "",
      est: "",
      price: "",
    });
    setCurrentItem(null);
    setValidationErrors({});
  }, []);

  const validateForm = useCallback(() => {
    const errors = {};
    REQUIRED_FIELDS.forEach((field) => {
      if (!formData[field] || String(formData[field]).trim() === "") {
        errors[field] = true;
      }
    });
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  const handleFind = useCallback(() => {
    findItem(formData, setItems, setShowDetails, toast, (firstItem) => {
      setSelectedItem(firstItem);
      setShowDetails(true);
      setFlashLocation(firstItem.location);
      setTimeout(() => setFlashLocation(null), 2500);
    });
  }, [formData, toast]);

  const handleAdd = useCallback(() => {
    if (!validateForm()) return;
    const addedLocation = formData.location;
    addItem(
      formData, setShowDetails, setItems, toast,
      () => {
        handleClear();
        refreshSuggestions();
        setFlashLocation(addedLocation);
        setTimeout(() => setFlashLocation(null), 2500);
      },
      async (message, onConfirm) => {
        let existingItems = [];
        try {
          const res = await axiosInstance.post("/inventoryFind", { inputs: { location: formData.location } });
          if (res.data !== "INVALID" && res.data.length > 0) existingItems = res.data;
        } catch { /* silent */ }
        setOccupiedDialog({ open: true, message, onConfirm, existingItems });
      },
      async (location) => {
        try {
          const res = await axiosInstance.post("/inventoryFind", { inputs: { location } });
          if (res.data !== "INVALID" && res.data.length > 0) {
            const existing = res.data[0];
            setItems(res.data);
            setSelectedItem(existing);
            setShowDetails(true);
            setFlashLocation(existing.location);
            setTimeout(() => setFlashLocation(null), 2500);
          }
        } catch { /* silent */ }
      },
    );
  }, [formData, toast, handleClear, validateForm, refreshSuggestions]);

  const handleUpdate = useCallback(
    (e) => {
      e.preventDefault();
      if (!validateForm()) return;
      if (!currentItem) {
        toast({ title: "No item selected", description: "Use Find then Set an item before updating.", status: "error", position: "top", duration: 2000, isClosable: true });
        return;
      }
      setUpdateExpanded(false);
      setUpdateDialogOpen(true);
    },
    [currentItem, toast, validateForm]
  );

  const doUpdate = useCallback(() => {
    const updateData = { ...formData, currentItem };
    updateItem(updateData, setItems, setShowDetails, setCurrentItem, toast, (updated) => {
      setSelectedItem(updated);
      setShowDetails(true);
      setFlashLocation(updated.location);
      setTimeout(() => setFlashLocation(null), 2500);
    });
    handleClear();
  }, [formData, currentItem, toast, handleClear]);

  const confirmUpdate = useCallback(async () => {
    setUpdateDialogOpen(false);
    const locationChanged = formData.location !== currentItem?.location;
    if (locationChanged) {
      try {
        const res = await axiosInstance.post("/inventoryFind", { inputs: { location: formData.location } });
        if (res.data !== "INVALID" && res.data.length > 0) {
          setOverwriteDialog({ open: true, existingItems: res.data });
          return;
        }
      } catch {
        // if check fails just proceed
      }
    }
    doUpdate();
  }, [formData, currentItem, doUpdate]);

  const handleRemove = useCallback(() => {
    if (!currentItem) {
      toast({ title: "No item selected", description: "Use Find then Set an item before removing.", status: "error", position: "top", duration: 2000, isClosable: true });
      return;
    }
    setRemoveExpanded(false);
    setRemoveDialogOpen(true);
  }, [currentItem, toast]);

  const confirmRemove = useCallback(() => {
    setRemoveDialogOpen(false);
    removeItem(currentItem, formData.location, setItems, setShowDetails, setCurrentItem, toast);
    handleClear();
  }, [currentItem, formData.location, toast, handleClear]);

  const handleBulkRemove = useCallback((ids, selectedItems, onSuccess) => {
    setBulkRemoveDialog({ open: true, ids, items: selectedItems, onSuccess });
  }, []);

  const confirmBulkRemove = useCallback(async () => {
    const { ids, onSuccess } = bulkRemoveDialog;
    setBulkRemoveDialog({ open: false, ids: [], items: [], onSuccess: null });
    try {
      await axiosInstance.post("/inventoryBulkRemove", { ids });
      const idSet = new Set(ids);
      setItems((prev) => prev.filter((item) => !idSet.has(item._id)));
      if (currentItem && idSet.has(currentItem._id)) {
        setShowDetails(false);
        setSelectedItem(null);
        handleClear();
      }
      toast({ title: `${ids.length} item${ids.length !== 1 ? "s" : ""} removed`, position: "top", status: "success", duration: 2000, isClosable: true });
      if (onSuccess) onSuccess();
    } catch {
      toast({ title: "Failed to remove items", position: "top", status: "error", duration: 3000, isClosable: true });
    }
  }, [bulkRemoveDialog, currentItem, toast, handleClear]);

  const handleSet = useCallback((item) => {
    if (!item) return;
    setFormData({
      location: item.location || "",
      lot: item.lot || "",
      vendor: item.vendor || "",
      brand: item.brand || "",
      species: item.species || "",
      description: item.description || "",
      grade: item.grade || "",
      quantity: item.quantity || "",
      weight: item.weight || "",
      packdate: item.packdate || "",
      date_recvd: item.date_recvd || "",
      est: item.est || "",
      price: item.price || "",
    });
    setCurrentItem(item);
    setValidationErrors({});
  }, []);

  const handleItemClick = useCallback((item) => {
    setSelectedItem(item);
    setShowDetails(true);
  }, []);

  const handleItemUpdate = useCallback((updatedItem) => {
    setItems((prev) => prev.map((i) => (i._id === updatedItem._id ? updatedItem : i)));
    setSelectedItem(updatedItem);
  }, []);

  const handleLocate = useCallback((item) => {
    setLocateLocation(item?.location || null);
    setLocateMapOpen(true);
  }, []);

  const handleScannerAdd = useCallback(async (location) => {
    if (!location) return;
    try {
      const res = await axiosInstance.post("/inventoryFind", { inputs: { location: location.toUpperCase() } });
      if (res.data !== "INVALID" && res.data.length > 0) {
        setItems(res.data);
        setSelectedItem(res.data[0]);
        setShowDetails(true);
        setFlashLocation(res.data[0].location);
        setTimeout(() => setFlashLocation(null), 2500);
      }
    } catch { /* silent */ }
  }, []);

  const handleTabClick = useCallback(() => {
    setShowDetails(false);
  }, []);

  useEffect(() => {
    if (!formData.location) {
      setBadgeState(null);
      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const verifyResult = await axiosInstance.post(
          "/verifyLocation",
          { location: formData.location },
          { signal: controller.signal }
        );

        if (verifyResult.data === "OK") {
          const inventoryResult = await axiosInstance.post(
            "/inventoryFind",
            { inputs: { location: formData.location } },
            { signal: controller.signal }
          );
          setBadgeState(inventoryResult.data === "INVALID" ? "out" : "in");
        } else {
          setBadgeState("error");
        }
      } catch (err) {
        if (err.name !== "CanceledError") {
          setBadgeState("error");
          console.error(err);
        }
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.location]);

  return (
    <FormContext.Provider
      value={{
        setFormData,
        setCurrentItem,
        formData,
        onScannerAdd: handleScannerAdd,
      }}
    >
      <>
        <Navbar />
        <Flex
          width="100vw"
          height={{ base: "auto", lg: "100vh" }}
          minHeight={{ base: "100vh", lg: "unset" }}
          alignItems={{ base: "stretch", lg: "center" }}
          justifyContent="space-between"
          bg="gray.50"
          pt={{ base: "60px", md: "140px", lg: "80px", }}
          gap={3}
          px={3}
          pb={3}
          direction={{ base: "column", lg: "row" }}
        >
          <Flex
            bg="white"
            width={{ base: "100%", lg: "60%" }}
            height={{ base: "auto", lg: "90%" }}
            borderRadius="lg"
            boxShadow="md"
            direction="column"
            justifyContent="flex-start"
            alignItems="center"
            overflowY={{ base: "visible", lg: "auto" }}
            p={4}
          >
            <InventoryForm
              formData={formData}
              onInputChange={handleInputChange}
              badgeState={badgeState}
              validationErrors={validationErrors}
              suggestions={suggestions}
            />

            <Flex width="100%" direction="column" alignItems="center" mt="5%">
              <ActionButtons
                onAdd={handleAdd}
                onFind={handleFind}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
                onClear={handleClear}
              />
            </Flex>
          </Flex>

          <Flex
            bg="white"
            width={{ base: "100%", lg: "40%" }}
            height={{ base: "auto", lg: "90%" }}
            minH={{ base: "400px", lg: "unset" }}
            borderRadius="lg"
            boxShadow="md"
            direction="column"
            overflow="hidden"
          >
            <Box flex={1} minH={0} overflow="hidden">
              <InventoryTabs
                items={items}
                handleItemClick={handleItemClick}
                handleTabClick={handleTabClick}
                selectedItem={selectedItem}
                flashLocation={flashLocation}
                onBulkRemove={handleBulkRemove}
              />
            </Box>
            <DetailsPanel
              item={selectedItem}
              showDetails={showDetails}
              onClose={() => setShowDetails(false)}
              onSet={handleSet}
              onLocate={handleLocate}
              onItemUpdate={handleItemUpdate}
            />
          </Flex>
        </Flex>

        <ShowMap
          isOpen={locateMapOpen}
          onClose={() => setLocateMapOpen(false)}
          highlightLocation={locateLocation}
        />

        <AlertDialog
          isOpen={occupiedDialog.open}
          leastDestructiveRef={cancelOccupiedRef}
          onClose={() => {
            const existing = occupiedDialog.existingItems[0];
            if (existing) {
              setItems(occupiedDialog.existingItems);
              setSelectedItem(existing);
              setShowDetails(true);
              setFlashLocation(existing.location);
              setTimeout(() => setFlashLocation(null), 2500);
            }
            setOccupiedDialog({ open: false, message: "", onConfirm: null, existingItems: [] });
          }}
          isCentered
        >
          <AlertDialogOverlay backdropFilter="blur(2px)" />
          <AlertDialogContent borderRadius="xl" maxW="420px">
            <Box px={6} pt={5} pb={3} borderBottom="1px" borderColor="gray.100">
              <Text fontWeight="bold" fontSize="md" color="gray.800">
                Location Already Occupied
              </Text>
              <Text fontSize="xs" color="gray.400" mt={0.5}>
                The following item is already stored here
              </Text>
            </Box>
            <AlertDialogBody px={6} py={4} maxH="340px" overflowY="auto">
              {occupiedDialog.existingItems.map((item, i) => (
                <Box key={i} mb={i < occupiedDialog.existingItems.length - 1 ? 3 : 0} bg="gray.50" border="1px" borderColor="gray.200" borderRadius="md" px={3} py={3}>
                  <Flex align="baseline" gap={2} mb={2}>
                    <Text fontSize="md" fontWeight="bold" color="gray.800">{item.location}</Text>
                    <Text fontSize="sm" color="gray.500" noOfLines={1}>{item.description}</Text>
                  </Flex>
                  <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                    <RemoveField label="Lot" value={item.lot} />
                    <RemoveField label="Brand" value={item.brand} />
                    <RemoveField label="Grade" value={item.grade} />
                    <RemoveField label="Quantity" value={item.quantity ? `${item.quantity} bx` : null} />
                    <RemoveField label="Weight" value={item.weight ? `${item.weight} lb` : null} />
                    <RemoveField label="Species" value={item.species} />
                  </Grid>
                </Box>
              ))}
              <Text fontSize="sm" color="gray.500" mt={3}>
                Do you want to add another item to this location anyway?
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter px={6} pb={5} gap={3}>
              <Button
                ref={cancelOccupiedRef}
                onClick={() => {
                  const existing = occupiedDialog.existingItems[0];
                  if (existing) {
                    setItems(occupiedDialog.existingItems);
                    setSelectedItem(existing);
                    setShowDetails(true);
                    setFlashLocation(existing.location);
                    setTimeout(() => setFlashLocation(null), 2500);
                  }
                  setOccupiedDialog({ open: false, message: "", onConfirm: null, existingItems: [] });
                }}
                variant="outline"
                borderRadius="lg"
                w="full"
              >
                Cancel
              </Button>
              <Button
                colorScheme="orange"
                borderRadius="lg"
                w="full"
                onClick={() => {
                  const fn = occupiedDialog.onConfirm;
                  setOccupiedDialog({ open: false, message: "", onConfirm: null, existingItems: [] });
                  if (fn) fn();
                }}
              >
                Add Anyway
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          isOpen={overwriteDialog.open}
          leastDestructiveRef={cancelOverwriteRef}
          onClose={() => setOverwriteDialog({ open: false, existingItems: [] })}
          isCentered
        >
          <AlertDialogOverlay backdropFilter="blur(2px)" />
          <AlertDialogContent borderRadius="xl" maxW="420px">
            <Box px={6} pt={5} pb={3} borderBottom="1px" borderColor="gray.100">
              <Text fontWeight="bold" fontSize="md" color="gray.800">
                Slot Already Has Items
              </Text>
              <Text fontSize="xs" color="gray.400" mt={0.5}>
                {formData.location} currently contains the following
              </Text>
            </Box>
            <AlertDialogBody px={6} py={4} maxH="340px" overflowY="auto">
              {overwriteDialog.existingItems.map((item, i) => (
                <Box key={i} mb={i < overwriteDialog.existingItems.length - 1 ? 3 : 0} bg="gray.50" border="1px" borderColor="gray.200" borderRadius="md" px={3} py={3}>
                  <Flex align="baseline" gap={2} mb={2}>
                    <Text fontSize="md" fontWeight="bold" color="gray.800">{item.location}</Text>
                    <Text fontSize="sm" color="gray.500" noOfLines={1}>{item.description}</Text>
                  </Flex>
                  <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                    <RemoveField label="Lot" value={item.lot} />
                    <RemoveField label="Brand" value={item.brand} />
                    <RemoveField label="Grade" value={item.grade} />
                    <RemoveField label="Quantity" value={item.quantity ? `${item.quantity} bx` : null} />
                    <RemoveField label="Weight" value={item.weight ? `${item.weight} lb` : null} />
                    <RemoveField label="Species" value={item.species} />
                  </Grid>
                </Box>
              ))}
            </AlertDialogBody>
            <AlertDialogFooter px={6} pb={5} gap={3}>
              <Button
                ref={cancelOverwriteRef}
                onClick={() => setOverwriteDialog({ open: false, existingItems: [] })}
                variant="outline"
                borderRadius="lg"
                w="full"
              >
                Cancel
              </Button>
              <Button
                colorScheme="orange"
                borderRadius="lg"
                w="full"
                onClick={() => {
                  setOverwriteDialog({ open: false, existingItems: [] });
                  doUpdate();
                }}
              >
                Confirm Update
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          isOpen={updateDialogOpen}
          leastDestructiveRef={cancelUpdateRef}
          onClose={() => setUpdateDialogOpen(false)}
          isCentered
        >
          <AlertDialogOverlay backdropFilter="blur(2px)" />
          <AlertDialogContent borderRadius="xl" maxW="420px">

            <Box px={6} pt={5} pb={3} borderBottom="1px" borderColor="gray.100">
              <Text fontWeight="bold" fontSize="md" color="gray.800">
                Confirm Update
              </Text>
              <Text fontSize="xs" color="gray.400" mt={0.5}>
                Review the changes before saving
              </Text>
            </Box>

            <AlertDialogBody px={6} py={4}>
              <Flex align="baseline" gap={2} mb={3}>
                <Text fontSize="lg" fontWeight="bold" color="gray.800">
                  {formData.location}
                </Text>
                <Text fontSize="sm" color="gray.500" noOfLines={1}>
                  {formData.description}
                </Text>
              </Flex>

              <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                <RemoveField label="Lot" value={formData.lot} />
                <RemoveField label="Brand" value={formData.brand} />
                <RemoveField label="Grade" value={formData.grade} />
                <RemoveField label="Quantity" value={formData.quantity ? `${formData.quantity} bx` : null} />
                <RemoveField label="Weight" value={formData.weight ? `${formData.weight} lb` : null} />
                <RemoveField label="Species" value={formData.species} />
              </Grid>

              <Collapse in={updateExpanded} animateOpacity>
                <Divider my={3} />
                <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                  <RemoveField label="Vendor" value={formData.vendor} />
                  <RemoveField label="EST #" value={formData.est} />
                  <RemoveField label="Pack Date" value={formData.packdate} />
                  <RemoveField label="Date Received" value={formData.date_recvd} />
                </Grid>
              </Collapse>

              <Button
                size="xs"
                variant="ghost"
                color="gray.400"
                _hover={{ color: "gray.600" }}
                mt={3}
                onClick={() => setUpdateExpanded((v) => !v)}
              >
                {updateExpanded ? "Less" : "Full Details"}
              </Button>
            </AlertDialogBody>

            <AlertDialogFooter px={6} pb={5} gap={3}>
              <Button
                ref={cancelUpdateRef}
                onClick={() => setUpdateDialogOpen(false)}
                variant="outline"
                borderRadius="lg"
                w="full"
              >
                Cancel
              </Button>
              <Button
                colorScheme="teal"
                onClick={confirmUpdate}
                borderRadius="lg"
                w="full"
              >
                Confirm Update
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          isOpen={bulkRemoveDialog.open}
          leastDestructiveRef={cancelBulkRemoveRef}
          onClose={() => setBulkRemoveDialog({ open: false, ids: [], items: [], onSuccess: null })}
          isCentered
        >
          <AlertDialogOverlay backdropFilter="blur(2px)" />
          <AlertDialogContent borderRadius="xl" maxW="400px">
            <Box px={6} pt={5} pb={3} borderBottom="1px" borderColor="gray.100">
              <Text fontWeight="bold" fontSize="md" color="gray.800">
                Remove {bulkRemoveDialog.ids.length} Item{bulkRemoveDialog.ids.length !== 1 ? "s" : ""}
              </Text>
              <Text fontSize="xs" color="gray.400" mt={0.5}>
                This action cannot be undone
              </Text>
            </Box>
            <AlertDialogBody px={6} py={4}>
              <Box maxH="220px" overflowY="auto" borderRadius="md" border="1px" borderColor="gray.100">
                {bulkRemoveDialog.items.map((item, i) => (
                  <Flex
                    key={item._id || i}
                    px={3}
                    py={2}
                    align="baseline"
                    gap={2}
                    borderBottom={i < bulkRemoveDialog.items.length - 1 ? "1px" : "none"}
                    borderColor="gray.100"
                  >
                    <Text fontSize="sm" fontWeight="semibold" color="gray.700" flexShrink={0}>
                      {item.location}
                    </Text>
                    <Text fontSize="xs" color="gray.400" noOfLines={1}>
                      {item.description}
                    </Text>
                  </Flex>
                ))}
              </Box>
            </AlertDialogBody>
            <AlertDialogFooter px={6} pb={5} gap={3}>
              <Button
                ref={cancelBulkRemoveRef}
                onClick={() => setBulkRemoveDialog({ open: false, ids: [], items: [], onSuccess: null })}
                variant="outline"
                borderRadius="lg"
                w="full"
              >
                Cancel
              </Button>
              <Button
                colorScheme="red"
                onClick={confirmBulkRemove}
                borderRadius="lg"
                w="full"
              >
                Remove All
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          isOpen={removeDialogOpen}
          leastDestructiveRef={cancelRemoveRef}
          onClose={() => setRemoveDialogOpen(false)}
          isCentered
        >
          <AlertDialogOverlay backdropFilter="blur(2px)" />
          <AlertDialogContent borderRadius="xl" maxW="420px">

            {/* Header */}
            <Box px={6} pt={5} pb={3} borderBottom="1px" borderColor="gray.100">
              <Text fontWeight="bold" fontSize="md" color="gray.800">
                Confirm Remove
              </Text>
              <Text fontSize="xs" color="gray.400" mt={0.5}>
                This action cannot be undone
              </Text>
            </Box>

            <AlertDialogBody px={6} py={4}>
              {/* Location + description prominent */}
              <Flex align="baseline" gap={2} mb={3}>
                <Text fontSize="lg" fontWeight="bold" color="gray.800">
                  {currentItem?.location}
                </Text>
                <Text fontSize="sm" color="gray.500" noOfLines={1}>
                  {currentItem?.description}
                </Text>
              </Flex>

              {/* Summary fields */}
              <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                <RemoveField label="Lot" value={currentItem?.lot} />
                <RemoveField label="Brand" value={currentItem?.brand} />
                <RemoveField label="Grade" value={currentItem?.grade} />
                <RemoveField label="Quantity" value={currentItem?.quantity ? `${currentItem.quantity} bx` : null} />
                <RemoveField label="Weight" value={currentItem?.weight ? `${currentItem.weight} lb` : null} />
                <RemoveField label="Species" value={currentItem?.species} />
              </Grid>

              {/* Expandable full details */}
              <Collapse in={removeExpanded} animateOpacity>
                <Divider my={3} />
                <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                  <RemoveField label="Vendor" value={currentItem?.vendor} />
                  <RemoveField label="EST #" value={currentItem?.est} />
                  <RemoveField label="Pack Date" value={currentItem?.packdate} />
                  <RemoveField label="Date Received" value={currentItem?.date_recvd} />
                </Grid>
              </Collapse>

              <Button
                size="xs"
                variant="ghost"
                color="gray.400"
                _hover={{ color: "gray.600" }}
                mt={3}
                onClick={() => setRemoveExpanded((v) => !v)}
              >
                {removeExpanded ? "Less" : "Full Details"}
              </Button>
            </AlertDialogBody>

            <AlertDialogFooter px={6} pb={5} gap={3}>
              <Button
                ref={cancelRemoveRef}
                onClick={() => setRemoveDialogOpen(false)}
                variant="outline"
                borderRadius="lg"
                w="full"
              >
                Cancel
              </Button>
              <Button
                colorScheme="red"
                onClick={confirmRemove}
                borderRadius="lg"
                w="full"
              >
                Remove
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    </FormContext.Provider>
  );
};

export default Homescreen;
