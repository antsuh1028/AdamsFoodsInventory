import React from "react";
import {
  Text,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Image,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
} from "@chakra-ui/react";

function OpenHelp({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl">
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
                <Image
                  h="100%"
                  w="100%"
                  src="AF_FIND.gif"
                  alt="InventoryFind"
                />
              </TabPanel>
              <TabPanel>
                <Image
                  h="100%"
                  w="100%"
                  src="AF_UPDATE.gif"
                  alt="InventoryUpdate"
                />
                <Text textAlign="center" fontSize="small">
                  - Set Item before Updating -
                </Text>
              </TabPanel>
              <TabPanel>
                <Image
                  h="100%"
                  w="100%"
                  src="AF_REMOVE.gif"
                  alt="InventoryRemove"
                />
                <Text textAlign="center" fontSize="small">
                  - Set Item before Removing -
                </Text>
              </TabPanel>
              <TabPanel>
                <Image h="100%" w="100%" src="AF_UPLOAD.gif" alt="UploadFile" />
                <Text textAlign="center" fontSize="small">
                  - File must be a "Incoming Product Record Form" -
                </Text>
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

export default OpenHelp;
