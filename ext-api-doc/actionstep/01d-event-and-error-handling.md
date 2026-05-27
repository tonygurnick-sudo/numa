---
api_name: 'Actionstep'
api_slug: 'actionstep'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-27'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Actionstep — Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. RestHooks (webhooks), error format, rate limits, recovery.

---

## Event-Driven Capabilities

| Mechanism            | Supported | Notes                                     |
| -------------------- | --------- | ----------------------------------------- |
| Webhooks (RestHooks) | Yes       | `resthooks` resource; 24 event types      |
| WebSocket            | No        | —                                         |
| Server-Sent Events   | No        | —                                         |
| Polling fallback     | Yes       | Page resources; change-detection field 🔬 |

---

## Webhooks (RestHooks)

### Setup

- **Registration method:** API (the `resthooks` resource).
- **Registration endpoint:** `POST /api/rest/resthooks`
- **Scope required:** `resthooks`.
- **URL requirement:** the target URL **must return HTTP 200**, or Actionstep disables the hook.

**Register a hook:**

```http
POST {api_endpoint}/api/rest/resthooks
Authorization: Bearer <token>
Content-Type: application/vnd.api+json

{ "resthooks": { "eventName": "ActionCreated", "targetUrl": "https://your-endpoint.example/webhook" } }
```

The response returns the created hook including its assigned `id`.

**Manage hooks:**

```http
GET    {api_endpoint}/api/rest/resthooks            # list
GET    {api_endpoint}/api/rest/resthooks/{id}       # retrieve
PUT    {api_endpoint}/api/rest/resthooks/{id}       # update
DELETE {api_endpoint}/api/rest/resthooks/{id}       # unsubscribe
```

### Event Catalog (24 events)

| #   | Event Name                       | Trigger                           |
| --- | -------------------------------- | --------------------------------- |
| 1   | ActionCreated                    | Matter created                    |
| 2   | ActionUpdated                    | Matter updated                    |
| 3   | ActionDocumentCreated            | Matter document created           |
| 4   | ActionDocumentUpdated            | Matter document updated           |
| 5   | ActionDocumentDeleted            | Matter document deleted           |
| 6   | ActionParticipantAdded           | Participant added to a matter     |
| 7   | ActionParticipantDeleted         | Participant removed from a matter |
| 8   | DataCollectionRecordUpdated      | Custom data record updated        |
| 9   | DataCollectionRecordDeleted      | Custom data record deleted        |
| 10  | DataCollectionRecordValueUpdated | Custom data value updated         |
| 11  | DisbursementCreated              | Disbursement created              |
| 12  | DisbursementUpdated              | Disbursement updated              |
| 13  | FileNoteCreated                  | File note created                 |
| 14  | FileNoteUpdated                  | File note updated                 |
| 15  | ParticipantCreated               | Contact created                   |
| 16  | ParticipantUpdated               | Contact updated                   |
| 17  | StepChanged                      | Matter workflow step changed      |
| 18  | TaskCreated                      | Task created                      |
| 19  | TaskUpdated                      | Task updated                      |
| 20  | TimeEntryCreated                 | Time entry logged                 |
| 21  | TimeEntryUpdated                 | Time entry updated                |

> The docs enumerate ~21 named events here and describe "24 triggerable events"; the remaining
> few are additional Action/DataCollection variants. 🔬 Pull the authoritative list from a live
> org's `/webhooks/` reference before building event-specific logic.

### Payload Format

🔬 **NOT DOCUMENTED.** Actionstep's docs do not publish the body POSTed to the target URL.
Determine it empirically: register a hook against a sandbox, trigger the event, and capture the
delivered body. Until then, treat the payload as "an identifier for the changed record" and
**re-fetch** the record via the REST API rather than trusting payload contents.

### Verification / Security

- **No signature/verification header is documented.** 🔬 Confirm on a sandbox; if none exists,
  secure the receiver with an unguessable target URL path + re-fetch-and-verify, and consider an
  allowlist of Actionstep egress IPs if published.

### Reliability

- A non-200 response disables the hook. Always return 200 quickly, then process async.
- Retry policy / ordering / dedup guarantees: 🔬 not documented — assume **at-least-once** and
  build idempotent receivers keyed on the changed record id.

