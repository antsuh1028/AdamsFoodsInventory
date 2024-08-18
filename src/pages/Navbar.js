import React from 'react';
import { Input, Image, Box, Flex, Stack, HStack, IconButton, useDisclosure, Drawer, Button, DrawerOverlay, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter, List } from '@chakra-ui/react';
import { HamburgerIcon, CloseIcon } from '@chakra-ui/icons';
import {Modal, ModalOverlay, ModalContent, ModalHeader, ModalFooter, ModalBody, ModalCloseButton,} from '@chakra-ui/react'
import {FormControl, FormLabel, FormErrorMessage, FormHelperText} from '@chakra-ui/react'
import { Link as ChakraLink} from '@chakra-ui/react'
import { Link} from 'react-router-dom'

function UploadFile({ isOpen, onClose }) {

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    console.log(file);
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Title</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
          <FormControl >
              <Box width="90%">
                <Input bg='white' width="100%" type="input1" placeholder='Location'/>
                <Input type="file" onChange={handleFileChange} />
              </Box>
          </FormControl>
          </ModalBody>
          <ModalFooter>
            <Button colorScheme='blue' mr={3} >
              Upload
            </Button>
            <Button variant='ghost' onClick={onClose}>Cancel</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

function OpenHelp({ isOpen, onClose }) {

  return (
    <>
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
    </>
  );
}




const ShowDrawer = ({ isOpen, onClose, onOpen, onUploadOpen }) => {
  return (
    <Drawer placement='left' onClose={onClose} isOpen={isOpen}>
      <DrawerOverlay />
      <DrawerContent>
        <DrawerHeader borderBottomWidth='1px'>Other Actions</DrawerHeader>
        <Stack direction="column" spacing={4} p={4}>
          <Button bg='white' justifyContent="flex-start" >Show Map</Button>
          <Button bg='white' justifyContent="flex-start">Some Content</Button>
          <Button bg='white' justifyContent="flex-start" onClick={onUploadOpen}>Upload File</Button>
        </Stack>
        <DrawerFooter justifyContent='center'>
          <Button bg='red.400' as={Link} to="/login" _hover={{ bg: 'red.500' }}>Log Out</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

const Navbar = () => {
  const { isOpen: isDrawerOpen, onOpen: onDrawerOpen, onClose: onDrawerClose } = useDisclosure();
  const { isOpen: isModalOpen, onOpen: onModalOpen, onClose: onModalClose } = useDisclosure();
  const { isOpen: isHelpOpen, onOpen: onHelpOpen, onClose: onHelpClose } = useDisclosure();
  return (
    <>
      <Box bg="white" px={4} w="100%" position="fixed" top={0} zIndex={1}>
        <Flex h={16} alignItems="center" justifyContent="space-between">
          <HStack spacing={8} alignItems="center">
            <Box>
              <Button onClick={onDrawerOpen} bg="white" color="black" p={2}>
                <HamburgerIcon w={6} h={6} />
              </Button>
            </Box>
            <HStack as="nav" spacing={4} display={{ base: 'none', md: 'flex' }} justifyContent='center'>
              <Image src="AdamsWings.png" alt="Adams Wings" height='50px'/>
            </HStack>
          </HStack>
          <Flex alignItems="center">
            <Button onClick={onHelpOpen} bg="white" color="black" p={2}>
             Help
            </Button>
          </Flex>
        </Flex>
      </Box>
      <ShowDrawer isOpen={isDrawerOpen} onClose={onDrawerClose} onUploadOpen={onModalOpen} onMapOpen={onModalOpen} />
      <UploadFile isOpen={isModalOpen} onClose={onModalClose} />
      <OpenHelp isOpen={isHelpOpen} onClose={onHelpClose} />
    </>
  );
};

export default Navbar;
