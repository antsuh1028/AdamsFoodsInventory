import { useState, useRef } from "react";
import {
  Box,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Text,
  Flex,
  Icon,
  useToast,
  Spinner,
  Tooltip,
} from "@chakra-ui/react";
import readXlsxFile from "read-excel-file";
import axiosInstance from "../../utils/axiosInstance";

const VALID_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

const FileIcon = () => (
  <Icon viewBox="0 0 24 24" boxSize={8} color="green.500">
    <path
      fill="currentColor"
      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"
    />
  </Icon>
);

const UploadIcon = () => (
  <Icon viewBox="0 0 24 24" boxSize={10} color="gray.300">
    <path
      fill="currentColor"
      d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"
    />
  </Icon>
);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadFile({ isOpen, onClose }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const toast = useToast();

  const validateAndSet = (file) => {
    setError(null);
    if (!file) return;
    if (!VALID_TYPES.includes(file.type)) {
      setError("File must be an Excel spreadsheet (.xlsx or .xls).");
      return;
    }
    setSelectedFile(file);
  };

  const handleFileChange = (e) => validateAndSet(e.target.files[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    validateAndSet(e.dataTransfer.files[0]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const handleClear = () => {
    setSelectedFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClose = () => {
    handleClear();
    onClose();
  };

  const handleUpload = () => {
    if (!selectedFile) return;

    readXlsxFile(selectedFile).then((rows) => {
      if (!rows[1] || !rows[1].includes("DAILY INCOMING PRODUCT RECORD")) {
        setError('File must be a "Daily Incoming Product Record" form.');
        return;
      }

      setUploading(true);

      const isRowEmpty = (row) => row.every((v) => v === null);
      const cleanRow = (row) => {
        const idx = row.indexOf(null);
        if (idx !== -1) row.splice(idx, 1);
        while (row.length > 3 && row[row.length - 1] === null) row.pop();
        return row;
      };

      const filteredRows = rows.filter((row) => !isRowEmpty(row));
      const finalRows = filteredRows.map(cleanRow).slice(4);
      const valueToAdd = filteredRows[1]?.[9] ?? null;

      for (let i = finalRows.length - 1; i >= 0; i--) {
        const row = finalRows[i];
        if (row[0]) {
          if (valueToAdd !== null && row.length > 1) row[1] = valueToAdd + "-" + row[1];
        } else {
          finalRows.splice(i, 1);
        }
      }

      const validationPromises = finalRows.map((row) =>
        axiosInstance.post("/verifyLocation", { location: row[0] })
      );

      Promise.all(validationPromises)
        .then(() => {
          const addPromises = finalRows.map((row) => {
            const [location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est] = row;
            return axiosInstance
              .post("/inventoryAdd", {
                inputs: { location: String(location).toUpperCase(), lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est },
                force: true,
              })
              .catch((err) => console.error("Error adding row:", err));
          });

          return Promise.all(addPromises);
        })
        .then(() => {
          toast({
            title: "Upload Successful",
            description: `${finalRows.length} item(s) imported from ${selectedFile.name}`,
            position: "top",
            status: "success",
            duration: 3000,
            isClosable: true,
          });
          handleClose();
        })
        .catch(() => {
          toast({
            title: "Upload Failed",
            description: "Could not validate locations. Please check the file.",
            position: "top",
            status: "error",
            duration: 3000,
            isClosable: true,
          });
        })
        .finally(() => setUploading(false));
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} isCentered>
      <ModalOverlay bg="blackAlpha.600" />
      <ModalContent borderRadius="xl" overflow="hidden" maxW="440px">
        <ModalHeader borderBottom="1px" borderColor="gray.100" py={3} fontSize="md" fontWeight="semibold">
          <Flex align="center" gap={2}>
            Import Inventory File
            <Tooltip
              label="Upload a completed 'Incoming Product Form.xlsx' to automatically add all items from that form into the inventory."
              placement="right"
              hasArrow
              borderRadius="md"
              fontSize="xs"
              maxW="220px"
            >
              <Flex
                align="center"
                justify="center"
                w={5}
                h={5}
                borderRadius="full"
                border="1.5px solid"
                borderColor="gray.300"
                color="gray.400"
                fontSize="xs"
                fontWeight="bold"
                cursor="default"
                flexShrink={0}
              >
                ?
              </Flex>
            </Tooltip>
          </Flex>
        </ModalHeader>
        <ModalCloseButton top={3} />

        <ModalBody py={6} px={6}>
          {/* Drop zone */}
          <Box
            border="2px dashed"
            borderColor={dragging ? "blue.400" : selectedFile ? "green.300" : error ? "red.300" : "gray.200"}
            borderRadius="xl"
            bg={dragging ? "blue.50" : selectedFile ? "green.50" : "gray.50"}
            p={8}
            textAlign="center"
            cursor="pointer"
            transition="all 0.15s"
            onClick={() => !selectedFile && inputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />

            {selectedFile ? (
              <Flex direction="column" align="center" gap={2}>
                <FileIcon />
                <Text fontSize="sm" fontWeight="semibold" color="gray.700">
                  {selectedFile.name}
                </Text>
                <Text fontSize="xs" color="gray.400">
                  {formatBytes(selectedFile.size)}
                </Text>
                <Button
                  size="xs"
                  variant="ghost"
                  colorScheme="red"
                  mt={1}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                >
                  Remove
                </Button>
              </Flex>
            ) : (
              <Flex direction="column" align="center" gap={2}>
                <UploadIcon />
                <Text fontSize="sm" fontWeight="medium" color="gray.600">
                  Drag & drop your file here
                </Text>
                <Text fontSize="xs" color="gray.400">
                  or click to browse
                </Text>
                <Text fontSize="xs" color="gray.300" mt={1}>
                  .xlsx / .xls · Daily Incoming Product Record
                </Text>
              </Flex>
            )}
          </Box>

          {/* Inline error */}
          {error && (
            <Text fontSize="xs" color="red.500" mt={3} textAlign="center">
              {error}
            </Text>
          )}
        </ModalBody>

        <ModalFooter borderTop="1px" borderColor="gray.100" gap={2} py={3}>
          <Button variant="ghost" size="sm" onClick={handleClose} isDisabled={uploading}>
            Cancel
          </Button>
          <Button
            colorScheme="blue"
            size="sm"
            onClick={handleUpload}
            isDisabled={!selectedFile || uploading}
            leftIcon={uploading ? <Spinner size="xs" /> : undefined}
          >
            {uploading ? "Importing…" : "Import"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default UploadFile;
