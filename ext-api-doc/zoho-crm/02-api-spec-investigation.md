---
api_name: 'Zoho CRM'
api_slug: 'zoho-crm'
base_url: 'https://www.zohoapis.{region}/crm/v8/'
version: 'v8'
spec_format: 'none'
spec_url: ''
docs_url: 'https://www.zoho.com/crm/developer/docs/api/v8/'
date_researched: '2026-04-23'
---

# Zoho CRM -- API Specification & Investigation

> Developer-facing condensed reference. Everything needed to implement or extend the
> Zoho CRM integration, in one page. Derived from `00-api-investigation-questionnaire.md`.

---

## Overview

- **Vendor:** Zoho Corporation
- **API version:** `v8` (released Oct 2024; v7 / v2 still supported for legacy)
- **Base URL (region-pinned):** `https://www.zohoapis.{region}/crm/v8/`
  - Regions: `.com.au` (AU), `.com` (US), `.eu` (EU), `.in` (IN), `.jp` (JP), `.com.cn` (CN)
- **Sandbox:** Activated per-org in Zoho UI — same host, no separate URL
- **API type:** REST
- **Data format:** JSON (multipart for file uploads only)
- **Documentation:** [zoho.com/crm/developer/docs/api/v8/](https://www.zoho.com/crm/developer/docs/api/v8/)
- **API reference:** Same URL — left nav lists every endpoint
- **OpenAPI spec:** Not published by Zoho
- **Status page:** [status.zoho.com](https://status.zoho.com/)

**Summary:** Zoho CRM is a structured-records CRM platform with full CRUD, search, and reporting across sales entities (Leads, Contacts, Accounts, Deals, Tasks) plus admin-configurable custom modules. The API is comprehensive, well-documented, and used by hundreds of thousands of organisations worldwide.

---

## Authentication

### Method: OAuth 2.0

Standard OAuth 2.0 authorization_code flow with long-lived refresh tokens. Access token lives 1 hour; refresh token does not expire and is NOT rotated on use.

**Header format:**

```
Authorization: Zoho-oauthtoken {access_token}
```

**Note: NOT `Bearer`** — Zoho uses its own scheme. Our backend handles this via the `authHeaderScheme` field on the connector registry entry.

### OAuth 2.0 Details

| Parameter         | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| Grant type        | `authorization_code` (also `refresh_token`)               |
| Authorization URL | `https://accounts.zoho.{region}/oauth/v2/auth`            |
| Token URL         | `https://accounts.zoho.{region}/oauth/v2/token`           |
| Revocation URL    | `https://accounts.zoho.{region}/oauth/v2/token/revoke`    |
| Access token TTL  | 1 hour                                                    |
| Refresh token TTL | Unlimited until revoked                                   |
| Refresh rotation  | No — same refresh_token keeps working                     |
| PKCE required     | No                                                        |
| `access_type`     | Must be `offline` on authorize to receive a refresh_token |
| `prompt`          | Recommended `consent` for fresh scope grants              |

### Required Scopes

Numa's default bundle for the Zoho CRM connector:

| Scope                           | Purpose                                           | Required? |
| ------------------------------- | ------------------------------------------------- | --------- |
| `ZohoCRM.modules.ALL`           | CRUD across all standard modules                  | yes       |
| `ZohoCRM.users.READ`            | Read user directory (for current user lookup)     | yes       |
| `ZohoCRM.org.READ`              | Read org metadata                                 | yes       |
| `ZohoCRM.settings.modules.READ` | Module metadata (module names, custom modules)    | yes       |
| `ZohoCRM.settings.fields.READ`  | Field metadata (required fields, picklist values) | yes       |
| `ZohoCRM.coql.READ`             | COQL queries                                      | yes       |
| `ZohoCRM.notifications.ALL`     | Subscribe to webhooks                             | optional  |

Alternative narrower scopes: `ZohoCRM.modules.{Module}.{READ|CREATE|UPDATE|DELETE}` — one per module per operation.

---

## Endpoint Catalog

### Records (repeat per module)

| Method | Path                                         | Purpose                                | Auth | Paginated | Idempotent | Notes                                |
| ------ | -------------------------------------------- | -------------------------------------- | ---- | --------- | ---------- | ------------------------------------ |
| GET    | `/crm/v8/{Module}`                           | List records                           | yes  | yes       | yes        | `fields` required; hybrid page/token |
| GET    | `/crm/v8/{Module}/{id}`                      | Get one record                         | yes  | no        | yes        | `fields` optional                    |
| GET    | `/crm/v8/{Module}/search`                    | Search (criteria/email/phone/word)     | yes  | yes       | yes        | Max 2000 rows; heavy-ops pool        |
| POST   | `/crm/v8/{Module}`                           | Create 1–100 records                   | yes  | no        | no         | 207 on partial                       |
| PUT    | `/crm/v8/{Module}/{id}`                      | Update one (partial)                   | yes  | no        | yes        |                                      |
| PUT    | `/crm/v8/{Module}`                           | Update 1–100 records                   | yes  | no        | yes        | `id` per record                      |
| DELETE | `/crm/v8/{Module}/{id}`                      | Delete one (soft)                      | yes  | no        | yes        |                                      |
| DELETE | `/crm/v8/{Module}?ids=...`                   | Delete 1–100 (soft)                    | yes  | no        | yes        | `wf_trigger` optional                |
| POST   | `/crm/v8/{Module}/upsert`                    | Insert or update                       | yes  | no        | yes\*      | `duplicate_check_fields`; 100 max    |
| GET    | `/crm/v8/{Module}/deleted?type=recycle`      | List soft-deleted records              | yes  | yes       | yes        |                                      |
| POST   | `/crm/v8/{Module}/{id}/Attachments`          | Upload attachment                      | yes  | no        | no         | multipart/form-data                  |
| GET    | `/crm/v8/{Module}/{id}/Attachments/{att_id}` | Download attachment                    | yes  | no        | yes        | Binary response                      |
| GET    | `/crm/v8/{Module}/{id}/{Related}`            | Related list (Notes/Attachments/Tasks) | yes  | yes       | yes        |                                      |

\* Upsert is effectively idempotent when the same dedupe keys are used.

### Lead-specific

| Method | Path                                 | Purpose              | Credits |
| ------ | ------------------------------------ | -------------------- | ------- |
| POST   | `/crm/v8/Leads/{id}/actions/convert` | Convert Lead         | 5       |
| POST   | `/crm/v8/Leads/actions/mass_convert` | Mass Lead conversion | 5 each  |

### Metadata

| Method | Path                                            | Purpose            |
| ------ | ----------------------------------------------- | ------------------ |
| GET    | `/crm/v8/org`                                   | Get org info       |
| GET    | `/crm/v8/users?type=CurrentUser`                | Get current user   |
| GET    | `/crm/v8/users?type=AllUsers`                   | List all users     |
| GET    | `/crm/v8/users/{id}`                            | Get user by id     |
| GET    | `/crm/v8/settings/modules`                      | List modules       |
| GET    | `/crm/v8/settings/modules/{module}`             | Get module details |
| GET    | `/crm/v8/settings/fields?module={module}`       | List fields        |
| GET    | `/crm/v8/settings/layouts?module={module}`      | List layouts       |
| GET    | `/crm/v8/settings/custom_views?module={module}` | List CVIDs         |
| GET    | `/crm/v8/settings/roles`                        | List roles         |
| GET    | `/crm/v8/settings/profiles`                     | List profiles      |

### Queries

| Method | Path           | Purpose        | Credits |
| ------ | -------------- | -------------- | ------- |
| POST   | `/crm/v8/coql` | SQL-like query | 1       |

### Notifications (Webhooks)

| Method | Path                                  | Purpose            |
| ------ | ------------------------------------- | ------------------ |
| POST   | `/crm/v8/actions/watch`               | Subscribe          |
| GET    | `/crm/v8/actions/watch`               | List subscriptions |
| DELETE | `/crm/v8/actions/watch?channel_ids=…` | Unsubscribe        |

### Async Bulk

| Method | Path                                | Purpose              | Credits |
| ------ | ----------------------------------- | -------------------- | ------- |
| POST   | `/crm/bulk/v8/read`                 | Initiate async read  | 500     |
| GET    | `/crm/bulk/v8/read/{job_id}`        | Poll status          | 1       |
| GET    | `/crm/bulk/v8/read/{job_id}/result` | Download CSV         | 1       |
| POST   | `/crm/bulk/v8/write`                | Initiate async write | 500     |
| GET    | `/crm/bulk/v8/write/{job_id}`       | Poll status          | 1       |

---

## Data Models

### EntityID (record id)

- **Type:** string (18–19 digit numeric)
- **Example:** `"410405000002264040"`
- **Immutable, server-assigned.** Always treat as opaque string — integer parsing will truncate.

### Lead

| Field             | Type          | Required | Writable | Notes                             |
| ----------------- | ------------- | -------- | -------- | --------------------------------- |
| `id`              | string        | —        | no       | 18-19 digit record ID             |
| `Last_Name`       | string        | yes      | yes      | Required on create                |
| `First_Name`      | string        | no       | yes      |                                   |
| `Company`         | string        | yes      | yes      | Required on Leads specifically    |
| `Email`           | email         | no       | yes      | Default duplicate-check field     |
| `Phone`, `Mobile` | string        | no       | yes      |                                   |
| `Lead_Status`     | picklist      | no       | yes      | Tenant-configurable               |
| `Lead_Source`     | picklist      | no       | yes      |                                   |
| `Owner`           | User lookup   | no       | yes      | `{id, name, email}`               |
| `Layout`          | Layout lookup | yes\*    | yes      | Required if multi-layout org      |
| `Converted`       | boolean       | —        | no       | Set on successful Lead conversion |
| `Created_Time`    | ISO 8601 dt   | —        | no       |                                   |
| `Modified_Time`   | ISO 8601 dt   | —        | no       |                                   |

**Relationships:** N:1 to User (Owner); 1:N to Note/Attachment/Task; on conversion, 1:1 to Contact/Account/Deal.

### Contact / Account / Deal / Task / Note / User

See `01a-domain-model-reference.md` for the full field catalogue.

---

## Pagination

- **Type:** hybrid — offset-based (`page`+`per_page`) for the first 2000 records, cursor (`page_token`) beyond.
- **Default page size:** 200
- **Max page size:** 200
- **Total count:** per-page only via `info.count`; global count via COQL `count(Id)`

### Parameters

| Parameter    | Type   | Default | Description                                                      |
| ------------ | ------ | ------- | ---------------------------------------------------------------- |
| `page`       | int    | 1       | 1-based. Mutually exclusive with `page_token`.                   |
| `per_page`   | int    | 200     | Max 200.                                                         |
| `page_token` | string | —       | From previous `info.next_page_token`; use once past record 2000. |
| `sort_by`    | string | `id`    | Single field only.                                               |
| `sort_order` | enum   | `desc`  | `asc` / `desc`.                                                  |

### Response structure

```json
{
  "data": [ … ],
  "info": {
    "per_page": 200,
    "count": 200,
    "page": 1,
    "more_records": true,
    "next_page_token": null,
    "sort_by": "Modified_Time",
    "sort_order": "desc"
  }
}
```

### Last page detection

`info.more_records === false`.

---

## Rate Limits

**Credit-based, 24-hour rolling window.** Not requests-per-minute.

| Edition               | Base credits | Per-user | Max limit | Concurrent calls | Heavy-ops sub-pool |
| --------------------- | ------------ | -------- | --------- | ---------------- | ------------------ |
| Free                  | 5,000        | —        | 5,000     | 5                | 10 shared          |
| Standard / Starter    | 50,000       | +250     | 100,000   | 10               | 10 shared          |
| Professional          | 50,000       | +500     | 3,000,000 | 15               | 10 shared          |
| Enterprise / Zoho One | 50,000       | +1,000   | 5,000,000 | 20               | 10 shared          |
| Ultimate / CRM Plus   | 50,000       | +2,000   | unlimited | 25               | 10 shared          |

**Credit costs:** most calls 1 credit; Convert Lead 5; Merge Records 50; Bulk Write Initialize 500.

**Heavy ops** (count against the 10-slot sub-pool): Get Records with `cvid`, Convert Lead, bulk operations >10 records, Send Mail, Search, COQL, Composite APIs.

### Headers

| Header                    | Meaning                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `X-API-CREDITS-REMAINING` | Appears only when >50% of daily credits have been consumed |

Standard `X-RATELIMIT-*` headers are NOT returned.

### When exceeded

HTTP 429 `TOO_MANY_REQUESTS`. `Retry-After` header may be present.

### Strategy

1. Honour `Retry-After`.
2. Exponential backoff with jitter (base 2s, max 60s).
3. Surface to user after 3 retries.

---

## Error Handling

### Standard format

```json
{
  "code": "INVALID_DATA",
  "details": { "api_name": "Email", "expected_data_type": "string" },
  "message": "the given data is not valid",
  "status": "error"
}
```

### Status codes

| Status | Common codes                                                                                        | Retryable | Recovery                                 |
| ------ | --------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------- |
| 200    | SUCCESS                                                                                             | —         | —                                        |
| 204    | —                                                                                                   | —         | Zero results                             |
| 207    | Mixed per-record                                                                                    | per-item  | Iterate `data[i].status`                 |
| 400    | `INVALID_MODULE`, `INVALID_DATA`, `REQUIRED_PARAM_MISSING`, `MANDATORY_NOT_FOUND`, `DUPLICATE_DATA` | No        | Fix per `details`                        |
| 401    | `INVALID_TOKEN`                                                                                     | Yes (1)   | Refresh; if refresh also 401, re-consent |
| 403    | `OAUTH_SCOPE_MISMATCH`, `NOT_ALLOWED`                                                               | No        | Add scope (admin); check role            |
| 404    | `RESOURCE_NOT_FOUND`                                                                                | No        | Verify id (string, not int)              |
| 409    | `DUPLICATE_DATA`, `RECORD_LOCKED`                                                                   | Maybe     | Use `/upsert` or fetch-and-update        |
| 422    | `MANDATORY_NOT_FOUND`, `INVALID_DATA`                                                               | No        | `GET /settings/fields?module=X`          |
| 429    | `TOO_MANY_REQUESTS`                                                                                 | Yes (3)   | Retry-After; exponential backoff         |
| 5xx    | `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`                                                             | Yes (3)   | Retry with backoff                       |

Full reference: `01d-event-and-error-handling.md` § Error Code Reference.

---

## Webhooks / Events

**Supported.** Notifications API: `POST /crm/v8/actions/watch`.

| Event             | Trigger               | Payload                                                               |
| ----------------- | --------------------- | --------------------------------------------------------------------- |
| `{Module}.create` | Record created        | `{server_time, module, ids[], operation:"insert", channel_id, token}` |
| `{Module}.edit`   | Record updated        | Same plus `affected_fields`                                           |
| `{Module}.delete` | Record deleted (soft) | Same, `operation:"delete"`                                            |
| `Leads.convert`   | Lead conversion       |                                                                       |

**Verification:** echo-back shared `token` only. No HMAC signing.

**Reliability:** 5 retries with exponential backoff on non-2xx; no DLQ; best-effort ordering; duplicates possible.

**Subscription lifetime:** 24h default, extendable to 1 year via `channel_expiry`.

**Numa status:** not yet wired into Numa (no public receiver endpoint). Polling is the current fallback.

---

## Known Limitations

1. **No OpenAPI/Swagger spec.** Must code against the docs manually (or use the Zoho SDKs).
2. **No `/auth/me` endpoint.** Use `GET /crm/v8/users?type=CurrentUser`.
3. **Search capped at 2000 records.** Use COQL or bulk read for larger extracts.
4. **Rate limits hidden until 50% consumed.** No proactive header for early warnings.
5. **Webhooks not HMAC-signed** — only echo-back token. Weaker than industry standard.
6. **Soft delete only** via DELETE. Hard delete requires emptying the whole Recycle Bin.
7. **Search criteria dropped silently** — conflicting params (both `criteria` and `word`) aren't flagged; only one is used.
8. **Lookup fields need `.id` or `.name`** path inside search criteria — direct field name won't match.
9. **Custom modules are tenant-specific.** Always query `/settings/modules` at runtime; never hardcode.

---

## SDKs & Tooling

| SDK                    | Language | Repository                             | Quality | Notes                                    |
| ---------------------- | -------- | -------------------------------------- | ------- | ---------------------------------------- |
| zohocrm-python-sdk-8.0 | Python   | github.com/zoho/zohocrm-python-sdk-8.0 | good    | Not used by Numa — we use httpx directly |
| zohocrm-nodejs-sdk-8.0 | Node.js  | github.com/zoho/zohocrm-nodejs-sdk-8.0 | good    |                                          |
| zohocrm-java-sdk-8.0   | Java     | github.com/zoho/zohocrm-java-sdk-8.0   | good    |                                          |
| zohocrm-php-sdk-8.0    | PHP      | github.com/zoho/zohocrm-php-sdk-8.0    | good    |                                          |
| zohocrm-csharp-sdk-8.0 | C#       | github.com/zoho/zohocrm-csharp-sdk-8.0 | good    |                                          |
| zohocrm-go-sdk-8.0     | Go       | github.com/zoho/zohocrm-go-sdk-8.0     | good    |                                          |

**Postman collection:** developer.zoho.com/postman-collection (public v2 collection).
**OpenAPI spec:** Not published.

---

## Integration Path Assessment

**Recommended path:** **Direct API Only**

**Justification:**

- Zoho CRM is a structured-records platform — Leads, Contacts, Deals, etc. Not files.
- It doesn't naturally fit the "browse files" UX that the Data Connector pattern is designed for.
- All value comes from the workspace agent making HTTP calls via `connect_request`: list/search/get/create/update.
- `surfaces: ['chat']` in the connector registry keeps it out of Files > Remote.

**Connector compatibility:**

| Connector Method    | API Endpoint                          | Feasibility |
| ------------------- | ------------------------------------- | ----------- |
| `list_files`        | n/a — no file model                   | none        |
| `download_file`     | n/a — attachments only, not file tree | none        |
| `search_files`      | n/a — record search, not file search  | none        |
| `get_file_metadata` | n/a                                   | none        |

No provider class required. The generic `connect_request` handler in `oauth-workspace-tools` covers all CRUD, given:

1. `oauth-client-zoho-crm` vault entry with client_id/secret + auth_url/token_url (admin wizard does this).
2. `auth_header_scheme: "Zoho-oauthtoken"` in the same vault entry (persisted automatically from the registry).
3. Optional: `connector-config-zoho-crm.fields.instance_url` (e.g. `https://www.zohoapis.com.au/crm/v8`) for relative-path expansion.

Steps 1 and 2 are already shipped in commit `d5333a75`.

---

_Researched on 2026-04-23. Source: `00-api-investigation-questionnaire.md`. Confidence: medium — first-live-call gate not yet satisfied, promote markers to [CONFIRMED] after a successful `GET /crm/v8/org` against the deployed integration._
