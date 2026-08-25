import { useState } from "react";
import {
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Badge,
  Flex,
  Text,
} from "@chakra-ui/react";
import FloatingWindow from "../FloatingWindow";
import S3Uploader from "../../utils/navbar/S3Uploader";
import S3FileList from "./s3Files";
import ScanImageList from "./scanImageList";

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
    <FloatingWindow
      isOpen={isOpen}
      onClose={handleClose}
      width={560}
      title={
        <Flex align="center" gap={2}>
          <Text fontSize="md" fontWeight="semibold">Incoming Product Records</Text>
          <Badge colorScheme="red" fontSize="xs">PDF</Badge>
        </Flex>
      }
      bodyProps={{ p: 0, overflowY: "auto" }}
    >
      <Tabs index={tabIndex} onChange={setTabIndex} colorScheme="blue">
        <TabList px={4} pt={2} borderBottom="2px" borderColor="gray.100">
          <Tab fontSize="sm" fontWeight="semibold" _selected={{ color: "blue.600", borderColor: "blue.500" }}>
            Files
          </Tab>
          <Tab fontSize="sm" fontWeight="semibold" _selected={{ color: "blue.600", borderColor: "blue.500" }}>
            Upload
          </Tab>
          <Tab fontSize="sm" fontWeight="semibold" _selected={{ color: "blue.600", borderColor: "blue.500" }}>
            Scans
          </Tab>
        </TabList>

        <TabPanels>
          <TabPanel px={4} py={4}>
            <S3FileList isOpen={isOpen} key={refreshKey} />
          </TabPanel>
          <TabPanel px={4} py={4}>
            <S3Uploader onUploadSuccess={handleUploadSuccess} />
          </TabPanel>
          <TabPanel px={4} py={4}>
            <ScanImageList isOpen={isOpen && tabIndex === 2} />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </FloatingWindow>
  );
}

export default IncomingOrders;
