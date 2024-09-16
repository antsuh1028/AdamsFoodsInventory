import {
  Select,
  HStack,
  Text,
  Input,
  VStack,
  Flex,
  Button,
  FormControl,
  FormLabel,
  Box,
  List,
  ListItem,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  useToast
} from "@chakra-ui/react";
import React, { useState } from "react";
import axios from "axios";
import Navbar from "./Navbar";

const Homescreen = () => {
  //State for the inputs
  const [location, setLocation] = useState("");
  const [lot, setLot] = useState("");
  const [vendor, setVendor] = useState("");
  const [brand, setBrand] = useState("");
  const [species, setSpecies] = useState("");
  const [description, setDescription] = useState("");
  const [grade, setGrade] = useState("");
  const [quantity, setQuantity] = useState("");
  const [weight, setWeight] = useState("");
  const [packdate, setPackdate] = useState("");
  const [temp, setTemp] = useState("");
  const [est, setEst] = useState("");

  //The states for the Display Area
  const [items, setItems] = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [currentItem, setCurrentItem] = useState(null);

  const inputs = {
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
    est,
  };

  const updateInputs = {
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
    est,
    currentItem,
  };

  const toast = useToast();

  //Function that Adds to the Freezer Database
  const handleAdd = () => {
    console.log("Inputs:", inputs);
    axios
      .post("http://localhost:3001/inventoryAdd", { inputs })
      .then((result) => {
        toast({
          title: "Adding Item Error",
          position:"top",
          description: "Item Successfully Added.",
          status: "success",
          duration: 2000,
          isClosable: true,
        });
        handleClear();
        setShowDetails(false);
        handleFind();
      })
      .catch((err) => {
        const message = err.response.data.error
        toast({
          title: "Adding Item Error",
          position:"top",
          description: message,
          status: "error",  
          duration: 2000,
          isClosable: true,
        });

        setItems([]);
        setShowDetails(false);
      });
  };

  //Function that Finds a Product based on the Input Fields
  const handleFind = () => {

    axios
      .post("http://localhost:3001/inventoryFind", { inputs })
      .then((result) => {
        const sortedItems = result.data.sort((a, b) =>
          a.location.localeCompare(b.location)
        );
        setItems(sortedItems);
        setShowDetails(false);
        setShowDetails(false);
      })
      .catch((err) => {
        const message = err.response.data.error
        toast({
          title: "Finding Item Error",
          position:"top",
          description: message,
          status: "error",
          duration: 2000,
          isClosable: true,
        });
        setItems([]);
        setShowDetails(false);
      });
  };

  //Function that Updates a Location in the Freezer Database
  const handleUpdate = async (e) => {
    e.preventDefault();

    const userConfirmed = window.confirm(
      "Are you sure you want to update this item?"
    );

    if (userConfirmed) {
      axios
        .post("http://localhost:3001/inventoryUpdate", { updateInputs })
        .then((result) => {
          toast({
            title: "Update Item Success",
            position:"top",
            description: "Successfully Updated Item",
            status: "success",
            duration: 2000,
            isClosable: true,
          });
          setItems([result.data]);
          setShowDetails(false);
          setCurrentItem(null)
          handleClear();
        })
        .catch((err) => {
          const message = err.response.data.error
          toast({
            title: "Update Item Error",
            position:"top",
            description: message,
            status: "error",
            duration: 2000,
            isClosable: true,
          });
          setItems([]);
          setShowDetails(false);
        });
    } else {
      console.log("User canceled the update.");
    }
  };

  //Function that Removes the Product from a Location
  const handleRemove = () => {
    const userConfirmed = window.confirm(
      "Are you sure you want to delete this item?"
    );
    console.log(currentItem)
    if (!currentItem){
      toast({
        title: "Remove Item Error",
        position:"top",
        description: "Set Item you would like to Remove.",
        status: "error",
        duration: 2000,
        isClosable: true,
      });
    }else{
      if (userConfirmed) {
        if (location == currentItem.location){
          
          axios
            .post("http://localhost:3001/inventoryRemove", { currentItem })
            .then((result) => {
              toast({
                title: "Remove Item Success",
                position:"top",
                description: "Successfully Removed Item",
                status: "success",
                duration: 2000,
                isClosable: true,
              });
              setShowDetails(false);
              setItems([]);
              setCurrentItem(null)
              handleClear();
            })
            .catch((err) => {
              const message = err.response.data.error
              toast({
                title: "Remove Item Error",
                position:"top",
                description: message,
                status: "error",
                duration: 2000,
                isClosable: true,
              });
              setItems([]);
              setShowDetails(false);
            });
        }else{
          toast({
            title: "Remove Item Error",
            position:"top",
            description: "Set Item you would like to Remove.",
            status: "error",
            duration: 2000,
            isClosable: true,
          });
          setShowDetails(false);
          setItems([]);
        };
  
      } else {
        console.log("User canceled the deletion.");
      }
    }
  };

  //Function that Clears All Inputs on the Form
  const handleClear = () => {
    setLocation("");
    setLot("");
    setVendor("");
    setBrand("");
    setSpecies("");
    setDescription("");
    setGrade("");
    setQuantity("");
    setWeight("");
    setPackdate("");
    setTemp("");
    setEst("");

    setCurrentItem(null)
  };

  //Function that Sets the detailed information into Inputs on the Form
  const handleSet = (item) => {
    setLocation(item.location || "");
    setLot(item.lot || "");
    setVendor(item.vendor || "");
    setBrand(item.brand || "");
    setSpecies(item.species || "");
    setDescription(item.description || "");
    setGrade(item.grade || "");
    setQuantity(item.quantity || "");
    setWeight(item.weight || "");
    setPackdate(item.packdate || "");
    setTemp(item.temp || "");
    setEst(item.est || "");

    setCurrentItem(item);
  };

  //Used for Display Area
  const handleItemClick = (item) => {
    setSelectedItem(item);
    setShowDetails(true);
  };

  const handleTabClick = () => {
    setShowDetails(false);
  };

  const DetailsPanel = ({ item, onClose, onSet }) => (
    showDetails && item && (
      <Box
        p={4}
        bg="white"
        borderWidth="1px"
        borderRadius="md"
        mt={4}
        width="90%"
      >
        <Text fontWeight="bold">Location: {item.location}</Text>
        <Text>Lot: {item.lot}</Text>
        <Text>Vendor: {item.vendor}</Text>
        <Text>Brand: {item.brand}</Text>
        <Text>Species: {item.species}</Text>
        <Text>Description: {item.description}</Text>
        <Text>Grade: {item.grade}</Text>
        <Text>Quantity: {item.quantity}</Text>
        <Text>Weight: {item.weight}</Text>
        <Text>Pack Date: {item.packdate}</Text>
        <Text>Temperature: {item.temp}</Text>
        <Text>EST#: {item.est}</Text>
        <Flex width="100%" justifyContent="center" mt={4}>
          <Button marginRight="10px" onClick={() => onSet(item)}>Set</Button>
          <Button onClick={onClose}>Close</Button>
        </Flex>
      </Box>
    )
  );

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
          <FormControl width="90%">
            <VStack spacing={2} alignItems="center">
              <HStack spacing={2} width="100%">
                <VStack spacing={1} width="75%">
                  <FormLabel
                    marginTop="5px"
                    textAlign="left"
                    marginBottom="5px"
                  >
                    Location
                  </FormLabel>
                  <Input
                    required
                    value={location}
                    type="text"
                    bg="white"
                    width="100%"
                    placeholder="Enter Location"
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </VStack>
                <VStack spacing={1} width="25%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    Lot
                  </FormLabel>
                  <Input
                    value={lot}
                    type="text"
                    bg="white"
                    width="100%"
                    placeholder="Enter Lot"
                    onChange={(e) => setLot(e.target.value)}
                  />
                </VStack>
              </HStack>

              <HStack spacing={2} width="100%">
                <VStack spacing={1} width="33%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    Vendor
                  </FormLabel>
                  <Input
                    value={vendor}
                    type="text"
                    bg="white"
                    width="100%"
                    placeholder="Enter Vendor"
                    onChange={(e) => setVendor(e.target.value)}
                  />
                </VStack>
                <VStack spacing={1} width="33%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    Brand
                  </FormLabel>
                  <Input
                    value={brand}
                    type="text"
                    bg="white"
                    width="100%"
                    placeholder="Enter Brand"
                    onChange={(e) => setBrand(e.target.value)}
                  />
                </VStack>
                <VStack spacing={1} width="33%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    Species
                  </FormLabel>
                  <Select
                    value={species}
                    bg="white"
                    width="100%"
                    placeholder="Select Species"
                    onChange={(e) => setSpecies(e.target.value)}
                  >
                    <option value="Beef">Beef</option>
                    <option value="Prok">Pork</option>
                    <option value="Chicken">Chicken</option>
                    <option value="Lamb">Lamb</option>
                  </Select>
                </VStack>
              </HStack>

              <FormLabel marginTop="5px" marginBottom="5px">
                Description
              </FormLabel>
              <Input
                value={description}
                type="text"
                bg="white"
                width="100%"
                size="lg"
                placeholder="Enter Description"
                onChange={(e) => setDescription(e.target.value)}
              />

              <HStack spacing={4} width="100%">
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    Grade
                  </FormLabel>
                  <Select
                    value={grade}
                    bg="white"
                    width="100%"
                    placeholder="Select Grade"
                    onChange={(e) => setGrade(e.target.value)}
                  >
                    <option value="Wagyu">Wagyu</option>
                    <option value="Prime">Prime</option>
                    <option value="Choice">Choice</option>
                    <option value="No Roll/Ongrade">No Roll/Ongrade</option>
                    <option value="Select">Select</option>
                    <option value="Other">Other</option>
                  </Select>
                </VStack>
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    Quantity
                  </FormLabel>
                  <Input
                    value={quantity}
                    type="number"
                    bg="white"
                    width="100%"
                    placeholder="Enter Quantity"
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </VStack>
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    Weight
                  </FormLabel>
                  <Input
                    value={weight}
                    type="number"
                    bg="white"
                    width="100%"
                    placeholder="Enter Weight"
                    onChange={(e) => setWeight(e.target.value)}
                  />
                </VStack>
              </HStack>

              <HStack spacing={4} width="100%">
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    Pack Date
                  </FormLabel>
                  <Input
                    value={packdate}
                    type="date"
                    bg="white"
                    width="100%"
                    onChange={(e) => setPackdate(e.target.value)}
                  />
                </VStack>
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    Temperature (°F)
                  </FormLabel>
                  <Input
                    value={temp}
                    type="number"
                    bg="white"
                    width="100%"
                    placeholder="Enter Temperature"
                    onChange={(e) => setTemp(e.target.value)}
                  />
                </VStack>
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">
                    EST#
                  </FormLabel>
                  <Input
                    value={est}
                    type="text"
                    bg="white"
                    width="100%"
                    placeholder="Enter Est"
                    onChange={(e) => setEst(e.target.value)}
                  />
                </VStack>
              </HStack>
            </VStack>
          </FormControl>

          <Flex
            alignItems="center"
            justifyContent="center"
            mt="20px"
            width="100%"
          >
            <HStack spacing="5">
              <Button bg="green.200" margin="20px" onClick={handleAdd}>
                Add
              </Button>
              <Button bg="white" margin="20px" onClick={handleFind}>
                Find
              </Button>
              <Button
                bg="white"
                margin="20px"
                onClick={handleUpdate}
                type="submit"
              >
                Update
              </Button>
              <Button bg="white" margin="20px" onClick={handleRemove}>
                Remove
              </Button>
              <Button bg="red.200" margin="20px" onClick={handleClear}>
                Clear
              </Button>
            </HStack>
          </Flex>
        </Flex>

        {/* Area for Object Displaying*/}
        <VStack
          bg="lightblue"
          width="50%"
          height="90%"
          margin="10px"
          direction="column"
          justifyContent="flex-start"
          alignItems="center"
        >
          <Tabs variant="enclosed" width="100%" height="100%">
            <TabList>
              <Tab bg="lightblue" border="1px" onClick={handleTabClick}>
                Level 1
              </Tab>
              <Tab bg="lightblue" border="1px" onClick={handleTabClick}>
                Level 2
              </Tab>
              <Tab bg="lightblue" border="1px" onClick={handleTabClick}>
                Level 3
              </Tab>
            </TabList>

            <TabPanels border="1px" height="90%">
              {/* Level 1 Panel */}
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
                      .filter((item) => item.location[1] === "1")
                      .map((item, index) => (
                        <ListItem
                          key={index}
                          onClick={() => handleItemClick(item)}
                        >
                          <Box
                            p={3}
                            shadow="md"
                            marginTop="10px"
                            borderWidth="1px"
                            borderRadius="md"
                            bg="gray.100"
                            cursor="pointer"
                            _hover={{ bg: "gray.200" }}
                          >
                            {`Level 1: ${item.location} - ${item.description}`}
                          </Box>
                        </ListItem>
                      ))}
                  </List>
                  <DetailsPanel
                    item={selectedItem}
                    onSet={handleSet}
                  />
                </Flex>
              </TabPanel>

              {/* Level 2 Panel */}
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
                      .filter((item) => item.location[1] === "2")
                      .map((item, index) => (
                        <ListItem
                          key={index}
                          onClick={() => handleItemClick(item)}
                        >
                          <Box
                            p={3}
                            shadow="md"
                            borderWidth="1px"
                            borderRadius="md"
                            bg="gray.100"
                            cursor="pointer"
                            _hover={{ bg: "gray.200" }}
                          >
                            {`Level 2: ${item.location} - ${item.description}`}
                          </Box>
                        </ListItem>
                      ))}
                  </List>
                  <DetailsPanel
                    item={selectedItem}
                    onSet={handleSet}
                  />
                </Flex>
              </TabPanel>

              {/* Level 3 Panel */}
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
                      .filter(
                        (item) =>
                          item.location[1] !== "1" && item.location[1] !== "2"
                      )
                      .map((item, index) => (
                        <ListItem
                          key={index}
                          onClick={() => handleItemClick(item)}
                        >
                          <Box
                            p={3}
                            shadow="md"
                            borderWidth="1px"
                            borderRadius="md"
                            bg="gray.100"
                            cursor="pointer"
                            _hover={{ bg: "gray.200" }}
                          >
                            {`Level 3: ${item.location} - ${item.description}`}
                          </Box>
                        </ListItem>
                      ))}
                  </List>
                  <DetailsPanel
                    item={selectedItem}
                    onSet={handleSet}
                  />
                </Flex>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>
      </Flex>
    </>
  );
};

export default Homescreen;
