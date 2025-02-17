import axios from "axios";


function getHistory() {
    const API_BASE_URL = "https://server.afdcstorage.com";
    const TEST_BASE_URL = "http://localhost:3001";

    return axios
        .get(`${TEST_BASE_URL}/getHistory`)
        .then((result) => {
            console.log("API Response:", result.data);
            return result.data;   
        })
        .catch((err) => {
            const message = err.response?.data?.error || "An error occurred";
            console.error(message);
            throw err;
        });
}

export default getHistory;