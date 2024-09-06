import React from 'react';
import {Input, Box, Flex, Stack, HStack, useDisclosure, Drawer, Button,DrawerOverlay, DrawerContent, DrawerHeader, DrawerFooter,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalFooter,ModalBody, ModalCloseButton, FormControl, FormLabel, Image,
  Tabs, TabList, TabPanels, Tab, TabPanel} from '@chakra-ui/react';
import { HamburgerIcon } from '@chakra-ui/icons';
import { Link } from 'react-router-dom';

function UploadFile({ isOpen, onClose }) {
  const handleFileChange = (event) => {
    const file = event.target.files[0];

    if (file) {
      const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ];
      if (validTypes.includes(file.type)) {
        console.log('Valid Excel file:', file);
      } else {
        alert('Please select a valid Excel file.');
      }
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Upload File</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <FormControl>
            <Box width="90%" padding='4'>
              <FormLabel fontWeight='bold' marginLeft='10px'>Location</FormLabel>
              <Input bg='white'  width="100%" type="text" placeholder='Enter Location' />
              <Input type="file" marginTop='20px' h='' accept=".xlsx, .xls" onChange={handleFileChange} />
            </Box>
          </FormControl>
        </ModalBody>
        <ModalFooter>
          <Button colorScheme='blue' mr={3}>
            Upload
          </Button>
          <Button variant='ghost' onClick={onClose}>Cancel</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ShowMap({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Freezer Map</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Tabs>
            <TabList>
              <Tab>Level 1</Tab>
              <Tab>Level 2</Tab>
              <Tab>Level 3</Tab>
            </TabList>

            <TabPanels>
              <TabPanel>
                <p>one!</p>
              </TabPanel>
              <TabPanel>
                <p>two!</p>
              </TabPanel>
              <TabPanel>
                <p>three!</p>
              </TabPanel>
            </TabPanels>
          </Tabs>


        </ModalBody>
        <ModalFooter>
          <Button variant='ghost' onClick={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function OpenHelp({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Help</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          Some Stuff Here
        </ModalBody>
        <ModalFooter>
          <Button variant='ghost' onClick={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

const ShowDrawer = ({ isOpen, onClose, onOpen, onUploadOpen, onMapOpen }) => {
  return (
    <Drawer placement='left' onClose={onClose} isOpen={isOpen}>
      <DrawerOverlay />
      <DrawerContent>
        <DrawerHeader borderBottomWidth='1px'>Other Actions</DrawerHeader>
        <Stack direction="column" spacing={4} p={4}>
          <Button bg='white' justifyContent="flex-start" onClick={onMapOpen}>Show Map</Button>
          <Button bg='white' justifyContent="flex-start">Some Content</Button>
          <Button bg='white' justifyContent="flex-start" onClick={onUploadOpen}>Upload File</Button>
        </Stack>
        <DrawerFooter justifyContent='center'>
          <Button bg='red.400' as={Link} to="/" _hover={{ bg: 'red.500' }}>Log Out</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

const Navbar = () => {
  const { isOpen: isDrawerOpen, onOpen: onDrawerOpen, onClose: onDrawerClose } = useDisclosure();
  const { isOpen: isUploadOpen, onOpen: onUploadOpen, onClose: onUploadClose } = useDisclosure();
  const { isOpen: isMapOpen, onOpen: onMapOpen, onClose: onMapClose } = useDisclosure();
  const { isOpen: isHelpOpen, onOpen: onHelpOpen, onClose: onHelpClose } = useDisclosure();

  return (
    <>
      <Box bg="white" px={4} w="100%" h='10vh' position="fixed" top={0} zIndex={1}>
        <Flex h={16} alignItems="center" justifyContent="space-between">
          <HStack spacing={8} alignItems="center">
            <Box>
              
              <Button onClick={onDrawerOpen} bg="white" color="black" p={2}>
                <HamburgerIcon w={6} h={6} />
              </Button>
            </Box>
            <HStack as="nav" spacing={4} display={{ base: 'none', md: 'flex' }} justifyContent='center'>
              <Image h='50px'src="AdamsWings.png" alt="Adams Wings" />
            </HStack>
          </HStack>
          <Flex alignItems="center">
            <Button onClick={onHelpOpen} bg="white" color="black" p={2}>
              Help
            </Button>
          </Flex>
        </Flex>
      </Box>
      <ShowDrawer
        isOpen={isDrawerOpen}
        onClose={onDrawerClose}
        onUploadOpen={onUploadOpen}
        onMapOpen={onMapOpen}
      />
      <UploadFile isOpen={isUploadOpen} onClose={onUploadClose} />
      <ShowMap isOpen={isMapOpen} onClose={onMapClose} />
      <OpenHelp isOpen={isHelpOpen} onClose={onHelpClose} />
    </>
  );
};

export default Navbar;
