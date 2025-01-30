import React, { useState, useEffect, useCallback } from "react";
import {
  Flex,
  VStack,
  useToast,
} from "@chakra-ui/react";
import axios from "axios";
import Navbar from "./Navbar";

import addItem from "../utils/homescreen/addItem";
import findItem from "../utils/homescreen/findItem";
import removeItem from "../utils/homescreen/removeItem";
import updateItem from "../utils/homescreen/updateItem";

import InventoryTabs from "../components/homescreen/inventoryTabs";
import InventoryForm from "../components/homescreen/inventoryForm";
import ActionButtons from "../components/homescreen/actionButtons";
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
    temp: "",
    est: "",
  });

  // Display state
  const [items, setItems] = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [currentItem, setCurrentItem] = useState(null);
  const [badgeState, setBadgeState] = useState(null);
  const [loading, setLoading] = useState(false);

  const toast = useToast();

  // Handle form input changes
  const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
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
      temp: "",
      est: "",
    });
    setCurrentItem(null);
  }, []);

  const handleFind = useCallback(() => {
    findItem(formData, setItems, setShowDetails, toast);
  }, [formData, toast]);

  // Form action handlers
  const handleAdd = useCallback(async () => {
    setLoading(true);
    try {
      await addItem(formData, setShowDetails, setItems, toast);
      handleClear();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [formData, toast, handleClear]);
  
  const handleUpdate = useCallback((e) => {
    e.preventDefault();
    const updateData = { ...formData, currentItem };
    updateItem(updateData, setItems, setShowDetails, setCurrentItem, toast);
    handleClear();
  }, [formData, currentItem, toast, handleClear]); // added handleClear


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
      temp: item.temp || "",
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

  // Location verification effect with debounce
  useEffect(() => {
    const checkLocation = async () => {
      if (!formData.location) {
        setBadgeState(null);
        return;
      }
  
      try {
        const verifyResult = await axios.post("https://server.afdcstorage.com/verifyLocation", {
          location: formData.location,
        });
        
        if (verifyResult.data === "OK") {
          const locationInputs = { ...formData };
          
          const inventoryResult = await axios.post("https://server.afdcstorage.com/inventoryFind", { 
            inputs: locationInputs  
          });
          
          setBadgeState(inventoryResult.data === "INVALID" ? "out" : "in");
        } else {
          setBadgeState("error");
        }
      } catch (err) {
        setBadgeState("error");
        console.error(err);
      }
    };
  
    checkLocation();
  }, [formData]); // added formData

  return (
    <>
      <Navbar />
      <Flex
        width="100vw"
        height="100vh"
        alignItems="center"
        justifyContent="space-between"
        bg="lightblue"
        pt="60px"
      >
        <Flex
          bg="lightblue"
          width="80%"
          height="90%"
          margin="10px"
          border="1px"
          direction="column"
          justifyContent="flex-start"
          alignItems="center"
          overflowY="auto"
        >
          <InventoryForm 
            formData={formData}
            onInputChange={handleInputChange}
            badgeState={badgeState}
          />

          <ActionButtons
            onAdd={handleAdd}
            onFind={handleFind}
            onUpdate={handleUpdate}
            onRemove={handleRemove}
            onClear={handleClear}
            loading={loading}
          />
        </Flex>

        <VStack
          bg="lightblue"
          width="50%"
          height="90%"
          margin="10px"
          direction="column"
          justifyContent="flex-start"
          alignItems="center"
        >
          <InventoryTabs
            items={items}
            handleItemClick={handleItemClick}
            handleTabClick={handleTabClick}
            DetailsPanel={() => (
              <DetailsPanel
                item={selectedItem}
                showDetails={showDetails}
                onClose={() => setShowDetails(false)}
                onSet={handleSet}
              />
            )}
            selectedItem={selectedItem}
            handleSet={handleSet}
          />
        </VStack>
      </Flex>
    </>
  );
};

export default Homescreen;