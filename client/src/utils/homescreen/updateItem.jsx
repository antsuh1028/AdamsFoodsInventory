import axiosInstance from "../axiosInstance";
import postHistory from "./postHistory";

function updateItem(
  updateInputs,
  setItems,
  setShowDetails,
  setCurrentItem,
  toast,
  onSuccess
) {
  let updatedItem = null;
  axiosInstance
    .post("/inventoryUpdate", { updateInputs })
    .then((result) => {
      updatedItem = result.data;
      setItems([result.data]);
      return postHistory(updateInputs, "UPDATE");
    })
    .then(() => {
      toast({
        title: "Update Item Success",
        position: "top",
        description: "Successfully Updated Item",
        status: "success",
        duration: 2000,
        isClosable: true,
      });
      setShowDetails(false);
      setCurrentItem(null);
      if (onSuccess && updatedItem) onSuccess(updatedItem);
    })
    .catch((err) => {
      toast({
        title: "Update Item Error",
        position: "top",
        description:
          err.response?.data?.error || "Error while updating the item.",
        status: "error",
        duration: 2000,
        isClosable: true,
      });
      setItems([]);
      setShowDetails(false);
    });
}

export default updateItem;
