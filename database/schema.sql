-- =========================================================
-- 2BeLive Psychosocial Diagnostic Tool — Schema (PostgreSQL)
-- Two zones: IDENTIFIED (company/admin) and ANONYMIZED (survey)
-- No FK path connects RespondentSession/Response back to a
-- named employee. This is enforced structurally, not by convention.
-- =========================================================

-- ============ IDENTIFIED ZONE ============

CREATE TABLE company (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    cnpj            TEXT UNIQUE,
    plan_seats      INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('trial','active','suspended','cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_user (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'admin'
                        CHECK (role IN ('owner','admin')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One company can run multiple cycles over time (year-over-year comparison)
CREATE TABLE survey_cycle (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    question_set_version INTEGER NOT NULL,   -- pins which SurveyQuestion version was used
    opens_at            TIMESTAMPTZ,
    closes_at           TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','active','closed')),
    invite_url_token    TEXT NOT NULL UNIQUE,   -- public survey URL slug, not tied to identity
    target_seat_count   INTEGER NOT NULL,
    min_respondents_for_report INTEGER NOT NULL DEFAULT 5, -- suppression threshold
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tracks WHO WAS INVITED / HAS ACCESS — never joined to Response data.
-- If you invite anonymously (open link, no named list), this table can
-- be skipped entirely and completion is tracked only via RespondentSession.
CREATE TABLE seat_invite (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_cycle_id     UUID NOT NULL REFERENCES survey_cycle(id) ON DELETE CASCADE,
    seat_email          TEXT,                -- nullable: optional, for reminder emails only
    invited_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    link_opened_at      TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'not_started'
                            CHECK (status IN ('not_started','in_progress','completed')),
    -- status is updated via aggregate signal from RespondentSession,
    -- NOT via a foreign key to a specific session/response
    reminder_count      INTEGER NOT NULL DEFAULT 0
);


-- ============ ANONYMIZED ZONE ============
-- Nothing in this zone carries a column that references admin_user,
-- seat_invite, or any employee identity table.

CREATE TABLE respondent_session (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_cycle_id     UUID NOT NULL REFERENCES survey_cycle(id) ON DELETE CASCADE,
    session_token       TEXT NOT NULL UNIQUE, -- stored client-side (cookie/localStorage), lets user resume
    ip_hash             TEXT,                 -- SHA-256(ip + per-cycle salt); abuse detection only, not reversible
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress','completed','abandoned'))
);

-- Prevent retake after completion at the DB level, not just app logic
CREATE UNIQUE INDEX uq_completed_session_token
    ON respondent_session(session_token)
    WHERE status = 'completed';

CREATE TABLE survey_domain (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code    TEXT NOT NULL CHECK (code IN
                ('demands','control','support','relationships','role','change')),
    version INTEGER NOT NULL,
    label_pt TEXT NOT NULL,
    UNIQUE (code, version)
);

CREATE TABLE survey_question (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id           UUID NOT NULL REFERENCES survey_domain(id),
    version             INTEGER NOT NULL,
    text_pt             TEXT NOT NULL,
    scale               TEXT NOT NULL DEFAULT 'freq' CHECK (scale IN ('freq','agree')),
    is_reverse_scored   BOOLEAN NOT NULL DEFAULT false,
    display_order       INTEGER NOT NULL
);

CREATE TABLE response (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    respondent_session_id   UUID NOT NULL REFERENCES respondent_session(id) ON DELETE CASCADE,
    question_id             UUID NOT NULL REFERENCES survey_question(id),
    raw_answer               SMALLINT NOT NULL CHECK (raw_answer BETWEEN 1 AND 5),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (respondent_session_id, question_id)  -- one answer per question per session
);


-- ============ AGGREGATION / REPORTING ZONE ============
-- Dashboard reads ONLY from these tables — never from response/respondent_session directly.

CREATE TABLE domain_score_cache (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_cycle_id     UUID NOT NULL REFERENCES survey_cycle(id) ON DELETE CASCADE,
    domain_id           UUID NOT NULL REFERENCES survey_domain(id),
    mean_score          NUMERIC(3,2),   -- null if respondent_count < min_respondents_for_report
    respondent_count    INTEGER NOT NULL,
    response_rate       NUMERIC(5,2),   -- completed / target_seat_count
    risk_band           TEXT CHECK (risk_band IN ('green','amber','red')),
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (survey_cycle_id, domain_id)
);

CREATE TABLE action_item (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id           UUID NOT NULL REFERENCES survey_domain(id),
    risk_band_trigger   TEXT NOT NULL CHECK (risk_band_trigger IN ('amber','red')),
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    delivery_type       TEXT NOT NULL CHECK (delivery_type IN ('on_platform_training','off_platform')),
    linked_training_id  UUID,   -- FK into 2BeLive LMS course table (external to this schema)
    active               BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE company_action_plan (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_cycle_id     UUID NOT NULL REFERENCES survey_cycle(id) ON DELETE CASCADE,
    action_item_id      UUID NOT NULL REFERENCES action_item(id),
    status              TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','in_progress','completed')),
    owner_admin_id      UUID REFERENCES admin_user(id),
    target_date         DATE,
    evidence_note       TEXT,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identified, employee-level — separate path entirely from survey response data.
-- Joins to company/employee, never to respondent_session or response.
CREATE TABLE training_completion (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    employee_id              UUID NOT NULL,  -- FK into 2BeLive's existing employee/user table
    course_id                UUID NOT NULL,  -- FK into 2BeLive LMS course table
    assigned_action_item_id  UUID REFERENCES action_item(id),
    completed_at             TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ REWARDS (company-funded, anonymous redemption) ============
-- Issued at the respondent_session level only — never joined to seat_invite
-- or any identified table. Completion and identity remain unlinked.

CREATE TABLE reward_pool (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_cycle_id UUID NOT NULL REFERENCES survey_cycle(id) ON DELETE CASCADE,
    partner_name    TEXT NOT NULL,              -- e.g. 'Starbucks'
    funded_by       TEXT NOT NULL DEFAULT 'company'
                        CHECK (funded_by IN ('company','2belive_partnership')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reward_code (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reward_pool_id          UUID NOT NULL REFERENCES reward_pool(id) ON DELETE CASCADE,
    code                    TEXT NOT NULL UNIQUE,     -- redeemable code from partner (pre-loaded batch)
    status                  TEXT NOT NULL DEFAULT 'available'
                                CHECK (status IN ('available','issued','redeemed')),
    issued_to_session_id    UUID REFERENCES respondent_session(id),  -- anonymous FK only, nullable
    issued_at               TIMESTAMPTZ,
    redeemed_at              TIMESTAMPTZ
);

-- Enforce one code per completed session at the DB level
CREATE UNIQUE INDEX uq_one_code_per_session
    ON reward_code(issued_to_session_id)
    WHERE issued_to_session_id IS NOT NULL;

CREATE INDEX idx_reward_code_pool_status ON reward_code(reward_pool_id, status);

-- ============ PLATFORM ZONE (2BeLive internal, cross-company) ============
-- Distinct from admin_user, which is scoped to a single company_id.
-- platform_admin has no company_id — that's the point: it's the role that
-- crosses tenant boundaries, so it must live outside the company-scoped tables.

CREATE TABLE platform_admin (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'ops'
                        CHECK (role IN ('ops','support','admin')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every read a platform_admin does against company-scoped tables (company,
-- survey_cycle, domain_score_cache, company_action_plan) is a normal
-- unscoped SELECT — no new join tables needed, since those already carry
-- company_id. The only thing platform_admin adds is a role that's allowed
-- to query across company_id values, which application-layer authorization
-- enforces (this role must never be granted to admin_user).

CREATE INDEX idx_platform_admin_email ON platform_admin(email);

-- ============ Helpful indexes ============
CREATE INDEX idx_response_session ON response(respondent_session_id);
CREATE INDEX idx_seat_invite_cycle ON seat_invite(survey_cycle_id);
CREATE INDEX idx_action_plan_cycle ON company_action_plan(survey_cycle_id);
CREATE INDEX idx_training_completion_company ON training_completion(company_id);
