const { namedListRouter } = require("../utils/namedList");

// The customers outgoing pallets go to.
module.exports = namedListRouter({
  path: "/customers", table: "customers",
  usedColumn: "ship_to", label: "customers",
});
