require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());
app.options("*", cors());

mongoose
  .connect(process.env.MONGO_DB_URI)
  .then(() => console.log("Connected to MongoDB Atlas"))
  .catch((err) => console.error("Connection error", err));

app.use("/", require("./routes/auth"));
app.use("/", require("./routes/inventory"));
app.use("/", require("./routes/history"));
app.use("/", require("./routes/s3"));
app.use("/", require("./routes/scanner"));

app.listen(3001, () => console.log("Server is running on port 3001"));
