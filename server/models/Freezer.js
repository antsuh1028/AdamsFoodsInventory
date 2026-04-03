const mongoose = require('mongoose');

// Define the schema for the user
const FreezerSchema = new mongoose.Schema({
    location: String,
    lot: String,
    vendor: String,
    brand: String,
    species: String,
    description: String,
    grade: String,
    quantity: String,
    weight: String,
    packdate: String,
    date_recvd: String,
    est: String,
    price: String
});

// Connect the schema to the `freezerinventories` collection
const FreezerModel = mongoose.model("freezerinventories", FreezerSchema);

module.exports = FreezerModel;