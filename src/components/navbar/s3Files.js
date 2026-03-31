import { useState, useEffect } from "react";
import {
  Box,
  Text,
  Flex,
  IconButton,
  Button,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  useDisclosure,
  Spinner,
  Icon,
  Badge,
} from "@chakra-ui/react";
import { DownloadIcon, ViewIcon } from "@chakra-ui/icons";
import { API_BASE_URL } from "../../config/api";

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

const S3FileList = ({ isOpen }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const { isOpen: isPdfOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    authFetch(`${API_BASE_URL}/list-pdfs`)
      .then((r) => r.json())
      .then((data) => setFiles(Array.isArray(data) ? data : []))
      .catch(() => {
        toast({
          title: "Failed to load files",
          position: "top",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      })
      .finally(() => setLoading(false));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = async (fileKey, fileName) => {
    try {
      const response = await authFetch(
        `${API_BASE_URL}/get-pdf/${encodeURIComponent(fileKey)}`
      );
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
      toast({
        title: "Downloaded",
        description: fileName,
        position: "top",
        status: "success",
        duration: 2000,
        isClosable: true,
      });
    } catch (err) {
      toast({
        title: "Download failed",
        description: err.message,
        position: "top",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleView = (fileKey) => {
    setSelectedFile(`${API_BASE_URL}/get-pdf/${encodeURIComponent(fileKey)}`);
    onOpen();
  };

  if (loading) {
    return (
      <Flex justify="center" align="center" py={10}>
        <Spinner color="blue.400" />
      </Flex>
    );
  }

  if (files.length === 0) {
    return (
      <Flex justify="center" align="center" py={10} direction="column" gap={1}>
        <Text color="gray.400" fontSize="sm">No files uploaded yet.</Text>
      </Flex>
    );
  }

  return (
    <>
      <Flex direction="column" gap={2}>
        {files.map((file) => (
          <Flex
            key={file.fileUrl}
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
            </Flex>
          </Flex>
        ))}
      </Flex>

      <Modal isOpen={isPdfOpen} onClose={onClose} size="5xl">
        <ModalOverlay bg="blackAlpha.600" />
        <ModalContent h="90vh" borderRadius="xl" overflow="hidden">
          <ModalHeader borderBottom="1px" borderColor="gray.100" py={3} fontSize="md" fontWeight="semibold">
            PDF Viewer
          </ModalHeader>
          <ModalCloseButton top={3} />
          <ModalBody p={0}>
            {selectedFile && (
              <iframe
                src={selectedFile}
                style={{ width: "100%", height: "100%", border: "none" }}
                title="PDF Viewer"
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};

export default S3FileList;
