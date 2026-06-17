---
api_name: Flowingly
api_slug: flowingly
companion_to: 01-llm-api-rules.md
source_phases: Phase 7 (real-time & event-driven), Phase 8 (operational concerns)
confidence: webhook step is [DOCUMENTED] but its payload envelope/signature are partial/[UNKNOWN]; error HTTP codes are [INFERRED], NOT live-tested. Tags inline where not [DOCUMENTED].
---

# Flowingly — Event & Error Handling Reference

## Event-driven capabilities

| Mechanism              | Supported      | Notes                                                                            |
| ---------------------- | -------------- | -------------------------------------------------------------------------------- |
| Webhooks (outbound)    | **Yes**        | a "Webhook - Form" step in a flow model POSTs form JSON to your URL [DOCUMENTED] |
| Webhook management API | No             | configured in the modeller (web UI), not the API [DOCUMENTED]                    |
| WebSocket              | No             | [UNKNOWN/None]                                                                   |
| Server-Sent Events     | No             | [UNKNOWN/None]                                                                   |
| Long polling           | No             | [UNKNOWN/None]                                                                   |
| Change feeds / streams | No             | [UNKNOWN/None]                                                                   |
| Polling for changes    | **Not viable** | no list/changed-since endpoint → cannot discover new/changed flows [INFERRED]    |

**Key implication:** for Numa Automations the **outbound Webhook step is the ONLY usable trigger source** — polling cannot detect new/changed flows (no list endpoint) [INFERRED].

---

## Webhooks (outbound Webhook step)

- **Direction:** outbound only — Flowingly POSTs to an endpoint **you** configure; no inbound webhook receiver in the API [DOCUMENTED].
- **Setup:** added in the flow modeller as a **"Webhook - Form"** step with an **Endpoint URL**; NOT configurable via the Public API — a Business Administrator sets it up in the web UI [DOCUMENTED].
- **Trigger:** when the form/step containing the webhook is submitted, Flowingly POSTs a JSON payload to the Endpoint URL [DOCUMENTED].
- **Payload:** JSON matching the webhook step's form fields (short/long text, option lists, dates, etc.). Exact envelope/field-naming NOT fully documented [DOCUMENTED, partial]. Flowingly validates the payload against a **JSON schema generated from a test payload** during setup [DOCUMENTED].
- **Illustrative payload (shape INFERRED — confirm with a live receiver; real top-level keys / whether `flowIdentifier` is included / field representation MUST be captured from an actual delivery):**
  `{"flowIdentifier":"FLOW-9042","stepIdentifier":"New Customer (Debtor) Form","fields":[{"name":"Customer Name","identifier":"field4938201746","value":"Acme Ltd"},{"name":"Email","identifier":"field4938201747","value":"jo@acme.com"}]}`

### Security ⚠️ (flag for security review)

**No documented signature / HMAC / secret / IP allowlist** [UNKNOWN]. Treat inbound webhook calls as **unauthenticated** unless a shared secret is added manually (e.g. a secret query param or path token baked into the Endpoint URL when configuring the step) [INFERRED]. The Numa receiver should: (a) require a secret in the URL/header, (b) validate the payload against the expected schema, (c) not trust `flowIdentifier`/`value` blindly [INFERRED].

### Reliability

Retries, ordering, delivery guarantees, dedup are undocumented. Assume at-least-once delivery — make the receiver idempotent [UNKNOWN].

### Canonical flow-to-flow pattern [DOCUMENTED]

```
[Flow A] ──Webhook step submit──> [Your endpoint / middleware (e.g. Azure Logic Apps)]
                                          │ (process + map fields)
                                          ▼
                          POST /public/startflow (Authorization: Bearer ...)
                                          │
                                          ▼
                                    [Flow B starts]
```

The documented way to chain flows: a Webhook step in Flow A hands data to middleware, which authenticates and calls `POST /public/startflow` to launch Flow B with pre-populated values. In Numa the "middleware" is the trigger receiver + a `numa integrations request` call.

---

## Polling fallback (NOT viable as discovery)

