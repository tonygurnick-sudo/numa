---
api_name: Zoho CRM
api_slug: zoho-crm
doc: developer API spec — condensed implementation reference (NOT loaded into agent context)
base_url: https://www.zohoapis.{region}/crm/v8/ — region-pinned; use the api_domain from the token response
path_version_segment: /v8/ IS a real path segment, NOT a label. Route = {api_domain}/crm/v8/{Module}.
api_version: v8 (label only — already embedded in base path; do not add a separate /v8 prefix on top)
auth: OAuth 2.0; header `Zoho-oauthtoken {token}` (NOT Bearer)
spec_format: none (no OpenAPI published)
docs_url: https://www.zoho.com/crm/developer/docs/api/v8/
status_page: https://status.zoho.com/
date_researched: 2026-04-23
confidence: medium — first-live-call gate not yet satisfied; promote [INFERRED]/medium markers to confirmed after a successful GET /crm/v8/org against the deployed integration
---

# Zoho CRM — API Spec & Investigation

> Developer-facing condensed reference. Everything to implement/extend the Zoho CRM integration.

## Overview

- Vendor: Zoho Corporation. API type REST; data JSON (multipart for file uploads only).
- API version `v8` (released Oct 2024; v7/v2 still supported for legacy).
- Base URL region-pinned: `https://www.zohoapis.{region}/crm/v8/` — regions `.com.au`(AU), `.com`(US), `.eu`(EU), `.in`(IN), `.jp`(JP), `.com.cn`(CN), `.ca`(CA). At runtime use the `api_domain` from the token, not a computed host.
- Sandbox: activated per-org in Zoho UI — same host, no separate URL.
- No OpenAPI/Swagger spec. Docs: [zoho.com/crm/developer/docs/api/v8/](https://www.zoho.com/crm/developer/docs/api/v8/) (left nav lists every endpoint). Status: [status.zoho.com](https://status.zoho.com/).
- Structured-records CRM: full CRUD/search/reporting across Leads, Contacts, Accounts, Deals, Tasks + admin-configurable custom modules.

## Authentication

OAuth 2.0 `authorization_code` flow with long-lived refresh tokens. Access token 1h; refresh token never expires, NOT rotated on use.
Header: `Authorization: Zoho-oauthtoken {access_token}` — **NOT `Bearer`** (own scheme; handled via the registry `authHeaderScheme` field).

| Param             | Value                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Grant types       | `authorization_code` + `refresh_token`                                                                                                         |
| Authorization URL | `https://accounts.zoho.{region}/oauth/v2/auth` (CA: `accounts.zohocloud.ca`)                                                                   |
| Token URL         | `https://accounts.zoho.{region}/oauth/v2/token` (CA: `accounts.zohocloud.ca`)                                                                  |
| Revocation URL    | `https://accounts.zoho.{region}/oauth/v2/token/revoke` (CA: `accounts.zohocloud.ca`)                                                           |
| ⚠️ Region mapping | US `.com` · AU `.com.au` · EU `.eu` · IN `.in` · JP `.jp` · CN `.com.cn` · **CA `cloud.ca` (NOT `.ca`)** [VERIFIED 2026-05-19 — multi-dc.html] |
| Access token TTL  | 1 hour                                                                                                                                         |
| Refresh token TTL | unlimited until revoked                                                                                                                        |
| Refresh rotation  | No — same refresh_token keeps working                                                                                                          |
| PKCE              | No                                                                                                                                             |
| `access_type`     | must be `offline` on authorize to receive a refresh_token                                                                                      |
| `prompt`          | recommended `consent` for fresh scope grants                                                                                                   |

### Required Scopes (Numa default bundle)

| Scope                           | Purpose                                     | Req?     |
| ------------------------------- | ------------------------------------------- | -------- |
| `ZohoCRM.modules.ALL`           | CRUD across standard modules                | yes      |
| `ZohoCRM.users.READ`            | read user directory (current-user lookup)   | yes      |
| `ZohoCRM.org.READ`              | read org metadata                           | yes      |
| `ZohoCRM.settings.modules.READ` | module metadata (names, custom modules)     | yes      |
| `ZohoCRM.settings.fields.READ`  | field metadata (required fields, picklists) | yes      |
| `ZohoCRM.coql.READ`             | COQL queries                                | yes      |
| `ZohoCRM.notifications.ALL`     | subscribe to webhooks                       | optional |

Narrower alternative: `ZohoCRM.modules.{Module}.{READ|CREATE|UPDATE|DELETE}` — one per module per operation.

## Endpoint Catalog

### Records (per module)

| Method | Path                                         | Purpose                                | Paginated | Idempotent | Notes                                |
| ------ | -------------------------------------------- | -------------------------------------- | --------- | ---------- | ------------------------------------ |
| GET    | `/crm/v8/{Module}`                           | list                                   | yes       | yes        | `fields` required; hybrid page/token |
| GET    | `/crm/v8/{Module}/{id}`                      | get one                                | no        | yes        | `fields` optional                    |
| GET    | `/crm/v8/{Module}/search`                    | search (criteria/email/phone/word)     | yes       | yes        | max 2000 rows; heavy-ops pool        |
| POST   | `/crm/v8/{Module}`                           | create 1–100                           | no        | no         | 207 on partial                       |
| PUT    | `/crm/v8/{Module}/{id}`                      | update one (partial)                   | no        | yes        |                                      |
| PUT    | `/crm/v8/{Module}`                           | update 1–100                           | no        | yes        | `id` per record                      |
| DELETE | `/crm/v8/{Module}/{id}`                      | delete one (soft)                      | no        | yes        |                                      |
| DELETE | `/crm/v8/{Module}?ids=...`                   | delete 1–100 (soft)                    | no        | yes        | `wf_trigger` optional                |
| POST   | `/crm/v8/{Module}/upsert`                    | insert or update                       | no        | yes\*      | `duplicate_check_fields`; 100 max    |
| GET    | `/crm/v8/{Module}/deleted?type=recycle`      | list soft-deleted                      | yes       | yes        |                                      |
| POST   | `/crm/v8/{Module}/{id}/Attachments`          | upload attachment                      | no        | no         | multipart/form-data                  |
| GET    | `/crm/v8/{Module}/{id}/Attachments/{att_id}` | download attachment                    | no        | yes        | binary response                      |
| GET    | `/crm/v8/{Module}/{id}/{Related}`            | related list (Notes/Attachments/Tasks) | yes       | yes        |                                      |

\* Upsert is effectively idempotent with the same dedupe keys.

### Lead-specific

| Method | Path                                 | Purpose         | Credits |
| ------ | ------------------------------------ | --------------- | ------- |
| POST   | `/crm/v8/Leads/{id}/actions/convert` | convert Lead    | 5       |
| POST   | `/crm/v8/Leads/actions/mass_convert` | mass conversion | 5 each  |

### Metadata

| Method | Path                                            | Purpose        |
| ------ | ----------------------------------------------- | -------------- |
| GET    | `/crm/v8/org`                                   | org info       |
| GET    | `/crm/v8/users?type=CurrentUser`                | current user   |
| GET    | `/crm/v8/users?type=AllUsers`                   | all users      |
| GET    | `/crm/v8/users/{id}`                            | user by id     |
| GET    | `/crm/v8/settings/modules`                      | list modules   |
| GET    | `/crm/v8/settings/modules/{module}`             | module details |
| GET    | `/crm/v8/settings/fields?module={module}`       | list fields    |
| GET    | `/crm/v8/settings/layouts?module={module}`      | list layouts   |
| GET    | `/crm/v8/settings/custom_views?module={module}` | list CVIDs     |
| GET    | `/crm/v8/settings/roles`                        | list roles     |
| GET    | `/crm/v8/settings/profiles`                     | list profiles  |

### Queries

| Method | Path           | Purpose        | Credits |
| ------ | -------------- | -------------- | ------- |
| POST   | `/crm/v8/coql` | SQL-like query | 1       |

### Notifications (webhooks)

| Method | Path                                  | Purpose            |
| ------ | ------------------------------------- | ------------------ |
| POST   | `/crm/v8/actions/watch`               | subscribe          |
| GET    | `/crm/v8/actions/watch`               | list subscriptions |
| DELETE | `/crm/v8/actions/watch?channel_ids=…` | unsubscribe        |

### Async bulk

| Method | Path                                | Purpose              | Credits |
| ------ | ----------------------------------- | -------------------- | ------- |
| POST   | `/crm/bulk/v8/read`                 | initiate async read  | 500     |
| GET    | `/crm/bulk/v8/read/{job_id}`        | poll status          | 1       |
| GET    | `/crm/bulk/v8/read/{job_id}/result` | download CSV         | 1       |
| POST   | `/crm/bulk/v8/write`                | initiate async write | 500     |
| GET    | `/crm/bulk/v8/write/{job_id}`       | poll status          | 1       |

## Data Models

### EntityID (record id)

string (18–19 digit numeric), e.g. `"410405000002264040"`. Immutable, server-assigned. Always opaque string — int parsing truncates.

### Lead

| Field                          | Type          | Req   | Writable | Notes                          |
| ------------------------------ | ------------- | ----- | -------- | ------------------------------ |
| `id`                           | string        | —     | no       | 18–19 digit record ID          |
| `Last_Name`                    | string        | yes   | yes      | required on create             |
| `First_Name`                   | string        | no    | yes      |                                |
| `Company`                      | string        | yes   | yes      | required on Leads specifically |
| `Email`                        | email         | no    | yes      | default duplicate-check field  |
| `Phone`,`Mobile`               | string        | no    | yes      |                                |
| `Lead_Status`                  | picklist      | no    | yes      | tenant-configurable            |
| `Lead_Source`                  | picklist      | no    | yes      |                                |
| `Owner`                        | User lookup   | no    | yes      | `{id,name,email}`              |
| `Layout`                       | Layout lookup | yes\* | yes      | required if multi-layout org   |
| `Converted`                    | boolean       | —     | no       | set on successful conversion   |
| `Created_Time`,`Modified_Time` | ISO 8601 dt   | —     | no       |                                |

Relationships: N:1 → User (Owner); 1:N → Note/Attachment/Task; on conversion 1:1 → Contact/Account/Deal.
Contact / Account / Deal / Task / Note / User: full field catalogue in `01a-domain-model-reference.md`.

## Pagination

Hybrid — offset (`page`+`per_page`) for first 2000 records, cursor (`page_token`) beyond. Default+max `per_page=200`. Total count: per-page via `info.count`; global via COQL `count(Id)`.

| Param        | Type   | Default | Notes                                                                                                                                                                                                    |
| ------------ | ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`       | int    | 1       | 1-based; mutually exclusive with `page_token`                                                                                                                                                            |
| `per_page`   | int    | 200     | max 200                                                                                                                                                                                                  |
| `page_token` | string | —       | from `info.next_page_token`; use past record 2000. Cursor chain caps at 100,000 total; each token expires 24h after issue. `previous_page_token` also returned. [VERIFIED 2026-05-19 — get-records.html] |
| `sort_by`    | string | `id`    | single field                                                                                                                                                                                             |
| `sort_order` | enum   | `desc`  | `asc`/`desc`                                                                                                                                                                                             |

Response: `{"data":[…],"info":{"per_page":200,"count":200,"page":1,"more_records":true,"next_page_token":null,"sort_by":"Modified_Time","sort_order":"desc"}}`. Last page: `info.more_records === false`.

## Rate Limits — credit-based, 24h rolling window (NOT RPM)

| Edition               | Base credits | Per-user | Max limit | Concurrent | Heavy-ops sub-pool |
| --------------------- | ------------ | -------- | --------- | ---------- | ------------------ |
| Free                  | 5,000        | —        | 5,000     | 5          | 10 shared          |
| Standard / Starter    | 50,000       | +250     | 100,000   | 10         | 10 shared          |
| Professional          | 50,000       | +500     | 3,000,000 | 15         | 10 shared          |
| Enterprise / Zoho One | 50,000       | +1,000   | 5,000,000 | 20         | 10 shared          |
| Ultimate / CRM Plus   | 50,000       | +2,000   | unlimited | 25         | 10 shared          |

Credit costs: most calls 1; Convert Lead 5; Merge Records 50; Bulk Write Initialize 500.
Heavy ops (10-slot sub-pool): Get Records with `cvid`, Convert Lead, bulk >10 records, Send Mail, Search, COQL, Composite APIs.
Header: `X-API-CREDITS-REMAINING` — appears only when >50% of daily credits consumed. Standard `X-RATELIMIT-*` NOT returned.
When exceeded: HTTP 429 `TOO_MANY_REQUESTS`, `Retry-After` may be present. Strategy: honour `Retry-After`; exponential backoff w/ jitter (base 2s, max 60s); surface after 3 retries.

## Error Handling

Standard: `{"code":"INVALID_DATA","details":{"api_name":"Email","expected_data_type":"string"},"message":"the given data is not valid","status":"error"}`

| Status | Common codes                                                                                    | Retryable | Recovery                                 |
| ------ | ----------------------------------------------------------------------------------------------- | --------- | ---------------------------------------- |
| 200    | SUCCESS                                                                                         | —         | —                                        |
| 204    | —                                                                                               | —         | zero results                             |
| 207    | mixed per-record                                                                                | per-item  | iterate `data[i].status`                 |
| 400    | `INVALID_MODULE`,`INVALID_DATA`,`REQUIRED_PARAM_MISSING`,`MANDATORY_NOT_FOUND`,`DUPLICATE_DATA` | No        | fix per `details`                        |
| 401    | `INVALID_TOKEN`                                                                                 | Yes(1)    | refresh; if refresh also 401, re-consent |
| 403    | `OAUTH_SCOPE_MISMATCH`,`NOT_ALLOWED`                                                            | No        | add scope (admin); check role            |
| 404    | `RESOURCE_NOT_FOUND`                                                                            | No        | verify id (string, not int)              |
| 409    | `DUPLICATE_DATA`,`RECORD_LOCKED`                                                                | Maybe     | `/upsert` or fetch-and-update            |
| 422    | `MANDATORY_NOT_FOUND`,`INVALID_DATA`                                                            | No        | `GET /settings/fields?module=X`          |
| 429    | `TOO_MANY_REQUESTS`                                                                             | Yes(3)    | `Retry-After`; exponential backoff       |
| 5xx    | `INTERNAL_ERROR`,`SERVICE_UNAVAILABLE`                                                          | Yes(3)    | retry w/ backoff                         |

Full reference: `01d-event-and-error-handling.md` § Error Code Reference.

## Webhooks / Events

Supported. `POST /crm/v8/actions/watch`.
| Event | Trigger | Payload |
| --- | --- | --- |
| `{Module}.create` | created | `{server_time,module,ids[],operation:"insert",channel_id,token}` |
| `{Module}.edit` | updated | same + `affected_fields` |
| `{Module}.delete` | deleted (soft) | same, `operation:"delete"` |
| `Leads.convert` | conversion | |

Verification: echo-back shared `token` only (no HMAC). Reliability: 5 retries exponential backoff on non-2xx; no DLQ; best-effort ordering; duplicates possible. Subscription 24h default, extendable to 1 year via `channel_expiry`.
**Numa status:** not yet wired (no public receiver) — polling is the current fallback.

## Known Limitations

1. No OpenAPI/Swagger — code against docs (or Zoho SDKs).
2. No `/auth/me` — use `GET /crm/v8/users?type=CurrentUser`.
3. Search capped at 2000 records — use COQL or bulk read for larger extracts.
4. Rate limits hidden until 50% consumed — no proactive header.
5. Webhooks not HMAC-signed — echo-back token only.
6. Soft delete only via DELETE — hard delete requires emptying the whole Recycle Bin.
7. Search criteria dropped silently — conflicting params (both `criteria`+`word`) not flagged; only one used.
8. Lookup fields need `.id`/`.name` path inside criteria — direct field name won't match.
9. Custom modules are tenant-specific — query `/settings/modules` at runtime; never hardcode.

## SDKs & Tooling

v8 SDKs at github.com/zoho (good quality, NOT used by Numa — we use httpx directly): zohocrm-python-sdk-8.0, zohocrm-nodejs-sdk-8.0, zohocrm-java-sdk-8.0, zohocrm-php-sdk-8.0, zohocrm-csharp-sdk-8.0, zohocrm-go-sdk-8.0.
Postman collection: developer.zoho.com/postman-collection (public v2). OpenAPI: not published.

## Integration Path Assessment

**Recommended: Direct API Only.** Zoho CRM is a structured-records platform (Leads, Contacts, Deals…), not files — doesn't fit the "browse files" Data Connector UX. All value is the workspace agent making HTTP calls via `connect_request` (list/search/get/create/update). `surfaces:['chat']` in the registry keeps it out of Files > Remote.

File-connector method feasibility — all "none": `list_files` (no file model), `download_file` (attachments only, not a file tree), `search_files` (record search, not file search), `get_file_metadata` (n/a).

Any HTTP client that does per-region OAuth 2.0 authorization_code, injects `Authorization: Zoho-oauthtoken {token}`, and targets the region-correct API host (`www.zohoapis.{region}/crm/v8` — CA: `www.zohoapis.ca`) can drive the entire surface. No vendor SDK required.

> Numa-internal wiring (vault keys, registry entries, integration commits) lives in the Numa connector skill / Numa-side docs — not in this API reference.
