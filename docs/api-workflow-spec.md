# API & Workflow Spec — Diagnostic Survey Platform

Covers three flows: (1) survey resume logic, (2) score computation job, (3) action-plan → training assignment.

---

## 1. Survey Resume Logic

**Goal:** an employee can start the survey, close the tab, come back later (same device or different), and pick up where they left off — without ever tying that continuity to their identity.

### Mechanism: client-held session token

- On first visit to `/survey/{invite_url_token}`, if no valid token is present client-side, the server creates a `respondent_session` row and returns `session_token`.
- Token is stored **client-side only** — cookie (httpOnly, secure, sameSite=strict) as primary, with token also returned in response body so the client can offer a "save this link to resume on another device" option (see below).
- Every subsequent request from that client includes the token; server never infers identity from it, only session state.

### Endpoints

```
POST /api/v1/survey/{invite_url_token}/session
  → creates or resumes a respondent_session
  Request:  { existing_token?: string }
  Response: { session_token, status, next_question_index, domain_progress[] }

  Logic:
    1. If existing_token provided and matches an in_progress session for this cycle → resume.
    2. If existing_token matches a completed session → 409 Conflict, "already submitted."
    3. Else → create new respondent_session (status=in_progress), return fresh token.
    4. Update ip_hash = SHA256(request_ip + cycle_salt) — only ever compared, never reversed.

GET /api/v1/survey/{invite_url_token}/questions
  → returns the pinned question_set_version for this cycle, ordered by display_order
  Response: [{ question_id, domain_code, text_pt, display_order }]

POST /api/v1/survey/{invite_url_token}/answer
  Request:  { session_token, question_id, raw_answer }
  Response: { saved: true, next_question_index }

  Logic:
    - Validate session_token → in_progress session for this cycle. 401 if not.
    - Upsert response row (unique constraint on session_id+question_id handles re-answering
      a question before submit).
    - Update respondent_session.last_seen_at.

POST /api/v1/survey/{invite_url_token}/submit
  Request:  { session_token }
  Response: { completed: true }

  Logic:
    - Require all questions in question_set_version answered (or explicitly allow partial
      submit if you want a "skip" affordance — decide this before launch, it affects domain
      min-answer-threshold logic downstream).
    - Set respondent_session.status = 'completed', completed_at = now().
    - Fire async event → triggers score recomputation job (see §2).
    - Token becomes unusable for further answer/submit calls (enforced by the partial unique
      index on session_token WHERE status='completed' at the DB layer).
```

### Cross-device resume

Since the token lives in a cookie, a user switching from phone to laptop loses it unless you offer an explicit resume path. Options, in order of preference given the anonymity constraint:

1. **"Copy my resume link" button** shown mid-survey — generates a URL like `/survey/{invite_url_token}?t={session_token}`. User bookmarks/emails it *to themselves*. This keeps you out of the loop entirely — you never store where that link goes.
2. Avoid a "send me a resume code via email" server-side feature — that would require capturing an email address on the anonymized-zone side, which reopens exactly the identity leak the schema is designed to prevent.

### Abandonment handling

