---
api_name: Zoho CRM
api_slug: zoho-crm
base_url: https://{api_domain}/crm/v8 — {api_domain} from token response (e.g. https://www.zohoapis.com.au); region-pinned
path_version_segment: /v8/ IS a real path segment (NOT a label). Server route = {api_domain}/crm/v8/{Module}. Pass paths WITH /crm/v8/ as shown.
auth: Zoho-oauthtoken {access_token} (NOT Bearer — Bearer → 401 INVALID_TOKEN)
field_casing: PascalCase_With_Underscores (Last_Name, Modified_Time); api_name per field
id_format: string, 18–19 digit numeric (e.g. "410405000002264040") — opaque, never parse as int
rate_limit: credit-based 24h rolling + concurrent-calls cap (no RPM). See 01d.
call_surface: HTTP via `numa integrations request`. NOT a file store — no list-files/download-file. JSON-only (no attachment up/download).
confidence: facts verified 2026-04-23 unless tagged [INFERRED] or [VERIFIED <date>]
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Zoho CRM — API Rules

## Paths (read first)

- Pass FULL paths incl. version: `/crm/v8/Leads`, `/crm/v8/Leads/{id}`. `/v8/` is a REAL segment, not a label — keep it.
- Host = the `api_domain` returned in the token (e.g. `https://www.zohoapis.com.au`). Region-pinned: token minted in one DC works ONLY against that DC's host. Wrong host → misleading 401 `INVALID_TOKEN` (not "wrong region").
- Cross-region not possible: AU connection cannot reach a US org.

## Auth

Header: `Authorization: Zoho-oauthtoken {access_token}` (scheme is `Zoho-oauthtoken`, NOT `Bearer` — `Bearer` → 401 `INVALID_TOKEN`). `Content-Type: application/json`.

- Access token 1h; backend refreshes on 401, retries once; second 401 → fail tool call, user must reconnect.

## CAN

List/search/get/create/update/upsert/delete records in any module (Leads, Contacts, Accounts, Deals, Tasks, Calls, Meetings, Notes, custom) — ≤100/batch. COQL (`POST /crm/v8/coql`) for SQL-like cross-module reports/counts/filters search can't express. Walk related lists (`GET /crm/v8/{Module}/{id}/{Related}`) for notes/attachments/tasks/calls on a parent. Convert Lead (`POST /crm/v8/Leads/{id}/actions/convert`). Discover metadata at runtime: `/crm/v8/settings/modules`, `/crm/v8/settings/fields`.

## CANNOT

Upload/download attachments (proxy is JSON-only — tell user to use Zoho UI). Subscribe to notifications (no Numa-hosted webhook receiver yet — poll instead). Merge records (50 credits, irreversible — not exposed). Cross-region requests.

## Critical Gotchas

1. **`fields` REQUIRED on list.** `GET /crm/v8/Leads` without `?fields=...` → 400 `REQUIRED_PARAM_MISSING` (max 50 fields). Unknown fields? `GET /crm/v8/settings/fields?module=Leads` first.
2. **Module api_name is case-sensitive.** `Leads`,`Contacts`,`Accounts`,`Deals`,`Tasks`,`Calls`,`Meetings`,`Notes`; custom = admin-set (`CustomModule1`). Lowercase → 400 `INVALID_MODULE`.
3. **Body wrapper `{"data":[…]}`** on every create/update/upsert, even one record. Max 100/call.
4. **Pagination: two modes + hard cap.** `page`+`per_page` to record 2000; beyond, `page_token` (from prior `info.next_page_token`). Sending BOTH → 400. Cursor chain caps at 100,000 total/query; each `page_token` expires 24h after issue. `previous_page_token` also returned. Backfills >100k or >24h must checkpoint+restart or silently truncate. [VERIFIED 2026-05-19 — get-records.html]
5. **Search: 4 mutually-exclusive params.** One of `criteria`/`email`/`phone`/`word` per call. If multiple sent, only highest-priority used (criteria>email>phone>word), rest dropped silently. Max 2000 rows via search → use COQL for more.
6. **Criteria dates: use explicit offset** (`+00:00`/`+10:00`). `Z` accepted but URL-encoder sometimes mangles it.
7. **IDs are strings** (18–19 digit numeric), opaque — never int-parse.
8. **Lead conversion = 5 credits, irreversible via API.** Confirm with user first.
9. **Partial batch → HTTP 207** (sometimes 200 with per-record errors). Always iterate `data[i].status`; report successes AND failures (some SUCCESS, others DUPLICATE_DATA/MANDATORY_NOT_FOUND).
10. **`Layout.id` required** when a module has >1 layout. Discover: `GET /crm/v8/settings/layouts?module={Module}`; use `default:true` unless user says otherwise. Layout is NOT in `/settings/fields`.

