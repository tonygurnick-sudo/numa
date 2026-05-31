# SPK-010 — Tech Discovery: Numa Voice API requirements (answers)

**Spike outcome:** All six questions resolved against the current `feat/FEAT-160-ccp-softphone-widget` codebase. Each answer below is grounded in real `file:line` evidence and was independently adversarially verified.

> **TL;DR readiness.** The _AWS-side ingest legs_ (CCP widget, recordings bucket, Transcribe) are **unblocked** — they're net-new but low-risk and the patterns to follow exist. The _Numa-internal half_ (transcript → trigger → Post-Call Agent → write-back → notify SDR) is **conditionally unblocked**: the mechanisms all exist, but two **architectural decisions need a human call before FEAT-166/167 start** (see "Decisions needed"), and there is **no ready-made public webhook** — firing a named agent is more involved than the brief assumed.

---

## Decisions needed before agent-pipeline tickets start

1. **Trigger architecture (Q1):** native Connect event source vs. direct Lambda invoke of the schedule runner. Both need a pre-existing Automation record. _Recommendation: Option B (direct invoke) to ship Stage 0/1; Option A (native source) when Voice becomes a user-configurable Automation._
2. **Prospect-record storage shape (Q2):** one `master_prospects.json`, one-file-per-prospect in a KB, or a DynamoDB table. The KB write API has **no optimistic concurrency** — a single shared JSON is a last-writer-wins hotspot. _Recommendation: one-file-per-prospect, or DynamoDB if low-latency/structured state matters more than KB search._

Both are CLAUDE.md "architectural decisions require human input" items.

---

## Q1 — Numa webhook format (trigger a named agent with dynamic input)

**There is no generic public "Numa webhook" that fires an arbitrary named agent with arbitrary input.** Every agent-run entry point is bound to a **pre-existing persisted schedule/Automation record** (`scheduleId`), and the "named agent" is resolved by **`agentId`**, never by name.

- The async runner hard-requires `scheduleId` — `agent-schedule-runner/index.ts:745` throws `Missing scheduleId for scheduled run`.
- The two inbound webhook receivers are **source-hardcoded**: `connector-event-receiver` is Gmail-only (`index.ts:135-136`); `pipedream-event-receiver` only resolves a schedule via a Pipedream deployed-trigger id `dc_xxx` (`index.ts:167-201`). Neither accepts "run agent X with payload Y".

**Proven chain to a run:** receiver → EventBridge `numa.connector.*` bus → `connector-event-dispatcher` → `agent-schedule-runner` (async `InvokeCommand`, `type:'EVENT'`) → `POST /api/workspace-chat-agent/invocations` with `agentId` (Bearer `SCHEDULE_RUNNER_SECRET` + `x-arcanum-cloudfront-secret` + `x-schedule-runner-sub`). The EventBridge rule already routes **any** `numa.connector.*` + `detail-type: connector.event` to the dispatcher (`app-agnostic-api-gateway-lambda-collection.ts:2046-2052`) — **no new EventBridge infra needed**.

**Dynamic data → prompt** via `{{ event.<dotted.path> }}` interpolation (`interpolateEventVars`, `agent-schedule-runner/index.ts:480`), but **only** for `source==='gmail'`/`'pipedream'` today — a new `connect` source needs an interpolation branch or it gets no substitution.

### Two options for Numa Voice

