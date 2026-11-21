const pool = require("../db");

async function generateActionPlans(cycleId) {
  const atRiskResult = await pool.query(
    `SELECT domain_id, risk_band
     FROM domain_score_cache
     WHERE survey_cycle_id = $1
       AND risk_band IN ('amber', 'red')`,
    [cycleId]
  );

  if (atRiskResult.rows.length === 0) return;

  for (const { domain_id, risk_band } of atRiskResult.rows) {
    const itemsResult = await pool.query(
      `SELECT id FROM action_item
       WHERE domain_id = $1
         AND risk_band_trigger IN ($2, 'both')`,
      [domain_id, risk_band]
    );

    for (const { id: actionItemId } of itemsResult.rows) {
      await pool.query(
        `INSERT INTO company_action_plan
           (survey_cycle_id, action_item_id, status, created_at)
         VALUES ($1, $2, 'open', NOW())
         ON CONFLICT (survey_cycle_id, action_item_id) DO NOTHING`,
        [cycleId, actionItemId]
      );
    }
  }
}

module.exports = { generateActionPlans };
