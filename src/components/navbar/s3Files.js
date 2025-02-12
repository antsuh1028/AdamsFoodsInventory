import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  IconButton,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  useDisclosure
} from '@chakra-ui/react';
import { DownloadIcon,ViewIcon } from '@chakra-ui/icons';

const S3FileList = () => {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      const response = await fetch('http://localhost:3001/list-pdfs');
      console.log(response)
      const data = await response.json();
      console.log(data)
      setFiles(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch files',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleDownload = async (fileKey, fileName) => {
    try {
      const response = await fetch(`http://localhost:3001/get-pdf/${encodeURIComponent(fileKey)}`);
      
      if (!response.ok) {
        throw new Error('Failed to download file');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  
      toast({
        title: 'Success',
        description: 'File downloaded successfully',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      toast({
        title: 'Download failed',
        description: error.message,
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  };
  
  const handleView = (fileKey) => {
    setSelectedFile(`http://localhost:3001/get-pdf/${encodeURIComponent(fileKey)}`);
    onOpen();
  };

  return (
    <Box>
      <Table variant="simple">
        <Thead>
          <Tr>
            <Th>File Name</Th>
            <Th>Upload Date</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody overflowY="auto" maxH="50%">
        {files && files.length > 0 ? (
              files.map((file) => (
                <Tr key={file.fileUrl}>
                  <Td>{file.fileName}</Td>
                  <Td>{new Date(file.uploadDate).toLocaleDateString()}</Td>
                  <Td>
                    <IconButton
                      icon={<ViewIcon />}
                      aria-label="View PDF"
                      mr={2}
                      onClick={() => handleView(file.fileKey)} 
                      />
                    <IconButton
                      icon={<DownloadIcon />}
                      aria-label="Download PDF"
                      onClick={() => handleDownload(file.fileKey, file.fileName)}
                      />
                  </Td>
                </Tr>
              ))
            ) : (
              <Tr>
                <Td colSpan={3} textAlign="center">No files found</Td>
              </Tr>
            )}
        </Tbody>
      </Table>

      <Modal isOpen={isOpen} onClose={onClose} size="5xl">
        <ModalOverlay />
        <ModalContent h="90vh">
          <ModalHeader>PDF Viewer</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedFile && (
              <iframe
                src={selectedFile}
                style={{ width: '100%', height: '100%' }}
                title="PDF Viewer"
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default S3FileList;