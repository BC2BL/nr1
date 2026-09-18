const pool = require("../db");

// Recomputes domain_score_cache (company-wide) AND domain_score_cache_ghe (per-GHE)
// for one survey_cycle.
// Instrument-aware: filters questions by the cycle's instrument_code.
// Supports 'hse_it' (1–5 scale, domain mean) and 'copsoq_ii' (1–5 scale, domain mean).
// DASS-21 uses a separate scoring function (sum × 2, severity bands) — future roadmap.
async function recomputeDomainScores(surveyCycleId) {
  const cycleResult = await pool.query(
    `SELECT id, question_set_version, target_seat_count,
            min_respondents_for_report,
            COALESCE(instrument_code, 'hse_it') AS instrument_code
     FROM survey_cycle WHERE id = $1`,
    [surveyCycleId]
  );
  if (cycleResult.rows.length === 0) throw new Error("cycle_not_found");
  const cycle = cycleResult.rows[0];

  const completedSessions = await pool.query(
    "SELECT id, ghe_id FROM respondent_session WHERE survey_cycle_id = $1 AND status = 'completed'",
    [surveyCycleId]
  );
  const sessionIds = completedSessions.rows.map(r => r.id);

  // Build a map of sessionId → gheId for per-GHE scoring.
  // Both id and ghe_id are UUIDs (strings) — strict equality works.
  const sessionGheMap = Object.fromEntries(
    completedSessions.rows.map(r => [String(r.id), r.ghe_id ? String(r.ghe_id) : null])
  );

  // Fetch all GHEs for this cycle.
  const ghesResult = await pool.query(
    "SELECT id, name FROM survey_ghe WHERE survey_cycle_id = $1",
    [surveyCycleId]
  );
  const ghes = ghesResult.rows;

  // Domain version matches question_set_version pinned on the cycle.
  // Both HSE-IT v2 and COPSOQ II-Br use question_set_version = 2.
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
    const questionIds = questions.rows.map(q => String(q.id));
    const reverseMap = Object.fromEntries(questions.rows.map(q => [String(q.id), q.is_reverse_scored]));
    const domainQCount = questionIds.length;

    if (questionIds.length === 0 || sessionIds.length === 0) {
      // Write null company-wide cache row so the dashboard always has a row.
      await upsertCompanyScore(surveyCycleId, domain.id, null, 0, 0, null, cycle);
      results.push({ domain: domain.code, meanScore: null, respondentCount: 0, riskBand: null, suppressed: true });
      continue;
    }

    // ------------------------------------------------------------------
    // Fetch all answers for this domain across all completed sessions
    // in one query to avoid N×M round-trips.
    // ------------------------------------------------------------------
    const allAnswers = await pool.query(
      `SELECT rs.id AS session_id, r.question_id, r.raw_answer
       FROM response r
       JOIN respondent_session rs ON rs.id = r.respondent_session_id
       WHERE rs.survey_cycle_id = $1
         AND rs.status = 'completed'
         AND r.question_id = ANY($2)`,
      [surveyCycleId, questionIds]
    );

    // Group answers by session.
    const answersBySession = {};
    for (const row of allAnswers.rows) {
      if (!answersBySession[row.session_id]) answersBySession[row.session_id] = [];
      answersBySession[row.session_id].push(row);
    }

    // ------------------------------------------------------------------
    // Company-wide scoring
    // ------------------------------------------------------------------
    const perRespondentMeans = [];
    for (const sessionId of sessionIds.map(String)) {
      const answers = answersBySession[sessionId] || [];
      const answeredRatio = answers.length / domainQCount;
      if (answeredRatio < 0.8) continue;

      const scored = answers.map(a =>
        reverseMap[a.question_id] ? 6 - a.raw_answer : a.raw_answer
      );
      perRespondentMeans.push(scored.reduce((s, v) => s + v, 0) / scored.length);
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

    await upsertCompanyScore(surveyCycleId, domain.id, meanScore, respondentCount, responseRate, riskBand, cycle);
    results.push({ domain: domain.code, meanScore, respondentCount, riskBand, suppressed: meanScore === null });

    // ------------------------------------------------------------------
    // Per-GHE scoring
    // ------------------------------------------------------------------
    for (const ghe of ghes) {
      const gheSessions = sessionIds.map(String).filter(sid => sessionGheMap[sid] === String(ghe.id));

      const gheMeans = [];
      for (const sessionId of gheSessions) {
        const answers = answersBySession[sessionId] || [];
        const answeredRatio = answers.length / domainQCount;
        if (answeredRatio < 0.8) continue;

        const scored = answers.map(a =>
          reverseMap[a.question_id] ? 6 - a.raw_answer : a.raw_answer
        );
        gheMeans.push(scored.reduce((s, v) => s + v, 0) / scored.length);
      }

      const gheRespondentCount = gheMeans.length;
      const gheResponseRate = gheSessions.length > 0
        ? gheSessions.length / (cycle.target_seat_count || gheSessions.length)
        : 0;

      let gheMeanScore = null;
      let gheRiskBand = null;
      if (gheRespondentCount >= cycle.min_respondents_for_report) {
        gheMeanScore = gheMeans.reduce((s, v) => s + v, 0) / gheRespondentCount;
        gheRiskBand = gheMeanScore >= 3.5 ? "green" : gheMeanScore >= 2.5 ? "amber" : "red";
      }

      await pool.query(
        `INSERT INTO domain_score_cache_ghe
           (survey_cycle_id, domain_id, ghe_id, mean_score, respondent_count, response_rate, risk_band, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (survey_cycle_id, domain_id, ghe_id)
         DO UPDATE SET mean_score = $4, respondent_count = $5, response_rate = $6, risk_band = $7, computed_at = now()`,
        [surveyCycleId, domain.id, ghe.id, gheMeanScore, gheRespondentCount, gheResponseRate, gheRiskBand]
      );
    }
  }

  return results;
}

async function upsertCompanyScore(surveyCycleId, domainId, meanScore, respondentCount, responseRate, riskBand, cycle) {
  await pool.query(
    `INSERT INTO domain_score_cache
       (survey_cycle_id, domain_id, mean_score, respondent_count, response_rate, risk_band, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (survey_cycle_id, domain_id)
     DO UPDATE SET mean_score = $3, respondent_count = $4, response_rate = $5, risk_band = $6, computed_at = now()`,
    [surveyCycleId, domainId, meanScore, respondentCount, responseRate, riskBand]
  );
}

module.exports = { recomputeDomainScores };
