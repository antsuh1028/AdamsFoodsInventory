import React from "react";
import {
  Input,
  Box,
  Text,
  Button,
  FormControl,
} from "@chakra-ui/react";
import { useState } from "react";
import readXlsxFile from "read-excel-file";
import FloatingWindow from "../FloatingWindow";


const getBoxes = (rows) => {
    const boxes = [];
    
    // Start from row 6 (index 5) where data begins
    // End at row with "Total Boxes" (index 22)
    for (let i = 6; i < 22; i++) {
        if (rows[i] && rows[i][0] !== null) {
            // Only add rows where first column (boxes) is not 0
            if (rows[i][0] !== 0) {
                boxes.push(rows[i].slice(1, 11));
            }
        }
    }
    
    return {boxes: boxes, description: rows[4][2], total: rows[22][11], count: rows[22][1]};
 };

function UploadTally({ isOpen, onClose }) {
  const [selectedFile, setSelectedFile] = useState(null);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const validTypes = [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ];
      if (validTypes.includes(file.type)) {
        setSelectedFile(file);
      } else {
        alert("Please select a valid Excel file.");
      }
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      readXlsxFile(selectedFile).then((rows) => {

        // Check if it's a valid Noblesse Global form
        if (rows[0] && rows[0][6]?.includes("Noblesse Global")) {

            const cleanedRows = rows.map(row => {
                const firstNonNull = row.findIndex(cell => cell !== null);
                const lastNonNull = row.findLastIndex(cell => cell !== null);
                
                if (firstNonNull === -1) return [];
                return row.slice(firstNonNull, lastNonNull + 1);
              });
            
            const info = getBoxes(cleanedRows)
            // console.log(info);


        } else {
          alert("Please upload a valid Noblesse Global form");
        }
      });
    } else {
      alert("Please select a valid Excel file.");
    }
  };

  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      title="Upload Tally Sheet"
      width={620}
      footer={<>
        <Button colorScheme="blue" mr={3} onClick={handleUpload}>
          Upload
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </>}
    >
      <FormControl>
        <Box width="90%" padding="4">
          <Text textAlign="center" fontSize="small">
            - File must be Adams E-Tally -
          </Text>
          <Input
            type="file"
            marginTop="20px"
            accept=".xlsx, .xls"
            onChange={handleFileChange}
          />
        </Box>
      </FormControl>
    </FloatingWindow>
  );
}

export default UploadTally;