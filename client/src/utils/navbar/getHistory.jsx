import axiosInstance from "../axiosInstance";

function getHistory(offset = 0, search = "") {
  const params = new URLSearchParams({ offset });
  if (search) params.set("search", search);
  return axiosInstance
    .get(`/getHistory?${params}`)
    .then((result) => result.data)
    .catch((err) => {
      const message = err.response?.data?.error || "An error occurred";
      console.error(message);
      throw err;
    });
}

export default getHistory;
