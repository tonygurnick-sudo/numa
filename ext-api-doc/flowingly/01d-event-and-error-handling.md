---
api_name: 'Flowingly'
api_slug: 'flowingly'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
confidence: 'LOW — webhook step is DOCUMENTED but payload envelope/signature are partial/UNKNOWN; error HTTP codes are INFERRED, not live-tested.'
---

# Flowingly -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Covers event-driven capabilities (outbound webhook step,
> polling), the error envelope, and recovery playbooks.
>
> ⚠️ **DISCOVERY-REQUIRED.** The webhook step is [DOCUMENTED] but its exact payload envelope and any
> signature/secret scheme are **partial/UNKNOWN**. The error model is [DOCUMENTED] as a
> `success`/`errorCode`/`errorMessage` envelope, but **whether failures are HTTP 200 or 4xx/5xx, and
> the `errorCode` catalogue, are UNKNOWN.** Nothing here is live-verified.

---

## Event-Driven Capabilities

| Mechanism                | Supported      | Notes                                                                                |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------ |
| Webhooks (outbound)      | **Yes**        | A "Webhook - Form" step in a flow model POSTs form JSON to your URL [DOCUMENTED]     |
| Webhook management API   | No             | Webhooks are configured in the modeller (web UI), not via the API [DOCUMENTED]       |
| WebSocket                | No             | None found [UNKNOWN/None]                                                            |
| Server-Sent Events (SSE) | No             | None found [UNKNOWN/None]                                                            |
| Long polling             | No             | None found [UNKNOWN/None]                                                            |
| Change feeds / streams   | No             | None found [UNKNOWN/None]                                                            |
| Polling for changes      | **Not viable** | No list/changed-since endpoint exists — cannot discover new/changed flows [INFERRED] |

> **Key implication:** for Numa Automations, **the outbound Webhook step is the ONLY usable trigger
> source.** Polling cannot detect new or changed flows because there is no list endpoint to query.
> [INFERRED]

---

## Webhooks (Outbound Webhook Step)

### Direction & Setup

- **Direction:** Outbound only — Flowingly POSTs to an endpoint **you** configure. There is no inbound webhook receiver in Flowingly's API. [DOCUMENTED]
- **Setup:** Added in the flow modeller as a **"Webhook - Form"** integration step, with an **Endpoint URL**. NOT configurable via the Public API — a Flowingly Business Administrator sets it up in the web UI. [DOCUMENTED]
- **Trigger:** When the form/step containing the webhook is submitted, Flowingly sends a JSON payload to the Endpoint URL. [DOCUMENTED]

### Payload

- **Format:** JSON matching the form fields defined on the webhook step — short text, long text, option lists, date fields, etc. The exact envelope/field-naming is **not fully documented**. [DOCUMENTED, partial]
- **Schema validation:** Flowingly validates the payload against a **JSON schema generated from a test payload** during setup. [DOCUMENTED]
- **Illustrative payload (shape INFERRED — confirm with a live receiver):**

```json
{
  "flowIdentifier": "FLOW-9042",
  "stepIdentifier": "New Customer (Debtor) Form",
  "fields": [
    { "name": "Customer Name", "identifier": "field4938201746", "value": "Acme Ltd" },
    { "name": "Email", "identifier": "field4938201747", "value": "jo@acme.com" }
  ]
}
```

> ⚠️ The above is **illustrative only**. The real envelope (top-level keys, whether `flowIdentifier`
> is included, field representation) MUST be captured from an actual webhook delivery. [UNKNOWN]

### Security ⚠️ (flag for security review)

- **No documented signature / HMAC / secret / IP allowlist.** [UNKNOWN]
- Treat inbound webhook calls as **unauthenticated** unless a shared secret is added manually — e.g. a secret query param or path token baked into the Endpoint URL when configuring the step. [INFERRED]
- The Numa receiver should: (a) require a secret in the URL/header, (b) validate the payload against the expected schema, and (c) not trust `flowIdentifier`/`value` blindly. [INFERRED — security best practice]

### Reliability

- Retries, ordering, delivery guarantees, and dedup behaviour are **undocumented**. Assume at-least-once delivery is possible and make the receiver idempotent. [UNKNOWN]

### Canonical Flow-to-Flow Pattern [DOCUMENTED]

```
[Flow A] ──Webhook step submit──> [Your endpoint / middleware (e.g. Azure Logic Apps)]
                                              │  (process + map fields)
                                              ▼
                              POST /public/startflow  (Authorization: Bearer ...)
                                              │
                                              ▼
                                        [Flow B starts]
```

This is the documented way to chain flows: a Webhook step in Flow A hands data to middleware, which
authenticates and calls `POST /public/startflow` to launch Flow B with pre-populated values. In Numa,
the "middleware" is the trigger receiver + a `connect_request` call. [DOCUMENTED]

---

## Polling Fallback

> **Not viable as a discovery mechanism.** There is no list / changed-since / search endpoint, so you
> cannot poll to find new or modified flows. The only readable state is `GET /public/flow/{id}/step/{stepId}`
> for a **flow you already know**. [INFERRED]

If you already hold a `flowIdentifier` + step name and want to detect when a user has filled the
form, you could poll that one step:

```http
GET /public/flow/FLOW-9042/step/Step%201
Authorization: Bearer {accessToken}
```

- Compare field `value`s across polls to detect changes.
- There is no `lastModified` field documented, so change detection is value-diffing only. [INFERRED]
- Poll conservatively (e.g. ≥ 60s) — rate limits are unknown. [INFERRED]

