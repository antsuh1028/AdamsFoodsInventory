const router = require("express").Router();
const HistoryModel = require("../models/History");
const verifyToken = require("../middleware/verifyToken");
const requireRole = require("../middleware/requireRole");

router.post("/addHistory", verifyToken, requireRole("admin", "manager"), (req, res) => {
  const newHistory = {
    time: new Date().toLocaleString(),
    change: req.body.change || "",
    location: req.body.location || "",
    lot: req.body.lot || "",
    vendor: req.body.vendor || "",
    brand: req.body.brand || "",
    species: req.body.species || "",
    description: req.body.description || "",
    grade: req.body.grade || "",
    quantity: String(req.body.quantity || ""),
    weight: String(req.body.weight || ""),
    packdate: req.body.packdate || "",
    date_recvd: req.body.date_recvd || "",
    est: req.body.est || "",
  };

  if (!newHistory.change) return res.status(400).json({ error: "Change type is required" });

  HistoryModel.create(newHistory)
    .then((item) => res.status(201).json(item))
    .catch(() => res.status(500).json({ error: "Error adding history item" }));
});

router.get("/getHistory", verifyToken, requireRole("admin", "manager"), (req, res) => {
  HistoryModel.find()
    .sort({ _id: -1 })
    .limit(50)
    .then((items) => res.json(items))
    .catch(() => res.status(500).json({ error: "Unable to retrieve history" }));
});

module.exports = router;
