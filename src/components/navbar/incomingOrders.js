import React from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  useToast,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  TabPanels,
} from "@chakra-ui/react";
import S3Uploader from "../../utils/navbar/S3Uploader";
import S3FileList from "./s3Files";

function IncomingOrders({ isOpen, onClose }) {
  const toast = useToast();

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Daily Incoming Product Records</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Tabs>
            <TabList>
              <Tab>Files</Tab>
              <Tab>Upload</Tab>
            </TabList>

            <TabPanels>
              <TabPanel>
                <S3FileList />
              </TabPanel>
              <TabPanel>
                <S3Uploader />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default IncomingOrders;
