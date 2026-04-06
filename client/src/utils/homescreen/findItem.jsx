import axiosInstance from "../axiosInstance";

function findItem(inputs, setItems, setShowDetails, toast, onFound) {
  axiosInstance
    .post("/inventoryFind", { inputs })

    .then((result) => {
      if (result.data === "INVALID") {
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
        setItems([]);
        if (setShowDetails) {
          setShowDetails(false);
        }
      } else {
        const getLevel = (loc) => {
          const c = loc[1];
          if (c === "1") return 1;
          if (c === "2") return 2;
          return 3;
        };
        const sortedItems = result.data.sort((a, b) => {
          const levelDiff = getLevel(a.location) - getLevel(b.location);
          if (levelDiff !== 0) return levelDiff;
          return a.location.localeCompare(b.location);
        });
        setItems(sortedItems);
        if (setShowDetails) {
          setShowDetails(false);
        }
        if (onFound) onFound(sortedItems[0]);
      }
    })
    .catch((err) => {
      const message =
        err.response?.data?.error ||
        "An error occurred while finding the item.";
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
