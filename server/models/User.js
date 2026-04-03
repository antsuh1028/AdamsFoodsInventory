const mongoose = require('mongoose');

// Define the schema for the user
const UserSchema = new mongoose.Schema({
    username: String,
    password: String
});

// Connect the schema to the `UserDatabase` collection
const UserModel = mongoose.model("userdatabases", UserSchema);

module.exports = UserModel;