## Defaults (override only if user specifies)

`per_page=200` (API max), `sort_by=Modified_Time`, `sort_order=desc`, `trigger=["workflow"]` (keep workflows, skip approvals/blueprints), `wf_trigger=true` on delete (UI parity).

**Default `fields` per module (when user hasn't said which):**
| Module | Fields |
| --- | --- |
| Leads | `Last_Name,First_Name,Email,Phone,Company,Lead_Status,Lead_Source,Owner` |
| Contacts | `Full_Name,Email,Phone,Account_Name,Title,Owner` |
| Accounts | `Account_Name,Phone,Website,Industry,Owner` |
| Deals | `Deal_Name,Stage,Amount,Closing_Date,Account_Name,Owner,Probability` |
| Tasks | `Subject,Status,Priority,Due_Date,Who_Id,What_Id,Owner` |
| Notes | `Note_Title,Note_Content,Parent_Id,se_module,Owner,Created_Time` |

## Operations

| Operation    | Method | Path                                | Key params / notes                                         |
| ------------ | ------ | ----------------------------------- | ---------------------------------------------------------- |
| List records | GET    | /crm/v8/{Module}                    | `fields` (req), `per_page`, `page`, `page_token`           |
| Get one      | GET    | /crm/v8/{Module}/{id}               | `fields` optional; returns `data[0]`                       |
| Search       | GET    | /crm/v8/{Module}/search             | one of `criteria`/`email`/`phone`/`word`; 2000 max         |
| Create       | POST   | /crm/v8/{Module}                    | body `{"data":[…],"trigger":[…]}`; 100 max; 207 on partial |
| Update one   | PUT    | /crm/v8/{Module}/{id}               | body `{"data":[{…}]}`; partial update                      |
| Update many  | PUT    | /crm/v8/{Module}                    | body `{"data":[{…,"id":…},…]}`; 100 max                    |
| Upsert       | POST   | /crm/v8/{Module}/upsert             | `duplicate_check_fields`; safe for retries                 |
| Delete       | DELETE | /crm/v8/{Module}?ids=id1,id2        | `wf_trigger`; 100 max; soft delete                         |
| Modules      | GET    | /crm/v8/settings/modules            | when module unknown                                        |
| Fields       | GET    | /crm/v8/settings/fields?module={M}  | required before risky writes                               |
| Layouts      | GET    | /crm/v8/settings/layouts?module={M} | for `Layout.id` (gotcha 10)                                |
| Org          | GET    | /crm/v8/org                         | liveness / company name                                    |
| Current user | GET    | /crm/v8/users?type=CurrentUser      | no `/auth/me` — use this                                   |
| Convert Lead | POST   | /crm/v8/Leads/{id}/actions/convert  | 5 credits, confirm first                                   |
| COQL         | POST   | /crm/v8/coql                        | body `{"select_query":"…"}`; cross-module/aggregate        |

## Pagination

Hybrid. Default+max `per_page=200`. To record 2000: `?page=N&per_page=200`. Beyond: `?page_token={info.next_page_token}&per_page=200` (do NOT combine with `page`). Last page: `info.more_records === false`. HTTP 204 = zero results (no body).

## Webhooks / Events

Zoho supports notifications, but Numa has no receiver wired yet — poll instead. Poll via COQL on `Modified_Time`:
`POST /crm/v8/coql` `{"select_query":"select Id, Modified_Time from Leads where Modified_Time > '2026-04-23T09:00:00+10:00' order by Modified_Time desc limit 200"}`
Interval ≥5 min; never <1 min (concurrency cap 5–25/org/app). Detail in 01d.

## Errors

Standard: `{"code":"INVALID_DATA","details":{"api_name":"Email","expected_data_type":"string"},"message":"the given data is not valid","status":"error"}`. Always show user the `message` + first `details` entry verbatim.

Recovery by status:
| Status | Code(s) | Action |
| --- | --- | --- |
| 400 | `INVALID_MODULE`,`INVALID_DATA`,`REQUIRED_PARAM_MISSING`,`MANDATORY_NOT_FOUND`,`DUPLICATE_DATA`,`INVALID_QUERY` | Fix per `details` (common: missing `fields`, bad module) |
| 401 | `INVALID_TOKEN`,`AUTHENTICATION_FAILURE` | Backend refreshes; if re-raised, reconnect |
| 403 | `OAUTH_SCOPE_MISMATCH`,`NOT_ALLOWED` | Admin adds scope + user reconnects; or check role |
| 404 | `RESOURCE_NOT_FOUND` | Verify `id` (string, not int) |
| 207 | mixed | Iterate `data[i].status` — report successes AND failures |
| 409 | `DUPLICATE_DATA`,`RECORD_LOCKED` | Offer `/upsert` with `duplicate_check_fields`; or wait for approval |
| 422 | `MANDATORY_NOT_FOUND`,`INVALID_DATA` | Pull `/settings/fields` and supply missing required fields |
| 429 | `TOO_MANY_REQUESTS` | Back off per `Retry-After`; notify if persistent |
| 5xx | `INTERNAL_ERROR`,`SERVICE_UNAVAILABLE` | Exponential backoff |

Other: no RPM counter — only `X-API-CREDITS-REMAINING`, and only once >50% consumed. Custom modules use tenant-defined api_names — call `/settings/modules` for any unseen module.

## Examples

1. List Leads (first call after auth):
   `GET /crm/v8/Leads?fields=Last_Name,First_Name,Email,Phone,Company,Lead_Status,Owner&per_page=200&sort_by=Modified_Time&sort_order=desc`
   → `{"data":[{"id":"410405000002264040","Last_Name":"Smith","First_Name":"Jane","Email":"jane@acme.example","Phone":"+61 3 9000 0000","Company":"Acme","Lead_Status":"Contacted","Owner":{"id":"410405000000123456","name":"Sarah Owner","email":"sarah@example.com"}}],"info":{"per_page":200,"count":1,"page":1,"more_records":false,"next_page_token":null,"sort_by":"Modified_Time","sort_order":"desc"}}`

2. Find deals for an account:
   `GET /crm/v8/Deals/search?criteria=((Account_Name.name:equals:Acme))&fields=Deal_Name,Stage,Amount,Closing_Date,Owner`
   → `{"data":[{"id":"410405000002264100","Deal_Name":"Acme – Q2 renewal","Stage":"Negotiation/Review","Amount":45000,"Closing_Date":"2026-06-30","Owner":{"id":"…","name":"…"}}],"info":{"per_page":200,"count":1,"page":1,"more_records":false}}`

3. Create a Lead (`POST /crm/v8/Leads`):
   `{"data":[{"Last_Name":"Smith","First_Name":"Jane","Company":"Acme","Email":"jane@acme.example","Lead_Source":"Web Form"}],"trigger":["workflow"]}`
   → `{"data":[{"code":"SUCCESS","details":{"id":"410405000002264200","Created_Time":"2026-04-23T10:00:00+10:00"},"message":"record added","status":"success"}]}`
