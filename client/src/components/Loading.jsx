import React, { useEffect } from "react";
import { Center, Spinner, Text, VStack } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { landingFor } from "../utils/getRole";

const Loading = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const token = localStorage.getItem("token");
        const payload = token ? JSON.parse(atob(token.split(".")[1])) : null;
        navigate(landingFor(payload?.role));
      } catch {
        navigate("/home");
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <Center h="100vh">
      <VStack>
        <Spinner
          thickness="4px"
          speed="0.65s"
          emptyColor="gray.200"
          color="blue.500"
          size="xl"
        />
        <Text>Loading...</Text>
      </VStack>
    </Center>
  );
};

export default Loading;
