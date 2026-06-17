---
api_name: Zoho CRM
api_slug: zoho-crm
doc: events & errors — notifications (webhooks), polling fallback, error format, credit-based rate limits, backoff
base_url: https://{api_domain}/crm/v8 (region-pinned; see 01)
call_surface: HTTP via `numa integrations request`
numa_event_status: notifications NOT wired in Numa (no public receiver) — polling is the only path
confidence: verified 2026-04-23 unless tagged
companion_of: 01-llm-api-rules.md
---

# Zoho CRM — Events & Errors

## Event Mechanisms

| Mechanism                                 | Supported | Notes                                                                     |
| ----------------------------------------- | --------- | ------------------------------------------------------------------------- |
| Webhooks (Notifications)                  | yes       | `/crm/v8/actions/watch`; 24h default subscription, renewable up to 1 year |
| WebSocket / SSE / long-poll / change-feed | no        | not exposed by Zoho CRM                                                   |
| Bulk export notifications                 | partial   | optional callback URL on bulk read/write completion                       |

> **Numa status:** the connector does NOT subscribe to notifications — Numa has no public HTTPS receiver for it. Polling is the only path today. The webhook section documents what we'd build if prioritised.

## Webhooks (Notifications API)

Register: API (`POST /crm/v8/actions/watch`) or Zoho UI (Setup → Developer Space → Notifications). HTTPS required in production; Zoho does NOT ping the URL on registration. Subscription lifetime 24h default, extend up to 1 year via `channel_expiry`; renew before expiry.

`POST /crm/v8/actions/watch` `{"watch":[{"channel_id":"1001","events":["Leads.create","Leads.edit","Leads.delete"],"channel_expiry":"2027-04-23T10:00:00+10:00","notify_url":"https://arcanum-demo-tony.numa.arcanum.ai/api/zoho-crm/webhook","token":"shared-secret-echoed-back-in-payload-for-verification"}]}`

Event name pattern `{Module}.{event}`:
| Event | Trigger | Key payload | Notes |
| --- | --- | --- | --- |
| `Leads.create` | created | `ids[]`,`module`,`operation` | |
| `Leads.edit` | updated | + `affected_fields` | pre-change snapshot NOT included |
| `Leads.delete` | deleted (soft) | `ids[]` | soft delete only — hard delete not fired |
| `Leads.convert` | conversion | `ids[]` | |
| `Contacts.*`,`Accounts.*`,`Deals.*`,`Tasks.*`,`{CustomModule}.*` | create/edit/delete | as above | |

Payload to `notify_url`: `{"server_time":1713849600000,"query_params":{},"module":"Leads","resource_uri":"https://www.zohoapis.com.au/crm/v8/Leads","ids":["410405000002264040"],"affected_fields":[],"operation":"insert","channel_id":"1001","token":"shared-secret-echoed-back-in-payload-for-verification"}`
Payload carries IDs only, NOT record data — fetch via `GET /crm/v8/{Module}/{id}` for details.
Delivery headers: `Content-Type: application/json`, `User-Agent: Zoho CRM Notification/v8`.

**Verification:** NO HMAC signature. The ONLY verification is matching the payload `token` against the shared secret supplied at registration — drop requests where it doesn't match. Anyone who learns your notify_url can spoof; keep the token high-entropy (≥32 bytes random). No published IP allowlist; consider LB-level IP allowlist as extra hardening.
**Reliability:** 5 retries on non-2xx, exponential backoff (~1m,5m,30m,2h,10h); no DLQ (drops after 5); best-effort ordering (build idempotent handlers keyed on `(module,id,operation,server_time)`); duplicate delivery possible on retry — dedupe.
List/unsubscribe: `GET /crm/v8/actions/watch` (list); `DELETE /crm/v8/actions/watch?channel_ids=1001` (unsubscribe).

## Polling Fallback (Numa's current default)

Best — COQL on `Modified_Time`:
`POST /crm/v8/coql` `{"select_query":"select Id, Modified_Time, Last_Name from Leads where Modified_Time > '2026-04-23T09:00:00+10:00' order by Modified_Time desc limit 200"}`
Alternative: `GET /{Module}?fields=id,Modified_Time&sort_by=Modified_Time&sort_order=desc&per_page=200` then filter client-side.
Change-detection field: `Modified_Time` (always server-set). Interval: 5–15 min active sync, 30–60 min background, **never <1 min** (concurrency limits 5–25/app/org).
Credit budget: ~1 credit per poll (COQL or list). [INFERRED — the Zoho COQL credits doc URL 404s (2026-05-19); community claim: COQL tiered 1–3 credits by LIMIT (1–200→1, 201–1000→2, 1001–2000→3). Treat 1 as lower bound; re-check before tight budgeting.] Concurrency matters more than credit total.
Loop: store `last_poll_ts=now()` → sleep interval → COQL `select Id, Modified_Time … where Modified_Time > last_poll_ts` → fetch full details if needed → update `last_poll_ts` → repeat.
Tips: COQL over list when filtering (server-side filter saves credits); keep detection query lean (`fields=id,Modified_Time`); batch detail fetches in one COQL via `Id in ('id1','id2',...)`.

