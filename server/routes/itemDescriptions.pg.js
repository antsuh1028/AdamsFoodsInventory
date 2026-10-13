const { namedListRouter, normaliseName } = require("../utils/namedList");

// The standard outgoing item descriptions the dock picks from.
module.exports = namedListRouter({
  path: "/item-descriptions", table: "item_descriptions",
  usedColumn: "item_description", label: "item descriptions",
});
module.exports.normaliseName = normaliseName;
