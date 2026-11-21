/**
 * actionPlans.js — Action plan CRUD routes
 *
 * Routes:
 *   GET  /api/v1/companies/:companyId/cycles/:cycleId/action-plans
 *   PATCH /api/v1/companies/:companyId/cycles/:cycleId/action-plans/:planId
 *
 * The GET endpoint joins company_action_plan → action_item → survey_domain
 * so the response includes delivery_type, domain_code, title, description, etc.
 */

const express = require("express");
const router  = express.Router();
const db      = require("../db");
const { requireAdmin } = require("../middleware/auth");

// ─── GET /api/v1/companies/:companyId/cycles/:cycleId/action-plans ───────────
//
// Returns all action plan items for the given cycle, joined with action_item
// and survey_domain so callers get the full payload (including delivery_type).
//
router.get(
  "/companies/:companyId/cycles/:cycleId/action-plans",
  requireAdmin,
  async (req, res) => {
    const { companyId, cycleId } = req.params;

    try {
      // Verify the cycle belongs to this company (ownership check)
      const cycleCheck = await db.query(
        `SELECT id FROM survey_cycle WHERE id = $1 AND company_id = $2`,
        [cycleId, companyId]
      );
      if (cycleCheck.rowCount === 0) {
        return res.status(404).json({ error: "cycle_not_found" });
      }

      // Join company_action_plan → action_item → survey_domain
      const result = await db.query(
        `SELECT
           cap.id,
           cap.survey_cycle_id,
           cap.action_item_id,
           cap.status,
           cap.owner_admin_id,
           cap.target_date,
           cap.evidence_note,
           cap.completed_at,
           cap.created_at,
           ai.title,
           ai.description,
           ai.delivery_type,
           ai.risk_band_trigger,
           ai.linked_training_id,
           sd.code    AS domain_code,
           sd.label_pt AS domain_label
         FROM company_action_plan cap
         JOIN action_item   ai  ON ai.id  = cap.action_item_id
         JOIN survey_domain sd  ON sd.id  = ai.domain_id
         WHERE cap.survey_cycle_id = $1
         ORDER BY sd.code, ai.risk_band_trigger, cap.created_at`,
        [cycleId]
      );

      res.json({ actionPlans: result.rows });
    } catch (err) {
      console.error("GET action-plans error:", err);
      res.status(500).json({ error: "server_error" });
    }
  }
);

// ─── POST /api/v1/companies/:companyId/cycles/:cycleId/action-plans/:planId/assign-training ─
//
// Bulk-assign a training course to a list of employees for a given plan.
// Uses a single transactional INSERT ... ON CONFLICT DO NOTHING to prevent
// double-assignment on retry and leave consistent state on partial failure.
//
// Body: { employeeIds: [uuid, ...], courseId: uuid }
//
router.post(
  "/companies/:companyId/cycles/:cycleId/action-plans/:planId/assign-training",
  requireAdmin,
  async (req, res) => {
    const { companyId, cycleId, planId } = req.params;
    const { employeeIds, courseId } = req.body;

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: "employee_ids_required" });
    }
    if (!courseId) {
      return res.status(400).json({ error: "course_id_required" });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Verify plan belongs to this cycle/company
      const planCheck = await client.query(
        `SELECT cap.id, cap.action_item_id
           FROM company_action_plan cap
           JOIN survey_cycle sc ON sc.id = cap.survey_cycle_id
          WHERE cap.id = $1
            AND cap.survey_cycle_id = $2
            AND sc.company_id = $3`,
        [planId, cycleId, companyId]
      );
      if (planCheck.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "plan_not_found" });
      }
      const actionItemId = planCheck.rows[0].action_item_id;

      // Bulk insert — one statement, ON CONFLICT DO NOTHING (idempotent)
      // Build VALUES list: ($1,$2,$3,$4), ($1,$5,$3,$4), ...
      const baseParams = [companyId, courseId, actionItemId];
      const valueClauses = employeeIds.map((_, i) => {
        const empIdx = baseParams.length + i + 1;
        return `(gen_random_uuid(), $1, $${empIdx}, $2, $3, NOW())`;
      });
      const allParams = [...baseParams, ...employeeIds];

      await client.query(
        `INSERT INTO training_completion
           (id, company_id, employee_id, course_id, assigned_action_item_id, created_at)
         VALUES ${valueClauses.join(", ")}
         ON CONFLICT (company_id, employee_id, assigned_action_item_id) DO NOTHING`,
        allParams
      );

      await client.query("COMMIT");
      res.json({ assigned: employeeIds.length });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("assign-training error:", err);
      res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  }
);

