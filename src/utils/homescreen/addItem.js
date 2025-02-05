import axios from "axios";
import findItem from "./findItem";

function addItem(inputs, setShowDetails, setItems, toast) {
  // console.log("In AddItem: ",inputs)

  const modifiedInputs = {
    ...inputs,
    description: inputs.description.toUpperCase()
  };
  // console.log("modified: ",modifiedInputs)

  axios
    .post("https://server.afdcstorage.com/inventoryAdd", { inputs: modifiedInputs })

    // .post("http://localhost:3001/inventoryAdd", { inputs })
    .then((result) => {
      // return axios.post("http://localhost:3001/addHistory", {
      return axios.post("https://server.afdcstorage.com/addHistory", {

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
