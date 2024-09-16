import React from "react";
import { Navigate } from "react-router-dom";

// PrivateRoute component to check if token exists
const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem("token");

  // Check if the token exists
  return token ? children : <Navigate to="/" />;
};

export default PrivateRoute;
