// Simulates N respondents completing the seeded survey, then checks
// domain_score_cache directly to prove suppression behaves correctly
// at n<5 and n>=5.
const pool = require("../db");

const BASE = "http://localhost:3000/api/v1";

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  return { status: res.status, body: await res.json() };
}

async function completeOneRespondent(inviteToken, questionIds, answerPattern) {
  const { body: sess } = await fetchJson(`${BASE}/survey/${inviteToken}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const sessionToken = sess.sessionToken;

  for (const qid of questionIds) {
    await fetchJson(`${BASE}/survey/${inviteToken}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, questionId: qid, rawAnswer: answerPattern() }),
    });
  }

  const { body: submitResult } = await fetchJson(`${BASE}/survey/${inviteToken}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
  return submitResult;
}

async function main() {
  const cycleRow = await pool.query("SELECT id, invite_url_token FROM survey_cycle LIMIT 1");
  const { id: cycleId, invite_url_token: inviteToken } = cycleRow.rows[0];

  const { body: questions } = await fetchJson(`${BASE}/survey/${inviteToken}/questions`);
  const questionIds = questions.map(q => q.id);
  console.log(`Cycle ${cycleId}, ${questionIds.length} questions loaded.\n`);

  // Respondents 1-4: answer mid-scale (3s) — should NOT be enough to unsuppress (n<5)
  console.log("--- Submitting 4 respondents ---");
  for (let i = 0; i < 4; i++) {
    const result = await completeOneRespondent(inviteToken, questionIds, () => 3);
    console.log(`Respondent ${i + 1}:`, result);
  }

  await new Promise(r => setTimeout(r, 500)); // let async scoring settle

  let scores = await pool.query(
    `SELECT sd.code, dsc.mean_score, dsc.respondent_count, dsc.risk_band
     FROM domain_score_cache dsc JOIN survey_domain sd ON sd.id = dsc.domain_id
     WHERE dsc.survey_cycle_id = $1 ORDER BY sd.code`,
    [cycleId]
  );
  console.log("\nDomain scores after 4 respondents (expect ALL suppressed, mean_score=null):");
  console.table(scores.rows);

  // 5th respondent pushes every domain over the n=5 threshold
  console.log("--- Submitting 5th respondent ---");
  const result5 = await completeOneRespondent(inviteToken, questionIds, () => 3);
  console.log("Respondent 5:", result5);

  await new Promise(r => setTimeout(r, 500));

  scores = await pool.query(
    `SELECT sd.code, dsc.mean_score, dsc.respondent_count, dsc.risk_band
     FROM domain_score_cache dsc JOIN survey_domain sd ON sd.id = dsc.domain_id
     WHERE dsc.survey_cycle_id = $1 ORDER BY sd.code`,
    [cycleId]
  );
  console.log("\nDomain scores after 5 respondents (expect UNSUPPRESSED, mean_score populated):");
  console.table(scores.rows);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
