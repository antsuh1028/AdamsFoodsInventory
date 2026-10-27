// In development the API is on whichever computer served the page, so a tablet on the
// same network reaches this PC rather than itself.
export const API_BASE_URL =
  process.env.NODE_ENV === "development"
    ? `http://${window.location.hostname}:3001`
    : "https://server.afdcstorage.com";
