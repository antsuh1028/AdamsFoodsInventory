import { useState, useEffect, useCallback } from "react";
import { Flex, Box, useToast } from "@chakra-ui/react";
import Navbar from "./Navbar";
import axiosInstance from "../utils/axiosInstance";

import { FormContext } from "../utils/homescreen/formContext";

import addItem from "../utils/homescreen/addItem";
import findItem from "../utils/homescreen/findItem";
import removeItem from "../utils/homescreen/removeItem";
import updateItem from "../utils/homescreen/updateItem";

import InventoryTabs from "../components/homescreen/inventoryTabs";
import InventoryForm from "../components/homescreen/inventoryForm";
import ActionButtons from "../components/homescreen/actionButton";
import DetailsPanel from "../components/homescreen/detailsPanel";

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
  });

  // Display state
  const [items, setItems] = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [currentItem, setCurrentItem] = useState(null);
  const [badgeState, setBadgeState] = useState(null);

  const toast = useToast();

  const handleInputChange = useCallback((field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
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
    });
    setCurrentItem(null);
  }, []);

  const handleFind = useCallback(() => {
    findItem(formData, setItems, setShowDetails, toast);
  }, [formData, toast]);

  const handleAdd = useCallback(() => {
    addItem(formData, setShowDetails, setItems, toast, handleClear);
  }, [formData, toast, handleClear]);

  const handleUpdate = useCallback(
    (e) => {
      e.preventDefault();
      const updateData = { ...formData, currentItem };
      updateItem(updateData, setItems, setShowDetails, setCurrentItem, toast);
      handleClear();
    },
    [formData, currentItem, toast, handleClear]
  );

  const handleRemove = useCallback(() => {
    removeItem(
      currentItem,
      formData.location,
      setItems,
      setShowDetails,
      setCurrentItem,
      toast
    );
    handleClear();
  }, [currentItem, formData.location, toast, handleClear]);

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
    });
    setCurrentItem(item);
  }, []);

  const handleItemClick = useCallback((item) => {
    setSelectedItem(item);
    setShowDetails(true);
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
            { inputs: { ...formData } },
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
      }}
    >
      <>
        <Navbar />
        <Flex
          width="100vw"
          height="100vh"
          alignItems="center"
          justifyContent="space-between"
          bg="gray.50"
          pt="60px"
          gap={3}
          px={3}
          pb={3}
        >
          <Flex
            bg="white"
            width="60%"
            height="90%"
            borderRadius="lg"
            boxShadow="md"
            direction="column"
            justifyContent="flex-start"
            alignItems="center"
            overflowY="auto"
            p={4}
          >
            <InventoryForm
              formData={formData}
              onInputChange={handleInputChange}
              badgeState={badgeState}
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
            width="40%"
            height="90%"
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
              />
            </Box>
            <DetailsPanel
              item={selectedItem}
              showDetails={showDetails}
              onClose={() => setShowDetails(false)}
              onSet={handleSet}
            />
          </Flex>
        </Flex>
      </>
    </FormContext.Provider>
  );
};

export default Homescreen;
