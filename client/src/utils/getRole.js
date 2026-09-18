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

// Outgoing is two-party: the dock weighs finished boxes, reception owns the
// load and calls a lot finished. Mirrors RECEPTION_ROLES on the server, which
// is the actual control — this only decides what is worth showing.
export const RECEPTION_ROLES = ["admin", "manager", "noblesse", "reception"];

export const canReceive = () => RECEPTION_ROLES.includes(getRole());

export default getRole;
