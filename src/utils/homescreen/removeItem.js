import axios from "axios";
import findItem from "./findItem";

function removeItem(
  currentItem,
  location,
  setItems,
  setShowDetails,
  setCurrentItem,
  toast
) {
  if (!window.confirm("Are you sure you want to delete this item?")) {
    return;
  }

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

  axios
    // .post("https://server.afdcstorage.com/inventoryRemove", { currentItem })

    .post("http://localhost:3001/inventoryRemove", { currentItem })
    .then(() => {
      return axios.post("http://localhost:3001/addHistory", {
        ...currentItem,
        change: "REMOVE",
        time: new Date().toLocaleString(),
      });
    })
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
