import { useState, useEffect } from "react";
import {
  Box, Flex, Text, Image, Spinner, Modal, ModalOverlay, ModalContent,
  ModalHeader, ModalCloseButton, ModalBody, useDisclosure, Badge,
} from "@chakra-ui/react";
import { API_BASE_URL } from "../../config/api";

const authFetch = (url, options = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: token || "" } });
};

const ScanImageList = ({ isOpen }) => {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const { isOpen: isImgOpen, onOpen: onImgOpen, onClose: onImgClose } = useDisclosure();

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    authFetch(`${API_BASE_URL}/list-scans`)
      .then((r) => r.json())
      .then((data) => setScans(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleView = async (item) => {
    try {
      const res = await authFetch(`${API_BASE_URL}/get-scan-image?key=${encodeURIComponent(item.scanImageKey)}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      setSelectedUrl(URL.createObjectURL(blob));
      setSelectedItem(item);
      onImgOpen();
    } catch {
      // silent
    }
  };

  const handleClose = () => {
    if (selectedUrl) URL.revokeObjectURL(selectedUrl);
    setSelectedUrl(null);
    setSelectedItem(null);
    onImgClose();
  };

  if (loading) {
    return (
      <Flex justify="center" align="center" py={10}>
        <Spinner color="blue.400" />
      </Flex>
    );
  }

  if (scans.length === 0) {
    return (
      <Flex justify="center" align="center" py={10}>
        <Text fontSize="sm" color="gray.400">No scan images yet.</Text>
      </Flex>
    );
  }

  return (
    <>
      <Box maxH="340px" overflowY="auto" pr={1}>
        <Flex direction="column" gap={2}>
          {scans.map((item) => (
            <Flex
              key={item._id}
              align="center"
              gap={3}
              px={3}
              py={2.5}
              border="1px"
              borderColor="gray.100"
              borderRadius="lg"
              bg="white"
              cursor="pointer"
              _hover={{ borderColor: "blue.200", bg: "blue.50" }}
              transition="all 0.1s"
              onClick={() => handleView(item)}
            >
              <ScanThumb scanImageKey={item.scanImageKey} />
              <Box flex={1} minW={0}>
                <Text fontSize="sm" fontWeight="medium" color="gray.700" noOfLines={1}>
                  {item.location} {item.lot ? `— Lot ${item.lot}` : ""}
                </Text>
                <Text fontSize="xs" color="gray.400" noOfLines={1}>
                  {[item.species, item.description].filter(Boolean).join(" · ")}
                </Text>
              </Box>
              <Badge colorScheme="blue" fontSize="xs" variant="subtle">View</Badge>
            </Flex>
          ))}
        </Flex>
      </Box>

      <Modal isOpen={isImgOpen} onClose={handleClose} size="2xl" isCentered>
        <ModalOverlay bg="blackAlpha.600" />
        <ModalContent borderRadius="xl">
          <ModalHeader borderBottom="1px" borderColor="gray.100" py={3} fontSize="sm" fontWeight="semibold">
            {selectedItem?.location} {selectedItem?.lot ? `— Lot ${selectedItem.lot}` : ""}
          </ModalHeader>
          <ModalCloseButton top={3} />
          <ModalBody p={4}>
            {selectedUrl && (
              <Image src={selectedUrl} w="100%" objectFit="contain" borderRadius="lg" />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};

// Small thumbnail fetched lazily per row
const ScanThumb = ({ scanImageKey }) => {
  const [src, setSrc] = useState(null);
  const token = localStorage.getItem("token");

  useEffect(() => {
    let objUrl;
    fetch(`${API_BASE_URL}/get-scan-image?key=${encodeURIComponent(scanImageKey)}`, {
      headers: { Authorization: token || "" },
    })
      .then((r) => r.blob())
      .then((blob) => {
        objUrl = URL.createObjectURL(blob);
        setSrc(objUrl);
      })
      .catch(() => {});
    return () => { if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [scanImageKey, token]);

  return (
    <Box w="40px" h="40px" borderRadius="md" overflow="hidden" bg="gray.100" flexShrink={0}>
      {src
        ? <Image src={src} w="100%" h="100%" objectFit="cover" />
        : <Flex w="100%" h="100%" align="center" justify="center"><Spinner size="xs" color="gray.400" /></Flex>
      }
    </Box>
  );
};

export default ScanImageList;
