/**
 * services/actionPlan.js
 *
 * Generates company_action_plan rows for a survey cycle after scoring runs.
 *
 * Logic:
 *   1. Load all domain_score_cache rows for the cycle that are amber or red.
 *   2. For each at-risk domain, find matching action_item rows
 *      (risk_band_trigger IN ('amber','red','both') AND domain_id matches).
 *   3. Upsert into company_action_plan — ON CONFLICT DO NOTHING so re-runs
 *      after additional submissions don't duplicate or overwrite existing plans.
 */

const pool = require("../db");

async function generateActionPlans(cycleId) {
  // 1. Find domains that are amber or red for this cycle
  const atRiskResult = await pool.query(
    `SELECT domain_id, risk_band
     FROM domain_score_cache
     WHERE survey_cycle_id = $1
       AND risk_band IN ('amber', 'red')`,
    [cycleId]
  );

  if (atRiskResult.rows.length === 0) return; // All green — nothing to do

  for (const { domain_id, risk_band } of atRiskResult.rows) {
    // 2. Find action items that apply to this domain and risk level
    const itemsResult = await pool.query(
      `SELECT id FROM action_item
       WHERE domain_id = $1
         AND risk_band_trigger IN ($2, 'both')`,
      [domain_id, risk_band]
    );

    for (const { id: actionItemId } of itemsResult.rows) {
      // 3. Insert — skip silently if already exists
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
