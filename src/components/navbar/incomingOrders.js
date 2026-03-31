import { useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Badge,
  Flex,
  Text,
} from "@chakra-ui/react";
import S3Uploader from "../../utils/navbar/S3Uploader";
import S3FileList from "./s3Files";

function IncomingOrders({ isOpen, onClose }) {
  const [tabIndex, setTabIndex] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUploadSuccess = () => {
    setRefreshKey((k) => k + 1);
    setTabIndex(0);
  };

  const handleClose = () => {
    setTabIndex(0);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} isCentered>
      <ModalOverlay bg="blackAlpha.600" />
      <ModalContent maxW="560px" maxH="80vh" borderRadius="xl" overflow="hidden">
        <ModalHeader borderBottom="1px" borderColor="gray.100" py={3}>
          <Flex align="center" gap={2}>
            <Text fontSize="md" fontWeight="semibold">Incoming Product Records</Text>
            <Badge colorScheme="red" fontSize="xs">PDF</Badge>
          </Flex>
        </ModalHeader>
        <ModalCloseButton top={3} onClick={handleClose} />

        <ModalBody p={0} overflowY="auto">
          <Tabs index={tabIndex} onChange={setTabIndex} colorScheme="blue">
            <TabList px={4} pt={2} borderBottom="2px" borderColor="gray.100">
              <Tab
                fontSize="sm"
                fontWeight="semibold"
                _selected={{ color: "blue.600", borderColor: "blue.500" }}
              >
                Files
              </Tab>
              <Tab
                fontSize="sm"
                fontWeight="semibold"
                _selected={{ color: "blue.600", borderColor: "blue.500" }}
              >
                Upload
              </Tab>
            </TabList>

            <TabPanels>
              <TabPanel px={4} py={4}>
                <S3FileList isOpen={isOpen} key={refreshKey} />
              </TabPanel>
              <TabPanel px={4} py={4}>
                <S3Uploader onUploadSuccess={handleUploadSuccess} />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default IncomingOrders;
