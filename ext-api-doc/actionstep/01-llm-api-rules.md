---
api_name: 'Actionstep'
api_slug: 'actionstep'
version: 'v1 (vnd.api+json); v2 partial'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-27'
line_count_target: '< 300 lines'
---

# Actionstep — Workspace Agent API Rules

> **Loaded into the workspace agent's context when the Actionstep integration is active.**
> Actionstep is a legal practice management system. Matters are called **Actions**.
> Companion files (01a–01d) hold the detailed reference.

## Context

- **API:** Actionstep v1 (`application/vnd.api+json`). A newer v2 (cleaner JSON) covers only
  Matters/FileNotes/Tags — prefer **v1** unless told otherwise.
- **Base URL:** the `api_endpoint` returned in the OAuth token response (region-specific),
  then `/api/rest/{resource}`. Never hard-code a region host.
- **Auth:** OAuth2 (authorization code) bearer token, user-context only.
- **Integration path:** Direct API, chat-only.
- **Rate limits:** HTTP 429 since April 2024; thresholds unpublished — back off on 429.

## Auth Structure

Bearer token in the `Authorization` header. The token is managed by Numa's connector layer;
you do not handle the OAuth dance yourself.

```
Authorization: Bearer <access_token>
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json
```

**Token lifecycle:**

- Access token lives 8 hours; refresh token lives 21 days and **rotates** on every refresh.
- The base URL comes from `api_endpoint` in the token response — every request goes to that host.

## Capabilities

### CAN

1. Read matters (Actions), contacts (Participants), time entries, file notes, tasks, bills, documents.
2. Create/update those records (e.g. log a time entry, add a file note, create a task).
3. Subscribe to change events via RestHooks (24 event types).

### CANNOT

1. Act without a user — there is no machine-to-machine / service-account mode.
2. Rely on a fixed base URL — it is per-region, from the token response.
3. Assume large pages — `pageSize` is capped at 200 (default 50).

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Base URL is dynamic:** use the connector's stored `api_endpoint`; a hard-coded
   `*.actionstep.com` host will fail for other regions.
2. **Matters are "Actions":** the resource is `actions`, the time resource is `timeentries`.
   Don't look for a `matters` endpoint on v1.
3. **Content type is `application/vnd.api+json`** on v1, not plain `application/json`.
   Responses are resource-keyed with `links`/`linked`/`meta`, not a bare array.
4. **Filter/sort syntax is not fully documented** — confirm parameter names against the live
   API before relying on server-side filtering; otherwise page through and filter client-side.

## Default Parameters

| Parameter   | Default | Reason                                           |
| ----------- | ------- | ------------------------------------------------ |
| `pageSize`  | 50      | API default; raise toward 200 max for bulk reads |
| `page`      | 1       | Page-number pagination starts at 1               |
| API version | v1      | Feature-complete; v2 only covers a few resources |

## Working Examples

### Example 1: List matters (Actions)

```http
GET {api_endpoint}/api/rest/actions?page=1&pageSize=50
Authorization: Bearer <token>
Accept: application/vnd.api+json
```

```json
{
  "actions": [{ "id": 123, "name": "Smith v Jones", "status": "Active" }],
  "meta": {
    "paging": {
      "actions": { "recordCount": 1, "pageCount": 1, "page": 1, "pageSize": 50, "prevPage": null, "nextPage": null }
    }
  }
}
```

### Example 2: Get one matter with related contacts

```http
GET {api_endpoint}/api/rest/actions/123
Authorization: Bearer <token>
Accept: application/vnd.api+json
```

```json
{
  "actions": { "id": 123, "name": "Smith v Jones" },
  "linked": { "participants": [{ "id": 9, "displayName": "Jane Smith" }] },
  "links": { "actions.participants": { "href": "/api/rest/participants/{actions.participants}" } }
}
```

### Example 3: Log a time entry (create)

```http
POST {api_endpoint}/api/rest/timeentries
Authorization: Bearer <token>
Content-Type: application/vnd.api+json

{ "timeentries": { "action": 123, "minutes": 30, "note": "Drafted advice" } }
```

```json
{ "timeentries": { "id": 555, "action": 123, "minutes": 30, "note": "Drafted advice" } }
```

> Field names in the create body are **🔬 sandbox-confirm** — verify against the live
> `timeentries` schema before trusting them.

## Proxy API Operations

| Operation         | Method | Path                     | Key Parameters           | Notes                   |
| ----------------- | ------ | ------------------------ | ------------------------ | ----------------------- |
| List matters      | GET    | `/api/rest/actions`      | `page`, `pageSize`       | Resource-keyed response |
| Get matter        | GET    | `/api/rest/actions/{id}` | —                        | `linked` for related    |
| List contacts     | GET    | `/api/rest/participants` | `page`, `pageSize`       |                         |
| List time entries | GET    | `/api/rest/timeentries`  | `page`, `pageSize`       |                         |
| Create time entry | POST   | `/api/rest/timeentries`  | body                     | Confirm fields 🔬       |
| Add file note     | POST   | `/api/rest/filenotes`    | body                     |                         |
| Create task       | POST   | `/api/rest/tasks`        | body                     |                         |
| Subscribe events  | POST   | `/api/rest/resthooks`    | `eventName`, `targetUrl` | Target must return 200  |

## Pagination

- **Type:** page-number.
- **Default page size:** 50. **Max page size:** 200.
- **How to paginate:**

```http
GET {api_endpoint}/api/rest/actions?page=2&pageSize=100
```

- **Last page detection:** `meta.paging.{resource}.nextPage` is `null`.

## Webhooks / Events

**Supported** via RestHooks (24 event types — see 01d for the full list).

| Event            | Trigger                | Key Payload Fields |
| ---------------- | ---------------------- | ------------------ |
| ActionCreated    | A matter is created    | (payload shape 🔬) |
| TimeEntryCreated | A time entry is logged | (payload shape 🔬) |
| FileNoteCreated  | A file note is added   | (payload shape 🔬) |

**Setup:** `POST /api/rest/resthooks` with `{"resthooks": {"eventName": "...", "targetUrl": "..."}}`.
The target URL must return HTTP 200 or Actionstep disables the hook.

## Error Handling

**Standard error format:**

```json
{
  "errors": {
    "id": "...",
    "status": 404,
    "code": "AS-TBC",
    "title": "Not Found",
    "detail": "...",
    "source": { "pointer": null, "parameter": null }
  }
}
```

**Recovery by status:**

| Status | Meaning          | Action                                   |
| ------ | ---------------- | ---------------------------------------- |
| 400    | Bad request      | Fix request parameters                   |
| 401    | Unauthorized     | Refresh token and retry                  |
| 403    | Forbidden        | Check scopes / user permissions          |
| 404    | Not found        | Verify resource ID                       |
| 422    | Validation error | Read per-resource code (A/P/T/TR series) |
| 429    | Rate limited     | Exponential backoff (no published limit) |
| 5xx    | Server error     | Retry with exponential backoff           |

## Known Limitations

1. No machine-to-machine auth — always user-context.
2. Filter/sort/sideload query syntax under-documented — confirm before relying on it.
3. Webhook payload shape and rate-limit thresholds are not published.

---

_Generated from investigation questionnaire. See companion files:_

- _01a-domain-model-reference.md — entities, relationships, business rules_
- _01b-query-patterns.md — list, filter, sideload, pagination_
- _01c-mutation-patterns.md — create, update, delete_
- _01d-event-and-error-handling.md — RestHooks events, errors, rate limits_
