# Numa Voice — Build Status & Bug-Hunt Record

Status: **all code built, statically verified, and bug-hunted across 5 adversarial review rounds.** NOT deployed or live-tested (needs a real Amazon Connect instance + a real call — that validation is the team's).

## What's built (entire epic, behind the `numaVoice` flag)

- **Phase 0 — gating:** `numaVoice` (+ `connectInstanceUrl`, `connectAutoProvision`) clientConfig flags; `NUMA_VOICE`/`CONNECT_INSTANCE_URL` in `config.json`; capabilities-metadata entry (depends on `NUMA_OPS`); `NumaVoiceConstruct` instantiated only `if (clientConfig.numaVoice)` → **flag false = zero voice IaC** (the hard requirement). FE `/voice` route + nav.
- **Phase 1 — capture/transcription (event-driven, scale-to-zero):** region-pinned (ap-southeast-2) recordings bucket + `numa-voice-processor` Lambda. S3 `.wav` → StartTranscriptionJob (diarised); Transcribe "Job State Change" → fetch transcript, read SDR outcome, write normalised transcript into the **client-region company KB** (so the agent can `numa_files`-read it), emit `numa.connector.connect`. Degrades gracefully on FAILED / fetch errors.
- **Phase 2 — native source + agents:** `ConnectEventTriggerSchema` (source `connect`, event-typed); `connect` branch in `connector-event-dispatcher` (tenant-id-index, event-type-scoped) + `connect` interpolation branch in `agent-schedule-runner` (additive — no impact on gmail/pipedream); `seed-voice-agents` deploy-time Lambda seeds the 4 agents (upsert) + 2 schedules (post-call EVENT, callprep CRON) with deterministic UUIDv5 ids, system-user-owned (resolved via `AdminGetUser`, ordered after `SystemUserCreator`). Morning `SchedulerSchedule`. Separate xlsx **intake bucket** + emitter (copy→KB→emit).
- **Phase 3 — frontend:** CCP softphone widget (`amazon-connect-streams`, app-shell mounted, eager init + auto-open on dial), click-to-dial prospect table, post-call wrap-up panel (writes outcome to OUTPUTS bucket), SDR assist sidebar (Stage 0 playbook + Stage 1 scaffold). Reconciled event wiring (`numa-voice-dial` / `numa-voice-contact` `acw` / `numa-voice-call-state`).
- **Phase 5 — GA scaffold:** `connectAutoProvision`-gated Connect instance + KMS CMK (+ key policy, bucket policy, processor KMS grant) + CALL_RECORDINGS storage config; admin phone-number UI component (stubbed backend).

## Bug-hunt: 5 rounds (each = ~30-47 agents, parallel review + adversarial verify)

| Round | Critical | Major | Minor | Outcome                                                                                                                                                                            |
| ----- | -------- | ----- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | 9        | 10    | 16    | fixed all crit+major (invalid UUID namespace, unwrapped cron, missing agent_snapshot, desktop CCP mount, FE↔agent path mismatch, system-user race, prospect-key, ingest dedupe, …) |
| 2     | 1        | 4     | 15    | fixed transcript-location (KB), FAILED degraded path, stuck-Dialing reset, agents-upsert, promoter wiring, cleanups                                                                |
| 3     | 2        | 5     | 11    | fixed yarn.lock (build), Cognito `voice/outcomes/*` write, Connect KMS+bucket policy, processor degrade-on-error, CCP eager-init                                                   |
| 4     | 0        | 4     | 11    | fixed master_prospects.json write race (single-writer), CCP/FAB overlap, processor KMS grant, system-user-email wiring                                                             |
| 5     | 0        | 2     | 15    | fixed dead field, gated `dependsOn`, S3 retention (scratch/intake), wrap-up state nit — **2 majors were design-deferrals; all 4 now resolved (below)**                             |

**Converged:** 0 criticals for 2 consecutive rounds; all actionable correctness bugs fixed. Every change re-verified (infra + frontend `tsc`, eslint, all lambdas package) after each round.

## Decisions — resolved by the user (2026-05-30)

1. **Trigger-quota exemption — ✅ IMPLEMENTED.** Seeded voice EVENT schedules previously counted against the tenant trigger quota; high call volume could silently halt them. **Decision: exempt voice schedules.** `agent-schedule-runner` now skips `enforceTriggerQuotaOrBail` entirely for `trigger.source === 'connect'` fires (skips both the company + user counters; gmail/pipedream fires still enforce quota unchanged).
2. **Schedule prompt updates don't auto-propagate — ✅ confirmed intentional (keep create-only).** Agents upsert on re-deploy (prompt/tool changes apply), but the 3 schedule records are create-only to protect runtime state (`total_runs`/`status`). Changing a _schedule_ `prompt_text`/`trigger` needs a manual update or a migration. (Agent system-prompts — the substantive instructions — do auto-sync.)
3. **Call-recording retention — ✅ confirmed intentional (no auto-expiry).** Recordings (`recordings/`) are NOT auto-expired (set a retention policy later if compliance requires); only re-derivable scratch (`transcripts/` 7d) + intake (`14d`) have lifecycle rules.

## Still open — need a live Connect instance (NOT silent gaps)

4. **`connectAutoProvision` path is untested** — Connect instance/KMS/bucket-policy/storage-config are coded + gated OFF; needs a live Connect instance to validate before enabling. Phase-1 uses a manual instance (FEAT-158); DID phone-number claiming is left to the admin UI/console.
5. **Soft dependencies** — `NUMA_VOICE` needs `NUMA_OPS` (qualified→CRM, degrades gracefully if off) and the user's `useCompanyData` S3 read grant (KB reads).

## Pre-deploy checklist (the team's, not done here)

- `cdktf synth` diff to confirm `numaVoice:false` → zero voice resources.
- Manual Connect instance (FEAT-158) + `connectInstanceUrl` in client config + Numa domain in Connect Approved Origins.
- Run `tools/seed-capabilities-metadata.ts`.
- SPK-010 Q6: en-AU vs en-NZ transcription A/B on a real NZ recording.
- End-to-end live test (real call → recording → transcript → agent → CRM).
