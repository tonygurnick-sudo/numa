# Numa Voice — Implementation & Ship Plan

**Goal:** complete the entire Numa Voice epic (FEAT‑158 → FEAT‑170, SPK‑010 done) and ship it behind a new `numaVoice` feature flag, such that **when `numaVoice` is false, zero Numa Voice IaC resources are created**.

Grounded in the SPK‑010 spike + a codebase precedent audit. Every mechanism below cites a real precedent.

---

## 0. The non‑negotiable: flag‑false → zero resources

The precedent is `numaOps`/`OpsConstruct` (and `disasterRecovery`, `siteWideSearch`, `racetechDataFeed`). The rule the codebase already follows:

> **A feature owns ALL of its AWS resources inside ONE construct, and that construct is instantiated behind a single `if (clientConfig.<flag>)` guard in `numa-client-stack.ts`.** API routes are declared _inside_ the construct (`addLambdaFunction({ route })` → `Apigatewayv2Route` children), so there is **no central route registry** that would leak resources. Skip the `new X()` and the entire subtree — tables, Lambdas, IAM, EventBridge, S3, routes — never enters the synthesized Terraform.

So **all** Voice infra goes into `infra/constructs/numa-voice-construct.ts`, instantiated as:

```ts
// numa-client-stack.ts — beside the numaOps guard (~line 713), disasterRecovery-style so outputs are referenceable
let numaVoice: NumaVoiceConstruct | undefined;
if (clientConfig.numaVoice) {
  numaVoice = new NumaVoiceConstruct(this, safeConstructId + '-voice', {
    /* ...props, voiceProvider... */
  });
}
```

**Acceptance gate (Phase 0 exit criterion):** with `numaVoice:false`, `cdktf synth` for a client diffs to **0** new resources vs. today; with `numaVoice:true`, only the Voice subtree appears. This is the single test that proves the requirement.

**⚠️ Frontend mirror gotcha:** `getFlag()` **defaults to `true`** when a key is missing from `config.json`. So "off" on the FE depends on the `NUMA_VOICE: clientConfig.numaVoice ?? false` line actually being emitted in `config.json` generation. For a brand‑new feature, gate the UI **hidden‑by‑default** via `sessionStorage.getItem('DEPLOY_NUMA_VOICE') === 'true'` (the `DEVELOPER_MODE`/`USAGE_REPORTING` pattern), so older deployments whose `config.json` predates the key don't surface the widget.

---

## Phase 0 — Flag + construct skeleton (foundation; lands first, ships nothing user‑visible)

**Flag wiring (CLAUDE.md feature‑flag steps):**

1. `numaVoice: z.boolean().optional().default(false)` in `clientConfigSchema` **before `.strict()`** (`numa-client-stack.ts` ~1483/1574). Strict mode rejects unknown keys, so this is mandatory.
2. `NUMA_VOICE: clientConfig.numaVoice ?? false` in the `config.json` generation block (`numa-client-stack.ts` ~924).
3. `NUMA_VOICE` entry in `infra/capabilities-metadata.ts` — title/description/icon, `system_only:false`, **`dependencies: ['NUMA_OPS']`** (the Qualification Promoter writes to the Ops CRM — see Phase 2). Re‑run `tools/seed-capabilities-metadata.ts`.
4. Empty `NumaVoiceConstruct extends ApiGatewayLambdaCollection` + the gated instantiation above.
5. **Region pinning prep:** Connect + Transcribe must run in **ap‑southeast‑2**; most stacks default to us‑east‑1. `NumaLambda` has **no** provider/region prop (binds to the stack default). Add an optional `provider` prop to `NumaLambda` (thread like `agentCoreProvider` in `workspace-chat-agent-construct.ts`), or raw‑build the Voice Lambda with an alias `AwsProvider`. Create a `voiceProvider` alias when `clientConfig.region !== 'ap-southeast-2'`.

