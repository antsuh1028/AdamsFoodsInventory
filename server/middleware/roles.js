// The role above admin. Master passes every admin check, and alone may make
// changes that take a measurement back out of the records.
const MASTER = "master";

/** Admin, or master above it. */
const isAdminRole = (role) => role === "admin" || role === MASTER;

module.exports = { MASTER, isAdminRole };
