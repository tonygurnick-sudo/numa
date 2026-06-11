---
api_name: 'JobAdder'
api_slug: 'jobadder'
generated_from: 'Official OpenAPI spec (api.jobadder.com/v2/openapi.json, fetched live 2026-06-10) + official Webhooks docs'
generated_date: '2026-06-10'
source_phases: ['Events, Webhooks & Error Handling']
---

# JobAdder -- Event & Error Handling

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> [DOCS] = official OpenAPI spec / docs (2026-06-10); [SPEC-community] = community mirror only;
> [UNVERIFIED] = inference.

## Webhooks — they exist, but they're not a chat tool

JobAdder supports webhooks managed **via the API itself** (`/webhooks` CRUD) [DOCS]. From workspace
chat you have **nowhere for JobAdder to POST to** — webhooks are platform/automation infrastructure
(a future Numa Triggers source), not something to create ad hoc in a conversation. **Do not create
webhooks from chat**; a webhook pointing at a dead URL accumulates failures and gets **Suspended**.
For "tell me when X changes" requests from chat, use the polling pattern below, or suggest a
scheduled agent.

### Subscription API [DOCS]

| Operation | Method/Path                  | Notes                                            |
| --------- | ---------------------------- | ------------------------------------------------ |
| List      | `GET /webhooks`              | Filters: `status`, `events`                      |
| Create    | `POST /webhooks`             | 201 `WebhookRepresentation`; 422 validation      |
| Get       | `GET /webhooks/{webhookId}`  | `webhookId` is a uuid                            |
| Update    | `PUT /webhooks/{webhookId}`  | 200 / 404 / 422                                  |
| Delete    | `DELETE /webhooks/{webhookId}` | 204 / 404                                      |

`AddWebhookCommand` (required: `name`, `events`, `url`) [DOCS]:

```json
{
  "name": "numa-placement-watch",
  "events": ["placement_approved", "jobapplication_status_changed"],
  "url": "https://receiver.example.com/hook",
  "authorization": "Bearer shared-secret-to-echo-back",
  "eventFilters": {
    "jobapplication_status_changed": {"statusId": [42], "statusActive": true}
  },
  "status": "Enabled"
}
```

- `authorization` is an optional header value JobAdder includes on deliveries — the only built-in
  receiver authentication (no HMAC signing documented) [DOCS].
- `eventFilters` currently supports filtering `jobapplication_status_changed` by `statusId` /
  `statusActive` [DOCS].
- Webhook `status` lifecycle: `Enabled`, `Disabled`, `Suspended`, `Failed` (+ timestamps
  `enabledAt/disabledAt/suspendedAt/failedAt` on the model). Suspension/failure semantics
  (thresholds, retries) are [UNVERIFIED — not in the spec].

### Delivery payload [DOCS]

HTTP POST to your URL:

```json
{
  "apiVersion": 2,
  "event": "placement_approved",
  "eventId": "00000000-0000-0000-0000-000000000000",
  "eventDate": "2019-01-01T09:00:00Z",
  "eventUser": {},
  "eventData": {}
}
```

**Ordering is not guaranteed and duplicates can occur** — official docs say so explicitly.
Receivers must dedupe on `eventId` and treat `eventData` as a hint: re-GET the entity for truth [DOCS].
The exact `eventData` payload per event type is not schema'd in the spec — assume it carries the
entity ids involved, not the full record [UNVERIFIED].

### Webhook health (read-only diagnostics ARE fine from chat)

