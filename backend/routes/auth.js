const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// POST /api/v1/companies/signup
// Creates company, admin_user, and an initial survey_cycle with an
// opaque (non-guessable) invite_url_token.
router.post("/companies/signup", async (req, res) => {
  const { companyName, cnpj, adminName, adminEmail, password, seats } = req.body;

  if (!companyName || !adminName || !adminEmail || !password || !seats) {
    return res.status(400).json({ error: "missing_required_fields" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password_too_short" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingAdmin = await client.query(
      "SELECT id FROM admin_user WHERE email = $1",
      [adminEmail]
    );
    if (existingAdmin.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "email_already_registered" });
    }

    const companyResult = await client.query(
      `INSERT INTO company (name, cnpj, plan_seats, status)
       VALUES ($1, $2, $3, 'trial')
       RETURNING id, name, created_at`,
      [companyName, cnpj || null, seats]
    );
    const company = companyResult.rows[0];

    const passwordHash = await bcrypt.hash(password, 12);
    const adminResult = await client.query(
      `INSERT INTO admin_user (company_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'owner')
       RETURNING id, name, email, role`,
      [company.id, adminName, adminEmail, passwordHash]
    );
    const admin = adminResult.rows[0];

    // Opaque token: NOT derived from company name (a guessable slug would
    // leak which companies are running surveys and let outsiders probe URLs).
    const inviteToken = `${slugify(companyName)}-${crypto.randomBytes(6).toString("hex")}`;

    const cycleResult = await client.query(
      `INSERT INTO survey_cycle
         (company_id, title, question_set_version, status, invite_url_token, target_seat_count)
       VALUES ($1, $2, 2, 'draft', $3, $4)
       RETURNING id, invite_url_token, status`,
      [company.id, `${companyName} — Ciclo 1`, inviteToken, seats]
    );
    const cycle = cycleResult.rows[0];

    await client.query("COMMIT");

    const token = jwt.sign(
      { adminId: admin.id, companyId: company.id, role: admin.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email },
      company: { id: company.id, name: company.name },
      surveyCycle: { id: cycle.id, inviteUrlToken: cycle.invite_url_token, status: cycle.status },
      surveyUrl: `https://bc2bl.github.io/nr1/frontend/employee-survey.html?survey=${cycle.invite_url_token}`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("signup_error", err);
    res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

// POST /api/v1/auth/login
router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "missing_credentials" });
  }

  try {
    const result = await pool.query(
      "SELECT id, company_id, name, email, password_hash, role FROM admin_user WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const token = jwt.sign(
      { adminId: admin.id, companyId: admin.company_id, role: admin.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      companyId: admin.company_id,
    });
  } catch (err) {
    console.error("login_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
