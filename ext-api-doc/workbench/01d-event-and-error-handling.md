---
api_name: Workbench International (ERP)
api_slug: workbench
doc: event & error handling, polling, discovery playbook (companion to 01-llm-api-rules.md)
confidence: no webhook support found, no error schema published, no rate limits documented — everything here is [INFERRED] 🔬 unless tagged otherwise. Handle errors defensively; surface raw responses.
path_note: /api/v1 prefix is a placeholder — read the real prefix from the Swagger base path.
call_surface: HTTP via `numa integrations request`. Not a Files connector. No webhooks → polling only.
---

# Workbench International — Event & Error Handling

## Event-Driven Capabilities

| Mechanism                      | Supported      | Notes                                                                |
| ------------------------------ | -------------- | -------------------------------------------------------------------- |
| Webhooks                       | no (found)     | None in public material; partner syncs (Xero/MYOB) appear poll/batch |
| WebSocket / SSE / Long polling | no             | —                                                                    |
| Change feed / "modified since" | `[UNKNOWN]` 🔬 | A date/modified filter may exist on list endpoints                   |

**Bottom line: polling-only.** If a customer needs near-real-time, set expectations — changes are discovered by periodic polling, not pushed.

## Polling Strategies

**Strategy 1 — Modified/date filter (preferred, if it exists).** If a list endpoint supports a date/"modified since" filter (field name `[UNKNOWN]` 🔬):

```python
last_poll = "2026-05-28T00:00:00Z"   # track per resource
page = 1
while True:
    body = GET(f"/api/v1/transactions?fromDate={last_poll}&page={page}&pageSize=200").json()
    rows = body.get("items") or body.get("data") or []
    for r in rows: process(r)
    total = body.get("totalCount") or body.get("total")
    if (total is not None and page*200 >= total) or len(rows) < 200: break
    page += 1
last_poll = now_utc()
```

**Strategy 2 — Snapshot diff (fallback).** No date filter → page the collection and diff against a local `{id: lastSeenState}` cache. Expensive (page everything each cycle) — use only for small collections (jobs, suppliers, plant).

**Intervals:** Active sync 15 min · Background sync 30–60 min · Reference data (jobs/suppliers/plant/chart of accounts) 4–6 h. **Never poll more frequently than every 5 min until rate limits are measured** — this is a customer's production ERP.

## Error Handling

Error-body schema `[UNKNOWN]` 🔬 — not published. Do NOT hard-code error parsing. Check the HTTP status first, defensively parse the body, surface raw text to the user (ERP domain errors like "distribution does not balance"/"job is closed" are actionable).

```python
def handle(resp):
    if 200 <= resp.status_code < 300:
        return resp.json()
    info = {"status": resp.status_code, "raw": None, "parsed": None}
    try:
        info["raw"] = resp.text; info["parsed"] = resp.json()
    except Exception: pass
    log.error("WORKBENCH_API_ERROR", extra={**info, "instance": instance_host})
    raise ApiError(info)   # surface info["raw"] to the user verbatim
```

### Recovery Playbook (statuses `[INFERRED]` 🔬)

| Status  | Meaning                              | Retryable | Recovery                                                                                             | Max retries         |
| ------- | ------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------- | ------------------- |
| 400/422 | Validation / business-rule rejection | No        | Fix payload (balance distribution, valid job/activity, open job)                                     | 0                   |
| 401     | Unauthorized                         | No        | Token invalid/expired OR wrong auth header — user re-issues token; try `X-Api-Key` if `Bearer` fails | 0 (no auto-refresh) |
| 403     | Forbidden                            | No        | Issuing user's Workbench role lacks permission — broaden role / use a different user                 | 0                   |
| 404     | Not found                            | No        | Verify path/id and `instance_url` normalisation; re-check Swagger base path                          | 0                   |
| 409     | Conflict                             | Maybe     | Concurrent edit / already-posted — GET current state before deciding 🔬                              | 1                   |
| 429     | Rate limited (if any)                | Yes       | Honour `Retry-After` if present; else exponential backoff                                            | 3                   |
| 5xx     | Server error                         | Yes       | Exponential backoff with jitter                                                                      | 3                   |

