const pool = require("../db");

// Runs after score recomputation. For every domain that landed in amber or
// red, find matching active action_item rows and create a company_action_plan
// if one doesn't already exist for that (cycle, action_item) pair. Idempotent —
// safe to call again after a late submission recomputes scores.
async function generateActionPlan(surveyCycleId) {
  const scoreRows = await pool.query(
    `SELECT domain_id, risk_band FROM domain_score_cache
     WHERE survey_cycle_id = $1 AND risk_band IN ('amber', 'red')`,
    [surveyCycleId]
  );

  let created = 0;
  for (const row of scoreRows.rows) {
    const matchingItems = await pool.query(
      `SELECT id FROM action_item
       WHERE domain_id = $1 AND risk_band_trigger = $2 AND active = true`,
      [row.domain_id, row.risk_band]
    );

    for (const item of matchingItems.rows) {
      const existing = await pool.query(
        `SELECT id FROM company_action_plan
         WHERE survey_cycle_id = $1 AND action_item_id = $2`,
        [surveyCycleId, item.id]
      );
      if (existing.rows.length > 0) continue;

      await pool.query(
        `INSERT INTO company_action_plan (survey_cycle_id, action_item_id, status)
         VALUES ($1, $2, 'open')`,
        [surveyCycleId, item.id]
      );
      created++;
    }
  }
  return created;
}

module.exports = { generateActionPlan };
