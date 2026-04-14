const router = require("express").Router();
const pool = require("../utils/pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");

router.post("/addHistory", verifyToken, requireRole("admin", "manager"), async (req, res) => {
  const { change, location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est } = req.body;
  if (!change) return res.status(400).json({ error: "Change type is required" });
  try {
    const result = await pool.query(
      `INSERT INTO history (tenant_id, time, change, changed_by, location, lot, vendor, brand, species, description, grade, quantity, weight, packdate, date_recvd, est)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        req.tenantId, new Date().toLocaleString(), change, req.username || "",
        location || "", lot || "", vendor || "", brand || "", species || "",
        description || "", grade || "", String(quantity || ""), String(weight || ""),
        packdate || "", date_recvd || "", est || "",
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error adding history item" });
  }
});

router.get("/getHistory", verifyToken, requireRole("admin", "manager"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM history WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.tenantId]
    );
    res.json(result.rows.map((r) => ({ ...r, _id: r.id })));
  } catch (err) {
    res.status(500).json({ error: "Unable to retrieve history" });
  }
});

module.exports = router;
