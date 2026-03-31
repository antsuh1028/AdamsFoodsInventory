import axiosInstance from "../axiosInstance";
import findItem from "./findItem";
import postHistory from "./postHistory";

function addItem(inputs, setShowDetails, setItems, toast, onSuccess) {
  const modifiedInputs = {
    ...inputs,
    description: inputs.description.toUpperCase(),
  };

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

    // Location occupied — ask user if they want to add anyway
    if (data?.code === "LOCATION_OCCUPIED") {
      if (
        window.confirm(
          `${data.error}\n\nAdd another item here anyway?`
        )
      ) {
        doAdd(true).catch((retryErr) => {
          toast({
            title: "Adding Item Error",
            position: "top",
            description:
              retryErr.response?.data?.error || "An error occurred",
            status: "error",
            duration: 2000,
            isClosable: true,
          });
          setItems([]);
          setShowDetails(false);
        });
      }
      return;
    }

    // All other errors (including hard duplicate block)
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
