import React, { useState } from 'react';
import {
  Box,
  Button,
  Progress,
  Text,
  VStack,
  useToast,
  Input,
  Icon
} from '@chakra-ui/react';
// import { FiUpload, FiFile } from 'react-icons/fi';

const S3Uploader = ({ onUploadSuccess }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
    } else {
      toast({
        title: 'Invalid file type',
        description: 'Please select a valid PDF file',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      setSelectedFile(null);
    }
  };

  const uploadToS3 = async () => {
    if (!selectedFile) {
      toast({
        title: 'No file selected',
        description: 'Please select a file first',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch('http://localhost:3001/upload-pdf', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      toast({
        title: 'Success',
        description: 'File uploaded successfully',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      
      setSelectedFile(null);
      if (onUploadSuccess) {
        onUploadSuccess(data);
      }
    } catch (err) {
      toast({
        title: 'Upload failed',
        description: err.message,
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box maxW="md" mx="auto" p={6} borderWidth={1} borderRadius="lg">
      <VStack spacing={4}>
        <Box
          w="100%"
          p={4}
          borderWidth={2}
          borderStyle="dashed"
          borderRadius="lg"
          textAlign="center"
          cursor="pointer"
          onClick={() => document.getElementById('file-upload').click()}
        >
          <Input
            id="file-upload"
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            display="none"
            disabled={uploading}
          />
          <Icon
            // as={selectedFile ? FiFile : FiUpload}
            w={8}
            h={8}
            color={selectedFile ? "blue.500" : "gray.400"}
          />
          <Text mt={2} fontSize="sm" color="gray.500">
            {selectedFile ? selectedFile.name : 'Click to select PDF'}
          </Text>
        </Box>

        {uploading && (
          <Box w="100%">
            <Progress
              value={uploadProgress}
              size="sm"
              colorScheme="blue"
              isAnimated
            />
            <Text mt={2} fontSize="sm" textAlign="center" color="gray.500">
              Uploading: {Math.round(uploadProgress)}%
            </Text>
          </Box>
        )}

        <Button
          colorScheme="blue"
          onClick={uploadToS3}
          isLoading={uploading}
          loadingText="Uploading..."
          w="100%"
          isDisabled={!selectedFile}
        >
          Upload to S3
        </Button>
      </VStack>
    </Box>
  );
};

export default S3Uploader;