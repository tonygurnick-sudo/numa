---
api_name: 'WorkflowMax (by Xero)'
api_slug: 'workflowmax'
version: 'WorkflowMax 2 (OAuth2 tier)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# WorkflowMax (by Xero) -- Workspace Agent API Rules

> **Loaded into the workspace agent's context when the WorkflowMax integration is active.**
> Companion files (01a-01d) hold the detailed reference. Keep this file under 300 lines.
> **Confidence: medium.** No live call was made — base host, JSON-vs-XML default, exact
> field casing, and enum values are [INFERRED]/[DOCUMENTED] but UNCONFIRMED. Verify on
> first live call. Treat anything not marked [DOCUMENTED] as provisional.

## Context

- **API:** WorkflowMax API, modern "WorkflowMax 2" generation. REST. PSA / job-management data.
- **Base URL (data):** `https://api.workflowmax2.com/` — **[INFERRED]**, parallels the auth host. The legacy host `https://api.workflowmax.com/` may still serve the same resource paths. **Confirm on first call** (see Gotcha 1).
- **URL shape (legacy, reused under OAuth2):** `https://{base}/{resource}.api/{action}` e.g. `GET /job.api/list`.
- **URL shape (modern v2):** `https://{base}/{resource}/{UUID}` e.g. `GET /job/{uuid}`. [DOCUMENTED]
- **Auth:** OAuth 2.0 (`Authorization: Bearer {token}`) **+ mandatory `account_id` header (the Org ID) on every call.**
- **Integration path:** Direct API Only — all interactions go through the connector's `connect_request` proxy, which injects the bearer token **and** the `account_id` header per call (same wiring as Xero, MYOB, simPRO).
- **Rate limits:** Published values UNKNOWN. One community source cites ~1000/hr + ~10/s for the legacy API. Poll conservatively; backoff on errors. See 01d.

## Auth Structure

OAuth 2.0 authorization-code flow. Registry config (the real connector entry, verified from `connectorRegistry.ts`):

```
authUrl:  https://oauth.workflowmax2.com/oauth/authorize
tokenUrl: https://oauth.workflowmax2.com/oauth/token
scopes:   openid profile email workflowmax
extraAuthParams: {"prompt":"consent"}
```

Every request the agent issues (via `connect_request`):

```
Authorization: Bearer eyJ...      (SHORT-lived JWT access token, ~12-30 min)
account_id: {org_uuid}            (REQUIRED on every call — decoded from the JWT)
Accept: application/json          (request JSON; legacy default is XML — always send this)
```

**Token lifecycle:**

- Access token is a **JWT and very short-lived (~12-30 min, [DOCUMENTED, conflicting figures])**. The `account_id` (Org ID) is a claim **inside** that JWT — the connector extracts it at token time and the proxy replays it as the `account_id` header. The agent does not manage tokens; if a call returns 401, treat it as "token expired/reconnect" — do not retry blindly.
- **⚠️ Registry scope gap:** the scope string **omits `offline_access`**, which vendor docs say is required to issue a refresh token. Without it the connection dies every ~12-30 min and needs full re-consent. Flagged for the connector owner — not something the agent can fix at chat time.

## Capabilities

### CAN

1. **List & read** jobs, clients, contacts, invoices, time entries, staff, quotes, purchase orders, suppliers, leads, costs, categories. Answer reporting questions (WIP, overdue jobs, hours per staff/job in a date range, outstanding invoices).
2. **Create / update** low-risk records on explicit user intent: create a job, log a time entry, add/update a client or contact.
3. **Filter by date range** (`from`/`to`, compact `YYYYMMDD`) and use the dedicated `current` endpoints for active-only jobs/invoices/leads.

### CANNOT

