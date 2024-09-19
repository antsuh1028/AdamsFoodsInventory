import React from "react";
import {
  Input,
  Box,
  Flex,
  Stack,
  Text,
  HStack,
  useDisclosure,
  Drawer,
  Button,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  FormControl,
  Image,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  useToast,
} from "@chakra-ui/react";
import { HamburgerIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import readXlsxFile from "read-excel-file";
import axios from "axios";

function UploadFile({ isOpen, onClose }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const toast = useToast();

  const handleFileChange = (event) => {
    const file = event.target.files[0];

    if (file) {
      const validTypes = [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ];
      if (validTypes.includes(file.type)) {
        console.log("Valid Excel file:", file);
        setSelectedFile(file);
      } else {
        alert("Please select a valid Excel file.");
      }
    }
  };

  //Function that Reads Excel File and then uses Add function to Input it into the Freezer Database
  const handleUpload = () => {
    if (selectedFile) {
      readXlsxFile(selectedFile).then((rows) => {
        if (rows[1] && rows[1].includes("DAILY INCOMING PRODUCT RECORD")) {
          const isRowEmpty = (row) => row.every((value) => value === null);
          const cleanRow = (row) => {
            let rowIndex = row.indexOf(null);
            if (rowIndex !== -1) {
              row.splice(rowIndex, 1);
            }
            while (
              row.length > 0 &&
              row[row.length - 1] === null &&
              row.length > 3
            ) {
              row.pop();
            }
            return row;
          };

          // Filter and clean the rows
          const filteredRows = rows.filter((row) => !isRowEmpty(row));
          const cleanedRows = filteredRows.map(cleanRow);
          const finalRows = cleanedRows.slice(4);
          const valueToAdd = filteredRows[1] ? filteredRows[1][9] : null;

          for (let i = finalRows.length - 1; i >= 0; i--) {
            const row = finalRows[i];
            if (row[0]) {
              if (valueToAdd !== null && row.length > 1) {
                row[1] = valueToAdd + "-" + row[1];
              }
            } else {
              finalRows.splice(i, 1);
            }
          }

          console.log("Cleaned rows:", finalRows);

          const validationPromises = finalRows.map((row) =>
            axios.post("http://localhost:3001/verifyLocation", {
              location: row[0],
            })
          );
          console.log("done");
          console.log(validationPromises);

          // Wait for all validation requests to complete
          Promise.all(validationPromises)
            .then((responses) => {
              console.log("All locations validated successfully");

              finalRows.forEach((row) => {
                const [
                  location,
                  lot,
                  vendor,
                  brand,
                  species,
                  description,
                  grade,
                  quantity,
                  weight,
                  packdate,
                  temp,
                  est,
                ] = row;

                const data = {
                  inputs: {
                    location: location.toUpperCase(),
                    lot,
                    vendor,
                    brand,
                    species,
                    description,
                    grade,
                    quantity,
                    weight,
                    packdate,
                    temp,
                    est,
                  },
                };

                // Add to inventory
                axios
                  .post("http://localhost:3001/inventoryAdd", data)
                  .then((response) => {
                    console.log("Item added successfully:", response.data);
                  })
                  .catch((error) => {
                    console.error("Error adding item to inventory:", error);
                    toast({
                      title: "Upload File Error",
                      position: "top",
                      description:
                        "Error adding item to inventory. Please try again.",
                      status: "error",
                      duration: 2000,
                      isClosable: true,
                    });
                  });
              });

              onClose();
              toast({
                title: "Upload File Success",
                position: "top",
                description: "File Successfully Uploaded",
                status: "success",
                duration: 3000,
                isClosable: true,
              });
              setSelectedFile(null);
            })
            .catch((err) => {
              toast({
                title: "Upload File Error",
                position: "top",
                description: "Error Uploading File",
                status: "error",
                duration: 3000,
                isClosable: true,
              });
              onClose();
            });
        } else {
          alert(
            "Please Upload Appropriate File (Daily Incoming Product Record)"
          );
        }
      });
    } else {
      alert("Please select a valid Excel file.");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Upload File</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <FormControl>
            <Box width="90%" padding="4">
            <Text textAlign="center" fontSize="small">- File must be a "Incoming Product Record Form" -</Text>
              <Input
                type="file"
                marginTop="20px"
                h=""
                accept=".xlsx, .xls"
                onChange={handleFileChange}
              />
            </Box>
          </FormControl>
        </ModalBody>
        <ModalFooter>
          <Button colorScheme="blue" mr={3} onClick={handleUpload}>
            Upload
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ShowMap({ isOpen, onClose }) {

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="full">
      <ModalOverlay />
      <ModalContent height="100%">
        <ModalHeader>Freezer Map</ModalHeader>
        <ModalCloseButton />
        <ModalBody >
        <iframe title="AF Inventory" width="100%" height="100%" frameborder="0" scrolling="no" src="https://onedrive.live.com/embed?resid=720A4D0EF04E3A43%21242069&authkey=%21AJbqeV0TlnVo1m8&em=2&wdAllowInteractivity=False&ActiveCell='Level%201'!A1&wdInConfigurator=True&wdInConfigurator=True"></iframe>        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function OpenHelp({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Help</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Tabs>
            <TabList>
              <Tab>Add</Tab>
              <Tab>Find</Tab>
              <Tab>Update</Tab>
              <Tab>Remove</Tab>
              <Tab>Upload</Tab>
            </TabList>

            <TabPanels>
              <TabPanel>
                <Image h="100%" w="100%" src="AF_ADD.gif" alt="InventoryAdd" />
              </TabPanel>
              <TabPanel>
              <Image h="100%" w="100%" src="AF_FIND.gif" alt="InventoryFind" />
              </TabPanel>
              <TabPanel>
                <Image h="100%" w="100%" src="AF_UPDATE.gif" alt="InventoryUpdate" />
                <Text textAlign="center" fontSize="small">- Set Item before Updating -</Text>
              </TabPanel>
              <TabPanel>
              <Image h="100%" w="100%" src="AF_REMOVE.gif" alt="InventoryRemove" />
              <Text textAlign="center" fontSize="small">- Set Item before Removing -</Text>
              </TabPanel>
              <TabPanel>
              <Image h="100%" w="100%" src="AF_UPLOAD.gif" alt="UploadFile" />
              <Text textAlign="center" fontSize="small">- File must be a "Incoming Product Record Form" -</Text>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

const ShowDrawer = ({
  isOpen,
  onClose,
  onUploadOpen,
  onMapOpen,
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
          <Button bg="white" justifyContent="flex-start">
            Some Content
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
        onDrawerClose={onDrawerClose}
      />
      <UploadFile isOpen={isUploadOpen} onClose={onUploadClose} />
      <ShowMap isOpen={isMapOpen} onClose={onMapClose} />
      <OpenHelp isOpen={isHelpOpen} onClose={onHelpClose} />
    </>
  );
};

export default Navbar;
