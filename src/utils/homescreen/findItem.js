import axiosInstance from "../axiosInstance";

function findItem(inputs, setItems, setShowDetails, toast) {
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
        const sortedItems = result.data.sort((a, b) =>
          a.location.localeCompare(b.location)
        );
        setItems(sortedItems);
        if (setShowDetails) {
          setShowDetails(false);
        }
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
