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
  Image,
} from "@chakra-ui/react";
import { EmailIcon, LockIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API_BASE_URL } from "../config/api";
import ntiLogo from "../assets/nti.jpg";

const NoblesseLogin = () => {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow]         = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

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
        if (result.data.refreshToken) {
          localStorage.setItem("refreshToken", result.data.refreshToken);
        }
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
      {/* Subtle red glow top-right */}
      <Box
        position="absolute"
        top="-15%"
        right="-5%"
        width="480px"
        height="480px"
        borderRadius="full"
        bg="red.900"
        opacity={0.35}
        filter="blur(90px)"
        pointerEvents="none"
      />
      {/* Subtle gray glow bottom-left */}
      <Box
        position="absolute"
        bottom="-20%"
        left="-8%"
        width="400px"
        height="400px"
        borderRadius="full"
        bg="gray.700"
        opacity={0.25}
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
        {/* Logo */}
        <Image
          src={ntiLogo}
          alt="Noblesse Trading Inc"
          height="42px"
          objectFit="contain"
        />

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
                _hover={{ borderColor: "red.300" }}
                _focus={{ borderColor: "red.700", boxShadow: "0 0 0 1px #9B2C2C" }}
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
                _hover={{ borderColor: "red.300" }}
                _focus={{ borderColor: "red.700", boxShadow: "0 0 0 1px #9B2C2C" }}
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
              size="md"
              width="100%"
              mt={2}
              isLoading={loading}
              loadingText="Signing in..."
              bg="red.800"
              color="white"
              _hover={{ bg: "red.700" }}
              _active={{ bg: "red.900" }}
            >
              Sign in
            </Button>
          </Stack>
        </form>

        
      </VStack>
    </Flex>
  );
};

export default NoblesseLogin;
 