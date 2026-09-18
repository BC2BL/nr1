const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const { recomputeDomainScores } = require("../services/scoring");
const { generateActionPlan } = require("../services/actionPlan");

const router = express.Router();

async function getCycleByToken(inviteUrlToken) {
  const result = await pool.query(
    `SELECT sc.*, c.name AS company_name
     FROM survey_cycle sc
     JOIN company c ON c.id = sc.company_id
     WHERE sc.invite_url_token = $1`,
    [inviteUrlToken]
  );
  return result.rows[0] || null;
}

function hashIp(ip, salt) {
  return crypto.createHash("sha256").update(ip + salt).digest("hex");
}

// GET /api/v1/survey/:token/ghes
// Returns the GHE list for the survey's cycle so the frontend can render the picker.
router.get("/survey/:token/ghes", async (req, res) => {
  const cycle = await getCycleByToken(req.params.token);
  if (!cycle) return res.status(404).json({ error: "survey_not_found" });

  try {
    const result = await pool.query(
      `SELECT id, name, display_order
       FROM survey_ghe
       WHERE survey_cycle_id = $1
       ORDER BY display_order ASC, id ASC`,
      [cycle.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("ghe_list_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/v1/survey/:token/session — create or resume
// Body: { existingToken?, gheId? }
// gheId is required for fresh sessions when the cycle has GHEs defined.
router.post("/survey/:token/session", async (req, res) => {
  const { token } = req.params;
  const { existingToken, gheId } = req.body;

  const cycle = await getCycleByToken(token);
  if (!cycle) return res.status(404).json({ error: "survey_not_found" });

  try {
    if (existingToken) {
      const existing = await pool.query(
        "SELECT * FROM respondent_session WHERE session_token = $1 AND survey_cycle_id = $2",
        [existingToken, cycle.id]
      );
      if (existing.rows.length > 0) {
        const session = existing.rows[0];
        if (session.status === "completed") {
          return res.status(409).json({ error: "already_submitted" });
        }
        await pool.query(
          "UPDATE respondent_session SET last_seen_at = now() WHERE id = $1",
          [session.id]
        );
        const answered = await pool.query(
          "SELECT question_id FROM response WHERE respondent_session_id = $1",
          [session.id]
        );
        return res.json({
          sessionToken: session.session_token,
          status: session.status,
          gheId: session.ghe_id,
          answeredQuestionIds: answered.rows.map(r => r.question_id),
          companyName: cycle.company_name,
        });
      }
    }

    // Validate gheId if provided — must belong to this cycle.
    let resolvedGheId = null;
    if (gheId) {
      const gheCheck = await pool.query(
        "SELECT id FROM survey_ghe WHERE id = $1 AND survey_cycle_id = $2",
        [gheId, cycle.id]
      );
      if (gheCheck.rows.length === 0) {
        return res.status(400).json({ error: "invalid_ghe" });
      }
      resolvedGheId = gheId;
    }

    // Fresh session. ip_hash is salted per-cycle so it can only ever be
    // compared for abuse detection, never reversed back to an IP.
    const newToken = crypto.randomBytes(24).toString("hex");
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const ipHash = hashIp(ip, cycle.id);

    const result = await pool.query(
      `INSERT INTO respondent_session (survey_cycle_id, session_token, ip_hash, status, ghe_id)
       VALUES ($1, $2, $3, 'in_progress', $4)
       RETURNING session_token, status, ghe_id`,
      [cycle.id, newToken, ipHash, resolvedGheId]
    );

    res.status(201).json({
      sessionToken: result.rows[0].session_token,
      status: result.rows[0].status,
      gheId: result.rows[0].ghe_id,
      answeredQuestionIds: [],
      companyName: cycle.company_name,
    });
  } catch (err) {
    console.error("session_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/v1/survey/:token/questions
router.get("/survey/:token/questions", async (req, res) => {
  const cycle = await getCycleByToken(req.params.token);
  if (!cycle) return res.status(404).json({ error: "survey_not_found" });

  // Filter questions by BOTH version (pinned at cycle creation) AND instrument_code
  // so HSE-IT v2 and COPSOQ II-Br questions are never mixed in one survey.
  const result = await pool.query(
    `SELECT sq.id, sq.text_pt, sq.text_en, sq.scale, sq.is_reverse_scored,
            sq.display_order, sd.code AS domain_code
     FROM survey_question sq
     JOIN survey_domain sd ON sd.id = sq.domain_id
     WHERE sq.version          = $1
       AND COALESCE(sq.instrument_code, 'hse_it') = $2
     ORDER BY sq.display_order ASC`,
    [cycle.question_set_version, cycle.instrument_code || 'hse_it']
  );
  res.json(result.rows);
});

// POST /api/v1/survey/:token/answer
router.post("/survey/:token/answer", async (req, res) => {
  const { sessionToken, questionId, rawAnswer } = req.body;
  if (!sessionToken || !questionId || !rawAnswer) {
    return res.status(400).json({ error: "missing_fields" });
  }
  if (rawAnswer < 1 || rawAnswer > 5) {
    return res.status(400).json({ error: "answer_out_of_range" });
  }

  const cycle = await getCycleByToken(req.params.token);
  if (!cycle) return res.status(404).json({ error: "survey_not_found" });

  try {
    const sessionResult = await pool.query(
      "SELECT id, status FROM respondent_session WHERE session_token = $1 AND survey_cycle_id = $2",
      [sessionToken, cycle.id]
    );
    if (sessionResult.rows.length === 0) return res.status(401).json({ error: "invalid_session" });
    const session = sessionResult.rows[0];
    if (session.status !== "in_progress") return res.status(409).json({ error: "session_not_active" });

    await pool.query(
      `INSERT INTO response (respondent_session_id, question_id, raw_answer)
       VALUES ($1, $2, $3)
       ON CONFLICT (respondent_session_id, question_id)
       DO UPDATE SET raw_answer = $3, created_at = now()`,
      [session.id, questionId, rawAnswer]
    );
    await pool.query(
      "UPDATE respondent_session SET last_seen_at = now() WHERE id = $1",
      [session.id]
    );

    res.json({ saved: true });
  } catch (err) {
    console.error("answer_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/v1/survey/:token/submit
// Marks the session completed, recomputes scores, and atomically claims
// a reward code if the pool has one available.
router.post("/survey/:token/submit", async (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken) return res.status(400).json({ error: "missing_session_token" });

  const cycle = await getCycleByToken(req.params.token);
  if (!cycle) return res.status(404).json({ error: "survey_not_found" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      "SELECT id, status FROM respondent_session WHERE session_token = $1 AND survey_cycle_id = $2 FOR UPDATE",
      [sessionToken, cycle.id]
    );
    if (sessionResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "invalid_session" });
    }
    const session = sessionResult.rows[0];
    if (session.status === "completed") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "already_submitted" });
    }

    await client.query(
      "UPDATE respondent_session SET status = 'completed', completed_at = now() WHERE id = $1",
      [session.id]
    );

    // Atomic reward claim: FOR UPDATE SKIP LOCKED prevents two concurrent
    // submits racing for the same code.
    const rewardResult = await client.query(
      `UPDATE reward_code
       SET status = 'issued', issued_to_session_id = $1, issued_at = now()
       WHERE id = (
         SELECT rc.id FROM reward_code rc
         JOIN reward_pool rp ON rp.id = rc.reward_pool_id
         WHERE rp.survey_cycle_id = $2 AND rc.status = 'available'
         LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING code, (SELECT partner_name FROM reward_pool WHERE id = reward_code.reward_pool_id)`,
      [session.id, cycle.id]
    );

    await client.query("COMMIT");

    // Score recompute runs after commit so a slow scoring pass never
    // blocks the respondent's submit confirmation. Action-plan generation
    // chains after scoring, since it reads the freshly computed risk bands.
    recomputeDomainScores(cycle.id)
      .then(() => generateActionPlan(cycle.id))
      .catch(err => console.error("scoring_or_action_plan_error", err));

    const reward = rewardResult.rows[0];
    res.json({
      completed: true,
      rewardCode: reward ? reward.code : null,
      partnerName: reward ? reward.partner_name : null,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("submit_error", err);
    res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

module.exports = router;
