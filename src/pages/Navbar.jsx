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

import ShowHistory from "../components/navbar/historyTable.js";
import UploadFile from "../components/navbar/uploadFile.js";
import ShowMap from "../components/navbar/locationMap.js";
import OpenHelp from "../components/navbar/openHelp.js";
import IncomingOrders from "../components/navbar/incomingOrders.js";

const ShowDrawer = ({
  isOpen,
  onClose,
  onUploadOpen,
  onMapOpen,
  onHistoryOpen,
  onDrawerClose,
  onIPROpen,
}) => {
  const navigate = useNavigate();
  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/");
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
            Freezer Map
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
          <Button
            bg="white"
            justifyContent="flex-start"
            onClick={() => {
              onIPROpen();
              onDrawerClose();
            }}
          >
            Incoming Product Records
          </Button>
        </Stack>
        <DrawerFooter justifyContent="center">
          <Button
            bg="red.400"
            _hover={{ bg: "red.500", color: "white" }}
            color="black"
            onClick={handleLogout}
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
    isOpen: isIPROpen,
    onOpen: onIPROpen,
    onClose: onIPRClose,
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
        px={{ base: 2, sm: 4 }}
        w="100%"
        h={{ base: "8vh", sm: "9vh", md: "10vh" }}
        position="fixed"
        top={0}
        zIndex={1}
        boxShadow="sm"
      >
        <Flex h="100%" alignItems="center" justifyContent="space-between">
          <HStack spacing={{ base: 4, sm: 6, md: 8 }} alignItems="center">
            <Box>
              <Button
                onClick={onDrawerOpen}
                bg="white"
                color="black"
                p={{ base: 1, sm: 1.5, md: 2 }}
                size={{ base: "sm", md: "md" }}
                _hover={{ transform: "scale(1.02)" }}
              >
                <HamburgerIcon
                  w={{ base: 4, sm: 5, md: 6 }}
                  h={{ base: 4, sm: 5, md: 6 }}
                />
              </Button>
            </Box>
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              h="100%"
            >
              <Image
                h={{ base: "25px", sm: "35px", md: "45px", lg: "50px" }}
                maxW={{ base: "120px", sm: "150px", md: "180px", lg: "200px" }}
                w="auto"
                objectFit="contain"
                src="AdamsWings.png"
                alt="Adams Wings"
                transition="all 0.2s ease-in-out"
                _hover={{ transform: "scale(1.02)" }}
              />
            </Box>
          </HStack>
          <Flex alignItems="center">
            <Button
              onClick={onHelpOpen}
              bg="white"
              color="black"
              size={{ base: "sm", md: "md" }}
              px={{ base: 2, sm: 3, md: 4 }}
              fontSize={{ base: "sm", sm: "md", md: "lg" }}
              transition="all 0.2s ease-in-out"
              _hover={{ transform: "scale(1.05)", bg: "gray.50" }}
            >
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
        onIPROpen={onIPROpen}
        onDrawerClose={onDrawerClose}
      />
      <UploadFile isOpen={isUploadOpen} onClose={onUploadClose} />
      <IncomingOrders isOpen={isIPROpen} onClose={onIPRClose} />

      <ShowMap isOpen={isMapOpen} onClose={onMapClose} />
      <ShowHistory isOpen={isHistoryOpen} onClose={onHistoryClose} />
      <OpenHelp isOpen={isHelpOpen} onClose={onHelpClose} />
    </>
  );
};

export default Navbar;
