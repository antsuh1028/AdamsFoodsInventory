import { useState, useEffect, useRef } from "react";
import {
  Box, Flex, Text, Image, Spinner, Modal, ModalOverlay, ModalContent,
  ModalHeader, ModalCloseButton, ModalBody, useDisclosure, Badge, Button, HStack,
  Input, InputGroup, InputLeftElement, InputRightElement,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, CloseIcon } from "@chakra-ui/icons";
import { API_BASE_URL } from "../../config/api";

const authFetch = (url, options = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: token || "" } });
};

const ScanImageList = ({ isOpen }) => {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedItem, setSelectedItem] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const debounceRef = useRef(null);
  const { isOpen: isImgOpen, onOpen: onImgOpen, onClose: onImgClose } = useDisclosure();

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const params = new URLSearchParams({ page });
    if (activeSearch) params.set("location", activeSearch);
    authFetch(`${API_BASE_URL}/list-scans?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setScans(Array.isArray(data.items) ? data.items : []);
        setTotalPages(data.pages || 1);
        setTotal(data.total || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, page, activeSearch]);

  // Reset to page 1 when tab opens
  useEffect(() => {
    if (isOpen) { setPage(1); setSearchInput(""); setActiveSearch(""); }
  }, [isOpen]);

  const handleSearchChange = (val) => {
    setSearchInput(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setActiveSearch(val.trim());
    }, 350);
  };

  const clearSearch = () => {
    setSearchInput("");
    setActiveSearch("");
    clearTimeout(debounceRef.current);
  };

  const handleView = (item) => {
    setSelectedItem(item);
    onImgOpen();
  };

  const handleClose = () => {
    setSelectedItem(null);
    onImgClose();
  };

  return (
    <>
      <Box>
        {/* Search */}
        <InputGroup size="sm" mb={3}>
          <InputLeftElement pointerEvents="none">
            <SearchIcon color="gray.400" boxSize={3} />
          </InputLeftElement>
          <Input
            placeholder="Search by location…"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            borderRadius="md"
            bg="gray.50"
            _focus={{ bg: "white", borderColor: "blue.300" }}
            pr={searchInput ? 8 : undefined}
          />
          {searchInput && (
            <InputRightElement cursor="pointer" onClick={clearSearch}>
              <CloseIcon boxSize={2.5} color="gray.400" />
            </InputRightElement>
          )}
        </InputGroup>

        {loading ? (
          <Flex justify="center" align="center" py={10}>
            <Spinner color="blue.400" />
          </Flex>
        ) : scans.length === 0 ? (
          <Flex justify="center" align="center" py={10}>
            <Text fontSize="sm" color="gray.400">
              {activeSearch ? `No scans found for "${activeSearch}".` : "No scan images yet."}
            </Text>
          </Flex>
        ) : (
          <Flex direction="column" gap={2}>
            {scans.map((item) => (
              <Flex
                key={item.id}
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
                <Box w="40px" h="40px" borderRadius="md" overflow="hidden" bg="gray.100" flexShrink={0}>
                  <Image src={item.signedUrl} w="100%" h="100%" objectFit="cover" />
                </Box>
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
        )}

        {totalPages > 1 && (
          <HStack justify="space-between" align="center" mt={3} px={1}>
            <Button
              size="xs"
              variant="ghost"
              leftIcon={<ChevronLeftIcon />}
              isDisabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </Button>
            <Text fontSize="xs" color="gray.400">
              {page} / {totalPages} ({total} total)
            </Text>
            <Button
              size="xs"
              variant="ghost"
              rightIcon={<ChevronRightIcon />}
              isDisabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </HStack>
        )}
      </Box>

      <Modal isOpen={isImgOpen} onClose={handleClose} size="2xl" isCentered>
        <ModalOverlay bg="blackAlpha.600" />
        <ModalContent borderRadius="xl">
          <ModalHeader borderBottom="1px" borderColor="gray.100" py={3} fontSize="sm" fontWeight="semibold">
            {selectedItem?.location} {selectedItem?.lot ? `— Lot ${selectedItem.lot}` : ""}
          </ModalHeader>
          <ModalCloseButton top={3} />
          <ModalBody p={4}>
            {selectedItem?.signedUrl && (
              <Image src={selectedItem.signedUrl} w="100%" objectFit="contain" borderRadius="lg" />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};

export default ScanImageList;
