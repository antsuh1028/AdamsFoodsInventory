// Adams Foods prices and dollar values: seen and set by these roles only.
const VALUE_ROLES = ["admin", "manager"];

const seesValue = (role) => VALUE_ROLES.includes(role);

module.exports = { VALUE_ROLES, seesValue };
