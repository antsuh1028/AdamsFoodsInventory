import axios from "axios";
import findItem from "./findItem"


function addItem(inputs, setShowDetails, setItems, toast) {

  
  axios
    .post("http://localhost:3001/inventoryAdd", { inputs })
    .then((result) => {
      toast({
        title: "Item Added Successfully",
        position: "top",
        description: "Item has been added to the inventory.",
        status: "success",
        duration: 2000,
        isClosable: true,
      });

      setShowDetails(false);
      findItem(inputs, setItems, setShowDetails); 
    })
    .catch((err) => {
      const message = err.response?.data?.error || "An error occurred"; // Check if error response exists
      toast({
        title: "Adding Item Error",
        position: "top",
        description: message,
        status: "error",
        duration: 2000,
        isClosable: true,
      });

      setItems([]); // Clear items on error
      setShowDetails(false); // Close details section on error
    });
}

export default addItem;


