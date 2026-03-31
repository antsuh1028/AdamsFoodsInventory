import axiosInstance from "../axiosInstance";
import postHistory from "./postHistory";

function updateItem(
  updateInputs,
  setItems,
  setShowDetails,
  setCurrentItem,
  toast
) {
  if (!window.confirm("Are you sure you want to update this item?")) {
    return;
  }

  axiosInstance
    .post("/inventoryUpdate", { updateInputs })
    .then((result) => {
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
