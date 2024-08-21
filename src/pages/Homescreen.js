import { Select, Textarea, Box, VStack, Flex, Button, FormControl, FormLabel } from '@chakra-ui/react';
import React, { useState } from 'react';
import axios from 'axios'; // Ensure axios is imported for HTTP requests
import Navbar from './Navbar';

const Homescreen = () => {
  const [inputs, setInputs] = useState(Array(13).fill(''));
  const [showTextarea, setShowTextarea] = useState(false);
  const [textareaContent, setTextareaContent] = useState('');

  const handleInputChange = (index, value) => {
    const newInputs = [...inputs];
    newInputs[index] = value;
    setInputs(newInputs);
  };

  const handleFind = () => {

    axios.post('http://localhost:3001/inventoryFind', { inputs }) // Assuming you have an endpoint for submission
      .then(result => {
        console.log(result);
        if(result.data === "Success"){
          setTextareaContent(inputs.map((input, index) => `Input ${index + 1}: ${input}`).join('\n'));
          setShowTextarea(true);
        }
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
                {Array.from({ length: 13 }, (_, index) => (
                  <Box width="90%" key={index}>
                    <FormLabel marginTop="5px" marginBottom="5px">{`Input ${index + 1}`}</FormLabel>
                    <Select
                      bg="white"
                      width="100%"
                      placeholder={`Select option for Input ${index + 1}`}
                      onChange={(e) => handleInputChange(index, e.target.value)}
                    >
                      <option value="Option 1">Option 1</option>
                      <option value="Option 2">Option 2</option>
                      <option value="Option 3">Option 3</option>
                    </Select>
                  </Box>
                ))}
              </VStack>
            </FormControl>

            <Flex alignItems="center" mt="20px">
              <Button bg="white" margin="20px" onClick={handleFind}>Find</Button>
              <Button bg="white" margin="20px" type="submit">Update/Submit</Button>
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
