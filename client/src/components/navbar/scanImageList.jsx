import { useState, useEffect } from "react";
import {
  Box, Flex, Text, Image, Spinner, useDisclosure, Badge, Button, HStack,
  Input, InputGroup, InputLeftElement, InputRightElement,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, CloseIcon } from "@chakra-ui/icons";
import { API_BASE_URL } from "../../config/api";
import FloatingWindow from "../FloatingWindow";

const authFetch = (url, options = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: token || "" } });
};

const PAGE_SIZE = 20;
// Signed URLs expire in 1 hour; cache for 55 min so we always have valid URLs
const CACHE_TTL_MS = 55 * 60 * 1000;
let scanCache = { data: null, timestamp: 0 };

const ScanImageList = ({ isOpen }) => {
  const [allScans, setAllScans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState(null);
  const [search, setSearch] = useState("");
  const { isOpen: isImgOpen, onOpen: onImgOpen, onClose: onImgClose } = useDisclosure();

  // Load all scans once — server returns up to 500 in one shot.
  // Results are cached in memory for 55 min (just under S3 signed URL expiry).
  useEffect(() => {
    if (!isOpen) return;
    const now = Date.now();
    if (scanCache.data && now - scanCache.timestamp < CACHE_TTL_MS) {
      setAllScans(scanCache.data);
      return;
    }
    let cancelled = false;
    setLoading(true);
    authFetch(`${API_BASE_URL}/list-scans`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items : [];
        scanCache = { data: items, timestamp: Date.now() };
        setAllScans(items);
      })
      .catch(() => { if (!cancelled) setAllScans([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) { setPage(1); setSearch(""); }
  }, [isOpen]);

  const handleView = (item) => { setSelectedItem(item); onImgOpen(); };
  const handleClose = () => { setSelectedItem(null); onImgClose(); };

  // Filter across ALL loaded scans, then slice for current page
  const filtered = search.trim()
    ? allScans.filter((s) =>
        (s.location    || "").toLowerCase().includes(search.toLowerCase()) ||
        (s.description || "").toLowerCase().includes(search.toLowerCase()) ||
        (s.lot         || "").toLowerCase().includes(search.toLowerCase())
      )
    : allScans;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <Box>
        <InputGroup size="sm" mb={3} >
          <InputLeftElement pointerEvents="none">
            <SearchIcon color="gray.400" boxSize={3} />
          </InputLeftElement>
          <Input
            placeholder="Search location, description, lot…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            borderRadius="md"
            bg="gray.50"
            _focus={{ bg: "white", borderColor: "blue.300" }}
            pr={search ? 8 : undefined}
          />
          {search && (
            <InputRightElement cursor="pointer" onClick={() => { setSearch(""); setPage(1); }}>
              <CloseIcon boxSize={2.5} color="gray.400" />
            </InputRightElement>
          )}
        </InputGroup>

        {loading ? (
          <Flex justify="center" align="center" py={10}>
            <Spinner color="blue.400" />
          </Flex>
        ) : visible.length === 0 ? (
          <Flex justify="center" align="center" py={10}>
            <Text fontSize="sm" color="gray.400">
              {search ? `No scans matching "${search}" on this page.` : "No scan images yet."}
            </Text>
          </Flex>
        ) : (
          <Flex direction="column" gap={2}>
            {visible.map((item) => (
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
                    {item.created_at && (
                      <Text as="span" ml={1}>
                        · {new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </Text>
                    )}
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
              size="xs" variant="ghost" leftIcon={<ChevronLeftIcon />}
              isDisabled={page === 1} onClick={() => setPage((p) => p - 1)}
            >Prev</Button>
            <Text fontSize="xs" color="gray.400">
              {page} / {totalPages} ({filtered.length}{search ? ` of ${allScans.length}` : ""} scans)
            </Text>
            <Button
              size="xs" variant="ghost" rightIcon={<ChevronRightIcon />}
              isDisabled={page === totalPages} onClick={() => setPage((p) => p + 1)}
            >Next</Button>
          </HStack>
        )}
      </Box>

      <FloatingWindow
        isOpen={isImgOpen}
        onClose={handleClose}
        width={800}
        bodyProps={{ p: 4, overflowY: "auto" }}
        title={
          <Flex direction="column">
            <Text>{selectedItem?.location} {selectedItem?.lot ? `— Lot ${selectedItem.lot}` : ""}</Text>
            {selectedItem?.created_at && (
              <Text fontSize="xs" fontWeight="normal" color="gray.400" mt={0.5}>
                Scanned {new Date(selectedItem.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </Text>
            )}
          </Flex>
        }
      >
        {selectedItem?.signedUrl && (
          <Image src={selectedItem.signedUrl} w="100%" objectFit="contain" borderRadius="lg" />
        )}
      </FloatingWindow>
    </>
  );
};

export default ScanImageList;
