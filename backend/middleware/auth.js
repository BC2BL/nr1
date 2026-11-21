const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const pool = require("../db");

// ── Email transport ──────────────────────────────────────────────────────────
// Configure via environment variables on Render:
//   EMAIL_HOST     e.g. smtp.gmail.com
//   EMAIL_PORT     e.g. 587
//   EMAIL_USER     your sending address
//   EMAIL_PASS     app password / API key
//   EMAIL_FROM     display name + address, e.g. "NR-1 · 2BeLive <no-reply@2blnr1.com>"
const mailer = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
const EMAIL_FROM = process.env.EMAIL_FROM || "NR-1 · 2BeLive <no-reply@2blnr1.com>";
const APP_URL    = process.env.APP_URL    || "https://2blnr1.com";

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

    // question_set_version=2 → Brazilian-adapted HSE-IT bank (seed_hse_it_brasil_v2.sql)
    // instrument_code → chosen during signup wizard (defaults to 'hse_it')
    const instrumentCode = req.body.instrumentCode || 'hse_it';
    const cycleResult = await client.query(
      `INSERT INTO survey_cycle
         (company_id, title, question_set_version, status, invite_url_token,
          target_seat_count, instrument_code)
       VALUES ($1, $2, 2, 'draft', $3, $4, $5)
       RETURNING id, invite_url_token, status, instrument_code`,
      [company.id, `${companyName} — Ciclo 1`, inviteToken, seats, instrumentCode]
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
      surveyUrl: `https://2blnr1.com/frontend/employee-survey.html?survey=${cycle.invite_url_token}`,
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

// POST /api/v1/auth/forgot-password
// Generates a one-time reset token (valid 1 hour), saves it, and emails a link.
// Always returns 200 so attackers can't enumerate registered emails.
router.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email_required" });

  try {
    const result = await pool.query(
      "SELECT id, name FROM admin_user WHERE email = $1",
      [email.toLowerCase().trim()]
    );

    if (result.rows.length > 0) {
      const admin = result.rows[0];
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Invalidate any existing tokens for this user, then insert new one
      await pool.query(
        "DELETE FROM password_reset_token WHERE admin_user_id = $1",
        [admin.id]
      );
      await pool.query(
        `INSERT INTO password_reset_token (token, admin_user_id, expires_at)
         VALUES ($1, $2, $3)`,
        [token, admin.id, expiresAt]
      );

      const resetUrl = `${APP_URL}/frontend/admin-dashboard.html?reset_token=${token}`;

      await mailer.sendMail({
        from: EMAIL_FROM,
        to: email,
        subject: "Redefinição de senha — NR-1 2BeLive",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <h2 style="color:#304269">Redefinição de senha</h2>
            <p>Olá, ${admin.name}.</p>
            <p>Clique no botão abaixo para redefinir sua senha. O link é válido por <strong>1 hora</strong>.</p>
            <p style="margin:28px 0">
              <a href="${resetUrl}"
                 style="background:#eb6025;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
                Redefinir senha
              </a>
            </p>
            <p style="font-size:12px;color:#888">Se você não solicitou isso, ignore este e-mail.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
            <p style="font-size:11px;color:#aaa">NR-1 Diagnóstico Psicossocial · 2BeLive</p>
          </div>`,
        text: `Acesse o link para redefinir sua senha (válido por 1 hora):\n${resetUrl}\n\nSe você não solicitou isso, ignore este e-mail.`,
      });
    }

    // Always 200 — don't reveal whether the email exists
    res.json({ ok: true });
  } catch (err) {
    console.error("forgot_password_error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/v1/auth/reset-password
// Validates the token and sets a new password.
router.post("/auth/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: "missing_fields" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password_too_short" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tokenResult = await client.query(
      `SELECT prt.id, prt.admin_user_id, prt.expires_at
       FROM password_reset_token prt
       WHERE prt.token = $1
         AND prt.used_at IS NULL
         AND prt.expires_at > NOW()
       FOR UPDATE`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }

    const { id: tokenId, admin_user_id } = tokenResult.rows[0];
    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      "UPDATE admin_user SET password_hash = $1 WHERE id = $2",
      [passwordHash, admin_user_id]
    );

    // Mark token used (keeps audit trail)
    await client.query(
      "UPDATE password_reset_token SET used_at = NOW() WHERE id = $1",
      [tokenId]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("reset_password_error", err);
    res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

module.exports = router;
