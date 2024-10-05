import axios from "axios";

function updateItem(updateInputs, setItems, setShowDetails, setCurrentItem, toast) {

  const userConfirmed = window.confirm(
    "Are you sure you want to update this item?"
  );

  if (userConfirmed) {
    axios
      .post("https://server.afdcstorage.com/inventoryUpdate", { updateInputs })
      .then((result) => {
        toast({
          title: "Update Item Success",
          position: "top",
          description: "Successfully Updated Item",
          status: "success",
          duration: 2000,
          isClosable: true,
        });
        setItems([result.data]);
        setShowDetails(false);
        setCurrentItem(null);
      })
      .catch((err) => {
        const message = err.response?.data?.error || "Error while updating the item.";
        toast({
          title: "Update Item Error",
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
    console.log("User canceled the update.");
  }
}

export default updateItem;
