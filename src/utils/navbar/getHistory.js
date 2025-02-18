//TODO:: Get the history from the history database on the backend and then return it wrappped neatly so that we can display later

// Should look like this:
// {
//     time: "2024-01-13 10:00",
//     change:"ADD",
//     location: "A1",
//     lot: "123",
//     vendor: "Vendor1",
//     brand: "Brand1",
//     species: "Chicken",
//     description: "Description here",
//     grade: "A",
//     quantity: "100",
//     weight: "500",
//     packdate: "2024-01-10",
//     temp: "-18",
//     est: "12345"
//   }
// getHistory.js
import axios from "axios";

function getHistory(setHistory, toast) {
    axios
        .get("https://server.afdcstorage.com/getHistory") //https://server.afdcstorage.com/getHistory
        .then((result) => {
            console.log("=== getHistory: Response received ===");
            console.log("Result data:", result.data);

            if (result.data && Array.isArray(result.data)) {

                // Map the history data to a consistent format
                const formattedHistory = result.data.map((history) => ({
                    time: history.time || "N/A",
                    change: history.change || "UNKNOWN",
                    location: history.location || "N/A",
                    lot: history.lot || "N/A",
                    vendor: history.vendor || "N/A",
                    brand: history.brand || "N/A",
                    species: history.species || "N/A",
                    description: history.description || "N/A",
                    grade: history.grade || "N/A",
                    quantity: history.quantity || "N/A",
                    weight: history.weight || "N/A",
                    packdate: history.packdate || "N/A",
                    temp: history.temp || "N/A",
                    est: history.est || "N/A",
                }));

                console.log("Formatted history:", formattedHistory);
                setHistory(formattedHistory);
            } else {
                console.log("Result is not an array or result.data is empty.");
                // Handle case where no history data is found
                if (toast) {
                    toast({
                        title: "Fetching History Error",
                        position: "top",
                        description: "No history records found.",
                        status: "error",
                        duration: 2000,
                        isClosable: true,
                    });
                }
                setHistory([]); 
            }
        })
        .catch((err) => {
            console.log("=== getHistory: Error occurred ===");
            console.error("Error details:", err);

            const message = err.response?.data?.error || "An error occurred while fetching history.";
            if (toast) {
                toast({
                    title: "Fetching History Error",
                    position: "top",
                    description: message,
                    status: "error",
                    duration: 2000,
                    isClosable: true,
                });
            }
            setHistory([]); 
        });
}

export default getHistory;
