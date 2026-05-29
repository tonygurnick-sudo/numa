---
api_name: 'Workbench International (ERP)'
api_slug: 'workbench'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Workbench International — Event & Error Handling

> Events, polling, error recovery, and the discovery playbook. Companion to `01-llm-api-rules.md`.
>
> ⚠️ **No webhook support found, no error schema published, no rate limits documented.** Everything
> here is `[INFERRED]` 🔬 unless tagged otherwise. Handle errors defensively; surface raw responses.

---

## Event-Driven Capabilities

| Mechanism                      | Supported   | Notes                                                                                |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------------ |
| Webhooks                       | no (found)  | None in public material; partner syncs (Xero/MYOB) appear poll/batch `[INFERRED]` 🔬 |
| WebSocket                      | no          | `[INFERRED]`                                                                         |
| Server-Sent Events (SSE)       | no          | `[INFERRED]`                                                                         |
| Long polling                   | no          | `[INFERRED]`                                                                         |
| Change feed / "modified since" | `[UNKNOWN]` | A date/modified filter may exist on list endpoints — unconfirmed 🔬                  |

**Bottom line: treat Workbench as polling-only.** If a customer needs near-real-time, set
expectations: changes are discovered by periodic polling, not pushed.

---

## Polling Strategies

### Strategy 1 — Modified/date filter (preferred, if it exists)

If a list endpoint supports a date filter (e.g. `?fromDate=` or a "modified since" param — **field
name `[UNKNOWN]` 🔬**), poll server-side:

```python
last_poll = "2026-05-28T00:00:00Z"   # track per resource
page = 1
while True:
    resp = GET(f"/api/v1/transactions?fromDate={last_poll}&page={page}&pageSize=200")
    body = resp.json()
    rows = body.get("items") or body.get("data") or []
    for r in rows:
        process(r)
    total = body.get("totalCount") or body.get("total")
    if (total is not None and page*200 >= total) or len(rows) < 200:
        break
    page += 1
last_poll = now_utc()
```

### Strategy 2 — Snapshot diff (fallback)

If no date filter is available, page the collection and diff against a local cache of
`{id: lastSeenState}`. More expensive — page through everything each cycle. Use only for small
collections (jobs, suppliers, plant).

### Recommended poll intervals

| Use case        | Interval      | Notes                                          |
| --------------- | ------------- | ---------------------------------------------- |
| Active sync     | 15 minutes    | Conservative default — rate limits unknown     |
| Background sync | 30–60 minutes | Most data                                      |
| Reference data  | 4–6 hours     | Jobs list, suppliers, plant, chart of accounts |

**Rule:** Never poll more frequently than every 5 minutes until rate limits are measured. Be
respectful — this is a customer's production ERP.

---

## Error Handling

### Error response format: `[UNKNOWN]` 🔬

Workbench does **not** publish its error-body schema. **Do not hard-code error parsing.** Check the
HTTP status first, then defensively attempt to parse the body and surface the raw text to the user —
ERP domain errors (e.g. "distribution does not balance", "job is closed") are usually specific enough
that the user can act on them.

```python
def handle(resp):
    if 200 <= resp.status_code < 300:
        return resp.json()
    info = {"status": resp.status_code, "raw": None, "parsed": None}
    try:
        info["raw"] = resp.text
        info["parsed"] = resp.json()
    except Exception:
        pass
    log.error("WORKBENCH_API_ERROR", extra={**info, "instance": instance_host})
    raise ApiError(info)        # surface info["raw"] to the user verbatim
```

### Recovery Playbook (statuses `[INFERRED]` 🔬)

| HTTP Status | Meaning                              | Retryable? | Recovery Action                                                                                          | Max Retries         |
| ----------- | ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------- | ------------------- |
| 400 / 422   | Validation / business-rule rejection | No         | Fix payload (balance distribution, valid job/activity, open job)                                         | 0                   |
| 401         | Unauthorized                         | No         | Token invalid/expired **or wrong auth header** — user re-issues token; try `X-Api-Key` if `Bearer` fails | 0 (no auto-refresh) |
| 403         | Forbidden                            | No         | Issuing user's Workbench role lacks permission — broaden role / use a different user                     | 0                   |
| 404         | Not found                            | No         | Verify path/id and **`instance_url` normalisation**; re-check Swagger base path                          | 0                   |
| 409         | Conflict                             | Maybe      | Concurrent edit / already-posted — GET current state before deciding 🔬                                  | 1                   |
| 429         | Rate limited (if it exists)          | Yes        | Honour `Retry-After` if present; else exponential backoff                                                | 3                   |
| 5xx         | Server error                         | Yes        | Exponential backoff with jitter                                                                          | 3                   |

### Do NOT retry

