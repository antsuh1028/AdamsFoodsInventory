
import {Textarea, Box, Input, VStack, Stack, Flex, Center, Text, InputGroup, InputLeftElement, InputRightElement, Button } from '@chakra-ui/react';
import React, { useState } from 'react';
import {FormControl, FormLabel,} from '@chakra-ui/react'
import Navbar from './Navbar';


const Homescreen = () => {


    const [input1, setInput1] = useState('');
    const [input2, setInput2] = useState('');
    const [input3, setInput3] = useState('');
    const [input4, setInput4] = useState('');
    const [input5, setInput5] = useState('');

    const [showTextarea, setShowTextarea] = useState(false);
    const [textareaContent, setTextareaContent] = useState('');


    const handleFind = () => {
      console.log('Find:', { input1, input2, input3, input4, input5 });

      setTextareaContent(`Input 1: ${input1}\nInput 2: ${input2}\nInput 3: ${input3}\nInput 4: ${input4}\nInput 5: ${input5}`);
      setShowTextarea(true);
    };

    const handleUpdateSubmit = () => {  
      console.log('Find:', { input1, input2, input3, input4, input5 });
    };

    const handleDelete = () => {
      console.log('Find:', { input1, input2, input3, input4, input5 });
    };

    return (
      <>
      <Navbar />
      <Flex width="100vw" height="100vh" alignItems="center" justifyContent="space-between" bg="lightblue" pt="60px" >
        <Flex bg="lightblue" width="80%" height="90%"  margin="10px" border='1px' direction='column' justifyContent='center' alignItems='center'>
          <FormControl >
            <VStack spacing={2} alignItems="center">
              <Box width="90%">
                <FormLabel marginTop='5px' marginBottom='5px'>Input</FormLabel>
                <Input bg='white' width="100%" type="input" id='input1' onChange={(e) => setInput1(e.target.value)}/>
              </Box>
              <Box width="90%">
                <FormLabel marginTop='1px'>Input</FormLabel>
                <Input bg='white' width="100%" type="input"  id='input2' onChange={(e) => setInput2(e.target.value)}/>
              </Box>
              <Box width="90%">
                <FormLabel>Input</FormLabel>
                <Input bg='white' width="100%" type="input" id='input3' onChange={(e) => setInput3(e.target.value)}/>
              </Box>
              <Box width="90%">
                <FormLabel>Input</FormLabel>
                <Input bg='white' width="100%" type="input" id='input4' onChange={(e) => setInput4(e.target.value)}/>
              </Box>
              <Box width="90%">
                <FormLabel>Input</FormLabel>
                <Input bg='white' width="100%" type="input" id='input5' onChange={(e) => setInput5(e.target.value)}/>
              </Box>
            </VStack>
          </FormControl>

          <Flex alignItems="center" >
            <Button bg="white" margin="20px" onClick={handleFind}>Find</Button>
            <Button bg="white" margin="20px" onClick={handleUpdateSubmit}>Update/Submit</Button>
            <Button bg="white" margin="20px" onClick={handleDelete}>Delete</Button>
          </Flex>

        </Flex>

        <Flex bg="lightblue" width="50%" height="85%" margin="10px" border="1px" justifyContent="center" alignItems="center">
          {showTextarea && (<Textarea bg="white" width="90%" height="80%" value={textareaContent} readOnly/>)}
        </Flex>
      </Flex>
    </>
    );
  }
  
  export default Homescreen;