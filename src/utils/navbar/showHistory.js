import React from "react";
import {
  Box,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,  
} from "@chakra-ui/react";
import {
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from '@chakra-ui/react';
import { useContext } from 'react';
import { FormContext } from '../homescreen/formContext.js';
import { useState } from "react";
import printDetails from "../printDetails"; 

function ShowHistory({isOpen, onClose}) {

    const [selectedProduct, setSelectedProduct] = useState(null);
    const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  
    const historyData = [
      {
        time: "2024-01-13 10:00",
        change:"ADD",
        location: "A1",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "A",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"UPDATE",
        location: "A2",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "Other",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"ADD",
        location: "A1",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "A",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"UPDATE",
        location: "A2",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "Other",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"ADD",
        location: "A1",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "A",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"UPDATE",
        location: "A2",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "Other",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"ADD",
        location: "A1",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "A",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"UPDATE",
        location: "A2",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "Other",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"ADD",
        location: "A1",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "A",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"UPDATE",
        location: "A2",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "Other",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"ADD",
        location: "A1",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "A",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"UPDATE",
        location: "A2",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "Other",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"ADD",
        location: "A1",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "A",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      },
      {
        time: "2024-01-13 10:00",
        change:"UPDATE",
        location: "A2",
        lot: "123",
        vendor: "Vendor1",
        brand: "Brand1",
        species: "Chicken",
        description: "Description here",
        grade: "Other",
        quantity: "100",
        weight: "500",
        packdate: "2024-01-10",
        temp: "-18",
        est: "12345"
      }
      // Add more data as needed
    ];
  
    const handleRowClick = (item, event) => {
      setSelectedProduct(item);
      setPopoverPosition({
        x: event.clientX,
        y: event.clientY
      });
    };
    const StyledTh = ({ children }) => (
      <Th border="1px" borderColor="gray.200">{children}</Th>
    );
  
    const formSetters = useContext(FormContext);
  
    const handleSet = (item) => {
      formSetters.setLocation(item.location || "");
      formSetters.setLot(item.lot || "");
      formSetters.setVendor(item.vendor || "");
      formSetters.setBrand(item.brand || "");
      formSetters.setSpecies(item.species || "");
      formSetters.setDescription(item.description || "");
      formSetters.setGrade(item.grade || "");
      formSetters.setQuantity(item.quantity || "");
      formSetters.setWeight(item.weight || "");
      formSetters.setPackdate(item.packdate || "");
      formSetters.setTemp(item.temp || "");
      formSetters.setEst(item.est || "");
      formSetters.setCurrentItem(item);
      onClose(); 
    };
  
    const handleClose = () => {
      setSelectedProduct(null); 
      onClose();  
    };
  
    return (
      <Modal isOpen={isOpen} onClose={onClose} size="xl">
        <ModalOverlay />
        <ModalContent maxW="90vw" height="90vh">
          <ModalHeader>History Log</ModalHeader>
          <ModalCloseButton onClick={handleClose}/>
          <ModalBody>
          <Box overflowX="auto">
            <Box maxH="75vh" overflowY="auto">
              <Table variant="sim" size="md" border="1px" borderColor="gray.200" >
                <Thead>
                  <Tr>
                    <StyledTh >Time</StyledTh>
                    <StyledTh >Change Made</StyledTh>
                    <StyledTh >Location</StyledTh>
                    <StyledTh >Lot</StyledTh>
                    <StyledTh >Vendor</StyledTh>
                    <StyledTh >Brand</StyledTh>
                    <StyledTh >Species</StyledTh>
                    <StyledTh >Desc.</StyledTh>
                    <StyledTh >Grade</StyledTh>
                    <StyledTh >Quant.</StyledTh>
                    <StyledTh >Weight</StyledTh>
                    <StyledTh >Pack Date</StyledTh>
                    <StyledTh >Temp.</StyledTh>
                    <StyledTh >EST</StyledTh>
                  </Tr>
                </Thead>
                <Tbody>
                  {historyData.map((item, index) => (
                    <Tr 
                      key={index}
                      onClick={(e) => handleRowClick(item, e)}
                      cursor="pointer"
                      _hover={{ bg: "gray.50" }}
                      border="1px"
                      borderColor="gray.200" 
  
                    >
                      <Td>{item.time}</Td>
                      <Td>{item.change}</Td>
                      <Td>{item.location}</Td>
                      <Td>{item.lot}</Td>
                      <Td>{item.vendor}</Td>
                      <Td>{item.brand}</Td>
                      <Td>{item.species}</Td>
                      <Td>{item.description}</Td>
                      <Td>{item.grade}</Td>
                      <Td>{item.quantity}</Td>
                      <Td>{item.weight}</Td>
                      <Td>{item.packdate}</Td>
                      <Td>{item.temp}</Td>
                      <Td>{item.est}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              </Box>
            </Box>
  
            {selectedProduct && (
              <Box
                position="fixed"
                left={popoverPosition.x}
                top={popoverPosition.y}
                bg="white"
                boxShadow="lg"
                border="1px"
                borderColor="gray.200"
                borderRadius="md"
                p={4}
                zIndex={1400}
              >
                <Box fontWeight="bold" mb={2}>
                  Product Info
                  <Button
                    size="sm"
                    position="absolute"
                    right={2}
                    top={2}
                    onClick={() => {setSelectedProduct(null);} }
                  >
                    ✕
                  </Button>
                </Box>
                <>
                  <Box mb={2}>Location: {selectedProduct.location}</Box>
                  <Box mb={2}>Lot: {selectedProduct.lot}</Box>
                  <Box mb={2}>Description: {selectedProduct.description}</Box>
                  <Box display="flex" gap={2} mt={4} h="10%" w="20vw" maxW="500px">
                    <Button size="sm" colorScheme="blue" onClick={() => handleSet(selectedProduct)}>Set</Button>
                    <Button size="sm" onClick={() => {
                        printDetails(selectedProduct);}}> Print
                    </Button>
                  </Box>
                </>
              </Box>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    );
  }

  export default ShowHistory;