import React from 'react';
import { Input, Stack, Flex, Center, Text, InputGroup, InputLeftElement, InputRightElement, Button } from '@chakra-ui/react';
import { EmailIcon, UnlockIcon, CheckIcon } from '@chakra-ui/icons'


const Login = () => {
  return (
    <Flex width="100vw" height="100vh" alignItems="center" justifyContent="center" bg="white">
      <Center>
        <Stack spacing={10} align="center">
          <Text fontSize="4xl" fontWeight="bold" color="teal" fontFamily="sans-serif">Adam's Foods Inventory System</Text>

          <Stack spacing={3}>
            <InputGroup>
                <InputLeftElement pointerEvents='none'>
                <EmailIcon color='gray.300' />
                </InputLeftElement>
                <Input type='tel' placeholder='Enter Email' />
            </InputGroup>

            <InputGroup>
                <InputLeftElement pointerEvents='none' color='gray.300' fontSize='1.2em'>
                <UnlockIcon/>
                </InputLeftElement>
                <Input placeholder='Enter Password' />
                <InputRightElement>
                <CheckIcon color='green.500' />
                </InputRightElement>
            </InputGroup>
            <Flex width="100%" justifyContent="space-between" mt={5}>
                <Button colorScheme="teal" size="lg" width="48%">
                Login
                </Button>
                <Button colorScheme="teal" size="lg" width="48%">
                Sign Up
                </Button>
            </Flex>
          </Stack>
        </Stack>
      </Center>
    </Flex>
  );
}

export default Login;
