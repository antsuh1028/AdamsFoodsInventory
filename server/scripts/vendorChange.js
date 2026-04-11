require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const FreezerModel = require("../models/Freezer");


async function run() {
  await mongoose.connect(process.env.MONGO_DB_URI);
  console.log("Connected to MongoDB");

  const items = await FreezerModel.find({}).lean();
  console.log(`Found ${items.length} items`);

  for (const item of items) {
    if (item.type === "prc"){
        await FreezerModel.updateOne({ _id: item._id }, { $set: { vendor: "AdamsFoods" } });
    }
  }

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
