import { useState, useEffect } from "react";
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
  Button, Text, Flex, Box, Spinner, Table, Thead, Tbody, Tr, Th, Td, TableContainer,
  Badge, IconButton, ButtonGroup,
} from "@chakra-ui/react";
import { DownloadIcon, ChevronLeftIcon, ChevronRightIcon } from "@chakra-ui/icons";
import * as XLSX from "xlsx";
import { API_BASE_URL } from "../../config/api";
import { useToast } from "@chakra-ui/react";

const authFetch = (url, options = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: token || "" } });
};

const getLevel = (loc) => {
  if (!loc || loc.length < 2) return 3;
  const c = loc[1];
  if (c === "1") return 1;
  if (c === "2") return 2;
  return 3;
};

const COLUMNS = [
  { key: "location", label: "Location" },
  { key: "lot", label: "Lot" },
  { key: "vendor", label: "Vendor" },
  { key: "brand", label: "Brand" },
  { key: "species", label: "Species" },
  { key: "description", label: "Description" },
  { key: "grade", label: "Grade" },
  { key: "type", label: "Type" },
  { key: "quantity", label: "Qty" },
  { key: "weight", label: "Weight" },
  { key: "packdate", label: "Pack Date" },
  { key: "date_recvd", label: "Recv Date" },
  { key: "est", label: "EST#" },
  { key: "price", label: "Price/lb" },
];

const PAGE_SIZE = 50;

const ExportByType = ({ isOpen, onClose }) => {
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [activeType, setActiveType] = useState("raw");
  const [page, setPage] = useState(0);
  const toast = useToast();

  useEffect(() => {
    if (!isOpen) return;
    setPage(0);
    setLoading(true);
    authFetch(`${API_BASE_URL}/inventoryAll`)
      .then((r) => r.json())
      .then((data) => {
        const sorted = [...data].sort((a, b) => {
          const levelDiff = getLevel(a.location) - getLevel(b.location);
          if (levelDiff !== 0) return levelDiff;
          return (a.location || "").localeCompare(b.location || "");
        });
        setAllItems(sorted);
      })
      .catch(() => {
        toast({ title: "Failed to load inventory", position: "top", status: "error", duration: 3000, isClosable: true });
      })
      .finally(() => setLoading(false));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = allItems.filter((i) => i.type === activeType);
  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleTabChange = (type) => {
    setActiveType(type);
    setPage(0);
  };

  const handleDownload = () => {
    setDownloading(true);
    try {
      const rows = items.map((item) =>
        COLUMNS.reduce((obj, col) => {
          obj[col.label] = item[col.key] ?? "";
          return obj;
        }, {})
      );

      const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map((c) => c.label) });
      ws["!cols"] = COLUMNS.map((col) => ({
        wch: Math.max(col.label.length, ...items.map((item) => String(item[col.key] ?? "").length)) + 2,
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, activeType === "raw" ? "Raw" : "Processed");

      const date = new Date().toISOString().split("T")[0];
      XLSX.writeFile(wb, `inventory_${activeType}_${date}.xlsx`);

      toast({ title: "Downloaded", description: `${items.length} items`, position: "top", status: "success", duration: 2000, isClosable: true });
      onClose();
    } catch (err) {
      toast({ title: "Export failed", description: err.message, position: "top", status: "error", duration: 3000, isClosable: true });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent borderRadius="xl" maxH="85vh">
        <ModalHeader fontSize="md" fontWeight="semibold" pb={1} borderBottom="1px" borderColor="gray.100">
          <Flex align="center" gap={3} flexWrap="wrap">
            Export by Type
            <ButtonGroup size="xs" isAttached variant="outline">
              <Button
                onClick={() => handleTabChange("raw")}
                colorScheme={activeType === "raw" ? "green" : "gray"}
                variant={activeType === "raw" ? "solid" : "outline"}
              >
                Raw
              </Button>
              <Button
                onClick={() => handleTabChange("prc")}
                colorScheme={activeType === "prc" ? "purple" : "gray"}
                variant={activeType === "prc" ? "solid" : "outline"}
              >
                Processed
              </Button>
            </ButtonGroup>
            {!loading && (
              <Badge colorScheme={activeType === "raw" ? "green" : "purple"} fontSize="xs" px={2} py={1} borderRadius="md">
                {items.length} item{items.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </Flex>
        </ModalHeader>
        <ModalCloseButton top={3} />

        <ModalBody p={0}>
          {loading ? (
            <Flex justify="center" align="center" py={16}>
              <Spinner color="blue.400" />
            </Flex>
          ) : items.length === 0 ? (
            <Flex justify="center" align="center" py={16}>
              <Text color="gray.400" fontSize="sm">No {activeType === "raw" ? "raw" : "processed"} items found.</Text>
            </Flex>
          ) : (
            <Box overflowX="auto">
              <TableContainer>
                <Table size="sm" variant="simple">
                  <Thead bg="gray.50">
                    <Tr>
                      {COLUMNS.map((col) => (
                        <Th key={col.key} fontSize="xs" color="gray.500" whiteSpace="nowrap" py={3}>
                          {col.label}
                        </Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {pageItems.map((item, i) => (
                      <Tr key={item._id || i} _hover={{ bg: "gray.50" }}>
                        {COLUMNS.map((col) => (
                          <Td key={col.key} fontSize="xs" color="gray.700" whiteSpace="nowrap" py={2}>
                            {item[col.key] ?? ""}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </ModalBody>

        <ModalFooter borderTop="1px" borderColor="gray.100" gap={3} justifyContent="space-between">
          {totalPages > 1 ? (
            <Flex align="center" gap={2}>
              <IconButton
                icon={<ChevronLeftIcon />}
                size="xs"
                variant="outline"
                borderRadius="md"
                isDisabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              />
              <Text fontSize="xs" color="gray.500" minW="80px" textAlign="center">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, items.length)} of {items.length}
              </Text>
              <IconButton
                icon={<ChevronRightIcon />}
                size="xs"
                variant="outline"
                borderRadius="md"
                isDisabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              />
            </Flex>
          ) : (
            <Box />
          )}

          <Flex gap={3}>
            <Button variant="outline" borderRadius="lg" onClick={onClose} size="sm">Cancel</Button>
            <Button
              colorScheme={activeType === "raw" ? "green" : "purple"}
              borderRadius="lg"
              size="sm"
              leftIcon={downloading ? <Spinner size="xs" /> : <DownloadIcon />}
              onClick={handleDownload}
              isDisabled={loading || downloading || items.length === 0}
            >
              {downloading ? "Downloading..." : `Download ${activeType === "raw" ? "Raw" : "Processed"}`}
            </Button>
          </Flex>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ExportByType;
