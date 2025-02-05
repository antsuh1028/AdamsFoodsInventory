import axios from "axios";

function findItem(inputs, setItems, setShowDetails, toast) {
  // console.log("Here",inputs);
  
    axios
      .post("https://server.afdcstorage.com/inventoryFind", { inputs })
      // .post("http://localhost:3001/inventoryFind", { inputs })


      .then((result) => {
        if (result.data === "INVALID"){
          if (toast) {
            toast({
              title: "Finding Item Error",
              position: "top",
              description: "Could Not Find Item.",
              status: "error",
              duration: 2000,
              isClosable: true,
            });
          }
          // console.log(result);
          setItems([]); 
          if (setShowDetails){
            setShowDetails(false); 
          }
        }else{
          const sortedItems = result.data.sort((a, b) =>
            a.location.localeCompare(b.location)
          );
          // console.log(result);
          setItems(sortedItems);
          if (setShowDetails){
            setShowDetails(false); 
          } 
        }
      })
      .catch((err) => {
        const message = err.response?.data?.error || "An error occurred while finding the item.";
        if (toast) {
          toast({
            title: "Finding Item Error",
            position: "top",
            description: message,
            status: "error",
            duration: 2000,
            isClosable: true,
          });
        }
      });
  }
  
  export default findItem;