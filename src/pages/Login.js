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
  const [error, setError] = useState(""); // To display error messages
  const navigate = useNavigate();

  const handleClick = () => setShow(!show);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError(""); // Reset error state before making request

    axios
      .post("https://server.afdcstorage.com/login", { email, password })
      .then((result) => {
        if (result.data.message === "Success") {
          // Save the JWT token in localStorage
          localStorage.setItem("token", result.data.token);
          
          // Navigate to loading screen or the homepage
          navigate("/loading...");
        } else {
          setError(result.data.message); // Set the error message returned by the server
        }
      })
      .catch((err) => {
        console.error(err);
        setError("An error occurred. Please try again."); // Set general error message
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
        width="100%"
        height="20vh"
        bg="white"
        color="white"
        padding="10px"
        display="flex"
        justifyContent="center"
        alignItems="center"
      >
        <Image src="AdamsWings.png" alt="Adams Wings" height="100%" />
      </Box>

      <Flex flex="1" alignItems="center" justifyContent="center">
        <Center>
          <Stack spacing={10} align="center">
            <VStack bg="white" borderRadius="md" width="60vh" height="50vh">
              <Text
                fontSize="4xl"
                fontWeight="500"
                fontFamily="sans-serif"
                marginTop="10px"
              >
                Login
              </Text>

              {/* Show error alert if there's an error */}
              {error && (
                <Alert status="error">
                  <AlertIcon />
                  {error}
                </Alert>
              )}

              <form onSubmit={handleSubmit}>
                <Stack spacing={3}>
                  <InputGroup>
                    <InputLeftElement pointerEvents="none">
                      <EmailIcon color="gray.300" />
                    </InputLeftElement>
                    <Input
                      type="email"
                      placeholder="Enter Email"
                      onChange={(e) => setEmail(e.target.value)}
                      value={email}
                      required
                    />
                  </InputGroup>

                  <InputGroup>
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
                    />
                    <InputRightElement>
                      <Button
                        h="1.75rem"
                        marginRight="10px"
                        size="sm"
                        onClick={handleClick}
                      >
                        {show ? "Hide" : "Show"}
                      </Button>
                    </InputRightElement>
                  </InputGroup>

                  <Flex width="100%" justifyContent="center" mt={5}>
                    <Button
                      bg="lightblue"
                      size="lg"
                      width="45%"
                      marginTop="10px"
                      type="submit"
                    >
                      Login
                    </Button>
                  </Flex>
                </Stack>
              </form>
            </VStack>
          </Stack>
        </Center>
      </Flex>
    </VStack>
  );
};

export default Login;
