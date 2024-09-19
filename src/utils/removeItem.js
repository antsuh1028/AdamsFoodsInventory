import axios from "axios";

function removeItem(currentItem, location, setItems, setShowDetails, setCurrentItem, toast) {


  const userConfirmed = window.confirm(
    "Are you sure you want to delete this item?"
  );

  if (userConfirmed) {
    if (currentItem) {
      if (location === currentItem.location) {
        axios
          .post("http://localhost:3001/inventoryRemove", { currentItem })
          .then((result) => {
            toast({
              title: "Remove Item Success",
              position: "top",
              description: "Successfully Removed Item",
              status: "success",
              duration: 2000,
              isClosable: true,
            });
            setShowDetails(false);
            setItems([]);
            setCurrentItem(null);
          })
          .catch((err) => {
            const message = err.response?.data?.error || "Error while removing the item.";
            toast({
              title: "Remove Item Error",
              position: "top",
              description: message,
              status: "error",
              duration: 2000,
              isClosable: true,
            });
            setItems([]);
            setShowDetails(false);
          });
      } else {
        toast({
          title: "Remove Item Error",
          position: "top",
          description: "Set Item you would like to Remove.",
          status: "error",
          duration: 2000,
          isClosable: true,
        });
        setShowDetails(false);
        setItems([]);
      }
    } else {
      toast({
        title: "Remove Item Error",
        position: "top",
        description: "Set Item you would like to Remove.",
        status: "error",
        duration: 2000,
        isClosable: true,
      });
    }
  } else {
    console.log("User canceled the deletion.");
  }
}

export default removeItem;
