---
api_name: Actionstep
api_slug: actionstep
companion_to: 01-llm-api-rules.md
role: RestHooks (webhooks), error format, validation codes, recovery playbook, rate limits, output formatting
confidence: doc-based 2026-05-27. Webhook payload shape, signature/verification, retry policy, and rate-limit thresholds are NOT published — items tagged 🔬 are SANDBOX-CONFIRM.
---

# Actionstep — Event & Error Handling

## Event-Driven Capabilities

| Mechanism            | Supported | Notes                                     |
| -------------------- | --------- | ----------------------------------------- |
| Webhooks (RestHooks) | Yes       | `resthooks` resource; 24 event types      |
| WebSocket            | No        | —                                         |
| Server-Sent Events   | No        | —                                         |
| Polling fallback     | Yes       | Page resources; change-detection field 🔬 |

## Webhooks (RestHooks)

- Registration: API, the `resthooks` resource. Scope required: `resthooks`.
- Register: `POST {api_endpoint}/api/rest/resthooks`, body `{"resthooks":{"eventName":"ActionCreated","targetUrl":"https://your-endpoint.example/webhook"}}` — response returns the created hook including its assigned `id`.
- Manage: `GET /api/rest/resthooks` (list) · `GET /api/rest/resthooks/{id}` (retrieve) · `PUT /api/rest/resthooks/{id}` (update) · `DELETE /api/rest/resthooks/{id}` (unsubscribe).
- **The target URL must return HTTP 200**, or Actionstep disables the hook.

### Event Catalog

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

Docs enumerate ~21 named events but describe "24 triggerable events"; the remaining few are additional Action/DataCollection variants. 🔬 Pull the authoritative list from a live org's `/webhooks/` reference before building event-specific logic.

### Payload, Security, Reliability

- **Payload format: 🔬 NOT DOCUMENTED.** Actionstep doesn't publish the body POSTed to the target URL. Determine empirically (register a sandbox hook, trigger, capture the body). Until then, treat the payload as "an identifier for the changed record" and **re-fetch** the record via REST rather than trusting payload contents.
- **Verification/security: no signature/verification header is documented.** 🔬 Confirm on sandbox; if none, secure the receiver with an unguessable target URL path + re-fetch-and-verify, and consider an allowlist of Actionstep egress IPs if published.
- **Reliability:** a non-200 response disables the hook (silently — no error to the API caller; re-check hook status periodically). Always return 200 quickly, then process async. Retry/ordering/dedup guarantees 🔬 not documented — assume **at-least-once** and build idempotent receivers keyed on the changed record id.

## Polling Fallback

When webhooks aren't viable: page each resource (`GET /api/rest/{resource}?page&pageSize=200`). Change-detection field 🔬 — confirm a `lastModified`/`*Timestamp` field exists and is filterable; until then, diff against a stored snapshot. Keep polling intervals conservative (e.g. ≥ 5 min for large orgs) to respect rate limits.

## Error Handling

Format: `{"errors":{"id":"<error id>","status":404,"code":"AS-TBC","title":"Not Found","detail":"Human-readable explanation","source":{"pointer":null,"parameter":null},"links":{"about":null},"meta":[]}}`

| Field    | Type   | Always present? | Description                              |
| -------- | ------ | --------------- | ---------------------------------------- |
| `id`     | string | yes             | Error instance id                        |
| `status` | number | yes             | HTTP status                              |
| `code`   | string | yes             | Actionstep error code (e.g. `AS-…`)      |
| `title`  | string | yes             | Short summary                            |
| `detail` | string | usually         | Human-readable detail                    |
| `source` | object | on validation   | `pointer`/`parameter` to offending field |

### Validation Codes (per-resource)

`A01–A02` Actions · `P01–P03` Participants · `T01–T11` Tasks · `TR01–TR05` Time records. 🔬 Map each code → message from `/error-codes/` for user-facing text.

### Recovery Playbook

| HTTP | Meaning           | Retryable? | Recovery                             | Max retries |
| ---- | ----------------- | ---------- | ------------------------------------ | ----------- |
| 400  | Bad request       | No         | Fix request body/params              | 0           |
| 401  | Unauthorized      | Yes        | Refresh access token, retry once     | 1           |
| 403  | Forbidden         | No         | Check user permissions + scopes      | 0           |
| 404  | Not found         | No         | Verify resource id / region base URL | 0           |
| 409  | Conflict          | Maybe      | Re-read record, reconcile, retry     | 1           |
| 422  | Validation failed | No         | Read `code`/`source`, fix fields     | 0           |
| 429  | Rate limited      | Yes        | Exponential backoff + jitter         | 3+          |
| 5xx  | Server error      | Yes        | Exponential backoff                  | 3           |

### Rate Limits

| Item                 | Value                                                     |
| -------------------- | --------------------------------------------------------- |
| Status code          | `429`                                                     |
| Live since           | April 2024 (all public endpoints)                         |
| Basis                | user/session, with `orgkey` + IP higher-order constraints |
| Published thresholds | None 🔬 — discover empirically                            |
| `Retry-After` header | Not documented 🔬                                         |
| Page-size cap        | `pageSize` ≤ 200                                          |

Backoff: on 429, honour `Retry-After` if present (🔬 confirm), else exponential backoff — start ~1–2s, double each attempt, cap ~60s, add jitter. Since limits are session/orgkey-based, **serialise** bursty workloads rather than fanning out.

## Counter-Exceptions

1. **Success bodies are resource-keyed objects; errors are under a top-level `errors` key** — detect errors by presence of `errors`, not by array-vs-object shape.
2. **A disabled webhook is silent** — a hook that returned non-200 stops delivering with no API-side error; re-check hook status periodically.

## Output Formatting

| Data type     | Format            | Example                                          |
| ------------- | ----------------- | ------------------------------------------------ |
| Single matter | Key-value summary | "Smith v Jones — Active — opened 1 May 2026"     |
| Matter list   | Markdown table    | id · name · status                               |
| Time entries  | Table + total     | rows + summed duration                           |
| Errors        | Clear message     | "Couldn't find matter 999. Check the matter id." |

Lists: show first ~20 rows, note `recordCount` total. Re-fetch records referenced by webhooks rather than trusting payloads.