## Error Handling

Standard error: `{"code":"INVALID_DATA","details":{"api_name":"Email","expected_data_type":"string"},"message":"the given data is not valid","status":"error"}`
Validation error: `{"code":"MANDATORY_NOT_FOUND","details":{"api_name":"Last_Name","json_path":"$.data[0].Last_Name"},"message":"required field not found","status":"error"}`
Fields: `code` (Zoho constant, always), `message` (human-readable user-safe, always), `status` (`"error"`, always), `details` (object, usually; validation errors carry `api_name`+`json_path`).
For bulk writes, per-record validation errors are inside the `data[]` array; outer status is 207 (sometimes 200) — inspect each record's `status`/`code`.

### Recovery Playbook

| HTTP | Codes                                                                                                           | Meaning                  | Retryable  | Recovery                                                                     | Max retries |
| ---- | --------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------- | ---------------------------------------------------------------------------- | ----------- |
| 200  | —                                                                                                               | success                  | —          | —                                                                            |             |
| 204  | —                                                                                                               | empty result             | —          | treat as zero results                                                        |             |
| 207  | mixed per-record                                                                                                | partial                  | per-record | iterate `data[i]`; retry failed records                                      |             |
| 400  | `INVALID_MODULE`,`INVALID_DATA`,`INVALID_QUERY`,`REQUIRED_PARAM_MISSING`,`DUPLICATE_DATA`,`MANDATORY_NOT_FOUND` | bad request              | No         | fix per `details`                                                            | 0           |
| 401  | `INVALID_TOKEN`,`AUTHENTICATION_FAILURE`                                                                        | unauthorized             | Yes        | refresh via `/oauth/v2/token`; if refresh also 401 → re-consent              | 1           |
| 403  | `OAUTH_SCOPE_MISMATCH`,`NOT_ALLOWED`,`UNAPPROVED`                                                               | forbidden                | No         | admin adds scope + user reconnects; for `NOT_ALLOWED` check role permissions | 0           |
| 404  | `INVALID_URL_PATTERN`,`RESOURCE_NOT_FOUND`                                                                      | not found                | No         | verify module api_name + record id                                           | 0           |
| 409  | `DUPLICATE_DATA`,`RECORD_LOCKED`                                                                                | conflict                 | Maybe      | `/upsert` with `duplicate_check_fields` OR fetch existing + update           | 1           |
| 413  | `REQUEST_ENTITY_TOO_LARGE`                                                                                      | body too big             | No         | split into batches ≤100                                                      | 0           |
| 415  | `INVALID_MIME_TYPE`                                                                                             | wrong Content-Type       | No         | set `Content-Type: application/json`                                         | 0           |
| 422  | `MANDATORY_NOT_FOUND`,`INVALID_DATA`                                                                            | validation failed        | No         | `GET /settings/fields?module=X` and fix                                      | 0           |
| 429  | `TOO_MANY_REQUESTS`                                                                                             | rate/concurrency limited | Yes        | honour `Retry-After`; exponential backoff w/ jitter                          | 3           |
| 500  | `INTERNAL_ERROR`                                                                                                | server error             | Yes        | retry w/ backoff                                                             | 3           |
| 502  | `BAD_GATEWAY`                                                                                                   | gateway error            | Yes        | retry after 5s                                                               | 3           |
| 503  | `SERVICE_UNAVAILABLE`                                                                                           | maintenance              | Yes        | retry after `Retry-After`                                                    | 3           |

### Rate Limits — Credit model (24h rolling window; NOT RPM)

| Edition               | Base credits | Per user | Max limit | Concurrent calls | Heavy-ops sub-pool |
| --------------------- | ------------ | -------- | --------- | ---------------- | ------------------ |
| Free                  | 5,000        | —        | 5,000     | 5                | 10 shared          |
| Standard / Starter    | 50,000       | +250     | 100,000   | 10               | 10 shared          |
| Professional          | 50,000       | +500     | 3,000,000 | 15               | 10 shared          |
| Enterprise / Zoho One | 50,000       | +1,000   | 5,000,000 | 20               | 10 shared          |
| Ultimate / CRM Plus   | 50,000       | +2,000   | unlimited | 25               | 10 shared          |