---

## Polling Fallback

When webhooks aren't viable:

- Page each resource (`GET /api/rest/{resource}?page&pageSize=200`).
- **Change-detection field:** 🔬 confirm a `lastModified`/`*Timestamp` field exists and is
  filterable; until then, diff against a stored snapshot.
- Respect rate limits — keep polling intervals conservative (e.g. ≥ 5 min for large orgs).

---

## Error Handling

### Standard Error Response Format

```json
{
  "errors": {
    "id": "<error id>",
    "status": 404,
    "code": "AS-TBC",
    "title": "Not Found",
    "detail": "Human-readable explanation",
    "source": { "pointer": null, "parameter": null },
    "links": { "about": null },
    "meta": []
  }
}
```

**Error fields:**

| Field    | Type   | Always Present? | Description                              |
| -------- | ------ | --------------- | ---------------------------------------- |
| `id`     | string | yes             | Error instance id                        |
| `status` | number | yes             | HTTP status                              |
| `code`   | string | yes             | Actionstep error code (e.g. `AS-…`)      |
| `title`  | string | yes             | Short summary                            |
| `detail` | string | usually         | Human-readable detail                    |
| `source` | object | on validation   | `pointer`/`parameter` to offending field |

### Validation Error Codes (per-resource)

| Series      | Resource     |
| ----------- | ------------ |
| `A01–A02`   | Actions      |
| `P01–P03`   | Participants |
| `T01–T11`   | Tasks        |
| `TR01–TR05` | Time records |

> 🔬 Map each code → message from `/error-codes/` for user-facing text.

### Recovery Playbook

| HTTP Status | Meaning           | Retryable? | Recovery Action                      | Max Retries |
| ----------- | ----------------- | ---------- | ------------------------------------ | ----------- |
| 400         | Bad request       | No         | Fix request body/params              | 0           |
| 401         | Unauthorized      | Yes        | Refresh access token, retry once     | 1           |
| 403         | Forbidden         | No         | Check user permissions + scopes      | 0           |
| 404         | Not found         | No         | Verify resource id / region base URL | 0           |
| 409         | Conflict          | Maybe      | Re-read record, reconcile, retry     | 1           |
| 422         | Validation failed | No         | Read `code`/`source`, fix fields     | 0           |
| 429         | Rate limited      | Yes        | Exponential backoff + jitter         | 3+          |
| 5xx         | Server error      | Yes        | Exponential backoff                  | 3           |

### Rate Limit Details

| Item                 | Value                                                     |
| -------------------- | --------------------------------------------------------- |
| Status code          | `429`                                                     |
| Live since           | April 2024 (all public endpoints)                         |
| Basis                | user/session, with `orgkey` + IP higher-order constraints |
| Published thresholds | **None** 🔬 — discover empirically                        |
| `Retry-After` header | Not documented 🔬                                         |
| Page-size cap        | `pageSize` ≤ 200                                          |

**Backoff strategy:**

1. On 429, honour `Retry-After` if present (🔬 confirm); otherwise exponential backoff.
2. Start ~1–2s, double each attempt, cap ~60s, add jitter.
3. Since limits are session/orgkey-based, **serialise** bursty workloads rather than fanning out.

---

## Counter-Exceptions

1. **Success bodies are resource-keyed objects**, errors are under a top-level `errors` key —
   detect errors by presence of `errors`, not by array vs object shape.
2. **A disabled webhook is silent** — a hook that returned non-200 stops delivering with no
   error to the API caller; re-check hook status periodically.

---

## Output Formatting Guide

| Data Type     | Format            | Example                                          |
| ------------- | ----------------- | ------------------------------------------------ |
| Single matter | Key-value summary | "Smith v Jones — Active — opened 1 May 2026"     |
| Matter list   | Markdown table    | id · name · status                               |
| Time entries  | Table + total     | rows + summed duration                           |
| Errors        | Clear message     | "Couldn't find matter 999. Check the matter id." |

- Lists: show first ~20 rows, note `recordCount` total.
- Re-fetch records referenced by webhooks rather than trusting payloads.

---

_Generated from the investigation questionnaire, Phases 7–8._