1. **Delete or archive** clients/jobs without explicit, confirmed user instruction — `client.api/delete` and `client.api/archive` exist and are destructive.
2. **Issue, finalise, or modify invoices / billing** without human-in-the-loop confirmation — financial consequences.
3. **Bulk anything** — there are no bulk endpoints. Do not hammer single-record writes (undocumented rate limits). No webhooks — change detection is polling only.

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Base host is unconfirmed.** `api.workflowmax2.com` is the working assumption; the legacy `api.workflowmax.com` may also work. If a call 404s at the host level, try the other host before assuming the resource is wrong. The `connect_request` proxy base URL is the authority — do not hardcode a host in reasoning.
2. **`account_id` header is mandatory on EVERY call.** It is the Org UUID, not a job/client id. Missing it → 401/403. The proxy injects it; if you ever see auth errors, this header (or an expired token) is the first suspect.
3. **HTTP 200 can still be an error.** Legacy endpoints return `200` with `<Status>Error</Status>` (or JSON `{"Status":"Error",...}`) in the body for business/validation failures. **Always check the `Status` field, not just the HTTP code.** [DOCUMENTED for legacy XML.]
4. **`detailed` toggle, not field selection.** `detailed=false` (default) returns summaries; `detailed=true` embeds child collections (tasks/costs). There is no per-field selection. Fetch summaries first, then detail per-UUID only when needed.
5. **Use `UUID` for relationships, `ID` for humans.** Entities carry both a stable `UUID` (use this to link records) and a human number like `J000123` (`ID`). Never pass the human `ID` where a `UUID` is expected.

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter   | Default            | Reason                                                      |
| ----------- | ------------------ | ----------------------------------------------------------- |
| `pagesize`  | 100                | Balance call count vs payload; raise only if clearly needed |
| `detailed`  | false              | Cheaper summaries first; fetch detail per-UUID on demand    |
| `Accept`    | `application/json` | Prefer JSON; omit only if forced to fall back to legacy XML |
| `from`/`to` | `YYYYMMDD`         | Legacy date-range filters expect compact dates              |
| Active jobs | `/job.api/current` | Use the dedicated endpoint, not a status filter             |

## Working Examples

> Responses shown as JSON (with `Accept: application/json`). If the org returns legacy XML,
> the same field names appear inside a `<Response><Status>OK</Status>...` envelope.

### Example 1: Connectivity check — list staff (low-risk first call)

```http
GET /staff.api/list
Accept: application/json
```

```json
{
  "Status": "OK",
  "StaffList": [
    { "UUID": "0d6d8234-1a2b-4c3d-9e8f-9f1a55667788", "Name": "Jane Smith", "Email": "jane@acme.co.nz" },
    { "UUID": "1e7f9345-2b3c-5d4e-af90-a02b66778899", "Name": "Raj Patel", "Email": "raj@acme.co.nz" }
  ]
}
```

### Example 2: List currently-active jobs (summary)

```http
GET /job.api/current?page=1&pagesize=100
Accept: application/json
```

```json
{
  "Status": "OK",
  "Jobs": [
    {
      "ID": "J000123",
      "UUID": "e3b0c442-98fc-1c14-9afb-f4c8996fb1a2",
      "Name": "Website Redesign",
      "State": "In Progress",
      "Client": { "UUID": "a1b2c3d4-0000-1111-2222-333344445555", "Name": "Acme Ltd" },
      "StartDate": "2026-05-01",
      "DueDate": "2026-06-30"
    }
  ]
}
```

### Example 3: This week's time entries (staff reporting)

```http
GET /time.api/list?from=20260525&to=20260531
Accept: application/json
```

```json
{
  "Status": "OK",
  "Times": [
    {
      "UUID": "7a8b9c0d-...-ff11",
      "Job": "J000123",
      "Staff": "0d6d8234-...-9f1a",
      "Task": "Discovery",
      "Date": "2026-05-27",
      "Minutes": 90,
      "Billable": "Yes",
      "Note": "Stakeholder workshop"
    }
  ]
}
```

### Example 4: Get one job with full detail (tasks + costs)

```http
GET /job.api/get?uuid=e3b0c442-98fc-1c14-9afb-f4c8996fb1a2&detailed=true
Accept: application/json
```

```json
{
  "Status": "OK",
  "Job": {
    "ID": "J000123",
    "UUID": "e3b0c442-...-fb1a2",
    "Name": "Website Redesign",
    "State": "In Progress",
    "Budget": "12000.00",
    "Client": { "UUID": "a1b2c3d4-...-5555", "Name": "Acme Ltd" },
    "Tasks": [{ "UUID": "...", "Name": "Discovery", "EstimatedMinutes": 600 }],
    "Costs": [{ "UUID": "...", "Description": "Stock photos", "Amount": "120.00" }]
  }
}
```

## Proxy API Operations

> Legacy `{resource}.api/{action}` paths shown (the OAuth2 tier reuses them). Modern equivalent in Notes.

