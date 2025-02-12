import axios from "axios";
import findItem from "./findItem";

function addItem(inputs, setShowDetails, setItems, toast) {
  const API_BASE_URL = "https://server.afdcstorage.com";
  const TEST_BASE_URL = "http://localhost:3001";

  const modifiedInputs = {
    ...inputs,
    description: inputs.description.toUpperCase(),
  };

  axios
    .post(`${API_BASE_URL}/inventoryAdd`, { inputs: modifiedInputs })

    .then((result) => {
      return axios.post(`${API_BASE_URL}/addHistory`, {
        ...modifiedInputs,
        change: "ADD",
        time: new Date().toLocaleString(),
      });
    })
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
    })
    .catch((err) => {
      const message = err.response?.data?.error || "An error occurred";
      toast({
        title: "Adding Item Error",
        position: "top",
        description: message,
        status: "error",
        duration: 2000,
        isClosable: true,
      });
      setItems([]);
      setShowDetails(false);
    });
}

export default addItem;
