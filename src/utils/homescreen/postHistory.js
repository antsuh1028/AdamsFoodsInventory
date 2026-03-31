import axiosInstance from "../axiosInstance";

function postHistory(item, changeType) {
  return axiosInstance.post("/addHistory", {
    ...item,
    change: changeType,
    time: new Date().toLocaleString(),
  });
}

export default postHistory;
