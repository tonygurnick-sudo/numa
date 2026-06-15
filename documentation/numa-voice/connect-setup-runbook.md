# Numa Voice — Amazon Connect Setup Runbook (FEAT-158, Phase 1)

This runbook covers **manually** provisioning the Amazon Connect instance that backs
Numa Voice for a tenant — the Phase-1 path, used for internal SDR trials before the
Phase-2 automated provisioning (FEAT-169) is enabled.

> **When do I need this?** Only when the tenant's client config has
> `numaVoice: true` **and** `connectAutoProvision` is **false/unset**. In that mode
> Numa does **not** create the Connect instance — you create it by hand and record
> its URL back into the client config. If `connectAutoProvision: true`, skip this
> runbook: the instance, recordings bucket, KMS key, and approved origin are all
> provisioned by IaC (`infra/constructs/numa-voice-construct.ts`). The **DID claim is
> gated by a separate `connectClaimDid` flag** (off by default, so no client is
> surprise-billed) — with `connectAutoProvision: true` but `connectClaimDid` unset
> you still claim numbers via the Voice Admin panel / console.

> **Deploy-time guard.** The client stack will **fail at synth** if `numaVoice` is on,
> `connectAutoProvision` is off, and `connectInstanceUrl` is missing or malformed
> (see `isValidConnectInstanceUrl` in `numa-voice-construct.ts`). That guard exists so a
> misconfigured tenant can't ship a silently-broken softphone — if you hit it, this
> runbook is what it's pointing you at.

---

## What Numa already creates (do NOT recreate these)

Even on the manual path, deploying the client stack with `numaVoice: true` creates:

| Resource                      | Name / location                                      | Notes                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Call-recordings S3 bucket     | `numa-{client}-connect-recordings` (ap-southeast-2)  | SSE-S3 (AES256), public access blocked. **Point Connect's recording storage here** — do not create a new bucket.                                                   |
| `numa-voice-processor` Lambda | region-pinned to `ap-southeast-2`                    | Watches `s3://numa-{client}-connect-recordings/recordings/*.wav` → starts Amazon Transcribe → writes the transcript to the company KB → fires the Post-Call agent. |
| DLQ + alarms                  | `{client}-voice-processor-dlq` + 4 CloudWatch alarms | Pipeline monitoring.                                                                                                                                               |
| Voice Admin API + CCP UI      | `/api/voice/*`, `/chat` Voice surface                | Phone claim/release, approved origins, federation login.                                                                                                           |

So the manual steps below are really: **create the instance, wire its recording
storage to the bucket Numa already made, claim numbers, add the origin, and record
the instance URL back into config.**

---

## Region

Create everything in **`ap-southeast-2` (Sydney)** — this is `NUMA_VOICE_REGION`.
Amazon Connect requires its recordings bucket in the same region, and the processor
Lambda + Transcribe are pinned there. Do **not** create the instance in another region.

---

## Steps

### 1. Create the Connect instance

1. Amazon Connect console (ap-southeast-2) → **Add an instance**.
2. Identity management: **Store users in Amazon Connect** (or SAML — see note below).
3. **Instance alias:** use `numa-{client}` (e.g. `numa-arcanum-demo-tony`). This matches
   the alias the Voice Admin Lambda resolves by (`INSTANCE_ALIAS`), so phone/queue/origin
   admin works without extra config.
4. Telephony: enable **outbound calls**. (Inbound is not required for SDR use.)
5. Finish creating the instance.

> **SAML note (passwordless agent login).** The CCP federation endpoint
> (`GET /api/voice/federation-token`) mints a console-federation SignInUrl for SAML
> instances. Each Numa user federates as their **own** Connect agent (derived from
> their email/sub and auto-provisioned via `ensureConnectUser`) so calls, recordings
> and post-call attribution are isolated per person. The shared `numa-voice-agent`
> user (`AGENT_USERNAME`) exists only as a fallback when a token carries no usable
> identity — it provides no call isolation. Embedded CCP login is Chrome/Edge only
> (third-party cookies on `*.my.connect.aws`).

### 2. Enable call recording → the Numa bucket

