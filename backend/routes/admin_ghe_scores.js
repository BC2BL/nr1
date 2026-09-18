// Snippet to add to backend/routes/admin.js (or wherever cycle admin routes live)
// GET /api/v1/cycles/:cycleId/ghe-scores
// Returns per-GHE domain scores keyed by domain code.
// Response shape: { demands: [{ghe_id, ghe_name, mean_score, respondent_count, risk_band}], control: [...], ... }

const express = require("express");
const pool    = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/cycles/:cycleId/ghe-scores", requireAdmin, async (req, res) => {
  const { cycleId } = req.params;
  try {
    const result = await pool.query(
      `SELECT sd.code      AS domain_code,
              sg.id        AS ghe_id,
              sg.name      AS ghe_name,
              dsg.mean_score,
              dsg.respondent_count,
              dsg.risk_band
       FROM domain_score_cache_ghe dsg
       JOIN survey_domain sd  ON sd.id  = dsg.domain_id
       JOIN survey_ghe    sg  ON sg.id  = dsg.ghe_id
       WHERE dsg.survey_cycle_id = $1
       ORDER BY sd.code ASC, sg.display_order ASC, sg.id ASC`,
      [cycleId]
    );

    // Group by domain code
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.domain_code]) grouped[row.domain_code] = [];
      grouped[row.domain_code].push({
        ghe_id:          row.ghe_id,
        ghe_name:        row.ghe_name,
        mean_score:      row.mean_score,
        respondent_count: row.respondent_count,
        risk_band:       row.risk_band,
      });
    }

    res.json(grouped);
  } catch (err) {
    console.error("ghe_scores_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
