import {    HStack, Text, Textarea, Input, VStack, Flex, Button, FormControl, FormLabel, Box, List, ListItem 
} from '@chakra-ui/react';
import React, { useState } from 'react';
import axios from 'axios'; 
import Navbar from './Navbar';



const Homescreen = () => {

  //State for the inputs
  const [location, setLocation] = useState('');
  const [lot, setLot] = useState('');
  const [vendor, setVendor] = useState('');
  const [brand, setBrand] = useState('');
  const [species, setSpecies] = useState('');
  const [description, setDescription] = useState('');
  const [grade, setGrade] = useState('');
  const [quantity, setQuantity] = useState('');
  const [weight, setWeight] = useState('');
  const [packdate, setPackdate] = useState('');
  const [temp, setTemp] = useState('');
  const [est, setEst] = useState('');

  //The States for the Display Area
  const [items, setItems] = useState([]); 
  const [showDetails, setShowDetails] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [errorMessage, setErrorMessage] = useState(''); // State to hold error message


  const inputs = {location,lot,vendor,brand,species,description,grade,quantity,weight,packdate,temp,est}

    const handleFind = () => {
      axios.post('http://localhost:3001/inventoryFind', { inputs })
      .then(result => {
        console.log("result:", result.data);

        if (result.data.length === 0) {
          setErrorMessage('No items found. Please try different criteria.');
          setItems([]);
        } else {
          setItems(result.data);
          setErrorMessage(''); 
        }

      })
      .catch(err => {
        console.log(err);
        setErrorMessage('No Item Found');
      });
  };
    //Used for Display Area
    const handleItemClick = (item) => {
      setSelectedItem(item); 
      setShowDetails(true); 
    };

  const handleUpdate = (e) => {  
    e.preventDefault(); // Prevents the default form submission behavior
    axios.post('http://localhost:3001/update', { inputs }) // Assuming you have an endpoint for submission
    .then(result => {
      console.log("result:", result.data);

      if (result.data.length === 0) {
        setErrorMessage('No items found. Please try different criteria.');
        setItems([]);
      } else {
        setItems([result.data]);
        setShowDetails(false)
        setErrorMessage('')
      }

    })
    .catch(err => {
      console.log(err);
      setErrorMessage('No Item Found');
      setItems([]);
        setShowDetails(false)
    });
  };

  const handleDelete = () => {
    console.log('Delete:', inputs);
  };

  const handleSet = (item) => {
    console.log('Setting...');
    console.log(item)
    setLocation(item.location || '');
    setLot(item.lot || '');
    setVendor(item.vendor || '');
    setBrand(item.brand || '');
    setSpecies(item.species || '');
    setDescription(item.description || '');
    setGrade(item.grade || '');
    setQuantity(item.quantity || '');
    setWeight(item.weight || '');
    setPackdate(item.packdate || '');
    setTemp(item.temp || '');
    setEst(item.est || '');

  }

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
  }

  
  return (
    <>
      <Navbar />
      <Flex width="100vw" height="100vh" alignItems="center" justifyContent="space-between" bg="lightblue" pt="60px">
        <Flex bg="lightblue" width="80%" height="90%" margin="10px" border="1px" direction="column" justifyContent="flex-start" alignItems="center" overflowY="auto">
          <form onSubmit={handleUpdate}>
            <FormControl>
              <VStack spacing={2} alignItems="center">
              
                <HStack spacing={2} width="100%">
                  <VStack spacing={1} width="75%">
                    <FormLabel  marginTop="5px" textAlign='left' marginBottom="5px">Location</FormLabel>
                    <Input value={location} type='text' bg="white" width="100%" placeholder='Enter Location' onChange={(e) => setLocation(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="25%">
                    <FormLabel marginTop="5px" marginBottom="5px">Lot</FormLabel>
                    <Input value={lot} type='text' bg="white" width="100%" placeholder='Enter Lot' onChange={(e) => setLot(e.target.value)} />
                  </VStack>
                </HStack>

                <HStack spacing={2} width="100%">
                  <VStack spacing={1} width="33%">
                    <FormLabel marginTop="5px" marginBottom="5px">Vendor</FormLabel>
                    <Input value={vendor} type='text' bg="white" width="100%" placeholder='Enter Vendor' onChange={(e) => setVendor(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="33%">
                    <FormLabel marginTop="5px" marginBottom="5px">Brand</FormLabel>
                    <Input value={brand} type='text' bg="white" width="100%" placeholder='Enter Brand' onChange={(e) => setBrand(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="33%">
                    <FormLabel marginTop="5px" marginBottom="5px">Species</FormLabel>
                    <Input value={species} type='text' bg="white" width="100%" placeholder='Enter Species' onChange={(e) => setSpecies(e.target.value)} />
                  </VStack>
                  
                </HStack>

                <FormLabel marginTop="5px" marginBottom="5px">Description</FormLabel>
                <Input value={description} type='text' bg="white" width="100%" size="lg"  placeholder='Enter Description' onChange={(e) => setDescription(e.target.value)} />

                <HStack spacing={4} width="100%">
                  <VStack spacing={1} width="32%">
                    <FormLabel marginTop="5px" marginBottom="5px">Grade</FormLabel>
                    <Input value={grade} type='text' bg="white" width="100%" placeholder='Enter Grade' onChange={(e) => setGrade(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="32%">
                    <FormLabel marginTop="5px" marginBottom="5px">Quantity</FormLabel>
                    <Input  value={quantity} type='number' bg="white" width="100%" placeholder='Enter Quantity' onChange={(e) => setQuantity(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="32%">
                    <FormLabel marginTop="5px" marginBottom="5px">Weight</FormLabel>
                    <Input  value={weight} type='number' bg="white" width="100%" placeholder='Enter Weight' onChange={(e) => setWeight(e.target.value)} />
                  </VStack>
              </HStack>

              <HStack spacing={4} width="100%">
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">Pack Date</FormLabel>
                  <Input value={packdate} type='date' bg="white" width="100%" onChange={(e) => setPackdate(e.target.value)} />
                </VStack>
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">Temperature</FormLabel>
                  <Input value={temp} type='number' bg="white" width="100%" placeholder='Enter Temperature' onChange={(e) => setTemp(e.target.value)} />
                </VStack>
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">EST#</FormLabel>
                  <Input value={est} type='text' bg="white" width="100%" placeholder='Enter Est' onChange={(e) => setEst(e.target.value)} />
               </VStack>
              </HStack>
              </VStack>
            </FormControl>

            <Flex alignItems="center" mt="20px" width='100%'>
              <HStack spacing="4">
                <Button bg="green.200" margin="20px" >Add</Button>
                <Button bg="white" margin="20px" onClick={handleFind}>Find</Button>
                <Button bg="white" margin="20px" onClick={handleUpdate} type="submit">Update</Button>
                <Button bg="white" margin="20px" onClick={handleDelete}>Delete</Button>
                <Button bg="red.200" margin="20px" onClick={handleClear}>Clear</Button>
              </HStack>
            </Flex>
          </form>
        </Flex>


        {/* Area for Object Displaying*/}
        <Flex bg="lightblue" width="50%" height="85%" margin="10px" border="1px" direction="column" justifyContent="flex-start" alignItems="center" overflowY="auto">
          
          {errorMessage && <Text color="red.500" mb={4}>{errorMessage}</Text>} {/* Display error message if any */}

          <List spacing={3} width="90%">
            {items.map((item, index) => (
              <ListItem key={index} onClick={() => handleItemClick(item)}>
                <Box p={3} shadow="md" borderWidth="1px" borderRadius="md" bg="white" cursor="pointer" _hover={{ bg: "gray.100" }}>
                  {`Item ${index + 1}: ${item.location} - ${item.description}`}
                </Box>
              </ListItem>
            ))}
          </List>

          {showDetails && selectedItem && (
            <Box p={4} bg="white" borderWidth="1px" borderRadius="md" mt={4} width="90%">
              
              <Text fontWeight="bold">Location: {selectedItem.location}</Text>
              <Text>Lot: {selectedItem.lot}</Text>
              <Text>Vendor: {selectedItem.vendor}</Text>
              <Text>Brand: {selectedItem.brand}</Text>
              <Text>Species: {selectedItem.species}</Text>
              <Text>Description: {selectedItem.description}</Text>
              <Text>Grade: {selectedItem.grade}</Text>
              <Text>Quantity: {selectedItem.quantity}</Text>
              <Text>Weight: {selectedItem.weight}</Text>
              <Text>Pack Date: {selectedItem.packdate}</Text>
              <Text>Temperature: {selectedItem.temp}</Text>
              <Text>EST#: {selectedItem.est}</Text>
              
              <Flex width="100%" justifyContent="center" mt={4}>
              <Button onClick={() => handleSet(selectedItem)}>Set</Button> 
              </Flex>

            </Box>
          )}
        </Flex>

      </Flex>
    </>
  );
};

export default Homescreen;
