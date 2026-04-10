import React, { useState } from "react";
import adamsWings from "../../assets/AdamsWings.png";
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
  Collapse,
  Text,
  Divider,
} from "@chakra-ui/react";
import { ChevronDownIcon, ChevronRightIcon } from "@chakra-ui/icons";

import { HamburgerIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";

import ShowHistory from "../navbar/historyTable.jsx";
import UploadFile from "../navbar/uploadFile.jsx";
import ShowMap from "../navbar/locationMap.jsx";
import OpenHelp from "../navbar/openHelp.jsx";
import IncomingOrders from "../navbar/incomingOrders.jsx";
import ExportInventory from "../navbar/exportInventory.jsx";
import InventoryReport from "../navbar/inventoryReport.jsx";
import FormScanner from "../navbar/formScanner.jsx";
import OrderScanner from "../navbar/orderScanner.jsx";

const ShowDrawer = ({
  isOpen,
  onClose,
  onUploadOpen,
  onMapOpen,
  onHistoryOpen,
  onDrawerClose,
  onIPROpen,
  onExportOpen,
  onReportOpen,
  onScanOpen,
  onOrderScanOpen,
}) => {
  const navigate = useNavigate();
  const [otherOpen, setOtherOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/");
  };

  const navBtn = (label, handler) => (
    <Button bg="white" justifyContent="flex-start" onClick={() => { handler(); onDrawerClose(); }}>
      {label}
    </Button>
  );

  return (
    <Drawer placement="left" onClose={onClose} isOpen={isOpen}>
      <DrawerOverlay />
      <DrawerContent>
        <DrawerHeader borderBottomWidth="1px">Menu</DrawerHeader>
        <Stack direction="column" spacing={3} p={4}>
          {navBtn("Freezer Map", onMapOpen)}
          {navBtn("Scan Pallet Form", onScanOpen)}
          {navBtn("Scan Order Sheet", onOrderScanOpen)}
          {navBtn("History Log", onHistoryOpen)}

          <Divider />

          <Button
            bg="white"
            justifyContent="flex-start"
            onClick={() => setOtherOpen((v) => !v)}
            rightIcon={otherOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
          >
            <Text flex={1} textAlign="left">Other</Text>
          </Button>
          <Collapse in={otherOpen} animateOpacity>
            <Stack direction="column" spacing={2} pl={3}>
              {navBtn("Upload IPF File", onUploadOpen)}
              {navBtn("Incoming Product Records", onIPROpen)}
              {navBtn("Export Inventory", onExportOpen)}
              {navBtn("Inventory Report", onReportOpen)}
            </Stack>
          </Collapse>
        </Stack>

        <DrawerFooter justifyContent="center">
          <Button bg="red.400" _hover={{ bg: "red.500", color: "white" }} color="black" onClick={handleLogout}>
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
  const {
    isOpen: isExportOpen,
    onOpen: onExportOpen,
    onClose: onExportClose,
  } = useDisclosure();
  const {
    isOpen: isReportOpen,
    onOpen: onReportOpen,
    onClose: onReportClose,
  } = useDisclosure();
  const {
    isOpen: isScanOpen,
    onOpen: onScanOpen,
    onClose: onScanClose,
  } = useDisclosure();
  const {
    isOpen: isOrderScanOpen,
    onOpen: onOrderScanOpen,
    onClose: onOrderScanClose,
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
                src={adamsWings}
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
        onExportOpen={onExportOpen}
        onReportOpen={onReportOpen}
        onScanOpen={onScanOpen}
        onOrderScanOpen={onOrderScanOpen}
      />
      <UploadFile isOpen={isUploadOpen} onClose={onUploadClose} />
      <IncomingOrders isOpen={isIPROpen} onClose={onIPRClose} />

      <ShowMap isOpen={isMapOpen} onClose={onMapClose} />
      <ShowHistory isOpen={isHistoryOpen} onClose={onHistoryClose} />
      <OpenHelp isOpen={isHelpOpen} onClose={onHelpClose} />
      <ExportInventory isOpen={isExportOpen} onClose={onExportClose} />
      <InventoryReport isOpen={isReportOpen} onClose={onReportClose} />
      <FormScanner isOpen={isScanOpen} onClose={onScanClose} />
      <OrderScanner isOpen={isOrderScanOpen} onClose={onOrderScanClose} />
    </>
  );
};

export default Navbar;