**Do NOT retry:** 400/422 (fix the request, don't resend a malformed/unbalanced posting) · 401/403 (auth/permission won't self-fix; no refresh path) · ambiguous financial POSTs (GET to check whether the record was created first).
**Do retry (with backoff):** 5xx + connection errors (transient) · 429 (honour `Retry-After`, else back off).

```python
if resp.status_code == 429:
    sleep(int(resp.headers.get("Retry-After", "60")))   # then retry
```

Rate-limit headers (`X-RateLimit-*`, `Retry-After`) presence `[UNKNOWN]` 🔬 — inspect a live tenant and record what's returned.

## Counter-Exceptions (looks like an error, is correct)

1. **Empty list ≠ error.** A filtered list with no matches returns empty `items[]` / `totalCount:0` — a valid result (field names 🔬).
2. **Write rejected on a valid-looking payload.** Workbench enforces its own business rules `[DOCUMENTED]`, so a syntactically correct POST can be rejected (closed job, invalid activity, unbalanced distribution). Correct behaviour — fix the domain issue, don't retry.
3. **`200` on create.** API may return `200` (not `201`) on create. Don't branch on status alone — look for a new `id` in the body 🔬.

## Idempotency

GET naturally idempotent. **POST (transactions, timesheets, POs, AP/AR) — NOT idempotent; no known idempotency key.** A retry can double-post. Track created ids client-side and GET before any retry. 🔬

## Output Formatting (for the agent)

| Data type        | Format              | Example                                                              |
| ---------------- | ------------------- | -------------------------------------------------------------------- |
| Single job       | Key-value summary   | "Job J-10042 — Riverside Bridge Upgrade · Active · Mgr: Aroha Ngata" |
| Transaction list | Markdown table      | Date · Type · Activity · GL · Amount · Tax                           |
| Cost breakdown   | Grouped table       | Group by `activityCode`/`glAccount`, sum `lines[].amount`            |
| Currency         | Localized           | "$12,450.00"                                                         |
| Dates            | Human-readable      | "29 May 2026"                                                        |
| Errors           | Raw + plain summary | Show raw response text, then a one-line explanation                  |

**Truncation:** lists — show first 25 rows and note the total; long notes — truncate at ~300 chars.

## Health / Liveness

No documented health endpoint 🔬. To verify a connection: (1) **Reach the Swagger** `GET {instance_url}/swagger` — failure means `instance_url` wrong/unreachable (not an auth check); (2) **Verify auth** with a small authenticated read `GET {instance_url}/{prefix}/jobs?pageSize=1` → `200` means token + header + instance all good.

## Logging (Numa convention — `_name` field for filtering)

Success: `{"_name":"WORKBENCH_API","method":"GET","path":"/api/v1/jobs/10042/transactions","status":200,"duration_ms":410,"page":1,"total":47,"instance":"acme.workbench.com","error":null}`
Error: `{"_name":"WORKBENCH_API_ERROR","method":"POST","path":"/api/v1/transactions","status":422,"duration_ms":180,"error_body":"<raw>","instance":"acme.workbench.com"}`

## Discovery Playbook (run with a live token + instance)

The single most valuable thing for this connector — until done, everything above is a hypothesis.

1. Obtain a `bearer_token` + `instance_url`; confirm **Workbench Online vs Workbench SBO**.
2. **Pull the Swagger first:** `{instance_url}/swagger` + raw `{instance_url}/swagger/v1/swagger.json` (exact path 🔬). Resolves prefix, resources/fields, endpoint catalog, query params, pagination.
3. **Smoke-test the gate:** `GET {instance_url}/{prefix}/jobs?pageSize=1` with `Authorization: Bearer <token>` → `200`.
4. **Confirm the auth header** — toggle `Bearer` vs `X-Api-Key`/`apikey` (watch `401` vs `200`).
5. **Enumerate the distribution model** on a real transaction (job/activity/GL/tax line shape).
6. **Trigger errors** (bad token, bad id, unbalanced distribution, closed job) to capture the real error-body schema and any rate-limit response (status, `Retry-After`, `X-RateLimit-*`).
7. **Establish token lifetime/rotation** — static or expiring? Is there a re-issue UI?
8. **Backfill** every `[INFERRED]`/`[UNKNOWN]` in 01–01d with verified values and re-tag `[CONFIRMED]`.