For anything broader (new flows, flows you didn't start), **use the Webhook step instead.**

---

## Error Handling

### Application-Level Error Envelope [DOCUMENTED]

Start Flow (and, by inference, Update Step Fields) return a `success` envelope:

```json
{
  "success": false,
  "errorCode": "SOME_CODE",
  "errorMessage": "Human readable reason",
  "dataModel": null
}
```

⚠️ **Two unknowns that materially affect handling:**

1. **HTTP status on failure is UNKNOWN.** It is unclear whether failures return HTTP 200 with
   `success:false`, or a 4xx/5xx. **Always check BOTH the HTTP status AND the `success` field.** [UNKNOWN]
2. **The `errorCode` catalogue is undocumented.** Do not branch on specific codes until they are
   captured from a live instance; surface `errorMessage` to the user. [UNKNOWN]

### Auth Errors

- The `/authorise` error shape is undocumented. Expect 400/401 for bad credentials, or possibly a
  `success:false` body. Capture on live. [UNKNOWN]
- A token expiry on a subsequent call likely returns 401 (or a `success:false`). **Recovery:**
  re-run `/authorise` (no refresh token available) and retry the call once. [INFERRED]

### Validation Errors (step fields)

- Field values are validated against modeller-configured rules. **Custom error messages** (configured
  by the admin in the modeller) are returned; otherwise **default validation errors** apply. The
  structure (single message vs per-field array) is undocumented. [DOCUMENTED, partial]
- Partial-failure semantics (one bad field in a bulk array) are unknown — treat as all-or-nothing and
  re-GET to confirm what was applied. [UNKNOWN]

### Recovery Playbook (ALL INFERRED — none confirmed)

| HTTP Status | Meaning (assumed)            | Retryable? | Recovery Action                                                      | Max Retries |
| ----------- | ---------------------------- | ---------- | -------------------------------------------------------------------- | ----------- |
| 200         | OK — **inspect `success`**   | n/a        | If `success:false`, surface `errorMessage`; do NOT retry blindly     | 0           |
| 400         | Bad request / validation     | No         | Fix payload — check PascalCase (Start Flow), required fields, casing | 0           |
| 401         | Unauthorized / token expired | Yes        | Re-run `/authorise`, retry once (no refresh token)                   | 1           |
| 403         | Forbidden                    | No         | Confirm the account is a **Business Administrator**                  | 0           |
| 404         | Flow / step not found        | No         | Verify `flowIdentifier` and the **URL-encoded** step name            | 0           |
| 409         | Conflict (assumed)           | Maybe      | Re-GET the step, resolve, retry                                      | 1           |
| 429         | Rate limited (assumed)       | Yes        | Backoff (no documented `retry-after`); exponential, max ~60s         | 3           |
| 5xx         | Server error                 | Yes        | Exponential backoff + jitter                                         | 3           |

### Backoff Strategy (no documented rate-limit headers)

1. No `retry-after` or `x-ratelimit-*` headers are documented — do not depend on them. [UNKNOWN]
2. On 429/5xx: exponential backoff starting at 2s, max 60s, with 0–1s jitter. [INFERRED]
3. **Never auto-retry `POST /public/startflow`** — it is not idempotent; an ambiguous failure may
   have already started a flow. Surface to the user and confirm before re-calling. [INFERRED]

---

## Counter-Exceptions

1. **Failures may not be HTTP errors.** A `200 OK` can still mean failure if `success:false`. Check the body. [DOCUMENTED envelope / UNKNOWN codes]
2. **No refresh token.** `refreshToken` is `null` in docs — re-authenticate from credentials rather than refreshing. [DOCUMENTED `null` / INFERRED behaviour]
3. **Webhooks are configured outside the API.** You can't register/list/delete them programmatically — it's all in the modeller. [DOCUMENTED]
4. **Polling can't discover flows.** Unlike most APIs, there is no "list changed since" — webhooks are the only event source. [INFERRED]
5. **`startflow` is not idempotent and has no idempotency key.** Retries create duplicate flows. [INFERRED]

---

## Output Formatting Guide

> How to present Flowingly results to the user in the workspace agent.

| Data Type       | Format                         | Example                                                              |
| --------------- | ------------------------------ | -------------------------------------------------------------------- |
| Started flow    | Identifier + subject + step    | "Started FLOW-9042 'Acme Ltd onboarding' — now at step 'Step 1'"     |
| Step fields     | name: value list               | "Customer Name: Acme Ltd; Email: jo@acme.com; Account Type: (empty)" |
| List-type field | value + available options      | "Account Type: — (options: Standard, Premium)"                       |
| Update result   | Confirmation + re-read summary | "Saved 2 fields to FLOW-9042 / Step 1. Customer Name and Email set." |
| Actor           | email or team name             | "jo@acme.com" or "Team: Finance"                                     |
| Error           | Plain `errorMessage`           | "Could not start flow: 'New Customer Onboarding' model not found"    |

### Display & Safety Rules

- After any write, **re-GET the step** and confirm the values that actually stuck (write response shape is uncertain). [INFERRED]
- When showing a step with empty required fields, point them out so the user can supply values.
- Before starting a flow, **echo the model `Name`, `Subject`, and actors back to the user for confirmation** — flows trigger real notifications/approvals. [INFERRED best practice]
- Never invent a `flowIdentifier` or model `Name`; if missing, ask the user (you cannot look them up).

---

_Generated from the investigation questionnaire, Phases 7-8 (2026-05-29). LOW confidence — webhook payload/signature and error HTTP codes are unverified; nothing is live-tested._