**Option A — native `connect` event source (the "right" way; mostly net-new):** `numa-voice-processor` emits a `numa.connector.connect` EventBridge event → dispatcher → runner. Reuses the routing rule, dedupe, quota, notifications. Net-new: an emitter, a dispatcher branch (`connector-event-dispatcher/index.ts:654`, with `scheduleId` resolution since there's no `dc_xxx`), an optional extractor, a `ConnectEventTriggerSchema` (`lib/scheduling-schemas.ts:170`) + `event-sources.ts` entry + FE trigger builder, and a runner interpolation branch.

**Option B — `numa-voice-processor` invokes the runner directly (least net-new; recommended for Stage 0/1):** mirror `connector-event-dispatcher/index.ts:532-552`:

```jsonc
{
  "type": "EVENT",
  "scheduleId": "<Post-Call Agent automation id>", // MUST pre-exist
  "tenantId": "<client>",
  "event": {
    "source": "connect", // "pipedream" as interim shortcut → free {{ event.* }} interpolation
    "transcript": "<full call text>",
    "prospect_id": "prospect_12345",
    "dedup_key": "<transcribe-job-id>", // load-bearing: runner dedupes on event.dedup_key
  },
}
```

Net-new for B: `lambda:InvokeFunction` IAM + runner function name on `numa-voice-processor`; a one-line runner interpolation branch (`else if source==='connect'` at `index.ts:909`); and **the schedule record must pre-exist**. _(Option B2 — calling `/invocations` directly to skip the schedule — is NOT recommended: it forces you to re-implement the scheduled-run preamble, tool/KB/integration payload assembly, dedupe, quota, notifications, and run history that the runner gives for free.)_

**Hard prerequisite for both:** a schedule record (`numa-{client}-agent-schedules`) with `trigger_type:'event'`, `agent_id` = Post-Call Agent, and a non-empty `conversation_id` (`agent-schedule-runner/index.ts:1400`), **owned by a real Cognito sub** — that sub determines KB scope (`:1492`) and notification routing (`:1411`). There is no service/system identity.

---

## Q2 — Agent write-back to a Numa Files KB JSON

**Yes** — a scheduled/triggered agent can create or overwrite a named JSON in a Numa Files KB, but **only via a whole-file upload** (no PATCH/append/conditional write).

- Tool: `numa_tool(name="numa_files", operation="upload")` (`numa_tool.py:701`) → `add_to_kb` → `handle_add_to_kb` (`workspace-chat-tools/tools/knowledge_base.py:952`) → `s3_client.put_object` into the **DATA bucket** `numa-{client}-data` (prod; `numa-{client}-{env}-data` in dev) at key `documents/{company|kb-<uuid>|kb-<user_sub>}/{path}/{filename}` (`:1066`). Re-uploading the same key overwrites atomically.
- **Strongly-consistent read** of a named file via `operation="download"` (S3-direct, no vector search) — so a **download → mutate in /workdir → upload** round-trip has **zero index lag**.
- **Search (`query`) lags ~30 min** — Bedrock ingestion runs on `cron(0,30 * ? * * *)` (`knowledge-base-construct.ts:668`). Affects semantic search only, not exact-filename reads.
- **Permissions:** upload requires EDITOR/OWNER; the Company KB is **admin-only**. The run executes as the schedule owner, so that user must hold write access — a dedicated shared "Voice" folder KB with the post-call service user as editor is cleanest.

**Watch-out:** `put_object` is unconditional — **no optimistic concurrency**. Two concurrent post-call runs on one shared `master_prospects.json` will last-writer-wins and silently drop an update. Prefer one file per prospect, or a DynamoDB table (see Decisions).

---

## Q3 — Agent push an inline prompt/notification to a specific user's UI

**Partial — bigger gap than "wire it up."** Two per-user mechanisms exist; **neither** is an out-of-band interactive push to an SDR who isn't currently mid-stream (which is exactly the post-call state).

1. **In-chat HITL approval (`tool_approval`)** — interactive and per-user, but **live-session only**: `sdk_runner.py:1459` emits the frame on the active chat stream and the tool Lambda blocks on `poll_approval()` with a **180s** timeout (`workspace-chat-tools/tools/approval.py:101`). Can't reach an SDR not mid-chat, and 180s is far too short to wait for a human after a call.
2. **Async per-user notification inbox** — the right primitive: `{client}-notifications` DynamoDB, hashKey `user_id` = Cognito sub, 90-day TTL (`core-numa-infra-construct.ts:819`). The Zod schema even permits `schedule_type:'transcription'`. **But as shipped:** (a) **no real-time push** — `notifications-stream` is a stub and `useNotificationStream.connect()` is hard-coded `setIsConnected(false)`; (b) **no polling** — the bell refreshes only on mount; (c) **not interactive** — the `PUT` API only accepts `status: read|dismissed`, no decision field; (d) **no producer reachable from the agent** — the Node producer is wired only into `agent-schedule-runner`, and its `createNotification` signature does **not** accept `event_type:'new_event'` (the schema allows it; the helper must be widened first).

**To deliver the "Did they qualify?" prompt, net-new:** (a) a producer hook (widen `createNotification` or add a small Python writer to `{client}-notifications`); (b) an interactive action-button variant + decision write-back (extend `UpdateNotificationPayloadSchema` + the `PUT` handler, or write the answer straight to the prospect record); (c) real-time delivery (cheap: `setInterval` poll on `NotificationBell`; proper: revive `notifications-stream` via Lambda Web Adapter / API GW WebSocket); plus a **Connect-agent → Cognito-sub identity map** captured at call time (does not exist).

---

## Q4 — CSP changes for the Connect CCP iframe + microphone

**Numa ships NO Content-Security-Policy and NO security response headers at all today.** The FE CloudFront distribution (`numa-frontend-infra-construct.ts:623-654`) attaches no `responseHeadersPolicyId` on any behavior; no Lambda@Edge / CloudFront Functions; `index.html` has no CSP meta; no `_headers` file (repo-wide grep = zero hits).

**Consequence:** there is **nothing to relax** — the browser won't block the CCP iframe on CSP grounds. The work needed today is **AWS-side, not Numa-CSP-side**:

1. The CCP iframe needs `allow="microphone; autoplay; clipboard-write"` — `amazon-connect-streams` `initCCP()` sets `allow="microphone"` on the iframe it creates; set it yourself if you hand-roll the wrapper.
2. `initCCP({ softphone: { allowFramedSoftphone: true } })`.
3. **Allowlist the Numa domain in the Amazon Connect instance's Approved Origins** (controls Connect's own `frame-ancestors`) — this is the actual gating step, done in the Connect console / `connect:AssociateApprovedOrigin`, outside this repo.

