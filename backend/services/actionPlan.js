/**
 * actionPlan.js — Action plan generation service
 *
 * Called async after scoring completes (never on the request path).
 *
 * Logic:
 *   1. Load the cycle's domain scores from domain_score_cache.
 *   2. For each domain with risk_band 'amber' or 'red', find matching action_items.
 *   3. Upsert into company_action_plan (ON CONFLICT DO NOTHING — idempotent).
 *
 * This means re-running generateActionPlans for a cycle is always safe.
 */

const db = require("../db");

/**
 * Generate (or refresh) action plans for a completed survey cycle.
 * @param {string} cycleId  UUID of the survey_cycle
 */
async function generateActionPlans(cycleId) {
  try {
    // ── 1. Load cycle metadata ───────────────────────────────────────────────
    const cycleRes = await db.query(
      `SELECT id, company_id, instrument_code, min_respondents_for_report
         FROM survey_cycle
        WHERE id = $1`,
      [cycleId]
    );
    if (cycleRes.rowCount === 0) {
      console.warn(`[actionPlan] cycle ${cycleId} not found`);
      return;
    }
    const cycle = cycleRes.rows[0];

    // ── 2. Load domain scores that need action (amber or red, not suppressed) ─
    const scoresRes = await db.query(
      `SELECT dsc.domain_id, dsc.risk_band, sd.code AS domain_code
         FROM domain_score_cache dsc
         JOIN survey_domain sd ON sd.id = dsc.domain_id
        WHERE dsc.survey_cycle_id = $1
          AND dsc.risk_band IN ('amber', 'red')
          AND dsc.respondent_count >= $2
          AND dsc.mean_score IS NOT NULL`,
      [cycleId, cycle.min_respondents_for_report]
    );

    if (scoresRes.rowCount === 0) {
      console.log(`[actionPlan] cycle ${cycleId}: no amber/red domains — no plans generated`);
      return;
    }

    // ── 3. For each at-risk domain, find matching action_items ───────────────
    let totalInserted = 0;

    for (const score of scoresRes.rows) {
      // Fetch action items for this domain/band combination.
      // 'red' band uses both 'red' and 'amber' triggers; 'amber' uses only 'amber'.
      const bandFilter = score.risk_band === "red"
        ? ["amber", "red"]
        : ["amber"];

      const itemsRes = await db.query(
        `SELECT id, title, description, delivery_type, linked_training_id
           FROM action_item
          WHERE domain_id = $1
            AND risk_band_trigger = ANY($2::text[])
            AND active = true
          ORDER BY risk_band_trigger DESC, title`,
        [score.domain_id, bandFilter]
      );

      if (itemsRes.rowCount === 0) continue;

      // ── 4. Upsert plans (idempotent) ─────────────────────────────────────
      for (const item of itemsRes.rows) {
        await db.query(
          `INSERT INTO company_action_plan
             (id, survey_cycle_id, action_item_id, status, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'open', NOW())
           ON CONFLICT DO NOTHING`,
          [cycleId, item.id]
        );
        totalInserted++;
      }
    }

    console.log(`[actionPlan] cycle ${cycleId}: upserted ${totalInserted} plan rows`);
  } catch (err) {
    console.error(`[actionPlan] generateActionPlans error for cycle ${cycleId}:`, err);
    // Never rethrow — this runs async after commit, errors must not bubble up
  }
}

module.exports = { generateActionPlans };