**Frontend scaffold:** 6. `amazon-connect-streams` added to `numa-frontend/package.json` (net‑new dep). 7. `/voice` route + nav entry in `routeConfig.tsx` with `featureFlag:'NUMA_VOICE'` on both the route and the `nav` sub‑object (Routes.tsx redirects, Nav.tsx hides — one object does both). Empty lazy `Pages/VoicePage.tsx`. 8. i18n `voice` namespace (`src/i18n/index.ts` + `src/locales/en/voice.json`).

**Exit:** the acceptance gate above passes; UI shows nothing unless `DEPLOY_NUMA_VOICE==='true'`.

---

## Phase 1 — Capture + transcription infra (FEAT‑158 manual, FEAT‑159)

Model the construct on **`racetech-data-feed-construct.ts`** (near‑exact: NumaLambda + `LambdaPermission(s3.amazonaws.com)` + `S3BucketNotification` ObjectCreated).

- **Recordings bucket:** `NumaCorsEnabledBucket(bucketName:'connect-recordings')` → `numa-{client}-connect-recordings` (SPK‑010 — **not** the brief's `numa-connect-recordings-{tenant}`). Region‑pinned via `voiceProvider`.
- **`numa-voice-processor`** (new `lambdas/python/numa-voice-processor`): **event-driven, scale-to-zero — no polling, no held Lambda.** (1) S3 `ObjectCreated:*` (`.wav`) → `aws_transcribe.start_transcription_job(...)` (diarised, `MaxSpeakerLabels:2`) and returns immediately; (2) Amazon Transcribe's **"Transcribe Job State Change"** EventBridge event (job-name-prefix filtered to `numa-voice-{client}-`) → `aws_transcribe.fetch_transcript(...)` → writes the normalised transcript JSON → fire the Post‑Call agent (Phase 2). `lib/aws-transcribe` was refactored to expose `start_transcription_job` + `fetch_transcript` publicly (the blocking `transcribe()` wrapper is retained for existing consumers). IAM: `transcribe:StartTranscriptionJob/GetTranscriptionJob/CreateVocabulary/GetVocabulary`, `s3:GetObject` (recordings) + `s3:PutObject` (transcript). Lambda timeout 120s (no waiting). Production Step Functions is unnecessary — the EventBridge completion event already removes the held-Lambda problem.
- **FEAT‑158 (Connect instance):** **manual** for Phase‑1 internal trial (single instance, bucket `numa-connect-recordings-internal` per the card, or our convention bucket). Output `connectInstanceUrl` → stored in `numa-client-config` (`connectInstanceUrl` field, same Phase‑0 schema add). Automated in Phase 5.
- **Language note:** FEAT‑159 says `en-AU`; SPK‑010 Q6 recommends `en-NZ` for NZ accents. Make `language_code` config‑driven (default `en-NZ` for NZ tenants), and run the Q6 empirical A/B once we have a real recording (the one spike residual).

---

## Phase 2 — Agents + provisioning (FEAT‑164, 165, 166, 167)

Agents and schedules are **DynamoDB records**; the deploy‑time seed precedent is **`seed-ops-config` + `LambdaInvocation`** (`ops-construct.ts:467‑533`). Build `lambdas/node/seed-voice-agents` inside the gated construct that idempotently `PutItem`s (with `attribute_not_exists` conditions) using **deterministic ids**:

| Agent                  | id                   | Type / trigger      | Notes                                                             |
| ---------------------- | -------------------- | ------------------- | ----------------------------------------------------------------- |
| Call List Preparer     | `agt_voice_callprep` | scheduled (morning) | reads `master_prospects.json` → writes `today_calls.json`         |
| Post‑Call Processor    | `agt_voice_postcall` | event               | summary/objections/score/next‑steps; writes back to prospect JSON |
| Qualification Promoter | `agt_voice_promoter` | event               | creates Ops CRM customer (**needs NUMA_OPS**)                     |
| Prospect ingest        | `agt_voice_ingest`   | file‑drop           | xlsx → append to `master_prospects.json`                          |

- Records: `{client}-agents` (public, `tenant_id=CLIENT_NAME`, shape per `agents/index.ts:472`). Schedules: `numa-{client}-agent-schedules` (shape per `agent-schedules/index.ts:762`), owned by the **SystemUserCreator** sub (schedules are user‑scoped, `PK=user_id`).
- **Post‑Call schedule:** seed `schedule_id='voice-postcall-{client}'`, `trigger_type:'event'`. `numa-voice-processor` fires it via `InvokeCommand`(`Event`) `{ type:'EVENT', scheduleId:'voice-postcall-{client}', event:{ source:'voice', transcript, prospect_id, dedup_key } }` (the `connector-event-dispatcher` pattern). **Add a one‑line `else if (source==='voice')` interpolation branch** to `agent-schedule-runner` so `{{ event.transcript }}`/`{{ event.prospect_id }}` resolve (today only gmail/pipedream interpolate).
- **Call List Preparer schedule (gotcha):** a seeded _cron_ DDB record alone **never fires** — EventBridge rule creation lives in the agent‑schedules CRUD path. Provision a dedicated **`SchedulerSchedule`** in the construct (`quota-report-daily-construct.ts:171` pattern) targeting the runner with `{ type:'SCHEDULE', scheduleId:'voice-callprep-{client}' }`. Infra‑native and deploy‑deterministic.
- **Prospect ingest trigger (design point):** "researcher uploads xlsx to a KB folder." S3 events on the shared `data` bucket risk colliding with the existing KB‑ingestion notification (one notification config per bucket). **Recommend** a dedicated intake prefix watched by a small router, or a scheduled poll of the intake folder — _decision below._
- **Write‑back & concurrency:** keep prospect state as JSON in a Numa Files KB (the cards' design). Use the strongly‑consistent **download → mutate → upload** loop (SPK‑010 Q2 — exact‑filename reads have no 30‑min index lag). The KB write API has **no optimistic concurrency**; for internal Phase‑1 SDR volume this is fine, but write one file per prospect (or move to DynamoDB) if volume grows.

---

## Phase 3 — Frontend MVP (FEAT‑160, 161, 162, 163)

- **CCP softphone widget** (FEAT‑160): `Components/Voice/CcpSoftphoneWidget` mounted at app‑shell level (so it floats across pages during a call), gated by in‑component `getFlag('NUMA_VOICE')`. `connect.core.initCCP({ ccpUrl, region:'ap-southeast-2', softphone:{ allowFramedSoftphone:true } })`. Mic = the library's injected iframe `allow="microphone"` + the Numa domain in **Connect Approved Origins** (no CSP exists — SPK‑010 Q4). Wire hooks: `onConnected`→assist sidebar, `onACW`→wrap‑up, `onEnded`→queue post‑call.
- **Click‑to‑dial** (FEAT‑161): `Dial` button per prospect row → `connect.agent(a => a.connect(Endpoint.byPhoneNumber(prospect.phone)))`; sets `currentProspect`, triggers assist load. Prospect table reads `today_calls.json`.
- **Reading KB JSON:** there is **no KB content‑fetch API** — read `today_calls.json`/`master_prospects.json` via **direct S3 `GetObject`** (`ChatReferencesDropdown.tsx:202` pattern: `useAuth().getCredentials()`, region/`DATA_BUCKET` from sessionStorage). Net‑new helper in `Services/VoiceService.ts` (mirror `OpsService.ts`, `BASE_URL='/api/voice'`).
- **Post‑call wrap‑up panel** (FEAT‑162): `onACW` inline panel — outcome buttons + notes + **Qualify? Yes/No**, completable in ~5s, non‑blocking. **This captures the qualify decision synchronously in‑UI**, which neatly sidesteps the SPK‑010 Q3 async‑notification gap for MVP. On submit → `POST /api/voice/...` updates `today_calls.json` status and, if `qualified`, fires the Qualification Promoter.
- **SDR assist sidebar — Stage 0** (FEAT‑163): loads `sdr_playbook.json`, matches `prospect.industry` → panel (fallback `general`); discovery questions (Next), objection buttons, hook lines, company context strip. Pure lookup, no streaming.

---

## Phase 4 — Enhancement: SDR assist Stage 1 (FEAT‑168)

Mid‑call transcript keyword matching: every ~60s send the accumulated transcript to an agent, match `objections[].keywords`, surface the card automatically. **This is the only piece needing near‑real‑time transcription** (Transcribe streaming or chunked mid‑call) vs. the Phase‑1 batch path. The brief explicitly says **do not block Phase 1** on it. Ship after Stage 0 is validated.

---

## Phase 5 — Phase 2 GA (FEAT‑169, 170)

- **FEAT‑169 — Connect provisioning in IaC:** the CDKTF AWS provider (6.25.0) fully supports Connect — provision **inside the same gated construct**: `connect-instance` (in/outbound), `connect-phone-number` (AU/NZ DID), `connect-instance-storage-config` (`CALL_RECORDINGS` → S3 → the `numa-{client}-connect-recordings` bucket), all on `voiceProvider`. Store `connectInstanceUrl`/`recordingsBucket`/`didNumbers` in tenant config. Replaces the manual FEAT‑158 step for new customers.
- **FEAT‑170 — Admin phone‑number UI:** Settings panel (list/claim/release DIDs, monthly usage) + `/api/voice/numbers` routes (inside the gated construct) calling the Connect API.

---

## Cross‑cutting decisions (LOCKED 2026‑05‑29)

1. **Trigger path (SPK‑010 Q1): Option A — native Connect event source.** Build Voice as a first‑class native trigger source so the Post‑Call Agent is a real, user‑configurable Numa Automation. Phase 2 work: a Voice receiver/emitter that puts a `numa.connector.connect` EventBridge event (the existing `numa.connector.*` rule already routes it to `connector-event-dispatcher` — no new rule); a `connect` branch in `connector-event-dispatcher` that resolves the bound schedule and invokes the runner; a `connect` extractor (`extractors/index.ts`); a `ConnectEventTriggerSchema` variant in `lib/scheduling-schemas.ts` + an entry in `lib/event-sources.ts` (`source_type:'native'`) + a frontend trigger builder (per `numa-triggers`); and a `source==='connect'` interpolation branch in `agent-schedule-runner` so `{{ event.transcript }}`/`{{ event.prospect_id }}` resolve. The seeded schedule still pre‑exists (deterministic id), but firing flows through the native connector pipeline rather than a direct invoke.
2. **Prospect ingest trigger: separate intake bucket** — dedicated S3 bucket + its own `ObjectCreated`→Lambda, avoiding the one‑notification‑per‑bucket limit on the shared `data` bucket.
3. **NUMA_OPS dependency:** the Qualification Promoter writes to the Ops CRM. `NUMA_OPS` declared a dependency of `NUMA_VOICE` in capabilities metadata; degrade gracefully (mark `qualified:true` in the JSON, skip CRM creation) if Ops is off.
4. **Transcribe language:** default `en-NZ` (SPK‑010 Q6) vs the card's `en-AU`; make it config‑driven and close Q6 empirically.

## Risks / open items carried from SPK‑010

- Connect‑agent → Cognito‑sub identity mapping (for per‑SDR attribution) — needed if/when post‑call prompts go async; **not needed for MVP** because the wrap‑up panel is synchronous.
- PII redaction (Transcribe batch redaction unsupported for en‑AU/en‑NZ) — hardening.
- Call‑recording consent + recordings‑bucket retention/lifecycle (dedicated bucket, so no `outputsBucket` lifecycle collision).
- Region/data‑residency: ap‑southeast‑2 recordings vs a possibly us‑east‑1 KB/agent.

## Suggested sequencing

Phase 0 → Phase 1 + Phase 2 (parallelizable: infra vs agents) → Phase 3 (FE, depends on 1+2) → internal trial validation → Phase 4 (Stage 1) → Phase 5 (GA). Phases 0–3 = the internal Phase‑1 product.
