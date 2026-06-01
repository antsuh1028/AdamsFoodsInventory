import React, { useState, useEffect } from "react";
import {
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
  Link,
} from "@chakra-ui/react";
import { EmailIcon, LockIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API_BASE_URL } from "../config/api";

const NoblesseLogin = () => {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow]         = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  // Redirect already-authenticated users
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload?.exp * 1000 > Date.now()) navigate("/noblesse");
    } catch { /* invalid token, stay on login */ }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await axios.post(`${API_BASE_URL}/login`, { email, password });
      if (result.data.message === "Success") {
        localStorage.setItem("token", result.data.token);
        navigate("/noblesse");
      } else {
        setError(result.data.message);
      }
    } catch {
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
      bg="gray.900"
    >
      {/* Subtle background accent */}
      <Box
        position="absolute"
        top="-20%"
        right="-10%"
        width="500px"
        height="500px"
        borderRadius="full"
        bg="teal.900"
        opacity={0.4}
        filter="blur(80px)"
        pointerEvents="none"
      />
      <Box
        position="absolute"
        bottom="-15%"
        left="-10%"
        width="400px"
        height="400px"
        borderRadius="full"
        bg="blue.900"
        opacity={0.3}
        filter="blur(80px)"
        pointerEvents="none"
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
        {/* Branding */}
        <Box textAlign="center">
          <Text fontSize="xl" fontWeight="800" color="teal.600" letterSpacing="tight">
            NOBLESSE TRADING INC
          </Text>
          <Text fontSize="xs" color="gray.400" fontWeight="500" letterSpacing="widest" mt={0.5}>
            PROCESSOR PORTAL
          </Text>
        </Box>

        <Divider />

        <Box width="100%" textAlign="left">
          <Text fontSize="2xl" fontWeight="700" color="gray.800">
            Sign in
          </Text>
          <Text fontSize="sm" color="gray.500" mt={1}>
            Enter your credentials to access the portal
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
                _hover={{ borderColor: "teal.400" }}
                _focus={{ borderColor: "teal.500", boxShadow: "0 0 0 1px #319795" }}
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
                _hover={{ borderColor: "teal.400" }}
                _focus={{ borderColor: "teal.500", boxShadow: "0 0 0 1px #319795" }}
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
              colorScheme="teal"
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

        <Text fontSize="xs" color="gray.400" textAlign="center">
          Adams Foods staff?{" "}
          <Link color="teal.500" href="/" fontWeight="500">
            Sign in here
          </Link>
        </Text>
      </VStack>
    </Flex>
  );
};

export default NoblesseLogin;
