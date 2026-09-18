const express = require("express");
const pool    = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// All GHE routes require a valid admin JWT.

// GET /api/v1/cycles/:cycleId/ghes
// Returns the GHE list for a cycle (ordered by display_order).
router.get("/cycles/:cycleId/ghes", requireAdmin, async (req, res) => {
  const { cycleId } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, name, display_order
       FROM survey_ghe
       WHERE survey_cycle_id = $1
       ORDER BY display_order ASC, id ASC`,
      [cycleId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("ghe_list_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/v1/cycles/:cycleId/ghes
// Create a new GHE for a cycle.
// Body: { name: "Operações" }
router.post("/cycles/:cycleId/ghes", requireAdmin, async (req, res) => {
  const { cycleId } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name_required" });
  }

  try {
    // display_order = current max + 1
    const orderResult = await pool.query(
      "SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM survey_ghe WHERE survey_cycle_id = $1",
      [cycleId]
    );
    const nextOrder = orderResult.rows[0].next_order;

    const result = await pool.query(
      `INSERT INTO survey_ghe (survey_cycle_id, name, display_order)
       VALUES ($1, $2, $3)
       RETURNING id, name, display_order`,
      [cycleId, name.trim(), nextOrder]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "ghe_name_exists" });
    }
    console.error("ghe_create_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// PATCH /api/v1/cycles/:cycleId/ghes/:gheId
// Rename a GHE.
// Body: { name: "Administrativo" }
router.patch("/cycles/:cycleId/ghes/:gheId", requireAdmin, async (req, res) => {
  const { cycleId, gheId } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name_required" });
  }

  try {
    const result = await pool.query(
      `UPDATE survey_ghe
       SET name = $1
       WHERE id = $2 AND survey_cycle_id = $3
       RETURNING id, name, display_order`,
      [name.trim(), gheId, cycleId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "ghe_not_found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "ghe_name_exists" });
    }
    console.error("ghe_update_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// DELETE /api/v1/cycles/:cycleId/ghes/:gheId
// Delete a GHE. Blocked if any sessions are already assigned to it.
router.delete("/cycles/:cycleId/ghes/:gheId", requireAdmin, async (req, res) => {
  const { cycleId, gheId } = req.params;
  try {
    const inUse = await pool.query(
      "SELECT 1 FROM respondent_session WHERE ghe_id = $1 LIMIT 1",
      [gheId]
    );
    if (inUse.rows.length > 0) {
      return res.status(409).json({ error: "ghe_has_responses" });
    }

    const result = await pool.query(
      "DELETE FROM survey_ghe WHERE id = $1 AND survey_cycle_id = $2 RETURNING id",
      [gheId, cycleId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "ghe_not_found" });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error("ghe_delete_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
