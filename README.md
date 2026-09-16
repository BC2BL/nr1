# 2BeLive · NR-1 Psychosocial Diagnostic Platform

A compliance and learning tool for Brazilian companies to meet the NR-1 (GRO)
psychosocial risk obligations under Portaria MTE 1.416/2024.

**Enforcement date: 26 May 2026.**

---

## What it does

1. **Company signs up** — creates an account, gets a shareable anonymous survey URL
2. **Employees take the survey** — 32-question anonymous psychosocial assessment (bilingual PT/EN UI; questions currently PT only)
3. **Admin sees the diagnostic** — 6-domain report with green/amber/red risk bands, auto-generated action plans, training assignments, and compliance evidence for NR-1 audits

The three phases map to 2BeLive's **Learn → Prove → Grow** framework.

---

## Repository structure

```
nr1-platform/
├── frontend/                  # Standalone HTML files — no build step required
│   ├── company-signup.html    # Company registration + shareable URL generation
│   ├── employee-survey.html   # Employee-facing anonymous survey (32 questions, PT/EN)
│   ├── admin-dashboard.html   # Admin login, diagnostic report, action plans
│   └── super-admin.html       # 2BeLive internal view (UI complete, backend TBD)
│
├── backend/                   # Node.js + Express API
│   ├── server.js              # Entry point — registers all routes
│   ├── db.js                  # PostgreSQL connection pool
│   ├── routes/
│   │   ├── auth.js            # POST /companies/signup, POST /auth/login
│   │   ├── survey.js          # Session, questions, answers, submit, reward claim
│   │   ├── dashboard.js       # Scores, latest cycle, reward pool status
│   │   └── actionPlans.js     # List, update, assign training, complete
│   ├── services/
│   │   ├── scoring.js         # Domain score computation + anonymity suppression
│   │   └── actionPlan.js      # Auto-generates action plans after scoring
│   ├── middleware/
│   │   └── auth.js            # JWT verification middleware
│   └── scripts/
│       ├── seed.js                  # Seeds 6 domains + 12 survey questions
│       ├── seed-action-items.js     # Seeds the action-item content library
│       ├── test-survey-flow.js      # Verifies anonymity suppression end-to-end
│       ├── test-survey-html.js      # Headless browser test: employee survey
│       └── test-dashboard-html.js   # Headless browser test: admin dashboard
│
├── database/
│   ├── schema.sql             # Canonical PostgreSQL DDL (source of truth)
│   └── migrations.sql         # schema.sql + pgcrypto extension (apply to new DB)
│
└── docs/
    ├── api-workflow-spec.md   # Full API spec + scoring algorithm + workflow pseudocode
    ├── pt-question-bank.md    # 32-item PT-BR question bank with domain/scale/reverse flags
    └── NR1-Handoff-Document.docx  # Full project handoff document (Word)
```

---

## Quick start (local)

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 1. Install backend dependencies
```bash
cd backend
npm install
```

### 2. Create the database
```bash
createdb nr1_diagnostic
psql -U postgres -d nr1_diagnostic -f ../database/migrations.sql
```

### 3. Configure environment
Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

### 4. Seed reference data
```bash
node scripts/seed.js
node scripts/seed-action-items.js
```

### 5. Start the server
```bash
node server.js
# API is now running at http://localhost:3000
```

### 6. Open the frontend
Open any file in `frontend/` directly in a browser.

For the employee survey, append the invite token to the URL:
```
frontend/employee-survey.html?survey=YOUR_INVITE_TOKEN
```
The invite token is returned by `POST /api/v1/companies/signup`.

If no `?survey=` token is present, the survey runs in **demo mode** with
bilingual sample questions — no backend required.

---

## Deploying to production (Render)

See **Section 4** of `docs/NR1-Handoff-Document.docx` for the full
step-by-step deployment guide. Summary:

1. Push this repo to GitHub
2. Create a PostgreSQL database on Render (São Paulo region recommended for LGPD)
3. Apply `database/migrations.sql` to the new database
4. Run seed scripts against the new database
5. Create a Render Web Service: Build = `npm install`, Start = `node server.js`
6. Set environment variables (see `.env.example`)
7. Update `API_BASE_URL` in each HTML file from `http://localhost:3000/api/v1` to your Render URL
8. Restrict CORS: change `cors()` in `server.js` to `cors({ origin: 'https://yourdomain.com' })`

---

## Key design decisions

### Anonymity is structural, not just a policy
There is **no foreign key path** from `response` to `seat_invite` or any named
employee. The link between "a session was created" and "this person was invited"
exists only as an aggregate count. This is enforced by the schema, not by code.

**Do not add a FK between `respondent_session` and `seat_invite`.**

### Anonymity suppression at n=5
Domain scores are only shown to admins when **5 or more respondents** contributed.
Below that threshold, `mean_score` is `null` and the dashboard shows
"insufficient responses". This prevents small-team de-anonymisation by arithmetic.

**Do not lower this threshold without a deliberate team decision.**

### Scoring
- Higher score always = healthier (reverse-scored items use `6 − raw_answer`)
- Domain score = mean of per-respondent means where respondent answered ≥80% of that domain
- Risk bands: ≥3.5 green, 2.5–3.49 amber, <2.5 red

---

## Environment variables

See `.env.example` for all required variables. **Never commit a real `.env` file.**

Generate a secure JWT secret:
```bash
openssl rand -hex 32
```

---

## Known gaps (before production)

| Gap | Notes |
|-----|-------|
| English question text | `survey_question` only has `text_pt`. Add `text_en` column before English-first employees take the survey. |
| Action item coverage | 11 items seeded. Role + Support domains have no red-trigger items. |
| 6 vs. 7 domains | Pending confirmation from Thais. May require schema + question bank + dashboard updates. |
| Super Admin backend | `super-admin.html` UI is complete; backend endpoints not built yet. |
| Session cookie auth | Admin JWT is in a JS variable — page refresh logs out. Replace with httpOnly cookie before launch. |
| CORS restriction | Currently wide open. Restrict to your domain before going live. |
| Rate limiting | None on `/signup` or `/auth/login`. Add before public launch. |
| Question validation | 32-item bank is a functional draft. Needs expert review + Cronbach's alpha pilot. |

---

## Tech stack

- **Backend:** Node.js, Express, PostgreSQL, bcrypt, jsonwebtoken
- **Frontend:** Vanilla HTML/CSS/JS — no framework, no build step
  - Ready to port to Vue2 (existing 2BeLive stack)
- **Design:** 2BeLive design system — Nunito font, navy `#0a1744`, orange `#eb6025`

---

## NR-1 compliance

This platform is designed to satisfy the GRO (Gerenciamento de Riscos
Ocupacionais) requirements under NR-1 Portaria MTE 1.416/2024:

| NR-1 Obligation | Platform Component |
|---|---|
| Inventário de Riscos | 6-domain diagnostic report (`domain_score_cache`) |
| Plano de Ação | Auto-generated action plans (`company_action_plan`) |
| Registros de monitoramento | Training completion + evidence notes |
| Participação dos trabalhadores | Anonymous employee survey |
| Melhoria contínua | Year-over-year cycle comparison |

See `docs/NR1-Handoff-Document.docx` for the full compliance reference.

---

*2BeLive Confidential · Internal Use Only*
