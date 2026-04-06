const fs = require("fs");
const path = require("path");

let validLocations = [];

try {
  const data = fs.readFileSync(path.join(__dirname, "../locations.txt"), "utf8");
  validLocations = data.split("\n").map((l) => l.trim()).filter(Boolean);
} catch (err) {
  console.error("Error reading locations file:", err);
}

module.exports = validLocations;
