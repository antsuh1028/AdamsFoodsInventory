import axios from "axios";

function findItem(inputs, setItems, setShowDetails, toast) {
  
    axios
      .post("https://server.afdcstorage.com/inventoryFind", { inputs })
      .then((result) => {
        if (result.data === "INVALID"){
          const message = "An error occurred while finding the item.";
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
        }else{
          const sortedItems = result.data.sort((a, b) =>
            a.location.localeCompare(b.location)
          );
          setItems(sortedItems);
          setShowDetails(false); 
        }
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
      });
  }
  
  export default findItem;