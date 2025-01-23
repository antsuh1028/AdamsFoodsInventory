import React from "react";
import {
  Box,
  Flex,
  Stack,
  HStack,
  useDisclosure,
  Drawer,
  Button,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  Image,
} from "@chakra-ui/react";

import { HamburgerIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";

import ShowHistory from "../utils/navbar/showHistory.js";
import UploadFile from "../utils/navbar/uploadFile.js";
import ShowMap from "../utils/navbar/showMap.js";
import OpenHelp from "../utils/navbar/openHelp.js";

const ShowDrawer = ({
  isOpen,
  onClose,
  onUploadOpen,
  onMapOpen,
  onHistoryOpen,
  onDrawerClose,
}) => {
  const navigate = useNavigate();
  const handleLogout = () => {
    // Clear the authentication token from localStorage or sessionStorage
    localStorage.removeItem("token"); // Assuming you stored the JWT token in localStorage
    navigate("/");
    // Redirect the user to the login page
    window.location.href = "/"; // Alternatively, use history.push('/') if using React Router's history object
  };

  return (
    <Drawer placement="left" onClose={onClose} isOpen={isOpen}>
      <DrawerOverlay />
      <DrawerContent>
        <DrawerHeader borderBottomWidth="1px">Other Actions</DrawerHeader>
        <Stack direction="column" spacing={4} p={4}>
          <Button
            bg="white"
            justifyContent="flex-start"
            onClick={() => {
              onMapOpen();
              onDrawerClose();
            }}
          >
            Show Map
          </Button>
          <Button
            bg="white"
            justifyContent="flex-start"
            onClick={() => {
              onHistoryOpen();
              onDrawerClose();
            }}
          >
            History Log
          </Button>
          <Button
            bg="white"
            justifyContent="flex-start"
            onClick={() => {
              onUploadOpen();
              onDrawerClose();
            }}
          >
            Upload File
          </Button>
        </Stack>
        <DrawerFooter justifyContent="center">
          <Button
            bg="red.400"
            _hover={{ bg: "red.500" }}
            onClick={handleLogout} // Call the logout function here
          >
            Log Out
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

const Navbar = () => {
  const {
    isOpen: isDrawerOpen,
    onOpen: onDrawerOpen,
    onClose: onDrawerClose,
  } = useDisclosure();
  const {
    isOpen: isUploadOpen,
    onOpen: onUploadOpen,
    onClose: onUploadClose,
  } = useDisclosure();
  const {
    isOpen: isMapOpen,
    onOpen: onMapOpen,
    onClose: onMapClose,
  } = useDisclosure();
  const {
    isOpen: isHistoryOpen,
    onOpen: onHistoryOpen,
    onClose: onHistoryClose,
  } = useDisclosure();
  const {
    isOpen: isHelpOpen,
    onOpen: onHelpOpen,
    onClose: onHelpClose,
  } = useDisclosure();

  return (
    <>
      <Box
        bg="white"
        px={4}
        w="100%"
        h="10vh"
        position="fixed"
        top={0}
        zIndex={1}
      >
        <Flex h={16} alignItems="center" justifyContent="space-between">
          <HStack spacing={8} alignItems="center">
            <Box>
              <Button onClick={onDrawerOpen} bg="white" color="black" p={2}>
                <HamburgerIcon w={6} h={6} />
              </Button>
            </Box>
            <HStack
              as="nav"
              spacing={4}
              display={{ base: "none", md: "flex" }}
              justifyContent="center"
            >
              <Image h="50px" src="AdamsWings.png" alt="Adams Wings" />
            </HStack>
          </HStack>
          <Flex alignItems="center">
            <Button onClick={onHelpOpen} bg="white" color="black" p={2}>
              Help
            </Button>
          </Flex>
        </Flex>
      </Box>
      <ShowDrawer
        isOpen={isDrawerOpen}
        onClose={onDrawerClose}
        onUploadOpen={onUploadOpen}
        onMapOpen={onMapOpen}
        onHistoryOpen={onHistoryOpen}
        onDrawerClose={onDrawerClose}
      />
      <UploadFile isOpen={isUploadOpen} onClose={onUploadClose} />
      <ShowMap
        isOpen={isMapOpen}
        onClose={onMapClose}
        occupiedCells={["A101", "A202"]}
      />
      <ShowHistory isOpen={isHistoryOpen} onClose={onHistoryClose} />
      <OpenHelp isOpen={isHelpOpen} onClose={onHelpClose} />
    </>
  );
};

export default Navbar;