**The real risk is the opposite direction:** if anyone later adds a CSP / restrictive `Permissions-Policy`, mic delegation to the cross-origin iframe will **silently break**. So the durable fix is to add a **Connect-aware** `CloudfrontResponseHeadersPolicy` now (net-new — Numa has no precedent; no iframe uses `allow=` today, only `sandbox=`; `amazon-connect-streams` is not yet a dependency). If/when a CSP is added it must include (confirm hosts against the provisioned ap-southeast-2 instance — `.my.connect.aws` new vs `.awsapps.com` legacy):

```
frame-src   'self' https://*.my.connect.aws https://*.awsapps.com;
connect-src 'self' https://*.my.connect.aws https://*.awsapps.com wss://*.connect.aws https://*.amazonaws.com;
media-src   'self' blob: mediastream:;
Permissions-Policy: microphone=(self "https://<instance>.my.connect.aws"), autoplay=(self "https://<instance>.my.connect.aws")
```

(A header-policy change needs a CloudFront invalidation — `invalidate-cloudfront-construct.ts` exists.)

---

## Q5 — Tenant config store (connectInstanceUrl, recordingsBucket)

Store in the existing **`numa-client-config` DynamoDB table** (deployer account, source of truth; `clientConfigProd.json` is local-dev only), typed by `clientConfigSchema` in `numa-client-stack.ts:1176-1575`.

- **`connectInstanceUrl` + a `NUMA_VOICE` flag → config-stored** (external/non-derivable, like `customDomain`/`senderEmail`). Add `numaVoice` (optional bool, default false) and `connectInstanceUrl` (optional string) to the schema **before the `.strict()` at `:1574`** — Zod rejects every deploy otherwise (and breaks every tool importing the schema).
- **`recordingsBucket` → NOT config-stored; derive it** like every other per-client bucket via `NumaCorsEnabledBucket`. **The brief's `numa-connect-recordings-{tenant}` is wrong** — the convention (`cors-enabled-bucket.ts:49`) yields **`numa-{client}-connect-recordings`** (`numa-{client}-{env}-connect-recordings` in dev). Pass the derived name to `numa-voice-processor` as an env var (`search-construct.ts:87-91` pattern).
- **FE threading:** add `NUMA_VOICE` + `CONNECT_INSTANCE_URL` to the `config.json` block (`numa-client-stack.ts:887-948`); `ConfigSetup.tsx:106-138` auto-stores every key to sessionStorage; the CCP widget gates with `getFlag('NUMA_VOICE')` and reads `CONNECT_INSTANCE_URL`. Add a `NUMA_VOICE` entry to `capabilities-metadata.ts` and run `seed-capabilities-metadata.ts`.
- **Region:** Connect/Transcribe are ap-southeast-2 while many stacks default us-east-1 — **pin `clientConfig.region`** for the voice processor, bucket, and Transcribe (a region-mismatched custom vocabulary is silently ignored).

---

## Q6 — Transcribe en-AU vs en-NZ (factual answer + test plan; empirical part needs audio)

**Confirmed without audio** (AWS supported-languages matrix + CreateVocabulary API, fetched 2026-05-29):

- Both **`en-AU` and `en-NZ` are valid batch `LanguageCode` values**, both support speaker diarisation (`ShowSpeakerLabels:true`, `MaxSpeakerLabels` 2–30; use 2) and custom vocabulary.
- Feature delta: **`en-AU` supports Custom Language Models + Connect Call Analytics; `en-NZ` supports neither.** Irrelevant to this pipeline (plain batch `StartTranscriptionJob` + a Numa Post-Call Agent, not Call Analytics). At the standard-model + custom-vocab tier the two are **feature-equivalent** here.
- Batch redaction is unsupported for both (streaming-only) → PII scrubbing is a separate post-processing step.
- **Custom vocabulary is language-locked AND region-locked**: a vocab's `LanguageCode` and Region must match the job, so an A/B test must build the vocab **twice** (en-NZ and en-AU), both in ap-southeast-2.
- For Connect **dual-channel** recordings (SDR/prospect on separate channels), `Settings.ChannelIdentification:true` is more reliable than diarisation.