// ─── PATCH /api/v1/companies/:companyId/cycles/:cycleId/action-plans/:planId ─
//
// Update a plan's status, owner, target_date, or evidence_note.
// Allowed status transitions: open → in_progress → completed
//
router.patch(
  "/companies/:companyId/cycles/:cycleId/action-plans/:planId",
  requireAdmin,
  async (req, res) => {
    const { companyId, cycleId, planId } = req.params;
    const { status, owner_admin_id, target_date, evidence_note } = req.body;

    const VALID_STATUSES = ["open", "in_progress", "completed"];
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "invalid_status" });
    }

    try {
      // Ownership check — cycle must belong to company
      const cycleCheck = await db.query(
        `SELECT id FROM survey_cycle WHERE id = $1 AND company_id = $2`,
        [cycleId, companyId]
      );
      if (cycleCheck.rowCount === 0) {
        return res.status(404).json({ error: "cycle_not_found" });
      }

      // Build SET clause dynamically from provided fields
      const fields  = [];
      const values  = [];
      let   idx     = 1;

      if (status !== undefined) {
        fields.push(`status = $${idx++}`);
        values.push(status);
        if (status === "completed") {
          fields.push(`completed_at = NOW()`);
        }
      }
      if (owner_admin_id !== undefined) {
        fields.push(`owner_admin_id = $${idx++}`);
        values.push(owner_admin_id || null);
      }
      if (target_date !== undefined) {
        fields.push(`target_date = $${idx++}`);
        values.push(target_date || null);
      }
      if (evidence_note !== undefined) {
        fields.push(`evidence_note = $${idx++}`);
        values.push(evidence_note);
      }

      if (fields.length === 0) {
        return res.status(400).json({ error: "no_fields_to_update" });
      }

      values.push(planId, cycleId);
      const updateSQL = `
        UPDATE company_action_plan
           SET ${fields.join(", ")}
         WHERE id = $${idx++}
           AND survey_cycle_id = $${idx}
        RETURNING *`;

      const result = await db.query(updateSQL, values);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "plan_not_found" });
      }

      res.json({ actionPlan: result.rows[0] });
    } catch (err) {
      console.error("PATCH action-plans error:", err);
      res.status(500).json({ error: "server_error" });
    }
  }
);

// ─── PATCH /api/v1/action-plans/:planId/complete ─────────────────────────────
//
// Shorthand route called by admin-dashboard.html's saveEvidence().
// Marks a plan completed and saves the evidence note.
// Body: { evidenceNote: string }   (camelCase — matches what the dashboard sends)
//
router.patch(
  "/action-plans/:planId/complete",
  requireAdmin,
  async (req, res) => {
    const { planId } = req.params;
    const evidenceNote = req.body.evidenceNote ?? req.body.evidence_note ?? "";

    try {
      const result = await db.query(
        `UPDATE company_action_plan
            SET status       = 'completed',
                evidence_note = $1,
                completed_at  = NOW()
          WHERE id = $2
         RETURNING *`,
        [evidenceNote, planId]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "plan_not_found" });
      }
      res.json({ actionPlan: result.rows[0] });
    } catch (err) {
      console.error("PATCH action-plans/complete error:", err);
      res.status(500).json({ error: "server_error" });
    }
  }
);

module.exports = router;
