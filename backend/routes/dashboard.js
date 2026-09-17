const express = require("express");
const pool = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/v1/companies/:companyId/cycles/latest
// Returns the admin's own company's most recent survey cycle — the
// dashboard needs this before it can ask for scores, since it only
// knows companyId from the JWT, not a specific cycleId.
router.get("/companies/:companyId/cycles/latest", requireAdmin, async (req, res) => {
  const { companyId } = req.params;
  if (req.admin.companyId !== companyId) {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    const result = await pool.query(
      `SELECT sc.id, sc.title, sc.status, sc.target_seat_count, sc.invite_url_token,
              sc.opens_at, sc.closes_at, c.name AS company_name
       FROM survey_cycle sc
       JOIN company c ON c.id = sc.company_id
       WHERE sc.company_id = $1
       ORDER BY sc.created_at DESC
       LIMIT 1`,
      [companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "no_cycle_found" });
    }

    const cycle = result.rows[0];
    const completedResult = await pool.query(
      "SELECT COUNT(*)::int AS completed FROM respondent_session WHERE survey_cycle_id = $1 AND status = 'completed'",
      [cycle.id]
    );

    res.json({
      id: cycle.id,
      title: cycle.title,
      status: cycle.status,
      companyName: cycle.company_name,
      targetSeatCount: cycle.target_seat_count,
      completedCount: completedResult.rows[0].completed,
      responseRate: cycle.target_seat_count > 0
        ? completedResult.rows[0].completed / cycle.target_seat_count
        : 0,
      inviteUrlToken: cycle.invite_url_token,
    });
  } catch (err) {
    console.error("latest_cycle_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/v1/companies/:companyId/cycles/:cycleId/scores
// Every query here filters by req.admin.companyId, not just the URL param —
// this is the enforcement point that stops one company's admin from ever
// reading another company's domain_score_cache by guessing a cycle id.
router.get("/companies/:companyId/cycles/:cycleId/scores", requireAdmin, async (req, res) => {
  const { companyId, cycleId } = req.params;

  if (req.admin.companyId !== companyId) {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    const cycleCheck = await pool.query(
      "SELECT id FROM survey_cycle WHERE id = $1 AND company_id = $2",
      [cycleId, companyId]
    );
    if (cycleCheck.rows.length === 0) {
      return res.status(404).json({ error: "cycle_not_found" });
    }

    const result = await pool.query(
      `SELECT sd.code AS domain_code, dsc.mean_score, dsc.respondent_count,
              dsc.response_rate, dsc.risk_band
       FROM domain_score_cache dsc
       JOIN survey_domain sd ON sd.id = dsc.domain_id
       WHERE dsc.survey_cycle_id = $1
       ORDER BY sd.code`,
      [cycleId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("dashboard_scores_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/v1/companies/:companyId/cycles/:cycleId/reward-pool/status
router.get("/companies/:companyId/cycles/:cycleId/reward-pool/status", requireAdmin, async (req, res) => {
  const { companyId, cycleId } = req.params;
  if (req.admin.companyId !== companyId) {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    const cycleCheck = await pool.query(
      "SELECT id FROM survey_cycle WHERE id = $1 AND company_id = $2",
      [cycleId, companyId]
    );
    if (cycleCheck.rows.length === 0) {
      return res.status(404).json({ error: "cycle_not_found" });
    }

    const poolResult = await pool.query(
      "SELECT id, partner_name FROM reward_pool WHERE survey_cycle_id = $1 LIMIT 1",
      [cycleId]
    );
    if (poolResult.rows.length === 0) {
      return res.json({ exists: false });
    }
    const rewardPool = poolResult.rows[0];

    const counts = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status != 'available')::int AS issued
       FROM reward_code WHERE reward_pool_id = $1`,
      [rewardPool.id]
    );

    res.json({
      exists: true,
      partnerName: rewardPool.partner_name,
      total: counts.rows[0].total,
      issued: counts.rows[0].issued,
      remaining: counts.rows[0].total - counts.rows[0].issued,
    });
  } catch (err) {
    console.error("reward_pool_status_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
