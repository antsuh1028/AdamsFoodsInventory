const mongoose = require('mongoose');

// Define the schema for the user
const AFInventorySchema = new mongoose.Schema({
    username: String,
    password: String
});

// Connect the schema to the `UserDatabase` collection
const UserModel = mongoose.model("UserDatabase", UserSchema);

module.exports = UserModel;
