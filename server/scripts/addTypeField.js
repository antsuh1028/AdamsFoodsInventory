require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const FreezerModel = require("../models/Freezer");

const classifyItem = (item) => {
  const brand = (item.brand || "").toLowerCase();
  const description = (item.description || "").toLowerCase();

  if (brand.includes("shabuya")) return "prc";
  if (brand.includes("creekstone")) return "raw";
  if (brand.includes("pho gyu")) return "prc";
  // 5+ digit standalone number in description = processed product code
  if (/\b\d{5,}\b/.test(description)) return "prc";

  return null;
};

async function run() {
  await mongoose.connect(process.env.MONGO_DB_URI);
  console.log("Connected to MongoDB");

  const items = await FreezerModel.find({}).lean();
  console.log(`Found ${items.length} items`);

  let prc = 0, raw = 0, skipped = 0;

  for (const item of items) {
    const type = classifyItem(item);
    if (type === null) {
      await FreezerModel.updateOne({ _id: item._id }, { $set: { type: null } });
      skipped++;
    } else {
      await FreezerModel.updateOne({ _id: item._id }, { $set: { type } });
      if (type === "prc") prc++;
      else raw++;
    }
  }

  console.log(`Done — raw: ${raw}, prc: ${prc}, unclassified (null): ${skipped}`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
