import React from "react";
import addGif from "../../assets/AF_ADD.gif";
import findGif from "../../assets/AF_FIND.gif";
import updateGif from "../../assets/AF_UPDATE.gif";
import removeGif from "../../assets/AF_REMOVE.gif";
import uploadGif from "../../assets/AF_UPLOAD.gif";
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
                <Image h="100%" w="100%" src={addGif} alt="InventoryAdd" />
              </TabPanel>
              <TabPanel>
                <Image
                  h="100%"
                  w="100%"
                  src={findGif}
                  alt="InventoryFind"
                />
              </TabPanel>
              <TabPanel>
                <Image
                  h="100%"
                  w="100%"
                  src={updateGif}
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
                  src={removeGif}
                  alt="InventoryRemove"
                />
                <Text textAlign="center" fontSize="small">
                  - Set Item before Removing -
                </Text>
              </TabPanel>
              <TabPanel>
                <Image h="100%" w="100%" src={uploadGif} alt="UploadFile" />
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
