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
//
// `manager` is an ADAMS FOODS role — /home admits it and /noblesse does not,
// and there is only one tenant, so the role name is the only thing separating
// the two facilities. `ntimanager` is its Noblesse counterpart.
export const RECEPTION_ROLES = [
  "admin", "manager", "ntimanager", "noblesse", "reception", "outgoing",
];

export const canReceive = () => RECEPTION_ROLES.includes(getRole());

// Scoped to the Outgoing tab and nothing else. The server refuses the rest
// outright (middleware/roleScope.js) — this only stops the screen asking for
// what it is going to be refused, and hides tabs that would open empty.
export const isOutgoingOnly = () => getRole() === "outgoing";

// Roles that live on the Noblesse side. Everything that routes by role reads
// this, so adding a role here is the whole job.
export const NOBLESSE_SIDE = ["noblesse", "ntimanager", "outgoing"];

// Who may read the daily report. Mirrors requireRole on the route, which is
// the control — admin for everything, ntimanager for the figures.
export const REPORT_ROLES = ["admin", "ntimanager"];
export const canSeeReport = () => REPORT_ROLES.includes(getRole());

export const landingFor = (role) =>
  (NOBLESSE_SIDE.includes(role) ? "/noblesse" : "/home");

export default getRole;