Credit costs: most calls 1; Convert Lead 5; Merge Records 50; Bulk Write Initialize 500.
Heavy ops (count against the 10-slot pool): Get Records with `cvid`, Convert Lead, bulk insert/update/upsert >10 records, Send Mail, Search, COQL, Composite APIs.
Headers: `X-API-CREDITS-REMAINING` (remaining credits in 24h window; appears ONLY once >50% consumed). Standard `X-RATELIMIT-*` NOT returned. Concurrency exposes no header — you see 429 when exceeded.
429 response: `{"code":"TOO_MANY_REQUESTS","details":{},"message":"too many requests. please try again after some time","status":"error"}`. `Retry-After` (seconds) may be present.
Backoff: (1) honour `Retry-After` first; (2) else exponential from 2s, doubling, capped 60s; (3) add ±50% jitter (avoid synchronised storms); (4) surface to user after 3 failed retries.

### Error Code Reference

| Code                     | HTTP    | Meaning                                   | Common cause                                  | Fix                                                   |
| ------------------------ | ------- | ----------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| `INVALID_TOKEN`          | 401     | token expired/revoked                     | hit 1h lifetime                               | refresh; if refresh fails → re-consent                |
| `OAUTH_SCOPE_MISMATCH`   | 403     | token lacks scope                         | scope not granted at app registration         | update app scopes; user reconnects                    |
| `INVALID_MODULE`         | 400     | module api_name wrong/disabled            | `leads` vs `Leads`; custom module not enabled | `GET /crm/v8/settings/modules`                        |
| `REQUIRED_PARAM_MISSING` | 400     | `fields` missing on list                  |                                               | pass `?fields=a,b,c`                                  |
| `MANDATORY_NOT_FOUND`    | 400/422 | required field missing on create/update   |                                               | `GET /crm/v8/settings/fields?module=X`                |
| `DUPLICATE_DATA`         | 400/409 | unique-constraint violation               | email already on another Lead/Contact         | `/upsert` with `duplicate_check_fields`               |
| `INVALID_DATA`           | 400/422 | type mismatch / bad format / bad picklist | date wrong; picklist case wrong               | verify field type in `/settings/fields`               |
| `INVALID_QUERY`          | 400     | criteria syntax error                     | unbalanced parens; wrong operator             | re-check criteria syntax                              |
| `NOT_ALLOWED`            | 403     | role forbids the operation                | salesperson trying to delete                  | admin adjusts role permissions                        |
| `RESOURCE_NOT_FOUND`     | 404     | record doesn't exist / deleted            | stale id; wrong module                        | refetch; verify id                                    |
| `RECORD_LOCKED`          | 409     | approval process locked the record        | record in approval flow                       | wait for approval; inspect via UI                     |
| `TOO_MANY_REQUESTS`      | 429     | credit/concurrency limit                  | too many concurrent calls                     | backoff + retry                                       |
| `INTERNAL_ERROR`         | 500     | Zoho server issue                         |                                               | retry w/ backoff; if persistent check status.zoho.com |
| `SERVICE_UNAVAILABLE`    | 503     | maintenance                               |                                               | honour `Retry-After`                                  |

## Counter-Exceptions (differ from standard REST)

1. **Partial success = HTTP 207 OR 200 with per-record errors inside.** Always iterate `data[i].status` regardless of outer code.
2. **Empty result = HTTP 204 no body**, NOT 200 with `data:[]`. Treat 204 as zero results, don't parse.
3. **`INVALID_TOKEN` can mean wrong region, not expired.** A token from `accounts.zoho.com.au` sent to `www.zohoapis.com` (US) → 401 `INVALID_TOKEN`. Check accounts host + API host match.
4. **Webhook `token` is the only verification** — no HMAC. Zoho echoes a plaintext shared secret. Keep it ≥32 bytes random.
5. **Soft delete is always default** — no `?hard=true`. Records go to Recycle Bin 60 days. Hard delete = `DELETE /crm/v8/{Module}/deleted` (empties entire Recycle Bin).
6. **Rate-limit header appears only at >50% credits consumed.** Don't rely on headers for pre-emptive throttling — honour `Retry-After` on 429.

## Output Formatting (how the agent presents responses)

| Data type     | Format                   | Example                                                                              |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| Single record | key-value summary        | "**Jane Smith** at Acme — Lead Status: Contacted, Owner: Sarah (she@…)"              |
| Record list   | markdown table           | columns `Name`,`Company`,`Status`,`Owner`,`Modified`                                 |
| Long text     | quoted block             | > Note content                                                                       |
| Dates         | human-readable           | "April 23, 2026 at 10:00 AM (AEST)"                                                  |
| Currency      | org currency symbol      | "$45,000 AUD"                                                                        |
| Picklists     | plain text               | "Negotiation/Review"                                                                 |
| User lookups  | name + email             | "Sarah Owner (sarah@example.com)"                                                    |
| Errors        | raw `message` + fix hint | "Zoho rejected: _required field not found_ (Last_Name). Retry with a Last_Name set?" |

Truncation: lists show first 10 records + mention total (`info.count` + note about `more_records`); long fields truncate at 500 chars with "…" + offer more; nested lookups show 1 level deep (don't recursively fetch related lists unless asked).