| Operation        | Method | Path                   | Key Parameters                   | Notes                                       |
| ---------------- | ------ | ---------------------- | -------------------------------- | ------------------------------------------- |
| List jobs        | GET    | `/job.api/list`        | `page,pagesize,detailed,from,to` | Modern: `GET /job`                          |
| List active jobs | GET    | `/job.api/current`     | `detailed`                       | Active only — no status filter needed       |
| Get job          | GET    | `/job.api/get`         | `uuid`                           | Modern: `GET /job/{uuid}`                   |
| Create job       | POST   | `/job.api/add`         | body                             | Needs existing `ClientUUID`. See 01c.       |
| Update job       | PUT    | `/job.api/update`      | body w/ `UUID`                   | See 01c                                     |
| List clients     | GET    | `/client.api/list`     | `page,pagesize`                  | Modern: `GET /client`                       |
| Get client       | GET    | `/client.api/get`      | `uuid`                           |                                             |
| Create client    | POST   | `/client.api/add`      | body                             |                                             |
| Update client    | PUT    | `/client.api/update`   | body w/ `UUID`                   |                                             |
| Archive client   | POST   | `/client.api/archive`  | `uuid`                           | **Destructive — confirm with user**         |
| Delete client    | DELETE | `/client.api/delete`   | `uuid`                           | **Destructive — confirm with user**         |
| List invoices    | GET    | `/invoice.api/list`    | `page,pagesize`                  | `/invoice.api/current` for outstanding      |
| List time        | GET    | `/time.api/list`       | `from,to`                        | Modern: `GET /time`                         |
| Log time         | POST   | `/time.api/add`        | body                             | Needs `Job`+`Staff`(+`Task`). See 01c.      |
| List staff       | GET    | `/staff.api/list`      | —                                | Best connectivity check                     |
| List quotes      | GET    | `/quote.api/list`      | `page,pagesize`                  | [INFERRED]                                  |
| List suppliers   | GET    | `/supplier.api/list`   | `page,pagesize`                  | [INFERRED]                                  |
| List leads       | GET    | `/lead.api/list`       | `from,to`                        | `/lead.api/current`, `/lead.api/categories` |
| List costs       | GET    | `/cost.api/list`       | `page,pagesize`                  | [INFERRED]                                  |
| List categories  | GET    | `/categories.api/list` | —                                | Reference data; cacheable                   |

Full catalog + field detail in `01a`/`01b`/`01c`.

## Pagination

- **Type:** page-number (`page` + `pagesize`). [DOCUMENTED]
- **Default page size:** server default (commonly 100). **Max:** [UNKNOWN] — confirm live.
- **Total count:** likely a `totalrecords`/count attribute on the collection (legacy XML exposes it). [INFERRED]
- **How to paginate:**

```http
GET /job.api/list?page=1&pagesize=100
GET /job.api/list?page=2&pagesize=100
```

- **Last page detection:** stop when the returned collection has **fewer than `pagesize`** items, or when `page * pagesize >= totalrecords` (if a total is provided).

## Webhooks / Events

No webhook, WebSocket, or SSE support. Use polling with `/{resource}.api/list` + `from`/`to` date filters; entities carry `WhenModified`/`WhenCreated` for change detection. Recommended interval: **≥15 min** (short token life + unknown rate limits). See 01d.

## Error Handling

**Standard error format (legacy envelope — still likely on reused endpoints):**

```json
{ "Status": "Error", "ErrorDescription": "Invalid UUID supplied" }
```

(XML equivalent: `<Response><Status>Error</Status><ErrorDescription>...</ErrorDescription></Response>`)

**Recovery by status:**

| Status                  | Meaning                                     | Action                                           |
| ----------------------- | ------------------------------------------- | ------------------------------------------------ |
| 200 + `Status: "Error"` | Business/validation error in body           | Read `ErrorDescription`; do NOT retry            |
| 400                     | Bad request                                 | Fix params — do not retry                        |
| 401                     | Expired/invalid access token                | Surface "reconnect required"; do not retry blind |
| 403                     | Missing `account_id` OR no 3rd-party access | Header issue / user must enable access           |
| 404                     | Unknown UUID/resource (or wrong base host)  | Verify UUID; consider the other base host        |
| 429 (assumed)           | Rate limited                                | Exponential backoff + jitter, retry              |
| 5xx                     | Server error                                | Retry with exponential backoff                   |

Full table + retry pseudocode in `01d-event-and-error-handling.md`.

## Known Limitations

1. **No live verification** — base host, JSON/XML default, field casing, and `State`/`Status` enums are unconfirmed. Lock them down from the first real response.
2. **No bulk ops, no webhooks** — single-record writes only; polling is the sole change-detection mechanism.
3. **Short token life + scope gap** — access tokens expire in ~12-30 min and the registry omits `offline_access`; reconnection prompts may be frequent until that scope is added.

---

_Generated from investigation questionnaire. See companion files for detailed reference:_

- _01a-domain-model-reference.md — Entity catalog, relationships, state machines_
- _01b-query-patterns.md — Filtering, search, pagination examples_
- _01c-mutation-patterns.md — Create, update, delete patterns_
- _01d-event-and-error-handling.md — Events, polling, error recovery_
