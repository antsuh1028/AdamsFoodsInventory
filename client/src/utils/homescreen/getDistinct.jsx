import axiosInstance from "../axiosInstance";

async function getDistinct() {
  const res = await axiosInstance.get("/inventoryDistinct");
  return res.data;
}

export default getDistinct;
