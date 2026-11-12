// In development the API is on whichever computer served the page, so a tablet on the
// same network reaches this PC rather than itself.
// REACT_APP_API_URL points a local copy at a test server instead.
export const API_BASE_URL = process.env.REACT_APP_API_URL || (
  process.env.NODE_ENV === "development"
    ? `http://${window.location.hostname}:3001`
    : "https://server.afdcstorage.com");