If a user asks "why did our JobAdder integration stop notifying us":

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/webhooks?status=Suspended"})
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/webhooks?status=Failed"})
```

Each webhook carries `suspendedAt`/`failedAt` timestamps. A suspended/failed webhook can be
re-enabled with `PUT /webhooks/{webhookId}` setting `"status": "Enabled"` (allowed submit values:
`Enabled`, `Disabled`, `Suspended`) — but only do this if the user owns the receiving endpoint and
asks for it; the underlying delivery failure will just re-suspend it otherwise [DOCS shapes;
suspension thresholds [UNVERIFIED]].

### Event catalog (42 events) [DOCS]

All events also require the `offline_access` scope plus the listed read scope.

| Group        | Events                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| Job          | `job_status_changed`, `job_invoice_sent`, `job_partner_action`                                |
| Job Ad       | `jobad_posted`, `jobad_expired`, `jobad_partner_action`                                       |
| Candidate    | `candidate_status_changed`, `candidate_updated`, `candidate_skill_updated`, `candidate_partner_action` |
| Application  | `jobapplication_status_changed`, `jobapplication_partner_action`                              |
| Placement    | `placement_approved`, `placement_status_changed`, `placement_partner_action`                  |
| Company      | `company_status_changed`, `company_updated`, `company_address_updated`, `company_partner_action` |
| Contact      | `contact_status_changed`, `contact_updated`, `contact_partner_action`                         |
| Interview/Event | `interview_scheduled`, `interview_evaluation_submitted`, `event_scheduled`, `event_interview_evaluation_submitted` |
| Folders      | `folder_updated` + `folder_{job\|candidate\|jobapplication\|placement\|company\|contact}_{added\|removed}` |
| Other        | `user_suspended`, `sms_sent`, `opportunity_stage_changed`                                     |

Notable gaps: **no create events** for candidates/jobs/companies (only `*_updated`/`*_status_changed`),
no note events, no application-created event (use `jobapplication_status_changed` — new applications
land in the default status) [DOCS list; gap analysis [UNVERIFIED]].

## Change Detection from Chat — polling `updatedAt`

The reliable chat-side substitute [DOCS filters; pattern [UNVERIFIED]]:

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/applications?updatedAt=%3E2026-06-09T00:00:00Z&sort=-updatedAt&limit=100"})
```

1. Filter `updatedAt=>{last-check}` (inclusive — overlap one record rather than miss one).
2. Page via `offset` until exhausted; dedupe on entity id.
3. For recurring needs, recommend a Numa scheduled agent rather than long-lived chat loops; persist
   the checkpoint timestamp (e.g. a workspace file) between runs.
4. Status-transition detection needs a before/after comparison — `updatedAt` says *something*
   changed, not *what*; fetch and diff the `status` object if the user cares about transitions.

Per-entity polling cheatsheet [DOCS filters]:

| Need                                | Poll                                                            |
| ----------------------------------- | ---------------------------------------------------------------- |
| New/changed applications on a job   | `/jobs/{id}/applications` then diff, or `/applications?jobId=&updatedAt=>...` |
| New candidates                      | `/candidates?createdAt=>{checkpoint}&sort=-createdAt`            |
| Placements approved since X         | `/placements?approved=true&approvedAt=>{checkpoint}`             |
| Jobs closed since X                 | `/jobs?closedAt=>{checkpoint}`                                   |
| Anything edited since X             | `/{entity}?updatedAt=>{checkpoint}&sort=-updatedAt`              |
| Notes added to an entity            | `/notes?candidateId={id}&createdAt=>{checkpoint}`                |

## Error Model

`ErrorModel` [DOCS]:

```json
{
  "message": "Validation error",
  "errors": [
    {"code": "<ErrorCode>", "message": "…", "fields": ["salary.rateLow"]}
  ]
}
```

`errors[].fields` names the offending body fields — quote them when reporting 422s. Not every
status carries a body (404s on PUT return only a description) [DOCS].

### Worked 422 example

`POST /jobs` with a stale `statusId` from another account:

1. Response: 422, body `{"message": "Validation error", "errors": [{"code": "...",
   "message": "...", "fields": ["statusId"]}]}` [DOCS shape; exact codes [UNVERIFIED]].
2. Re-fetch `GET /jobs/lists/status`, re-match the intended status by name.
3. Retry once with the corrected id. If it 422s again on the same field, stop and show the user
   both the error message and the valid options.

Never blind-retry a 422 — the request will fail identically until the body changes.

## Status Code Playbook

| Status | Documented contexts [DOCS]                          | Agent action                                                       |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------- |
| 200    | Success (PUT bodies are often **empty**)              | For empty bodies, GET to confirm state before reporting done        |
| 201    | Created — returns the new representation              | Capture the id                                                      |
| 202    | "Already in that state" (status endpoints, review ops) | **Success** — do not retry or treat as error                       |
| 204    | Deleted (webhooks, addresses, requisitions)            | Done                                                                |
| 400    | Malformed request/params                               | Fix syntax (date prefixes, array params); don't retry unchanged     |
| 401    | Expired/revoked OAuth grant [UNVERIFIED body shape]    | See below — reconnect flow                                          |
| 403    | Missing OAuth scope [UNVERIFIED body shape]            | See below — scope fix                                               |
| 404    | Wrong id or path                                       | Verify the id exists (search first); check path spelling            |
| 409    | Duplicate: candidate email, existing application       | Search for the existing record; use it; only force with explicit user intent |
| 422    | Validation error (`ErrorModel`)                        | Fix the named `fields`; don't retry unchanged                       |
| 429    | Rate limited — thresholds undocumented                 | Back off 2s → 10s → 30s, max 3 retries, then stop and tell the user; slow all subsequent calls |
| 5xx    | Server error                                           | Retry once after 5s. For writes: search for the record first — it may have landed |

