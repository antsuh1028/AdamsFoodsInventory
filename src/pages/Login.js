import React, { useState } from 'react';
import { Input, Stack, Flex, Center, Text, InputGroup, InputLeftElement, InputRightElement, Button } from '@chakra-ui/react';
import { EmailIcon, UnlockIcon, CheckIcon } from '@chakra-ui/icons';
import { Link, useNavigate } from 'react-router-dom';
import axios from "axios";

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate()


  const handleSubmit = (e) => {
    e.preventDefault(); // Prevents the default form submission behavior
    axios.post('http://localhost:3001/login', { email, password })
      .then(result => {
        console.log(result)
        if(result.data === "Success"){
          navigate("/")
        }
      })
      .catch(err => console.log(err));
  };

  return (
    <Flex width="100vw" height="100vh" alignItems="center" justifyContent="center" bg="white">
      <Center>
        <Stack spacing={10} align="center">
          <Text fontSize="4xl" fontWeight="bold" color="teal" fontFamily="sans-serif">Adam's Foods Inventory System</Text>
          <Text fontSize="4xl" fontWeight="bold" color="teal" fontFamily="sans-serif">Login</Text>
          <form onSubmit={handleSubmit}> {/* Form element to handle submission */}
            <Stack spacing={3}>
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

              <Flex width="100%" justifyContent="space-between" mt={5}>
                <Button colorScheme="teal" size="lg" width="48%" type="submit">Login</Button>
                <Button colorScheme="teal" size="lg" width="48%" as={Link} to="/signup">
                  Sign Up
                </Button>
              </Flex>
            </Stack>
          </form>
        </Stack>
      </Center>
    </Flex>
  );
}

export default Login;
