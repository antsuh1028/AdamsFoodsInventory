import React, { useState } from "react";
import {
  Image,
  Box,
  Input,
  Stack,
  Flex,
  Center,
  Text,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Button,
  VStack,
  Alert,
  AlertIcon,
} from "@chakra-ui/react";
import { EmailIcon, UnlockIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleClick = () => setShow(!show);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");

    axios
      .post("https://server.afdcstorage.com/login", { email, password })
      .then((result) => {
        if (result.data.message === "Success") {
          localStorage.setItem("token", result.data.token);
          navigate("/loading...");
        } else {
          setError(result.data.message);
        }
      })
      .catch((err) => {
        console.error(err);
        setError("An error occurred. Please try again.");
      });
  };

  return (
    <VStack
      width="100vw"
      height="100vh"
      alignItems="center"
      justifyContent="center"
      _before={{
        content: '""',
        position: "absolute",
        width: "100%",
        height: "100%",
        backgroundImage: 'url("/Fields.jpeg")',
        backgroundSize: "cover",
        backgroundPosition: "center",
        zIndex: -1,
      }}
      _after={{
        content: '""',
        position: "absolute",
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(173, 216, 230, 0.6)",
        zIndex: -1,
      }}
    >
      <Box
        width={{ base: "100%", md: "100%" }}
        height={{ base: "15vh", md: "20vh" }}
        bg="white"
        color="white"
        padding="10px"
        display="flex"
        justifyContent="center"
        alignItems="center"
      >
        <Image 
          src="AdamsWings.png" 
          alt="Adams Wings" 
          height={{ base: "80%", md: "100%" }} 
        />
      </Box>

      <Flex 
        flex="1" 
        alignItems="center" 
        justifyContent="center"
        width="100%"
      >
        <Center>
          <VStack 
            bg="white" 
            borderRadius="md" 
            width={{ base: "90vw", md: "500px" }}
            minHeight={{ base: "auto", md: "400px" }}
            p={{ base: 4, md: 8 }}
            spacing={4}
            boxShadow="lg"
          >
            <Text
              fontSize={{ base: "3xl", md: "4xl" }}
              fontWeight="500"
              fontFamily="sans-serif"
              mt={2}
            >
              Login
            </Text>

            {error && (
              <Alert status="error" width="90%">
                <AlertIcon />
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit} style={{ width: "90%" }}>
              <Stack spacing={5}>
                <InputGroup size={{ base: "md", md: "lg" }}>
                  <InputLeftElement pointerEvents="none">
                    <EmailIcon color="gray.300" />
                  </InputLeftElement>
                  <Input
                    type="email"
                    placeholder="Enter Email"
                    onChange={(e) => setEmail(e.target.value)}
                    value={email}
                    required
                    fontSize={{ base: "md", md: "lg" }}
                  />
                </InputGroup>

                <InputGroup size={{ base: "md", md: "lg" }}>
                  <InputLeftElement pointerEvents="none" color="gray.300">
                    <UnlockIcon />
                  </InputLeftElement>
                  <Input
                    type={show ? "text" : "password"}
                    pr="4.5rem"
                    placeholder="Enter Password"
                    onChange={(e) => setPassword(e.target.value)}
                    value={password}
                    required
                    fontSize={{ base: "md", md: "lg" }}
                  />
                  <InputRightElement width="4.5rem">
                    <Button
                      h="1.75rem"
                      size="sm"
                      onClick={handleClick}
                    >
                      {show ? "Hide" : "Show"}
                    </Button>
                  </InputRightElement>
                </InputGroup>

                <Flex width="100%" justifyContent="center" mt={6}>
                  <Button
                    bg="lightblue"
                    size={{ base: "md", md: "lg" }}
                    width={{ base: "100%", md: "45%" }}
                    type="submit"
                    py={6}
                    fontSize={{ base: "md", md: "lg" }}
                  >
                    Login
                  </Button>
                </Flex>
              </Stack>
            </form>
          </VStack>
        </Center>
      </Flex>
    </VStack>
  );
};

export default Login;