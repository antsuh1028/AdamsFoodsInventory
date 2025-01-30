import React from "react";
import {
  Input,
  Box,
  Text,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  FormControl,
  useToast,
  
} from "@chakra-ui/react";

import { useState } from "react";
import readXlsxFile from "read-excel-file";
import axios from "axios";


function UploadFile({ isOpen, onClose }) {
    const [selectedFile, setSelectedFile] = useState(null);
    const toast = useToast();
  
    const handleFileChange = (event) => {
      const file = event.target.files[0];
  
      if (file) {
        const validTypes = [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
        ];
        if (validTypes.includes(file.type)) {
          // console.log("Valid Excel file:", file);
          setSelectedFile(file);
        } else {
          alert("Please select a valid Excel file.");
        }
      }
    };
  
    //Function that Reads Excel File and then uses Add function to Input it into the Freezer Database
    const handleUpload = () => {
      if (selectedFile) {
        readXlsxFile(selectedFile).then((rows) => {
          if (rows[1] && rows[1].includes("DAILY INCOMING PRODUCT RECORD")) {
            const isRowEmpty = (row) => row.every((value) => value === null);
            const cleanRow = (row) => {
              let rowIndex = row.indexOf(null);
              if (rowIndex !== -1) {
                row.splice(rowIndex, 1);
              }
              while (
                row.length > 0 &&
                row[row.length - 1] === null &&
                row.length > 3
              ) {
                row.pop();
              }
              return row;
            };
  
            // Filter and clean the rows
            const filteredRows = rows.filter((row) => !isRowEmpty(row));
            const cleanedRows = filteredRows.map(cleanRow);
            const finalRows = cleanedRows.slice(4);
            const valueToAdd = filteredRows[1] ? filteredRows[1][9] : null;
  
            for (let i = finalRows.length - 1; i >= 0; i--) {
              const row = finalRows[i];
              if (row[0]) {
                if (valueToAdd !== null && row.length > 1) {
                  row[1] = valueToAdd + "-" + row[1];
                }
              } else {
                finalRows.splice(i, 1);
              }
            }
  
            // console.log("Cleaned rows:", finalRows);
  
            const validationPromises = finalRows.map((row) =>
              axios.post("https://server.afdcstorage.com/verifyLocation", {
                location: row[0],
              })
            );
            // console.log("done");
            // console.log(validationPromises);
  
            // Wait for all validation requests to complete
            Promise.all(validationPromises)
              .then((responses) => {
                // console.log("All locations validated successfully");
  
                finalRows.forEach((row) => {
                  const [
                    location,
                    lot,
                    vendor,
                    brand,
                    species,
                    description,
                    grade,
                    quantity,
                    weight,
                    packdate,
                    temp,
                    est,
                  ] = row;
  
                  const data = {
                    inputs: {
                      location: location.toUpperCase(),
                      lot,
                      vendor,
                      brand,
                      species,
                      description,
                      grade,
                      quantity,
                      weight,
                      packdate,
                      temp,
                      est,
                    },
                  };
  
                  // Add to inventory
                  axios
                    .post("https://server.afdcstorage.com/inventoryAdd", data)
                    .then((response) => {
                      // console.log("Item added successfully:", response.data);
                    })
                    .catch((error) => {
                      console.error("Error adding item to inventory:", error);
                      toast({
                        title: "Upload File Error",
                        position: "top",
                        description:
                          "Error adding item to inventory. Please try again.",
                        status: "error",
                        duration: 2000,
                        isClosable: true,
                      });
                    });
                });
  
                onClose();
                toast({
                  title: "Upload File Success",
                  position: "top",
                  description: "File Successfully Uploaded",
                  status: "success",
                  duration: 3000,
                  isClosable: true,
                });
                setSelectedFile(null);
              })
              .catch((err) => {
                toast({
                  title: "Upload File Error",
                  position: "top",
                  description: "Error Uploading File",
                  status: "error",
                  duration: 3000,
                  isClosable: true,
                });
                onClose();
              });
          } else {
            alert(
              "Please Upload Appropriate File (Daily Incoming Product Record)"
            );
          }
        });
      } else {
        alert("Please select a valid Excel file.");
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
              <Box width="90%" padding="4">
              <Text textAlign="center" fontSize="small">- File must be a "Incoming Product Record Form" -</Text>
                <Input
                  type="file"
                  marginTop="20px"
                  h=""
                  accept=".xlsx, .xls"
                  onChange={handleFileChange}
                />
              </Box>
            </FormControl>
          </ModalBody>
          <ModalFooter>
            <Button colorScheme="blue" mr={3} onClick={handleUpload}>
              Upload
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    );
  }

export default UploadFile;