- A scheduled job flags `respondent_session` rows with `status = in_progress` and `last_seen_at` older than, say, 30 days as `abandoned`. This keeps `domain_score_cache` respondent counts meaningful (abandoned ≠ completed, shouldn't count toward response rate denominator differently than "never started" — decide whether abandoned sessions count against `target_seat_count` for response-rate math, since leaving them in as perpetually "in progress" will understate response rate forever).

---

## 2. Score Computation Job

**Trigger:** async event on every `submit` (§1), plus a scheduled nightly recompute as a safety net for any missed events.

**Goal:** turn raw `response` rows into `domain_score_cache` rows the dashboard can safely read, respecting the minimum-respondent suppression rule.

### Pseudocode

```
function recompute_domain_scores(survey_cycle_id):
    cycle = SurveyCycle.get(survey_cycle_id)
    completed_sessions = RespondentSession.where(
        survey_cycle_id=survey_cycle_id, status='completed'
    )

    for domain in SurveyDomain.for_version(cycle.question_set_version):
        domain_questions = SurveyQuestion.where(domain_id=domain.id, version=cycle.question_set_version)
        per_respondent_means = []

        for session in completed_sessions:
            answers = Response.where(
                respondent_session_id=session.id,
                question_id__in=[q.id for q in domain_questions]
            )
            answered_ratio = len(answers) / len(domain_questions)
            if answered_ratio < 0.8:
                continue  # this respondent's domain data too incomplete, exclude from domain mean

            scored = [
                (6 - a.raw_answer) if question_map[a.question_id].is_reverse_scored else a.raw_answer
                for a in answers
            ]
            per_respondent_means.append(mean(scored))

        respondent_count = len(per_respondent_means)
        response_rate = len(completed_sessions) / cycle.target_seat_count

        if respondent_count < cycle.min_respondents_for_report:
            mean_score = null       # suppressed — not enough data to protect anonymity
            risk_band = null
        else:
            mean_score = mean(per_respondent_means)
            risk_band = (
                'green' if mean_score >= 3.5 else
                'amber' if mean_score >= 2.5 else
                'red'
            )

        upsert DomainScoreCache(
            survey_cycle_id=survey_cycle_id,
            domain_id=domain.id,
            mean_score=mean_score,
            respondent_count=respondent_count,
            response_rate=response_rate,
            risk_band=risk_band,
            computed_at=now()
        )
```

### Notes / decisions to confirm

- **Reverse-scoring formula** `6 - raw_answer` assumes a 1–5 scale; confirm once actual items are finalized (matches HSE's own reversal pattern).
- **80% domain-completion threshold** for including a respondent's data in a domain mean is a placeholder — matches the "meaningful partial response" idea, worth validating against however many items per domain you land on (too few items per domain and 80% forces near-total completion anyway).
- **Suppression is per domain, not per cycle** — a company might clear the threshold on Demands (large team) but not on Relationships if that domain had more skips. Dashboard should communicate this domain-by-domain, not as one blanket "not enough data."
- Recompute is idempotent (upsert on `(survey_cycle_id, domain_id)` unique constraint) so re-running after a late submission or a correction is safe.

### Endpoint for the dashboard to consume

```
GET /api/v1/companies/{company_id}/cycles/{cycle_id}/scores
  Response: [
    { domain_code, mean_score | null, respondent_count, response_rate, risk_band | null }
  ]
  - Auth: admin_user scoped to company_id.
  - If mean_score is null, dashboard should render "Insufficient responses to report (n<5)"
    rather than hiding the domain silently — transparency about *why* a domain isn't shown
    matters both for trust and for the response-rate-quality message from the HSE manual.
```

---

## 3. Action-Plan → Training Assignment Flow

**Trigger:** after score computation, whenever a domain's `risk_band` is `amber` or `red`.

### Step 1 — Generate candidate action items

```
POST (internal) /api/v1/cycles/{cycle_id}/generate-action-plan
  Logic:
    for each domain_score_cache row where risk_band in ('amber', 'red'):
        matching_items = ActionItem.where(
            domain_id=row.domain_id,
            risk_band_trigger=row.risk_band,
            active=true
        )
        for item in matching_items:
            if not CompanyActionPlan.exists(survey_cycle_id=cycle_id, action_item_id=item.id):
                create CompanyActionPlan(
                    survey_cycle_id=cycle_id,
                    action_item_id=item.id,
                    status='open'
                )
```

This runs once automatically right after score computation, populating the admin's action-plan view with suggested items already — admin doesn't start from a blank page.

### Step 2 — Admin reviews and assigns

```
PATCH /api/v1/action-plans/{plan_id}
  Request: { owner_admin_id?, target_date?, status? }
  - Admin can accept, reassign owner, set a target date, or dismiss (status stays 'open'
    with no target_date if left unactioned — surfaced as overdue in dashboard once
    target_date passes, matching the HSE Action Plan Template's "when/who/completed" fields).
```

### Step 3 — On-platform actions assign training

```
POST /api/v1/action-plans/{plan_id}/assign-training
  Request: { employee_ids[] }   -- e.g. all managers, or a specific team
  Logic:
    - Requires action_item.delivery_type == 'on_platform_training' and
      action_item.linked_training_id is not null.
    - For each employee_id, create/update TrainingCompletion row
      (assigned_action_item_id = plan.action_item_id, completed_at = null).
    - Calls into existing 2BeLive LMS enrollment API to actually enroll the employee
      in linked_training_id — this table just tracks the link back to the action plan.
```

### Step 4 — Completion rollup (for "Prove")

```
GET /api/v1/action-plans/{plan_id}/completion-status
  Response: { total_assigned, completed_count, completion_rate }
  - Reads TrainingCompletion where assigned_action_item_id = plan.action_item_id.
  - When completion_rate reaches a configurable threshold (e.g. 90%), auto-suggest
    status transition to 'completed' on the CompanyActionPlan (admin still confirms —
    off-platform evidence like "reduced peak workload" can't be auto-verified the same way).
```

### Off-platform actions

```
PATCH /api/v1/action-plans/{plan_id}/complete
  Request: { evidence_note }
  - For delivery_type == 'off_platform' only.
  - Sets status='completed', completed_at=now(), stores evidence_note as the
    audit trail (this is your NR-1 documentation artifact for actions that
    aren't trainable, e.g. "redistributed workload across 2 new hires").
```

---

---

## 4. Reward Redemption Flow (v1: company-funded, instant code, no PII)

**Goal:** boost completion rates by showing a redeemable coupon (e.g. Starbucks) immediately on the thank-you screen, without ever capturing an email/phone or linking the reward to identity.

### Setup (admin side, identified zone)

```
POST /api/v1/cycles/{cycle_id}/reward-pool
  Request: { partner_name, codes: [string, string, ...] }  -- admin bulk-uploads a batch of
                                                             -- pre-purchased partner codes
  Logic:
    - Create reward_pool(survey_cycle_id, partner_name, funded_by='company').
    - Bulk-insert reward_code rows, status='available', for each code in the batch.
    - Admin is responsible for sourcing/purchasing the codes from the partner (e.g. a
      Starbucks bulk gift-code order) — v1 has no live partner API integration.
```

### Issuance (anonymous zone, triggered by submit)

Extends the `submit` endpoint from §1:

```
POST /api/v1/survey/{invite_url_token}/submit
  ...
  Logic (additional step after respondent_session.status = 'completed'):
    - claimed = UPDATE reward_code
                SET status='issued', issued_to_session_id=session.id, issued_at=now()
                WHERE id = (
                  SELECT id FROM reward_code
                  WHERE reward_pool_id = cycle.reward_pool_id
                    AND status = 'available'
                  LIMIT 1 FOR UPDATE SKIP LOCKED   -- atomic claim, safe under concurrency
                )
                RETURNING code;
    - If claimed: return { completed: true, reward_code: claimed.code, partner_name }
    - If pool exhausted: return { completed: true, reward_code: null }
      → thank-you screen shows a plain "thank you," no error surfaced to the respondent
        (running out of codes should never look like something went wrong with their submission)
```

- The `uq_one_code_per_session` constraint means even a retried/duplicate submit call can't claim two codes for one session.
- `FOR UPDATE SKIP LOCKED` avoids two concurrent submissions racing for the same code.

### Admin visibility

```
GET /api/v1/cycles/{cycle_id}/reward-pool/status
  Response: { partner_name, total_codes, issued_count, remaining_count }
  - Lets the admin see the pool is running low and top it up — no per-code identity to show,
    by design.
```

### Notes

- No redemption tracking beyond what the partner's own code system provides — v1 doesn't need a `redeemed_at` update loop from your side unless the partner offers a webhook; the column exists in the schema for later if you build that integration.
- This is intentionally the simplest version: no partnership commissions, no live API, no PII. The `reward_pool.funded_by` field already anticipates a future `'2belive_partnership'` mode (brokered bulk rates, revenue share) without a schema change when you're ready for that.

---

## Open decisions before build

1. **Partial submit** — allow saving an incomplete survey as a final state, or force full completion? Affects the domain 80%-threshold logic and response-rate math.
2. **Abandoned session cutoff** — 30 days is a placeholder; depends on how long you plan to keep survey cycles open.
3. **Auto-complete threshold for on-platform actions** — 90% is a placeholder; you may want this fully manual at launch and automate later once you trust the signal.
4. **Cross-device resume UX** — confirm the "copy my link" pattern is acceptable, or whether product wants something friendlier (accepting the anonymity tradeoff of an email-based resume code) — this is a product decision, not just technical.
