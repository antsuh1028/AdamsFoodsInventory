import axiosInstance from "../axiosInstance";
import findItem from "./findItem";
import postHistory from "./postHistory";

function addItem(inputs, setShowDetails, setItems, toast, onSuccess, onOccupied, onHighlight) {
  const modifiedInputs = { ...inputs };

  const doAdd = (force = false) => {
    return axiosInstance
      .post("/inventoryAdd", { inputs: modifiedInputs, force })
      .then(() => postHistory(modifiedInputs, "ADD"))
      .then(() => {
        toast({
          title: "Item Added Successfully",
          position: "top",
          description: "Item has been added to the inventory.",
          status: "success",
          duration: 2000,
          isClosable: true,
        });
        setShowDetails(false);
        findItem(modifiedInputs, setItems, setShowDetails);
        if (onSuccess) onSuccess();
      });
  };

  doAdd().catch((err) => {
    const data = err.response?.data;

    // Exact duplicate (same lot + same location) — show toast and highlight existing item
    if (data?.code === "EXACT_DUPLICATE") {
      toast({
        title: "Adding Item Error",
        position: "top",
        description: data.error,
        status: "error",
        duration: 2000,
        isClosable: true,
      });
      if (onHighlight) onHighlight(modifiedInputs.location);
      return;
    }

    // Location occupied — let caller handle with a custom dialog
    if (data?.code === "LOCATION_OCCUPIED") {
      if (onOccupied) {
        onOccupied(data.error, () => {
          doAdd(true).catch((retryErr) => {
            toast({
              title: "Adding Item Error",
              position: "top",
              description: retryErr.response?.data?.error || "An error occurred",
              status: "error",
              duration: 2000,
              isClosable: true,
            });
            setItems([]);
            setShowDetails(false);
          });
        });
      }
      return;
    }

    // All other errors
    toast({
      title: "Adding Item Error",
      position: "top",
      description: data?.error || "An error occurred",
      status: "error",
      duration: 2000,
      isClosable: true,
    });
    setItems([]);
    setShowDetails(false);
  });
}

export default addItem;
