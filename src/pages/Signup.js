import React, { useState } from 'react';
import { Input, Stack, Flex, Center, Text, InputGroup, InputLeftElement, InputRightElement, Button, Link as ChakraLink } from '@chakra-ui/react';
import { EmailIcon, UnlockIcon, CheckIcon } from '@chakra-ui/icons';
import { Link } from 'react-router-dom';
import axios from "axios";

const Signup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault(); // Prevents the default form submission behavior
    axios.post('https://server.afdcstorage.com/signup', { email, password })
      .then(result => {
        console.log(result)
      })
      .catch(err => console.log(err));
  };

  return (
    <Flex width="100vw" height="100vh" alignItems="center" justifyContent="center" bg="white">
      <Center>
        <Stack spacing={10} align="center">
          <Text fontSize="4xl" fontWeight="bold" color="teal" fontFamily="sans-serif">Adam's Foods Inventory System</Text>
          <Text fontSize="4xl" fontWeight="bold" color="teal" fontFamily="sans-serif">Signup</Text>
          <form onSubmit={handleSubmit}> {/* Form element to handle submission */}
            <Stack spacing={3} align="center">
              <InputGroup>
                <InputLeftElement pointerEvents='none'>
                  <EmailIcon color='gray.300' />
                </InputLeftElement>
                <Input type='email' placeholder='Enter Email' onChange={(e) => setEmail(e.target.value)} />
              </InputGroup>

              <InputGroup>
                <InputLeftElement pointerEvents='none' color='gray.300' fontSize='1.2em'>
                  <UnlockIcon />
                </InputLeftElement>
                <Input type='password' placeholder='Enter Password' onChange={(e) => setPassword(e.target.value)} />
                <InputRightElement>
                  <CheckIcon color='green.500' />
                </InputRightElement>
              </InputGroup>

              <Button colorScheme="teal" size="lg" width="100%" type="submit" mt={5}>
                Sign Up
              </Button>

              <ChakraLink as={Link} to="/login" fontSize="lg" color="teal" textDecoration="underline" mt={5}>
                Already have an account?
              </ChakraLink>
            </Stack>
          </form>
        </Stack>
      </Center>
    </Flex>
  );
}

export default Signup;
