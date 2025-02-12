import axios from "axios";

function removeItem(
  currentItem,
  location,
  setItems,
  setShowDetails,
  setCurrentItem,
  toast
) {
  const API_BASE_URL = "https://server.afdcstorage.com";
  const TEST_BASE_URL = "http://localhost:3001";

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
    .post(`${API_BASE_URL}/inventoryRemove`, { currentItem })
    .then(() => {
      return axios.post(`${API_BASE_URL}/addHistory`, {
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