**Reuse:** `lib/aws-transcribe` already exposes `transcribe(language_code, max_speakers)` (`__init__.py:153`) — call with `'en-NZ'`, `max_speakers=2`. Net-new in that lib: a `VocabularyName` setting and a `ChannelIdentification` flag (hardcoded `False` at `:47`); and IAM `transcribe:CreateVocabulary`/`GetVocabulary` on the voice processor (the existing `workspace-chat-tools` role only has Start/Get — `workspace-chat-tools-construct.ts:298`). _(Note: `workspace-chat-tools/tools/transcribe.py` is a separate, richer implementation — extend `lib/aws-transcribe`, not that one.)_

**Provisional recommendation:** default **`en-NZ`** for NZ calls, keep `en-AU` as fallback (pick it only if the roadmap needs a CLM / Call Analytics), always attach a per-language custom vocabulary.

**⚠️ The one residual that can't be closed in this spike: the actual en-AU-vs-en-NZ accuracy comparison needs a real NZ call recording (no audio available here).** Closeout test plan (ready to run when audio lands):

- **Sample:** 15–20 real dual-channel NZ SDR calls (2–5 min, mixed accents, some te reo).
- **Method:** per call run two batch jobs identical except `LanguageCode`, each with its matched vocab; hand-correct one gold reference per call.
- **Metrics:** WER (jiwer) + targeted-term recall on NZ place names, te reo words/names, company names, dollar amounts, phone numbers (numbers/$ must be ~100% — wrong figures poison the agent's scoring).
- **Bar:** aggregate WER ≤ ~15% on clean audio AND ≥ ~90% targeted-term recall. Pick the winner on weighted term recall (WER tiebreaker); default en-NZ if within noise.
- **Prep now (no audio):** add `vocabulary_name` + `use_channel_identification` to `lib/aws-transcribe`; seed both vocabularies in ap-southeast-2; add the Transcribe IAM; build a jiwer + term-recall harness under `tools/`.

---

## Additional net-new work surfaced (not in the original questions)

- **Connect-agent → Cognito-sub identity map** (capture at call time, e.g. Connect Contact Attributes) — shared prerequisite for Q2 write-perms and Q3 targeting. Does not exist.
- **S3-ObjectCreated → `numa-voice-processor`** wiring, the Lambda itself, and its IAM (Transcribe + `s3:GetObject` on recordings and the KB DATA bucket) — all net-new.
- **PII/redaction** of stored transcripts/prospect records (Transcribe batch redaction is unavailable).
- **Call-recording consent capture + retention/lifecycle** on the recordings bucket; **data-residency review** for ap-southeast-2 recordings feeding a possibly us-east-1 KB.
- **Post-Call Agent type config** authored so KB upload is reachable without an interactive HITL approver.
- **Stale artifacts on this branch:** `TranscriptionServiceConstruct` and `transcription-dispatcher` exist **only as compiled `infra/dist` output** (source lives in git history on other branches); `s3-event-publisher` is an empty scaffold. Do **not** assume they're deployable from `feat/FEAT-160`.

---

## Recommended build sequence

- **Phase 0 — decisions + foundations:** resolve the two architectural decisions above; land the Q5 config schema first (`numaVoice` + `connectInstanceUrl` before `.strict()`, the `config.json` keys, the capabilities-metadata entry, region pin) — nothing deploys cleanly until this lands.
- **Phase 1 — ingest legs (parallel, low-risk):** CCP widget (Q4) gated by `getFlag('NUMA_VOICE')` + Connect Approved Origins; recordings bucket (`numa-{client}-connect-recordings`) + S3-event → `numa-voice-processor` + Transcribe IAM. **Capture the Connect→Cognito identity map here.**
- **Phase 2 — transcription (Q6):** extend `lib/aws-transcribe` (vocab + channel-id flag), seed both vocabularies, default en-NZ + ChannelIdentification, build the A/B harness.
- **Phase 3 — trigger + Post-Call Agent (gating leg):** wire transcript → trigger → runner EVENT payload; author the Post-Call Agent as a persisted Automation owned by a service user with EDITOR on the target KB.
- **Phase 4 — write-back + notify (Q2 + Q3):** download→mutate→upload to the prospect record (no query-lag); widen the notification producer + add interactive variant + real-time delivery for the SDR prompt.
- **Phase 5 — hardening:** empirical Transcribe A/B once audio exists; PII scrubbing; consent + retention; data-residency review.
