import { Select, HStack, Textarea, Box, Input, VStack, Flex, Button, FormControl, FormLabel } from '@chakra-ui/react';
import React, { useState } from 'react';
import axios from 'axios'; // Ensure axios is imported for HTTP requests
import Navbar from './Navbar';

const Homescreen = () => {
  // const [inputs, setInputs] = useState(Array(13).fill(''));
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
  const [showTextarea, setShowTextarea] = useState(false);
  const [textareaContent, setTextareaContent] = useState('');

  const inputs = {location,
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
    est}

  const handleFind = () => {

    axios.post('http://localhost:3001/inventoryFind', { inputs }) // Assuming you have an endpoint for submission
      .then(result => {
        console.log("result:",result.data[0].location);
        setTextareaContent(result.data[1].location, result.data[1].location);
          setShowTextarea(true);
      })
      .catch(err => console.log(err));

    
  };

  const handleUpdateSubmit = (e) => {  
    e.preventDefault(); // Prevents the default form submission behavior
    axios.post('http://localhost:3001/updateSubmit', { inputs }) // Assuming you have an endpoint for submission
      .then(result => {
        console.log(result);
        if(result.data === "Success"){
          //handle by message
        }
      })
      .catch(err => console.log(err));
  };

  const handleDelete = () => {
    console.log('Delete:', inputs);
  };

  return (
    <>
      <Navbar />
      <Flex width="100vw" height="100vh" alignItems="center" justifyContent="space-between" bg="lightblue" pt="60px">
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
          <form onSubmit={handleUpdateSubmit}>
            <FormControl>
              <VStack spacing={2} alignItems="center">
              
                <HStack spacing={2} width="100%">
                  <VStack spacing={1} width="75%">
                    <FormLabel marginTop="5px" textAlign='left' marginBottom="5px">Location</FormLabel>
                    <Input type='text' bg="white" width="100%" placeholder='Enter Location' onChange={(e) => setLocation(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="25%">
                    <FormLabel marginTop="5px" marginBottom="5px">Lot</FormLabel>
                    <Input type='text' bg="white" width="100%" placeholder='Enter Lot' onChange={(e) => setLot(e.target.value)} />
                  </VStack>
                </HStack>

                

                <HStack spacing={2} width="100%" marginTop="10px"> 
                  </HStack>

                <HStack spacing={2} width="100%">
                  <VStack spacing={1} width="33%">
                    <FormLabel marginTop="5px" marginBottom="5px">Vendor</FormLabel>
                    <Input type='text' bg="white" width="100%" placeholder='Enter Vendor' onChange={(e) => setVendor(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="33%">
                    <FormLabel marginTop="5px" marginBottom="5px">Brand</FormLabel>
                    <Input type='text' bg="white" width="100%" placeholder='Enter Brand' onChange={(e) => setBrand(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="33%">
                    <FormLabel marginTop="5px" marginBottom="5px">Species</FormLabel>
                    <Input type='text' bg="white" width="100%" placeholder='Enter Species' onChange={(e) => setSpecies(e.target.value)} />
                  </VStack>
                  
                </HStack>

                <FormLabel marginTop="5px" marginBottom="5px">Description</FormLabel>
                <Input type='text' bg="white" width="100%" size="lg"  placeholder='Enter Description' onChange={(e) => setDescription(e.target.value)} />

                <HStack spacing={4} width="100%">
                  <VStack spacing={1} width="32%">
                    <FormLabel marginTop="5px" marginBottom="5px">Grade</FormLabel>
                    <Input type='text' bg="white" width="100%" placeholder='Enter Grade' onChange={(e) => setGrade(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="32%">
                    <FormLabel marginTop="5px" marginBottom="5px">Quantity</FormLabel>
                    <Input type='number' bg="white" width="100%" placeholder='Enter Quantity' onChange={(e) => setQuantity(e.target.value)} />
                  </VStack>
                  <VStack spacing={1} width="32%">
                    <FormLabel marginTop="5px" marginBottom="5px">Weight</FormLabel>
                    <Input type='number' bg="white" width="100%" placeholder='Enter Weight' onChange={(e) => setWeight(e.target.value)} />
                  </VStack>
              </HStack>

              <HStack spacing={4} width="100%">
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">Pack Date</FormLabel>
                  <Input type='date' bg="white" width="100%" onChange={(e) => setPackdate(e.target.value)} />
                </VStack>
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">Temperature</FormLabel>
                  <Input type='number' bg="white" width="100%" placeholder='Enter Temperature' onChange={(e) => setTemp(e.target.value)} />
                </VStack>
                <VStack spacing={1} width="32%">
                  <FormLabel marginTop="5px" marginBottom="5px">EST#</FormLabel>
                  <Input type='text' bg="white" width="100%" placeholder='Enter Est' onChange={(e) => setEst(e.target.value)} />
               </VStack>
              </HStack>

                
                
                
                
              </VStack>
            </FormControl>

            <Flex alignItems="center" mt="20px">
              <Button bg="white" margin="20px" >Add</Button>
              <Button bg="white" margin="20px" onClick={handleFind}>Find</Button>
              <Button bg="white" margin="20px" type="submit">Update</Button>
              <Button bg="white" margin="20px" onClick={handleDelete}>Delete</Button>
            </Flex>
          </form>
        </Flex>

        <Flex bg="lightblue" width="50%" height="85%" margin="10px" border="1px" justifyContent="center" alignItems="center">
          {showTextarea && (
            <Textarea bg="white" width="90%" height="80%" value={textareaContent} readOnly />
          )}
        </Flex>
      </Flex>
    </>
  );
};

export default Homescreen;
