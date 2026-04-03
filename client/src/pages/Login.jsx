import React, { useState } from "react";
import {
  Image,
  Box,
  Input,
  Stack,
  Flex,
  Text,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Button,
  VStack,
  Alert,
  AlertIcon,
  Divider,
} from "@chakra-ui/react";
import { EmailIcon, LockIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await axios.post("https://server.afdcstorage.com/login", {
        email,
        password,
      });
      if (result.data.message === "Success") {
        localStorage.setItem("token", result.data.token);
        navigate("/loading...");
      } else {
        setError(result.data.message);
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex
      width="100vw"
      height="100vh"
      alignItems="center"
      justifyContent="center"
      position="relative"
      overflow="hidden"
    >
      {/* Background */}
      <Box
        position="absolute"
        inset={0}
        backgroundImage='url("/Fields.jpeg")'
        backgroundSize="cover"
        backgroundPosition="center"
        filter="brightness(0.45)"
        zIndex={0}
      />

      {/* Card */}
      <VStack
        position="relative"
        zIndex={1}
        bg="white"
        borderRadius="2xl"
        boxShadow="2xl"
        px={{ base: 8, md: 12 }}
        py={10}
        spacing={6}
        width={{ base: "90vw", sm: "420px" }}
      >
        {/* Logo */}
        <Image
          src="AdamsWings.png"
          alt="Adams Foods"
          height="56px"
          objectFit="contain"
        />

        <Divider />

        <Box width="100%" textAlign="left">
          <Text fontSize="2xl" fontWeight="700" color="gray.800">
            Sign in
          </Text>
          <Text fontSize="sm" color="gray.500" mt={1}>
            Enter your credentials to access the inventory system
          </Text>
        </Box>

        {error && (
          <Alert status="error" borderRadius="md" width="100%">
            <AlertIcon />
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <Stack spacing={4}>
            <InputGroup size="md">
              <InputLeftElement pointerEvents="none">
                <EmailIcon color="gray.400" />
              </InputLeftElement>
              <Input
                type="email"
                placeholder="Email address"
                onChange={(e) => setEmail(e.target.value)}
                value={email}
                required
                borderColor="gray.300"
                _hover={{ borderColor: "blue.400" }}
                _focus={{ borderColor: "blue.500", boxShadow: "0 0 0 1px #3182ce" }}
              />
            </InputGroup>

            <InputGroup size="md">
              <InputLeftElement pointerEvents="none">
                <LockIcon color="gray.400" />
              </InputLeftElement>
              <Input
                type={show ? "text" : "password"}
                pr="4.5rem"
                placeholder="Password"
                onChange={(e) => setPassword(e.target.value)}
                value={password}
                required
                borderColor="gray.300"
                _hover={{ borderColor: "blue.400" }}
                _focus={{ borderColor: "blue.500", boxShadow: "0 0 0 1px #3182ce" }}
              />
              <InputRightElement width="4rem">
                <Button
                  h="1.6rem"
                  size="xs"
                  variant="ghost"
                  color="gray.500"
                  onClick={() => setShow(!show)}
                >
                  {show ? "Hide" : "Show"}
                </Button>
              </InputRightElement>
            </InputGroup>

            <Button
              type="submit"
              colorScheme="blue"
              size="md"
              width="100%"
              mt={2}
              isLoading={loading}
              loadingText="Signing in..."
            >
              Sign in
            </Button>
          </Stack>
        </form>
      </VStack>
    </Flex>
  );
};

export default Login;