## 401 — Reconnect, Don't Re-prompt

Numa refreshes the 60-minute access token automatically; a 401 surfacing to you means the **refresh
failed** — the grant was revoked, the refresh token expired, or the user's JobAdder access changed
[DOCS token lifetimes; failure modes [UNVERIFIED]].

- Tell the user: "Your JobAdder connection has expired — please reconnect JobAdder from the
  integrations/Files Remote page."
- This is an **OAuth redirect flow** — there is **no chat credential card** for JobAdder, and you
  must never ask for tokens/passwords in chat.
- Do not retry the call until they confirm reconnection.

## 403 — Scope Fix, Not Credentials

The grant lacks the scope for this operation (e.g. connection granted `read` only, you attempted a
write needing `write` / `write_placement`) [DOCS scopes].

- Name the operation and the likely scope (scope table in 01a).
- The fix is reconnecting JobAdder with broader scopes (admin may need to adjust the requested
  scopes in the integration config) — not re-entering credentials.
- Do not retry; offer a read-only alternative meanwhile.

## 429 / Backoff Discipline

No public numeric limits or rate-limit headers are documented [DOCS — searched]. Conservative defaults:

1. Sequential calls only; never parallel-fan-out through the connector.
2. ≤ ~2 requests/second sustained; for big scans prefer `limit=1000` pages over many small pages.
3. On 429: wait 2s, retry; 10s; 30s; then stop and report. Halve your pacing for the session.
4. If a `Retry-After` header appears, honour it [UNVERIFIED whether sent].

## Connector-Level vs API-Level Failures

Not every failure is a JobAdder HTTP status. Triage in this order:

1. **Tool error, no HTTP status** (connector not found, connection missing) → the user hasn't
   connected JobAdder yet, or the integration isn't enabled — point them at the integration setup,
   don't debug the API.
2. **401/403** → auth layer (see above). Distinct fixes; never conflate them.
3. **404 on ONE id** → bad/foreign id — search for the record.
4. **404 on EVERYTHING, including `GET /users/current`** → systemic: possibly the account's
   regional API base differs from the configured `https://api.jobadder.com/v2` (the OAuth token
   response carries an account-specific `api` base; AU/US/EU shards exist) — stop and escalate to
   the Numa team rather than hammering retries [DOCS base mechanism; failure mode [UNVERIFIED]].
5. **Repeated 5xx across endpoints** → JobAdder-side incident; report and stop.

## Session Hygiene

- Run `GET /users/current` once at the start of any JobAdder-heavy session — confirms auth, scope
  baseline, and tells you who the connected recruiter is (useful default for `ownerUserId`).
- Cache lookup lists (statuses, categories, worktypes) for the session; refetch only after a 422
  blames one of those ids.
- Keep an in-conversation log of writes performed (entity, id, change) so a failed step can be
  rolled back or reported precisely — there is no API-side undo.

## Write-Failure Recovery Checklist

1. **Timeout/5xx on POST** → search for the would-be record (candidate by email, application by
   `jobId`+`candidateId`, note by `reference` if you set one) before re-creating [UNVERIFIED — assume non-idempotent].
2. **422** → report `errors[].fields` verbatim; re-check lookup ids (`statusId`, `categoryId`) belong
   to THIS account.
3. **409** → the record exists; switch to update/reuse. Only override candidate dedupe with
   `X-Allow-Duplicates` on explicit user instruction [DOCS].
4. **202** → desired state already true; report success, don't loop.
5. Partial batch (`POST /jobs/{id}/applications` with several `candidateId`s) → on error, verify
   per-candidate which applications were created before retrying [UNVERIFIED atomicity].

---

_Companion files: 01-llm-api-rules.md (core rules) · 01a (domain model) · 01b (queries) · 01c (mutations)._
