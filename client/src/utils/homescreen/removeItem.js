import axiosInstance from "../axiosInstance";
import postHistory from "./postHistory";

function removeItem(
  currentItem,
  location,
  setItems,
  setShowDetails,
  setCurrentItem,
  toast
) {
  if (!currentItem || location !== currentItem.location) {
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
    return;
  }

  axiosInstance
    .post("/inventoryRemove", { currentItem })
    .then(() => postHistory(currentItem, "REMOVE"))
    .then(() => {
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
      toast({
        title: "Remove Item Error",
        position: "top",
        description:
          err.response?.data?.error || "Error while removing the item.",
        status: "error",
        duration: 2000,
        isClosable: true,
      });
      setItems([]);
      setShowDetails(false);
    });
}

export default removeItem;
