// Decodes the stored JWT and returns the user's role (no signature verification — server enforces)
const getRole = () => {
  try {
    const token = localStorage.getItem("token");
    if (!token) return "user";
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role || "user";
  } catch {
    return "user";
  }
};

export default getRole;
