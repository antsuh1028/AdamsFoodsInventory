import { useState, useEffect, useRef } from "react";
import {
  Box,
  Text,
  Flex,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  useToast,
  useDisclosure,
  Spinner,
  Icon,
  Badge,
  Button,
  AlertDialog,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogBody,
  AlertDialogFooter,
} from "@chakra-ui/react";
import { DownloadIcon, ViewIcon, DeleteIcon, SearchIcon } from "@chakra-ui/icons";
import { API_BASE_URL } from "../../config/api";
import FloatingWindow from "../FloatingWindow";

const authFetch = (url, options = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: token || "" },
  });
};

const PdfRowIcon = () => (
  <Icon viewBox="0 0 24 24" boxSize={5} color="red.400" flexShrink={0}>
    <path
      fill="currentColor"
      d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"
    />
  </Icon>
);

const S3FileList = ({ isOpen, onRefresh }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { isOpen: isPdfOpen, onOpen: onPdfOpen, onClose: onPdfClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const cancelDeleteRef = useRef();
  const toast = useToast();

  const loadFiles = () => {
    if (!isOpen) return;
    setLoading(true);
    authFetch(`${API_BASE_URL}/list-pdfs`)
      .then((r) => r.json())
      .then((data) => setFiles(Array.isArray(data) ? data.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate)) : []))
      .catch(() => {
        toast({ title: "Failed to load files", position: "top", status: "error", duration: 3000, isClosable: true });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadFiles(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleView = async (fileKey) => {
    try {
      const response = await authFetch(`${API_BASE_URL}/get-pdf?key=${encodeURIComponent(fileKey)}`);
      if (!response.ok) throw new Error("Failed to load PDF");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setSelectedFile(url);
      onPdfOpen();
    } catch (err) {
      toast({ title: "Failed to load PDF", description: err.message, position: "top", status: "error", duration: 3000, isClosable: true });
    }
  };

  const handleDownload = async (fileKey, fileName) => {
    try {
      const response = await authFetch(`${API_BASE_URL}/get-pdf?key=${encodeURIComponent(fileKey)}`);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded", description: fileName, position: "top", status: "success", duration: 2000, isClosable: true });
    } catch (err) {
      toast({ title: "Download failed", description: err.message, position: "top", status: "error", duration: 3000, isClosable: true });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget._id);
    onDeleteClose();
    try {
      const response = await authFetch(`${API_BASE_URL}/delete-pdf/${deleteTarget._id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      setFiles((prev) => prev.filter((f) => f._id !== deleteTarget._id));
      toast({ title: "Deleted", description: deleteTarget.fileName, position: "top", status: "success", duration: 2000, isClosable: true });
      if (onRefresh) onRefresh();
    } catch (err) {
      toast({ title: "Delete failed", description: err.message, position: "top", status: "error", duration: 3000, isClosable: true });
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  };

  const filtered = files.filter((f) =>
    f.fileName.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <Flex justify="center" align="center" py={10}>
        <Spinner color="blue.400" />
      </Flex>
    );
  }

  return (
    <>
      {/* Search + count */}
      <Flex align="center" gap={2} mb={3}>
        <InputGroup size="sm" flex={1}>
          <InputLeftElement pointerEvents="none">
            <SearchIcon color="gray.400" boxSize={3} />
          </InputLeftElement>
          <Input
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            borderRadius="lg"
            bg="gray.50"
          />
        </InputGroup>
        <Badge colorScheme="gray" fontSize="xs" px={2} py={1} borderRadius="md">
          {filtered.length} file{filtered.length !== 1 ? "s" : ""}
        </Badge>
      </Flex>

      {/* File list with overflow */}
      <Box maxH="340px" overflowY="auto" pr={1}>
        {filtered.length === 0 ? (
          <Flex justify="center" align="center" py={10} direction="column" gap={1}>
            <Text color="gray.400" fontSize="sm">
              {search ? "No files match your search." : "No files uploaded yet."}
            </Text>
          </Flex>
        ) : (
          <Flex direction="column" gap={2}>
            {filtered.map((file) => (
              <Flex
                key={file._id}
                align="center"
                gap={3}
                px={3}
                py={2.5}
                border="1px"
                borderColor="gray.100"
                borderRadius="lg"
                bg="white"
                _hover={{ borderColor: "gray.200", bg: "gray.50" }}
                transition="all 0.1s"
              >
                <PdfRowIcon />
                <Box flex={1} minW={0}>
                  <Text fontSize="sm" fontWeight="medium" color="gray.700" noOfLines={1}>
                    {file.fileName}
                  </Text>
                  <Text fontSize="xs" color="gray.400">
                    {new Date(file.uploadDate).toLocaleDateString(undefined, {
                      year: "numeric", month: "short", day: "numeric",
                    })}
                  </Text>
                </Box>
                <Flex gap={1}>
                  <IconButton
                    icon={<ViewIcon />}
                    aria-label="View"
                    size="sm"
                    variant="ghost"
                    colorScheme="blue"
                    onClick={() => handleView(file.fileKey)}
                  />
                  <IconButton
                    icon={<DownloadIcon />}
                    aria-label="Download"
                    size="sm"
                    variant="ghost"
                    colorScheme="gray"
                    onClick={() => handleDownload(file.fileKey, file.fileName)}
                  />
                  <IconButton
                    icon={<DeleteIcon />}
                    aria-label="Delete"
                    size="sm"
                    variant="ghost"
                    colorScheme="red"
                    isLoading={deletingId === file._id}
                    onClick={() => { setDeleteTarget(file); onDeleteOpen(); }}
                  />
                </Flex>
              </Flex>
            ))}
          </Flex>
        )}
      </Box>

      {/* PDF Viewer Modal */}
      <FloatingWindow
        isOpen={isPdfOpen}
        onClose={() => { if (selectedFile) URL.revokeObjectURL(selectedFile); setSelectedFile(null); onPdfClose(); }}
        title="PDF Viewer"
        width={1180}
        bodyProps={{ p: 0, height: "90vh" }}
      >
        {selectedFile && (
          <iframe
            src={selectedFile}
            style={{ width: "100%", height: "100%", border: "none" }}
            title="PDF Viewer"
          />
        )}
      </FloatingWindow>

      {/* Delete Confirm Dialog */}
      <AlertDialog isOpen={isDeleteOpen} leastDestructiveRef={cancelDeleteRef} onClose={onDeleteClose} isCentered>
        <AlertDialogOverlay backdropFilter="blur(2px)" />
        <AlertDialogContent borderRadius="xl" maxW="380px">
          <Box px={6} pt={5} pb={3} borderBottom="1px" borderColor="gray.100">
            <Text fontWeight="bold" fontSize="md" color="gray.800">Delete File</Text>
            <Text fontSize="xs" color="gray.400" mt={0.5}>This cannot be undone</Text>
          </Box>
          <AlertDialogBody px={6} py={4}>
            <Text fontSize="sm" color="gray.600">
              Are you sure you want to delete <Text as="span" fontWeight="semibold" color="gray.800">{deleteTarget?.fileName}</Text>?
            </Text>
          </AlertDialogBody>
          <AlertDialogFooter px={6} pb={5} gap={3}>
            <Button ref={cancelDeleteRef} onClick={onDeleteClose} variant="outline" borderRadius="lg" w="full">
              Cancel
            </Button>
            <Button colorScheme="red" onClick={handleDeleteConfirm} borderRadius="lg" w="full">
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default S3FileList;