No list/changed-since/search endpoint → cannot poll to find new/modified flows. The only readable state is `GET /public/flow/{id}/step/{stepId}` for a flow you already know [INFERRED]. If you already hold a `flowIdentifier`+step name and want to detect when a user fills the form, you could poll that one step (`GET /public/flow/FLOW-9042/step/Step%201`) and value-diff across polls — there is no `lastModified` field, so change detection is value-diffing only; poll conservatively (≥60s, limits unknown) [INFERRED]. For anything broader (new flows, flows you didn't start), **use the Webhook step**.

---

## Error Handling

### Application-level envelope [DOCUMENTED]

startflow (and, by inference, update step fields): `{"success":false,"errorCode":"SOME_CODE","errorMessage":"Human readable reason","dataModel":null}`
Two unknowns that materially affect handling: (1) **HTTP status on failure is UNKNOWN** — unclear whether failures return HTTP 200 + `success:false` or a 4xx/5xx; **always check BOTH the HTTP status AND `success`**. (2) **The `errorCode` catalogue is undocumented** — do not branch on specific codes; surface `errorMessage` to the user.

### Auth errors

`/authorise` error shape undocumented — expect 400/401 for bad credentials, or possibly a `success:false` body [UNKNOWN]. Token expiry on a later call likely returns 401 (or `success:false`) — recovery: re-run `/authorise` (no refresh token), retry the call once [INFERRED].

### Validation errors (step fields)

Values validated against modeller-configured rules; **custom error messages** (admin-set in the modeller) returned, else **default validation errors**. Structure (single message vs per-field array) undocumented [DOCUMENTED, partial]. Partial-failure semantics (one bad field in a bulk array) unknown — treat as all-or-nothing, re-GET to confirm what applied [UNKNOWN].

### Recovery Playbook (all INFERRED — none confirmed)

| HTTP | Meaning (assumed)            | Retryable | Recovery                                                                  | Max Retries |
| ---- | ---------------------------- | --------- | ------------------------------------------------------------------------- | ----------- |
| 200  | OK — **inspect `success`**   | n/a       | if `success:false`, surface `errorMessage`; do NOT retry blindly          | 0           |
| 400  | Bad request / validation     | No        | fix payload — PascalCase (startflow), required fields, casing, value type | 0           |
| 401  | Unauthorized / token expired | Yes       | re-run `/authorise`, retry once (no refresh token)                        | 1           |
| 403  | Forbidden                    | No        | confirm the account is a **Business Administrator**                       | 0           |
| 404  | Flow / step not found        | No        | verify `flowIdentifier` + **URL-encoded** step name                       | 0           |
| 409  | Conflict (assumed)           | Maybe     | re-GET the step, resolve, retry                                           | 1           |
| 429  | Rate limited (assumed)       | Yes       | backoff (no documented `retry-after`); exponential, max ~60s              | 3           |
| 5xx  | Server error                 | Yes       | exponential backoff + jitter                                              | 3           |

### Backoff (no documented rate-limit headers)

No `retry-after` or `x-ratelimit-*` headers — don't depend on them [UNKNOWN]. On 429/5xx: exponential backoff from 2s, max 60s, 0–1s jitter [INFERRED]. **Never auto-retry `POST /public/startflow`** — not idempotent; an ambiguous failure may have already started a flow. Surface to the user and confirm before re-calling [INFERRED].

---

## Counter-Exceptions

1. **Failures may not be HTTP errors** — a 200 OK can mean failure if `success:false`; check the body [DOCUMENTED envelope / UNKNOWN codes].
2. **No refresh token** — `refreshToken` is null; re-authenticate from credentials rather than refreshing [DOCUMENTED null / INFERRED behaviour].
3. **Webhooks configured outside the API** — can't register/list/delete them programmatically; all in the modeller [DOCUMENTED].
4. **Polling can't discover flows** — no "list changed since"; webhooks are the only event source [INFERRED].
5. **`startflow` is not idempotent and has no idempotency key** — retries create duplicate flows [INFERRED].

---

## Output Formatting (presenting Flowingly results)

| Data Type       | Format                         | Example                                                              |
| --------------- | ------------------------------ | -------------------------------------------------------------------- |
| Started flow    | identifier + subject + step    | "Started FLOW-9042 'Acme Ltd onboarding' — now at step 'Step 1'"     |
| Step fields     | name: value list               | "Customer Name: Acme Ltd; Email: jo@acme.com; Account Type: (empty)" |
| List-type field | value + available options      | "Account Type: — (options: Standard, Premium)"                       |
| Update result   | confirmation + re-read summary | "Saved 2 fields to FLOW-9042 / Step 1. Customer Name and Email set." |
| Actor           | email or team name             | "jo@acme.com" or "Team: Finance"                                     |
| Error           | plain `errorMessage`           | "Could not start flow: 'New Customer Onboarding' model not found"    |

Display & safety: after any write, **re-GET the step** and confirm the values that actually stuck (write response shape uncertain) [INFERRED]. When showing a step with empty required fields, point them out. Before starting a flow, **echo the model `Name`, `Subject`, actors back to the user for confirmation** — flows trigger real notifications/approvals [INFERRED]. Never invent a `flowIdentifier` or model `Name`; if missing, ask the user (you cannot look them up).
