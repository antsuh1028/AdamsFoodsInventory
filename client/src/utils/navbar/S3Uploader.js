import { useState, useRef } from "react";
import { API_BASE_URL } from "../../config/api";
import { Box, Button, Text, Flex, Icon, Spinner, useToast } from "@chakra-ui/react";

const PdfIcon = () => (
  <Icon viewBox="0 0 24 24" boxSize={8} color="red.400">
    <path
      fill="currentColor"
      d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"
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

const S3Uploader = ({ onUploadSuccess }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const toast = useToast();

  const validateAndSet = (file) => {
    setError(null);
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("File must be a PDF.");
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

  const handleClear = () => {
    setSelectedFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const uploadToS3 = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/upload-pdf`, {
        method: "POST",
        headers: { Authorization: token || "" },
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      const data = await response.json();
      toast({
        title: "File Uploaded",
        description: `${selectedFile.name} saved successfully.`,
        position: "top",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      handleClear();
      if (onUploadSuccess) onUploadSuccess(data);
    } catch (err) {
      toast({
        title: "Upload Failed",
        description: err.message,
        position: "top",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Flex direction="column" gap={4}>
      <Box
        border="2px dashed"
        borderColor={dragging ? "blue.400" : selectedFile ? "red.300" : error ? "red.300" : "gray.200"}
        borderRadius="xl"
        bg={dragging ? "blue.50" : selectedFile ? "red.50" : "gray.50"}
        p={8}
        textAlign="center"
        cursor={selectedFile ? "default" : "pointer"}
        transition="all 0.15s"
        onClick={() => !selectedFile && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          style={{ display: "none" }}
          onChange={handleFileChange}
          disabled={uploading}
        />

        {selectedFile ? (
          <Flex direction="column" align="center" gap={2}>
            <PdfIcon />
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
              onClick={(e) => { e.stopPropagation(); handleClear(); }}
              isDisabled={uploading}
            >
              Remove
            </Button>
          </Flex>
        ) : (
          <Flex direction="column" align="center" gap={2}>
            <UploadIcon />
            <Text fontSize="sm" fontWeight="medium" color="gray.600">
              Drag & drop your PDF here
            </Text>
            <Text fontSize="xs" color="gray.400">or click to browse</Text>
            <Text fontSize="xs" color="gray.300" mt={1}>.pdf only</Text>
          </Flex>
        )}
      </Box>

      {error && (
        <Text fontSize="xs" color="red.500" textAlign="center">
          {error}
        </Text>
      )}

      <Button
        colorScheme="blue"
        size="sm"
        onClick={uploadToS3}
        isDisabled={!selectedFile || uploading}
        leftIcon={uploading ? <Spinner size="xs" /> : undefined}
      >
        {uploading ? "Uploading…" : "Upload PDF"}
      </Button>
    </Flex>
  );
};

export default S3Uploader;
