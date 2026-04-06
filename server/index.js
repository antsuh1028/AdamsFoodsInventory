require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const allowedOrigins = [process.env.ALLOWED_ORIGIN, "http://localhost:3000"].filter(Boolean);
const corsOptions = { origin: allowedOrigins };

app.use(express.json());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

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