1. Instance → **Data storage** → **Call recordings** → **Edit**.
2. Choose **existing S3 bucket**: `numa-{client}-connect-recordings`.
3. **Prefix:** `recordings` (the processor's S3 trigger is `recordings/*.wav`).
4. Save. Connect will add a bucket policy granting `connect.amazonaws.com` write access —
   that's expected and is **not** blocked by the bucket's public-access block (a
   service-principal grant is not "public").

> Encryption: the bucket is SSE-S3 (AES256), so the processor reads recordings with
> plain `s3:GetObject` — **no KMS key or `kms:Decrypt` grant is needed on the manual
> path.** (The auto-provision path adds a customer-managed KMS key and the matching
> grants; don't mix the two.)

### 3. Record both channels

In the recording behavior of your outbound contact flow (step 6) / queue, enable
recording of **both the agent and the customer** audio. Two-channel audio is what lets
Amazon Transcribe diarise the call into `spk_0` (SDR) and `spk_1` (prospect) — the
processor asserts exactly two speakers and alarms (`DiarisationUnexpected`) when it's
not, so single-channel recording will degrade the post-call analysis.

### 4. Claim AU/NZ DID numbers (at least 2 for testing)

Either:

- **Console:** Connect → Channels → **Phone numbers** → Claim a number (country AU or NZ,
  type DID), or
- **Numa Voice Admin panel** (`/chat` → Voice → Admin) → claim a number. This uses the
  Voice Admin Lambda and, on success, **writes the DID list back to client config**
  (FEAT-169) so `didNumbers` stays current.

Set one number as the queue's **outbound caller ID** (Voice Admin panel → set caller-id,
or the console queue's outbound caller-ID config).

> Outbound country enablement: if AU/NZ outbound is not yet enabled on the account, use
> the Voice Admin panel's **"request outbound country"** action — it files an AWS Support
> case (Business+ plan) or returns a pre-filled console link.

### 5. Add the Numa domain to Approved Origins (required for the CCP iframe)

1. Instance → **Approved origins** → Add domain.
2. Add `https://{client}.numa.arcanum.ai` (this matches `APPROVED_ORIGIN`).
3. The Voice Admin panel can also add/remove this for you (it calls
   `AssociateApprovedOrigin`). The CCP softphone will not load in the Numa iframe
   without this.

### 6. Create a basic outbound contact flow

1. Connect → Routing → **Contact flows** → create a simple outbound whisper/flow (the
   default outbound flow is fine for SDR dialing).
2. Ensure the flow / queue has **recording enabled for both channels** (step 3).

### 7. Record the outputs back into client config ← the step the deploy guard enforces

Document and persist:

| Output                    | Where it goes                                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connect instance URL**  | `connectInstanceUrl` in the tenant's `numa-client-config` record. Use the instance **access URL**, e.g. `https://numa-{client}.my.connect.aws` — **not** the `/connect/ccp-v2` softphone URL (the guard rejects that). |
| **Recordings bucket ARN** | Already known: `arn:aws:s3:::numa-{client}-connect-recordings`. FEAT-169 also persists `recordingsBucket` to config automatically once an admin touches the Voice Admin panel.                                         |
| **DID numbers**           | Persisted to config as `didNumbers` automatically by the Voice Admin claim/caller-id actions (FEAT-169), or document them manually.                                                                                    |

Set `connectInstanceUrl` via the Customer Success Portal (or the deployer-account
`numa-client-config` table) **before** the next client-stack deploy — otherwise the
synth guard will fail the deploy (by design).

---

## Recording consent

Numa Voice has a three-part recording-consent flow:

1. **Agent whisper** — the auto-provisioned `numa-voice-outbound-whisper` contact flow plays
   a `MessageParticipant` reminder to the SDR _before_ they connect ("…please tell the
   prospect the call is being recorded"). On the **manual** path, add an equivalent
   `MessageParticipant` step to the front of your outbound whisper flow.
2. **UI banner** — a persistent recording-disclosure banner is always shown on the Voice
   page (`RecordingConsentBanner`).
3. **Wrap-up attestation** — the SDR confirms "I told the prospect this call was being
   recorded" in the post-call wrap-up; it's persisted as `recording_disclosed` on the
   per-call outcome record (`voice/outcomes/{contactId}.json`) as the audit artifact.

AU/NZ are generally one-party-consent for the recording party, but disclosure is best
practice and required in some jurisdictions — keep all three in place.

## Verification

After setup + a client-stack deploy:

1. **Softphone loads:** open `/chat` → Voice. The CCP iframe should render and show the
   agent as available (no "instance URL missing" / blank CCP).
2. **Make a test call** to your own phone; hang up after a few seconds.
3. **Recording lands:** check `s3://numa-{client}-connect-recordings/recordings/` for a
   `.wav`.
4. **Transcript produced:** within ~1–2 min a Transcribe job (`numa-voice-{client}-…`)
   completes and a transcript appears in the company KB under
   `documents/company/voice/transcripts/`.
5. **Post-call ran:** the prospect record in `today_calls.json` / `master_prospects.json`
   gets `call_summary` + the structured fields (objections, next_steps, rating, …).

## Troubleshooting

| Symptom                                                                                                                                                                            | Likely cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synth fails: _"connectInstanceUrl is missing"_                                                                                                                                     | `numaVoice` on + `connectAutoProvision` off + no URL. Do step 7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Synth fails: _"not a valid Amazon Connect instance URL"_                                                                                                                           | You pasted the CCP URL or a wrong host. Use the bare instance URL on `*.my.connect.aws`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CCP iframe blank / won't load                                                                                                                                                      | Approved origin missing (step 5), or a non-Chromium browser blocking third-party cookies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Recording never produces a transcript                                                                                                                                              | Recording storage not pointed at `numa-{client}-connect-recordings` with prefix `recordings/` (step 2), or single-channel recording. Check the `{client}-voice-processor-dlq` and the `{client}-voice-transcription-failed` alarm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `DiarisationUnexpected` alarm firing                                                                                                                                               | Calls recorded single-channel, or lots of voicemails (1 speaker). Confirm both-channel recording (step 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Softphone "Connect phone" → CCP federate page shows **"Access denied — Please contact your AWS account administrator"** (and the embedded softphone stays on "Connect your phone") | **You are signed in to the AWS Console in the same browser.** The passwordless login federates through `signin.aws.amazon.com` → `/connect/federate`; an existing AWS Console session hijacks that hop, so the federate page runs as your console identity (not your voice agent) and denies. **It only affects users with a live AWS Console session — every real SDR works.** Fix: open Numa in a browser profile that is **not** signed in to the AWS Console (a normal Chrome/Edge profile — **not** Incognito, which blocks the third-party cookies the embedded CCP needs). Verified: the federation token + agent are correct; in a console-free browser the exact flow lands on `/ccp-v2` and the CCP session is just the `lily-auth-prod-syd` cookie (= the `GetFederationToken` AccessToken). The frontend shows this guidance automatically (`ccp.loginStalledHint`) after a stalled sign-in. |

## Related

- `infra/constructs/numa-voice-construct.ts` — the construct (recordings bucket, processor, DLQ, alarms, pre-flight guard, Phase-2 auto-provision block).
- FEAT-169 — automated provisioning + config write-back (`numa-voice-config-writer`).
- `.claude/skills/numa-voice/SKILL.md` — workspace-agent skill for the Voice feature.
