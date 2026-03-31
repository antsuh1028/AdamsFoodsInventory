import { Navigate } from "react-router-dom";

const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem("token");

  if (!token) return <Navigate to="/" />;

  try {
    // Decode the JWT payload (base64) to check expiry — no secret needed client-side
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp * 1000 < Date.now()) {
      localStorage.removeItem("token");
      return <Navigate to="/" />;
    }
  } catch {
    // Malformed token
    localStorage.removeItem("token");
    return <Navigate to="/" />;
  }

  return children;
};

export default PrivateRoute;
