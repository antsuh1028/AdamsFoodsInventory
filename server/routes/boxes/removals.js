// The removal history: voided boxes, deleted sessions and unmerged manifests.

const router = require("express").Router();
const pool = require("../../utils/pg");
const verifyToken = require("../../middleware/verifyToken.pg");

// Everything that has been taken off a tally, newest first.
router.get("/box-removals", verifyToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const batchId = req.query.batchId ? Number(req.query.batchId) : null;
  if (req.query.batchId && !Number.isInteger(batchId)) {
    return res.status(400).json({ error: "Invalid batch id" });
  }

  try {
    const result = await pool.query(
      `SELECT id, action, batch_id, item_id, lot_number, summary, reason,
              details, performed_by, created_at
         FROM box_removal_history
        WHERE tenant_id = $1
          AND ($2::int IS NULL OR batch_id = $2)
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [req.tenantId, batchId, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("list box removals:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
