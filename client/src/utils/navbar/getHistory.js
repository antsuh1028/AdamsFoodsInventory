import axiosInstance from "../axiosInstance";

function getHistory() {
  return axiosInstance
    .get("/getHistory")
    .then((result) => result.data)
    .catch((err) => {
      const message = err.response?.data?.error || "An error occurred";
      console.error(message);
      throw err;
    });
}

export default getHistory;
