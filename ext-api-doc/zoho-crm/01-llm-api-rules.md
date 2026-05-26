---
api_name: 'Zoho CRM'
api_slug: 'zoho-crm'
version: 'v8'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-04-23'
line_count_target: '< 300 lines'
---

# Zoho CRM -- Workspace Agent API Rules

> Loaded into the workspace agent's context when the Zoho CRM integration is active.
> Companion files (01a–01d) carry the detailed reference. Keep this one ≤300 lines.

## Context

- **API:** Zoho CRM v8 (REST, JSON)
- **Base URL (region-pinned):** `https://www.zohoapis.{region}/crm/v8/` — `.com.au` / `.com` / `.eu` / `.in` / `.jp` / `.com.cn`. Admin sets the region at wizard time; backend expands relative paths against the admin-configured host.
- **Auth:** OAuth 2.0. Header uses Zoho's own scheme, NOT `Bearer`.
- **Integration path:** Direct API Only — all interactions through `connect_request`.
- **Rate model:** credit-based (24-hour rolling) plus concurrent-calls cap. See 01d.

## Auth Structure

```
Authorization: Zoho-oauthtoken {access_token}
```

The header scheme is `Zoho-oauthtoken` (NOT `Bearer`). Build it verbatim — using `Bearer` returns `INVALID_TOKEN` 401.

**Token lifecycle:**

- Access token lives 1 hour. Backend refreshes via the admin-configured token URL.
- Refresh token is long-lived and NOT rotated on use.
- On `401 INVALID_TOKEN`, refresh and retry once; on second 401 fail the tool call — user must reconnect.

## Capabilities

### CAN

1. List, search, get, create, update, upsert, and delete records in any module (Leads, Contacts, Accounts, Deals, Tasks, Notes, custom) — up to 100 per batch.
2. Run COQL (`POST /crm/v8/coql`) for SQL-like cross-module reports, counts, and filters the `search` endpoint can't express.
3. Walk related lists (`GET /{module}/{id}/{Related}`) to pull notes, attachments, tasks, calls on a parent record.
4. Convert a Lead to Contact/Account/Deal via `POST /crm/v8/Leads/{id}/actions/convert`.
5. Discover module and field metadata at runtime via `/settings/modules` and `/settings/fields`.

### CANNOT

