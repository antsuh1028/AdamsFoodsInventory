import React, { useEffect } from 'react';
import { Center, Spinner, Text, VStack } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';

const Loading = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/home');
    }, 500);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <Center h="100vh">
      <VStack>
        <Spinner thickness='4px' speed='0.65s' emptyColor='gray.200' color='blue.500' size='xl'/>
        <Text>Loading...</Text>
      </VStack>
    </Center>
  );
};

export default Loading;
