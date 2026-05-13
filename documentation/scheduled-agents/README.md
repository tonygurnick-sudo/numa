# Scheduled Agents

Reference for the production-readiness state of scheduled agents after FEAT-105.

## Quota model

Scheduled-run quotas are enforced _projected_, not _actual_. When a user creates
or edits a schedule, the system sums the `projected_runs_per_month` of every
active schedule in the tenant (computed once from the cron expression and
cached on the record) and compares the total to the configured caps. There is
no per-run actual counter on the hot path.

### Three-level config chain

Mirrors the existing `scheduling-min-interval` pattern:

| Level | Where                                                              | Who sets it                                   | What it means                                                                                      |
| ----- | ------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1     | `lib/schedule-load.ts` `PLATFORM_DEFAULT_QUOTAS`                   | Engineering                                   | Hard ceiling. Code constant.                                                                       |
| 2     | `numa-client-config` table — `platform-settings` record            | Customer Success Portal → "Platform Settings" | Global override across all clients. ≤ Level 1.                                                     |
| 2b    | `numa-client-config` table — `<client>` record                     | Customer Success Portal → Customer Configs    | Per-client override. ≤ Level 2.                                                                    |
| 3     | `{client}-scheduling-settings` table — `setting=scheduling` record | Client admin → Settings → Scheduling          | Per-client admin override. ≤ Level 2b. May only LOWER caps. May only RAISE the min-interval floor. |

Each level may set fewer fields than the level above; missing fields cascade.

### Quota fields (and current platform defaults)

Defined in `lib/schedule-load.ts:PLATFORM_DEFAULT_QUOTAS`. **Validate against
Phase 0 telemetry (see `cloudwatch-insights-queries.md`) before considering
these final.**

Defaults favour **many low-frequency automations** over a few high-frequency
ones. The minimum cadence is hourly; per-user concurrency is 10 (matches the
"automations" UX) so users can stack a slack digest, weekly report, monthly
KPI, etc. without bumping the cap. One hourly schedule projects to ~720
runs/month, so 750 is the natural per-user/agent figure.

