const express = require("express");
const pool = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// Verifies a company_action_plan belongs to the requesting admin's company,
// via the survey_cycle it's attached to. Returns the plan row (with company_id)
// or null. This is the enforcement point for every route below — a plan id
// alone is not enough, it must also resolve to the caller's own company.
async function getOwnedPlan(planId, companyId) {
  const result = await pool.query(
    `SELECT cap.*, sc.company_id
     FROM company_action_plan cap
     JOIN survey_cycle sc ON sc.id = cap.survey_cycle_id
     WHERE cap.id = $1 AND sc.company_id = $2`,
    [planId, companyId]
  );
  return result.rows[0] || null;
}

// GET /api/v1/companies/:companyId/cycles/:cycleId/action-plans
router.get("/companies/:companyId/cycles/:cycleId/action-plans", requireAdmin, async (req, res) => {
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
      `SELECT cap.id, cap.status, cap.target_date, cap.evidence_note, cap.completed_at, cap.created_at,
              ai.title, ai.description, ai.delivery_type, ai.risk_band_trigger,
              sd.code AS domain_code,
              au.name AS owner_name
       FROM company_action_plan cap
       JOIN action_item ai ON ai.id = cap.action_item_id
       JOIN survey_domain sd ON sd.id = ai.domain_id
       LEFT JOIN admin_user au ON au.id = cap.owner_admin_id
       WHERE cap.survey_cycle_id = $1
       ORDER BY cap.created_at ASC`,
      [cycleId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("list_action_plans_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// PATCH /api/v1/action-plans/:planId
// Admin accepts/reassigns/sets a target date, or changes status directly
// (e.g. dismissing back to 'open').
router.patch("/action-plans/:planId", requireAdmin, async (req, res) => {
  const { planId } = req.params;
  const { ownerAdminId, targetDate, status } = req.body;

  try {
    const plan = await getOwnedPlan(planId, req.admin.companyId);
    if (!plan) return res.status(404).json({ error: "plan_not_found" });

    if (status && !["open", "in_progress", "completed"].includes(status)) {
      return res.status(400).json({ error: "invalid_status" });
    }

    const result = await pool.query(
      `UPDATE company_action_plan
       SET owner_admin_id = COALESCE($1, owner_admin_id),
           target_date = COALESCE($2, target_date),
           status = COALESCE($3, status)
       WHERE id = $4
       RETURNING id, status, owner_admin_id, target_date`,
      [ownerAdminId || null, targetDate || null, status || null, planId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("update_action_plan_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/v1/action-plans/:planId/assign-training
// Creates training_completion rows for a list of employee ids. Note:
// employee_id/course_id are FKs into 2BeLive's EXISTING employee/LMS
// tables, which live outside this schema — this endpoint doesn't validate
// that an employee_id is real, since this service doesn't own that table.
// The caller (2BeLive's LMS integration layer) is responsible for actually
// enrolling the employee in the course; this just tracks the link back to
// the action plan for completion reporting.
//
// Transactional + idempotent: all rows insert in one statement inside one
// transaction (no partial-batch state if something fails mid-way), and a
// retried/duplicate request skips employees already assigned instead of
// erroring or double-counting them. Requires the unique constraint from
// migration_training_completion_unique.sql on
// (company_id, employee_id, assigned_action_item_id).
router.post("/action-plans/:planId/assign-training", requireAdmin, async (req, res) => {
  const { planId } = req.params;
  const { employeeIds } = req.body;

  if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
    return res.status(400).json({ error: "employeeIds_required" });
  }

  // De-dupe the caller's own input so the same id twice in one request
  // doesn't need special-casing in the report below.
  const uniqueEmployeeIds = [...new Set(employeeIds)];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // getOwnedPlan uses the shared `pool`, not this transaction's client —
    // fine here, it's a read-only ownership check with no side effects to
    // roll back, and it must still enforce tenant isolation before we touch
    // anything.
    const plan = await getOwnedPlan(planId, req.admin.companyId);
    if (!plan) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "plan_not_found" });
    }

    const itemResult = await client.query(
      "SELECT delivery_type, linked_training_id FROM action_item WHERE id = $1",
      [plan.action_item_id]
    );
    const item = itemResult.rows[0];
    if (!item || item.delivery_type !== "on_platform_training") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "not_an_on_platform_training_action" });
    }
    if (!item.linked_training_id) {
      // This action_item hasn't been linked to a real 2BeLive LMS course
      // yet — that's a content-setup gap, not something the caller can fix
      // by retrying, so fail clearly instead of inserting a NULL course_id.
      await client.query("ROLLBACK");
      return res.status(422).json({ error: "action_item_not_linked_to_course" });
    }

    // Single multi-row INSERT instead of N round-trips. ON CONFLICT DO
    // NOTHING relies on the unique constraint on
    // (company_id, employee_id, assigned_action_item_id) — an employee
    // already assigned to this action item is silently skipped, not
    // duplicated and not an error. RETURNING only gives back rows that
    // were actually newly inserted, so we can diff against the input to
    // report what was skipped.
    const values = [];
    const placeholders = uniqueEmployeeIds.map((employeeId, i) => {
      const base = i * 4;
      values.push(req.admin.companyId, employeeId, item.linked_training_id, plan.action_item_id);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });

    const insertResult = await client.query(
      `INSERT INTO training_completion (company_id, employee_id, course_id, assigned_action_item_id)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (company_id, employee_id, assigned_action_item_id) DO NOTHING
       RETURNING id, employee_id`,
      values
    );

    const newlyAssigned = insertResult.rows;
    const newlyAssignedIds = new Set(newlyAssigned.map(r => r.employee_id));
    const alreadyAssignedIds = uniqueEmployeeIds.filter(id => !newlyAssignedIds.has(id));

    // Flip to in_progress regardless of whether this batch was all-new,
    // all-duplicate, or a mix — a duplicate call still means the plan is
    // conceptually in progress. Revisit if you'd rather gate this on
    // newlyAssigned.length > 0.
    await client.query(
      "UPDATE company_action_plan SET status = 'in_progress' WHERE id = $1 AND status = 'open'",
      [planId]
    );

    await client.query("COMMIT");

    res.status(201).json({
      assigned: newlyAssigned.length,
      alreadyAssigned: alreadyAssignedIds.length,
      records: newlyAssigned,
      alreadyAssignedEmployeeIds: alreadyAssignedIds,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("assign_training_error", err);
    res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

// GET /api/v1/action-plans/:planId/completion-status
router.get("/action-plans/:planId/completion-status", requireAdmin, async (req, res) => {
  const { planId } = req.params;

  try {
    const plan = await getOwnedPlan(planId, req.admin.companyId);
    if (!plan) return res.status(404).json({ error: "plan_not_found" });

    const counts = await pool.query(
      `SELECT COUNT(*)::int AS total_assigned,
              COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed_count
       FROM training_completion
       WHERE assigned_action_item_id = $1 AND company_id = $2`,
      [plan.action_item_id, req.admin.companyId]
    );
    const { total_assigned, completed_count } = counts.rows[0];
    const completionRate = total_assigned > 0 ? completed_count / total_assigned : 0;

    res.json({ totalAssigned: total_assigned, completedCount: completed_count, completionRate });
  } catch (err) {
    console.error("completion_status_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// PATCH /api/v1/action-plans/:planId/complete
// For off_platform actions only — records an evidence note as the audit
// trail (this is the NR-1 documentation artifact for actions that aren't
// trainable, e.g. "redistributed workload across 2 new hires").
router.patch("/action-plans/:planId/complete", requireAdmin, async (req, res) => {
  const { planId } = req.params;
  const { evidenceNote } = req.body;

  try {
    const plan = await getOwnedPlan(planId, req.admin.companyId);
    if (!plan) return res.status(404).json({ error: "plan_not_found" });

    const itemResult = await pool.query(
      "SELECT delivery_type FROM action_item WHERE id = $1",
      [plan.action_item_id]
    );
    if (itemResult.rows[0]?.delivery_type !== "off_platform") {
      return res.status(400).json({ error: "not_an_off_platform_action" });
    }

    const result = await pool.query(
      `UPDATE company_action_plan
       SET status = 'completed', completed_at = now(), evidence_note = $1
       WHERE id = $2
       RETURNING id, status, evidence_note, completed_at`,
      [evidenceNote || null, planId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("complete_off_platform_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