1. Upload attachments — the backend's `connect_request` only sends JSON. Ask the user to upload in the Zoho UI.
2. Subscribe to notifications on behalf of a user — requires a Numa-hosted public webhook endpoint we don't have yet.
3. Merge records (50 credits, irreversible) — not exposed from chat.
4. Trigger cross-region requests. If the admin configured AU, you cannot talk to a US org from the same connection.

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **`fields` is required when listing records.** `GET /crm/v8/Leads` returns 400 `REQUIRED_PARAM_MISSING` without `?fields=...` (max 50). Use `GET /crm/v8/settings/fields?module=Leads` first when you don't know what to ask for.
2. **Module api_name is case-sensitive.** `Leads`, `Contacts`, `Accounts`, `Deals`, `Tasks`, `Calls`, `Meetings`, `Notes`. Custom modules use whatever the admin set (e.g. `CustomModule1`). Lowercase will 400 as `INVALID_MODULE`.
3. **Body wrapper is `{"data": [ … ]}`** for every create/update/upsert — even when sending one record. Max 100 records per call.
4. **Pagination has two modes — and a hard cap.** Use `page` + `per_page` up to record 2000. Beyond that, switch to `page_token` (from the previous response's `info.next_page_token`). Sending both on the same request returns 400. **Cursor chain caps at 100,000 records total per query, and each `page_token` expires after 24 hours.** A `previous_page_token` is also returned. Long backfills must checkpoint and restart past 100k or after 24h, or they silently truncate. [VERIFIED 2026-05-19 against https://www.zoho.com/crm/developer/docs/api/v8/get-records.html]
5. **Search has four mutually-exclusive params.** One of `criteria`, `email`, `phone`, `word` per call. Priority if multiple: criteria → email → phone → word. Max 2000 rows retrievable via search; use COQL for more.
6. **Dates with timezone offset in criteria.** Use `+00:00` / `+10:00` form. A `Z` suffix is accepted but the URL-encoder sometimes mangles it — stick to explicit offsets.
7. **IDs are strings, not integers.** 18–19 digit numeric strings like `"410405000002264040"`. Always treat as opaque strings.
8. **Lead conversion costs 5 credits and is irreversible from the API.** Confirm with user before calling.
9. **Partial batch failures return HTTP 207.** Iterate `data[i].status` — some records may be SUCCESS while others are DUPLICATE_DATA / MANDATORY_NOT_FOUND. Report both the successes and the failures to the user.
10. **Layout.id is required** for orgs with multiple layouts on the same module. Discover via `GET /crm/v8/settings/layouts?module={Module}` — use the `default: true` one unless the user asks otherwise.

## Default Parameters

| Parameter              | Default                         | Reason                                                        |
| ---------------------- | ------------------------------- | ------------------------------------------------------------- |
| `per_page`             | 200                             | API max — minimise round-trips.                               |
| `fields` (list)        | core 6–8 per module (see below) | Avoid the "`fields` required" 400.                            |
| `sort_by`/`sort_order` | `Modified_Time` / `desc`        | Freshest-first is what the user expects.                      |
| `trigger` (writes)     | `["workflow"]`                  | Keep automations; skip approvals/blueprints unless user asks. |
| `wf_trigger` (delete)  | `true`                          | Workflow parity with UI deletes.                              |

**Per-module default `fields` fallback (when user hasn't said which):**

| Module   | Fields                                                                   |
| -------- | ------------------------------------------------------------------------ |
| Leads    | `Last_Name,First_Name,Email,Phone,Company,Lead_Status,Lead_Source,Owner` |
| Contacts | `Full_Name,Email,Phone,Account_Name,Title,Owner`                         |
| Accounts | `Account_Name,Phone,Website,Industry,Owner`                              |
| Deals    | `Deal_Name,Stage,Amount,Closing_Date,Account_Name,Owner,Probability`     |
| Tasks    | `Subject,Status,Priority,Due_Date,Who_Id,What_Id,Owner`                  |
| Notes    | `Note_Title,Note_Content,Parent_Id,se_module,Owner,Created_Time`         |

## Working Examples

### Example 1: List Leads (first call after auth)

```http
GET /crm/v8/Leads?fields=Last_Name,First_Name,Email,Phone,Company,Lead_Status,Owner&per_page=200&sort_by=Modified_Time&sort_order=desc HTTP/1.1
```

```json
{
  "data": [
    {
      "id": "410405000002264040",
      "Last_Name": "Smith",
      "First_Name": "Jane",
      "Email": "jane@acme.example",
      "Phone": "+61 3 9000 0000",
      "Company": "Acme",
      "Lead_Status": "Contacted",
      "Owner": { "id": "410405000000123456", "name": "Sarah Owner", "email": "sarah@example.com" }
    }
  ],
  "info": {
    "per_page": 200,
    "count": 1,
    "page": 1,
    "more_records": false,
    "next_page_token": null,
    "sort_by": "Modified_Time",
    "sort_order": "desc"
  }
}
```

### Example 2: Find deals for a specific account

```http
GET /crm/v8/Deals/search?criteria=((Account_Name.name:equals:Acme))&fields=Deal_Name,Stage,Amount,Closing_Date,Owner
```

```json
{
  "data": [
    {
      "id": "410405000002264100",
      "Deal_Name": "Acme – Q2 renewal",
      "Stage": "Negotiation/Review",
      "Amount": 45000,
      "Closing_Date": "2026-06-30",
      "Owner": { "id": "…", "name": "…" }
    }
  ],
  "info": { "per_page": 200, "count": 1, "page": 1, "more_records": false }
}
```

### Example 3: Create a Lead

```http
POST /crm/v8/Leads
Content-Type: application/json

{ "data": [ { "Last_Name": "Smith", "First_Name": "Jane", "Company": "Acme", "Email": "jane@acme.example", "Lead_Source": "Web Form" } ], "trigger": ["workflow"] }
```

```json
{
  "data": [
    {
      "code": "SUCCESS",
      "details": { "id": "410405000002264200", "Created_Time": "2026-04-23T10:00:00+10:00" },
      "message": "record added",
      "status": "success"
    }
  ]
}
```

## Proxy API Operations

| Operation    | Method | Path                                 | Key params                                       | Notes                        |
| ------------ | ------ | ------------------------------------ | ------------------------------------------------ | ---------------------------- |
| List records | GET    | `/crm/v8/{Module}`                   | `fields` (req), `per_page`, `page`, `page_token` | `fields` mandatory           |
| Get one      | GET    | `/crm/v8/{Module}/{id}`              | `fields` (opt)                                   | Returns `data[0]`            |
| Search       | GET    | `/crm/v8/{Module}/search`            | one of `criteria`/`email`/`phone`/`word`         | 2000 rows max                |
| Create       | POST   | `/crm/v8/{Module}`                   | body `{"data":[{…}], "trigger":[…]}`             | 100 max; 207 on partial      |
| Update one   | PUT    | `/crm/v8/{Module}/{id}`              | body `{"data":[{…}]}`                            | Partial update               |
| Update many  | PUT    | `/crm/v8/{Module}`                   | body `{"data":[{…, "id":…}, …]}`                 | 100 max                      |
| Upsert       | POST   | `/crm/v8/{Module}/upsert`            | `duplicate_check_fields`                         | Safe for retries             |
| Delete       | DELETE | `/crm/v8/{Module}?ids=id1,id2`       | `wf_trigger`                                     | 100 max; soft delete         |
| Modules      | GET    | `/crm/v8/settings/modules`           | —                                                | Do this when module unknown  |
| Fields       | GET    | `/crm/v8/settings/fields`            | `module`                                         | Required before risky writes |
| Org          | GET    | `/crm/v8/org`                        | —                                                | Liveness / company name      |
| Current user | GET    | `/crm/v8/users?type=CurrentUser`     | —                                                | No `/auth/me` — use this     |
| Convert Lead | POST   | `/crm/v8/Leads/{id}/actions/convert` | body                                             | 5 credits, confirm first     |
| COQL         | POST   | `/crm/v8/coql`                       | body `{"select_query": "…"}`                     | Cross-module / aggregate     |

## Pagination

- **Type:** query-string. Hybrid page/cursor.
- **Default page size:** 200. **Max:** 200.
- **Up to record 2000:** `?page=N&per_page=200`.
- **Beyond 2000:** `?page_token={info.next_page_token}&per_page=200`. Do NOT combine with `page`.
- **Last page detection:** `info.more_records === false`.

```http
GET /crm/v8/Leads?fields=id,Email&per_page=200&page=1
→ info.more_records=true, info.next_page_token=null (still offset)

GET /crm/v8/Leads?fields=id,Email&per_page=200&page_token=eyJ... (past 2000)
→ info.more_records=true, info.next_page_token="eyJ..."
```

## Webhooks / Events

Zoho CRM supports **notifications** (webhooks), but Numa's Zoho CRM connector does not yet expose a Numa-hosted receiver. If the user asks about live notifications, tell them it's currently not wired — polling is the workaround:

```
POST /crm/v8/coql
{ "select_query": "select Id, Modified_Time from Leads where Modified_Time > '2026-04-23T09:00:00+10:00' order by Modified_Time desc limit 200" }
```

Recommended interval: ≥5 minutes. Never below 1 minute — concurrency cap is 5–25 per org per app.

## Error Handling

**Standard error:**

```json
{
  "code": "INVALID_DATA",
  "details": { "api_name": "Email", "expected_data_type": "string" },
  "message": "the given data is not valid",
  "status": "error"
}
```

**Recovery by status:**

| Status | Meaning                | Action                                                        |
| ------ | ---------------------- | ------------------------------------------------------------- |
| 400    | Bad request            | Fix per `details` — most common: missing `fields`, bad module |
| 401    | `INVALID_TOKEN`        | Backend refreshes automatically; if re-raised, reconnect      |
| 403    | `OAUTH_SCOPE_MISMATCH` | Admin must add scope + user reconnects                        |
| 404    | `RESOURCE_NOT_FOUND`   | Verify `id` — it's a string, not an integer                   |
| 207    | Partial (batch)        | Iterate `data[i].status` — report successes AND failures      |
| 409    | `DUPLICATE_DATA`       | Offer to upsert with `duplicate_check_fields` instead         |
| 422    | `MANDATORY_NOT_FOUND`  | Pull `/settings/fields` and supply missing required fields    |
| 429    | `TOO_MANY_REQUESTS`    | Back off per `Retry-After`; notify user if persistent         |
| 5xx    | Server error           | Retry with exponential backoff                                |

Always show the user the `message` and the first entry in `details` — don't paraphrase.

## Known Limitations

1. No `/auth/me` endpoint — use `GET /crm/v8/users?type=CurrentUser` and cache the returned user object.
2. Rate limiting is credit-based over 24h — no RPM counter. Only `X-API-CREDITS-REMAINING` appears, and only once >50% consumed.
3. Webhook security: Zoho doesn't HMAC-sign payloads, only echoes a shared `token`. If we build notification support later, treat with extra scepticism.
4. Custom modules use tenant-defined api_names. Always call `/settings/modules` when the user asks about a module you haven't seen.
5. File attachments are not callable from chat in this iteration — JSON-only request path.

---

_Companions:_

- _01a-domain-model-reference.md — Entity catalogue, relationships, state machines_
- _01b-query-patterns.md — Filtering, search, pagination, COQL_
- _01c-mutation-patterns.md — Create, update, upsert, delete, Lead conversion_
- _01d-event-and-error-handling.md — Notifications, credit model, error recovery_
