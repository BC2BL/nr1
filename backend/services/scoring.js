const pool = require("../db");

// Recomputes domain_score_cache for one survey_cycle.
// Mirrors §2 of api-workflow-spec.md: reverse-scoring, 80% per-domain
// completion threshold per respondent, and suppression below min_respondents_for_report.
async function recomputeDomainScores(surveyCycleId) {
  const cycleResult = await pool.query(
    "SELECT id, question_set_version, target_seat_count, min_respondents_for_report FROM survey_cycle WHERE id = $1",
    [surveyCycleId]
  );
  if (cycleResult.rows.length === 0) throw new Error("cycle_not_found");
  const cycle = cycleResult.rows[0];

  const completedSessions = await pool.query(
    "SELECT id FROM respondent_session WHERE survey_cycle_id = $1 AND status = 'completed'",
    [surveyCycleId]
  );
  const sessionIds = completedSessions.rows.map(r => r.id);

  const domains = await pool.query(
    "SELECT id, code FROM survey_domain WHERE version = $1",
    [cycle.question_set_version]
  );

  const results = [];

  for (const domain of domains.rows) {
    const questions = await pool.query(
      "SELECT id, is_reverse_scored FROM survey_question WHERE domain_id = $1 AND version = $2",
      [domain.id, cycle.question_set_version]
    );
    const questionIds = questions.rows.map(q => q.id);
    const reverseMap = Object.fromEntries(questions.rows.map(q => [q.id, q.is_reverse_scored]));
    const domainQCount = questionIds.length;

    const perRespondentMeans = [];

    if (questionIds.length > 0 && sessionIds.length > 0) {
      for (const sessionId of sessionIds) {
        const answers = await pool.query(
          "SELECT question_id, raw_answer FROM response WHERE respondent_session_id = $1 AND question_id = ANY($2)",
          [sessionId, questionIds]
        );
        const answeredRatio = answers.rows.length / domainQCount;
        if (answeredRatio < 0.8) continue;

        const scored = answers.rows.map(a =>
          reverseMap[a.question_id] ? 6 - a.raw_answer : a.raw_answer
        );
        const mean = scored.reduce((s, v) => s + v, 0) / scored.length;
        perRespondentMeans.push(mean);
      }
    }

    const respondentCount = perRespondentMeans.length;
    const responseRate = cycle.target_seat_count > 0
      ? sessionIds.length / cycle.target_seat_count
      : 0;

    let meanScore = null;
    let riskBand = null;
    if (respondentCount >= cycle.min_respondents_for_report) {
      meanScore = perRespondentMeans.reduce((s, v) => s + v, 0) / respondentCount;
      riskBand = meanScore >= 3.5 ? "green" : meanScore >= 2.5 ? "amber" : "red";
    }

    await pool.query(
      `INSERT INTO domain_score_cache
         (survey_cycle_id, domain_id, mean_score, respondent_count, response_rate, risk_band, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (survey_cycle_id, domain_id)
       DO UPDATE SET mean_score = $3, respondent_count = $4, response_rate = $5, risk_band = $6, computed_at = now()`,
      [surveyCycleId, domain.id, meanScore, respondentCount, responseRate, riskBand]
    );

    results.push({ domain: domain.code, meanScore, respondentCount, riskBand, suppressed: meanScore === null });
  }

  return results;
}

module.exports = { recomputeDomainScores };