- **400 / 422** — fix the request (don't resend a malformed/unbalanced posting).
- **401 / 403** — auth/permission won't fix itself; the token has no refresh path.
- **Ambiguous financial POSTs** — GET to check whether the record was created before any resend.

### Do retry (with backoff)

- **5xx** and connection errors — transient.
- **429** — honour `Retry-After`; otherwise back off.

```python
if resp.status_code == 429:
    wait = int(resp.headers.get("Retry-After", "60"))
    sleep(wait)            # then retry
```

> **Rate-limit headers (`X-RateLimit-*`, `Retry-After`) presence is `[UNKNOWN]` 🔬.** Inspect response
> headers on a live tenant and record what's actually returned.

---

## Counter-Exceptions (looks like an error, is correct)

1. **Empty list ≠ error.** A filtered list with no matches returns an empty `items[]` / `totalCount: 0`.
   That's a valid result, not a failure. (Field names 🔬.)
2. **Write rejected on a valid-looking payload.** Workbench enforces its own business rules
   `[DOCUMENTED]`, so a syntactically correct POST can be rejected (closed job, invalid activity,
   unbalanced distribution). The rejection is correct behaviour — fix the domain issue, don't retry.
3. **`200` on create.** The API may return `200` (not `201`) on create. Don't branch on status alone;
   look for a new `id` in the body. 🔬

---

## Idempotency

- **GET** — naturally idempotent.
- **POST (transactions, timesheets, POs, AP/AR)** — **NOT idempotent; no known idempotency key.** A
  retry can double-post. Track created ids client-side and **GET before any retry**. `[INFERRED]` 🔬

---

## Output Formatting Guide (for the agent)

| Data type        | Format              | Example                                                              |
| ---------------- | ------------------- | -------------------------------------------------------------------- |
| Single job       | Key-value summary   | "Job J-10042 — Riverside Bridge Upgrade · Active · Mgr: Aroha Ngata" |
| Transaction list | Markdown table      | Date · Type · Activity · GL · Amount · Tax                           |
| Cost breakdown   | Grouped table       | Group by `activityCode` / `glAccount`, sum `lines[].amount`          |
| Currency         | Localized           | "$12,450.00"                                                         |
| Dates            | Human-readable      | "29 May 2026"                                                        |
| Errors           | Raw + plain summary | Show the raw response text, then a one-line explanation              |

**Truncation:** lists — show first 25 rows and note the total; long notes — truncate at ~300 chars.

---

## Health / Liveness

There is **no documented health endpoint** 🔬. To verify a connection:

1. **Reach the Swagger:** `GET {instance_url}/swagger` — if this fails, the `instance_url` is wrong
   or unreachable (this is _not_ an auth check).
2. **Verify auth:** a small authenticated read, e.g. `GET {instance_url}/{prefix}/jobs?pageSize=1` →
   `200` means token + header + instance are all good.

---

## Logging (Numa convention)

Log at each API boundary with a `_name` field for filtering:

```python
{ "_name": "WORKBENCH_API", "method": "GET", "path": "/api/v1/jobs/10042/transactions",
  "status": 200, "duration_ms": 410, "page": 1, "total": 47, "instance": "acme.workbench.com", "error": None }
```

On error:

```python
{ "_name": "WORKBENCH_API_ERROR", "method": "POST", "path": "/api/v1/transactions",
  "status": 422, "duration_ms": 180, "error_body": "<raw>", "instance": "acme.workbench.com" }
```

---

## Discovery Playbook — run this with a live token + instance

The single most valuable thing you can do for this connector. Until done, everything above is a hypothesis.

1. Obtain a **`bearer_token`** and **`instance_url`** from the customer; confirm **Workbench Online vs
   Workbench SBO**.
2. **Pull the Swagger first:** `{instance_url}/swagger` and the raw spec
   `{instance_url}/swagger/v1/swagger.json` (exact path 🔬). This resolves the API path prefix,
   resources/fields (Phase 3), endpoint catalog (Phase 4), query params (Phase 5), pagination (Phase 6).
3. **Smoke-test the gate:** `GET {instance_url}/{prefix}/jobs?pageSize=1` with
   `Authorization: Bearer <token>` → `200` satisfies the first-call gate.
4. **Confirm the auth header** — toggle `Bearer` vs `X-Api-Key`/`apikey`, watch `401` vs `200`.
5. **Enumerate the distribution model** on a real transaction (job/activity/GL/tax line shape) — the
   heart of Workbench's GL/AP/AR interface.
6. **Trigger errors** (bad token, bad id, unbalanced distribution, closed job) to capture the real
   error-body schema and any rate-limit response (status, `Retry-After`, `X-RateLimit-*`).
7. **Establish token lifetime / rotation** — static or expiring? Is there a re-issue UI?
8. **Backfill** every `[INFERRED]`/`[UNKNOWN]` in 01–01d with verified values from the live spec/calls,
   and re-tag them `[CONFIRMED]`.

---

_Generated from the investigation questionnaire, Phases 7–8. No webhooks (assumed); error body and rate limits `[UNKNOWN]` pending live discovery._
