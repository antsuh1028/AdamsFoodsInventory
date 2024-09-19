import axios from "axios";

function findItem(inputs, setItems, setShowDetails, toast) {
  
    axios
      .post("http://localhost:3001/inventoryFind", { inputs })
      .then((result) => {
        const sortedItems = result.data.sort((a, b) =>
          a.location.localeCompare(b.location)
        );
        setItems(sortedItems);
        setShowDetails(false); 
      })
      .catch((err) => {
        const message = err.response?.data?.error || "An error occurred while finding the item.";
        toast({
          title: "Finding Item Error",
          position: "top",
          description: message,
          status: "error",
          duration: 2000,
          isClosable: true,
        });
  
        setItems([]); 
        setShowDetails(false); 
      });
  }
  
  export default findItem;