| Field                                    | Default | Behaviour above cap                                                                                                                                       |
| ---------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minIntervalMinutes`                     | `60`    | Hard reject                                                                                                                                               |
| `maxRunsPerCompanyPerMonth`              | `2,000` | **Hard reject — always enforced. Admin approval cannot breach this.**                                                                                     |
| `maxRunsPerUserPerMonth`                 | `750`   | Admin approval up to the company cap (if `requireApprovalAboveUserCap`) else hard reject                                                                  |
| `maxConcurrentActiveSchedulesPerCompany` | `1,000` | Hard reject — tenant-wide cap on simultaneously active schedules                                                                                          |
| `maxConcurrentActiveSchedulesPerUser`    | `100`   | Hard reject — per-user share of the company concurrent cap                                                                                                |
| `requireApprovalAboveUserCap`            | `true`  | Toggles approval flow for the per-user cap. Level 2 (platform / per-client) is a hard floor — admin can disable, never enable beyond what platform allows |

There is **no** per-agent quota dimension. Per-automation rate-limiting is achieved via the schedule's own `max_runs` field (per-month, auto-pauses when hit), and the platform-level minimum interval prevents one agent from running away by setting a lower floor on cadence. Trigger (event) automations have parallel `maxTriggerRunsPer{Company,User}PerMonth` caps backed by actuals (counted at fire time) rather than projection.

**Approval semantics:** admin approval lets a user exceed their per-user cap _up to the company cap_. It can never authorise a schedule that would push the company total above `maxRunsPerCompanyPerMonth`. The company cap is the absolute ceiling for the tenant.

### Approval flow

When a schedule's projected runs would push a user over `maxRunsPerUserPerMonth`
and `requireApprovalAboveUserCap` is on:

1. Schedule is saved with `status: 'pending_approval'`. **No EventBridge entry
   is created.** The schedule will not run until approved.
2. The owner sees the schedule in their list with a "Pending approval" badge.
3. Admins see the same schedule in the tenant audit screen
   (`Settings > Scheduling > Audit`).
4. Admin clicks **Approve** → `POST /api/agent-schedules/:id/approve` → status
   transitions to `active` and the EventBridge entry is created. `approved_by`
   and `approved_at` are stamped on the record.
5. Admin clicks **Reject** → `POST /api/agent-schedules/:id/reject` → status
   becomes `deleted`.

Resuming a paused schedule re-runs the quota check; if the tenant has filled up
since the schedule was paused, it will land in `pending_approval` again.

## Approval / management API

| Endpoint                             | Method | Auth  | Purpose                                                                           |
| ------------------------------------ | ------ | ----- | --------------------------------------------------------------------------------- |
| `/api/agent-schedules`               | GET    | User  | List user's own schedules (existing).                                             |
| `/api/agent-schedules`               | POST   | User  | Create. Returns 201 (active) or 202 (`{requiresApproval: true, quotaViolation}`). |
| `/api/agent-schedules/tenant`        | GET    | Admin | List all tenant schedules (audit screen).                                         |
| `/api/agent-schedules/quota-summary` | GET    | User  | `{quotas, user, company}` for the dashboard strip.                                |
| `/api/agent-schedules/:id/approve`   | POST   | Admin | Pending → active + EventBridge.                                                   |
| `/api/agent-schedules/:id/reject`    | POST   | Admin | Pending → deleted.                                                                |
| `/api/settings/scheduling`           | GET    | User  | Admin override + ceiling + platform defaults.                                     |
| `/api/settings/scheduling`           | PUT    | Admin | Set Level-3 admin override.                                                       |

## Email notifications

Three completion templates dispatch from `agent-schedule-runner` after each
run via the centralised `numa-email-sender` lambda:

- `schedule_completed` — agent reported success.
- `schedule_failed` — agent reported failure (or invocation threw).
- `schedule_partial` — agent reported partial success.

All three templates include a `manage_url` link directly to
`/scheduling/{id}?action=pause` so the recipient can one-click pause from the
email. The detail page reads `?action=pause` on mount and prompts to confirm.
The link is Cognito-protected — the recipient must log in.

Two additional templates dispatch from `agent-schedules` for admin- and
quota-related events:

- `schedule_paused_by_admin` — fired from `agent-schedules` when an admin
  pauses or locks another user's schedule (audit panel modal). Recipient
  is the schedule owner; the email includes the action label, optional
  reason, and a deep-link.
- `schedule_quota_warning` — fired from `agent-schedules` when a successful
  create / reactivate pushes the user or company over 80% of their monthly
  cap. Per-month dedupe via conditional updates on `scheduling-settings`
  rows keyed `quota_warn_user_<sub>` / `quota_warn_company`. Recipient is
  the user whose action triggered the threshold crossing.

Failure paths in the runner (agent invocation throw, persist-failed,
outer-catch) all email the owner via the same `dispatchScheduleRunEmail`
helper that the success path uses. Earlier rounds wired this only on the
success path — failure runs got an in-app toast but no email.

A fourth template `schedule_quota_warning` exists in
`numa-email-sender/email_templates.py` for v2 dispatch (round-2 follow-up
will wire the trigger). Until then, the `QuotaUsageStrip` on the
`/scheduling` page is the primary in-product warning surface.

## Telemetry

Every scheduled run emits a `[SCHEDULE_METRIC] schedule_run_started` log line
in `/numa/{clientName}-core`. See `cloudwatch-insights-queries.md` for the
saved Logs Insights queries to chart load and tune Level-2 quotas.

## Cleanup that landed with FEAT-105

- **"Custom" frequency removed from the schedule picker.** Users can no
  longer choose `custom` and type a raw cron expression in
  `AgentScheduleModal` / `AgentCreateModal`. Direct response to the ticket
  bullet "remove custom cron jobs" — raw-cron syntax is too easy to use to
  set up quota-damaging or broken schedules. The `'custom'` value is
  retained in `FrequencyType` and the cron builder's render branch so
  _existing_ schedules with arbitrary cron expressions continue to load and
  remain editable.
- `lambdas/node/application-scheduler/` — removed. Was deployed but never
  wired to an EventBridge target. Application scheduling will re-emerge
  under `agent-schedules` if needed.
- `lambdas/node/data-sync-scheduler/` — removed. Same situation.

The platform-internal scheduled jobs (`pipedream-account-sync`,
`pipedream-schema-refresh`, `numa-dr-export`, `quota-report-daily`,
`gmail-watch-manager`, `beyond-expectations` daily, `connector-event-dispatcher`)
remain as-is — they are not user-facing recurrence.

## Operational runbook

### "My schedule won't fire"

1. Check the schedule status in `/scheduling/{id}`. If it's `pending_approval`,
   ask an admin to approve it (`Settings > Scheduling > Audit`).
2. Check `last_status` on the schedule record. If it's `failed`, inspect
   `last_error_typed` for the typed reason (integration not connected, KB
   removed, etc.) and the remediation path.
3. Confirm the EventBridge entry exists:
   ```bash
   aws scheduler get-schedule --name "{clientName}-{scheduleId}" \
     --group-name "{clientName}-agent-schedules"
   ```
4. Check the runner logs for the schedule-id in the last 24h:
   `filter @message like /{scheduleId}/` in `/numa/{clientName}-core`.

### "Quotas got exceeded — why?"

`GET /api/agent-schedules/quota-summary` returns the current usage. The audit
screen breaks it down per-user. To diagnose what's eating the company budget,
sort the audit screen by `projectedRunsPerMonth` descending.

### "I want to change the quotas for one client"

1. CS portal → Customer Configs → select client → set
   `maxRunsPerCompanyPerMonth` (or whichever field) on the `clientConfig`.
2. Redeploy that client's stack — values flow through env vars to the lambda.
3. Verify with `GET /api/settings/scheduling` — `effective` should reflect the
   new value.

### "I want to change the platform-default for everyone"

1. CS portal → Tools → Platform Settings → set the field.
2. The platform-settings record is read at deploy time; changes take effect on
   next deploy of each client stack. No data migration needed since values
   apply at runtime.

## Round-2 — what landed (this MR)

Building on the original FEAT-105 commit, the following round-2 follow-ups
shipped in the same branch:

- **DLQ + alarm on the runner** — SQS DLQ (`{client}-agent-schedule-runner-dlq`,
  14-day retention) catches BOTH paths into the runner:
  (1) async-invocation failures via the lambda's `deadLetterTargetArn`
  (Run Now self-invokes, dispatcher fire-and-forget); and (2) sync EB
  Scheduler invocations via `DeadLetterConfig` on every Scheduler target
  with a `MaximumRetryAttempts: 3` retry policy. The runner's
  `handleSchedulerEvent` no longer wraps the whole flow in a try/catch —
  unexpected infra-level errors propagate so EB Scheduler / async retries
  can route them to the DLQ. `CloudWatchMetricAlarm` fires on any message.
- **Reserved concurrency on the runner** — capped at 10 to protect the
  workspace agent proxy / AgentCore at peak.
- **S3 lifecycle on `numa-chat/scheduled-runs/`** — 90-day expiration so run
  logs don't accumulate forever. Doesn't affect chat uploads / artifacts in
  the same bucket (prefixed rule).
- **Idempotent run dedupe** — `(scheduleId, fireTime)` claimed atomically via
  conditional `last_run_started_epoch` update. EventBridge double-fires within
  60s are rejected.
- **Auto-pause on N consecutive failures** — runner increments
  `consecutive_failures` on each failed run, resets on success/partial. After
  5 consecutive (configurable via `SCHEDULE_AUTOPAUSE_AFTER_FAILURES`) the
  schedule is paused and the user notified.
- **`agent-id-index` GSI usage** — `getByAgent` now does a server-side Query
  instead of fetch-all-then-filter.
- **`AgentScheduleModal` runConfig rebuild** — the modal now passes a fresh
  `runConfig` + `agentSnapshot` when editing, so cached tool config doesn't go
  stale (matches what `AgentCreateModal`'s inline path already did).
- **`pending_approval` status badge** — proper blue/info variant in
  `SchedulingPage` and `ScheduleDetailPage` (was falling through to grey).
- **Cron preview (next 5 fire times)** — rendered in the schedule preview
  block when both `cronExpression` and `timezone` are passed.
- **Schedule end dates** — optional `expires_at` (epoch ms) on the schedule
  record. Validated `> now` at create/update, blocks reactivation past
  expiry. Date-picker added to `AgentScheduleModal`. Runner checks at run
  start and auto-pauses + notifies when reached. EB rule keeps firing
  until manual cleanup (deferred — see follow-up #17).
- **Admin lock (`admin_locked` status)** — separate status from `paused`.
  Owner sees the schedule but cannot reactivate; only an admin can
  transition out (back to `paused`). Schema gating in
  `agent-schedules` lambda; UI in `ScheduleAuditPanel` exposes Lock/Unlock
  buttons with optional admin-supplied reason.
- **Audit panel UX expansion** — projected runs/mo column shows `% of
company cap` next to each row; tenant gauge at the top with active
  vs parked split; paused / `admin_locked` rows visible in muted style
  with their projected load surfaced (so admins see latent quota usage
  if everyone resumed at once).

## What's still NOT in FEAT-105 (true round-2 follow-ups)

Genuinely deferred — these are tracked but not blockers for shipping:

1. **Schedule-change audit log** via DynamoDB stream → audit table.
   Currently only the run-history is preserved; admin-driven pauses /
   locks / approvals leave no audit trail beyond the in-record metadata.
2. **Actual-usage counter** as runner-side defence-in-depth. Quota
   enforcement today is projected (`projected_runs_per_month` summed at
   create time). The runner could keep a parallel actuals counter and
   refuse to fire when a tenant has somehow drifted past cap (e.g. via
   stale projected values after a cron edit).
3. **Cost-aware quota** — token-spend × historical avg per agent. Long-
   term project, needs per-run cost tracking infra hooked into the
   workspace agent's billing emissions.
4. **EventBridge cleanup on pause.** Runner pauses
   expired / failed / max-runs-hit schedules via DynamoDB only. The
   EB rule keeps firing harmlessly (runner returns immediately on
   non-active status), but it's wasted invocations. Same applies to
   admin lock and admin-pause from the audit panel modal. Cleaning up
   the rule needs SchedulerClient + IAM in the runner.
5. **Dormant quota-config behaviour** — quota fields stay set on the
   client config when `scheduling: false`. Acceptable v1; if this
   confuses customers, add clear-on-disable.
6. **Auto-pause meta-events emit in-app only.** Per-run failure emails
   wire through `dispatchScheduleRunEmail`, but the "auto-paused after
   N consecutive failures" and "auto-paused at expiry" notifications
   are still in-app toasts. By the time auto-pause fires, the user has
   already received N failure emails, so this is a low-value gap.

### Round-3 production hardening (post-review)

- **EventBridge sync ordering on update** — `updateSchedule` previously
  wrote DDB before EB. If EB then threw on a `paused → active`
  reactivation, the schedule was marked active in DDB but had no rule to
  fire it (silent dead schedule). Order is now reversed for active
  transitions: EB first, then DDB. Non-active transitions keep DDB-first
  - best-effort EB delete (the runner skips on non-active status, so a
    lingering EB rule is harmless). DDB failure after EB success attempts
    a best-effort revert (delete the freshly-created EB rule on
    reactivation; loud log on cron-change update where revert isn't
    trivially safe).
- **Runner outer-catch removed** — `handleSchedulerEvent` no longer
  swallows pre-run errors. `executeRun` retains its three internal
  failure handlers (agent throw, persist failed, outer-catch — each
  emails the owner). Anything that escapes those is infra-level and
  rightly propagates to the DLQ.
- **EB Scheduler DLQ + retry policy on every target** — every
  `CreateScheduleCommand` and `UpdateScheduleCommand` now sets
  `Target.RetryPolicy` (3 retries, 24h max event age) and
  `Target.DeadLetterConfig` pointing at the runner DLQ. Before this,
  sync invocation failures would just disappear into Scheduler's
  default-185-retry-then-drop behaviour. The execution role gained
  `sqs:SendMessage` on the DLQ — without that grant, DeadLetterConfig
  is a silent no-op.

### Shipped during the production-hardening rounds

These were on earlier deferral lists but landed in commits on this branch:

- Per-month `max_runs` semantics with manual-resume after quota window
  resets, replacing the lifetime cap
- Per-agent quota dimension removed entirely from the model
- `requireApprovalAboveUserCap` clamped — Level 2 is a hard floor; admin
  can disable but not enable beyond what platform allows
- Quota cache dropped from `agent-schedules` and `connector-event-dispatcher`
  resolvers — admin toggle changes apply within seconds, no cold-start
- `schedule_quota_warning` email dispatcher wired (dedupe per scope per
  month via scheduling-settings rows)
- `SchedulePreflightStepper` wired into `AgentScheduleModal` and wizard
  review step via `useSchedulePreflight` hook
- Failure-path emails wired in the runner (agent invoke throw, persist
  failed, outer catch) — used to be success-path only
- `manage_url` deep-links carry `?action=pause` so the email "Pause this
  schedule" CTA prompts immediately on landing
- Admin schedule overview modal in the audit panel (replaces broken
  navigate-to-detail-page flow), with cross-user pause / lock / unlock
  - owner email notification on admin pause / lock
- AgentScheduleModal runConfig rebuild on edit
- `agent_id` GSI for `getByAgent`
- S3 lifecycle on `numa-chat/scheduled-runs/` (90-day retention)
- Reserved concurrency on `agent-schedule-runner`
- Cron preview (next 5 fire times) in the builder
- DLQ + alarm on the runner
- Idempotent-fire dedupe via atomic `last_run_started_epoch` claim
- Auto-pause after N consecutive failures
- Schedule end dates (`expires_at`)
- Admin lock (`admin_locked` status) with dedicated audit-panel controls
- Admin-approval flow for over-user-cap creations
