---
api_name: 12d Synergy
api_slug: synergy
doc: events, polling, errors, retries (on-demand companion to 01-llm-api-rules.md)
webhooks: NONE. Swagger has zero webhook/callback/event-stream endpoints. Change detection = polling only.
error_format: plain-text strings, NOT JSON. Swagger documents only 200 responses — no error schema. Status-code table below is [INFERRED] from .NET REST conventions; verify against the real API. Handle non-2xx defensively; do NOT hard-code parsing on an assumed schema.
rate_limit: undocumented. Be conservative — ≥100ms between calls; exponential backoff on 429; small delay between pages; never poll <2 min.
health: GET {instance}/health — no auth, no /api/v1/ prefix. Use for connectivity, NOT auth (a 200 proves nothing about token validity).
confidence: [INFERRED] unless tagged.
---

# 12d Synergy — Event & Error Handling

## Webhooks: NONE

No webhook / event-subscription / callback-registration / event-streaming endpoints exist. All change detection is via polling.

## Polling strategies

Strategy 1 — modified-date (preferred). For entities with date fields (`LastModified`, `CreatedDate`), poll and filter client-side. **File search is job-scoped — there is no "fetch all files" call; poll per job (`LimitSearchTo:2` + the job's `LimitID`, which must include `_server_id`), looping over the jobs you watch. No global file feed.**

```python
last_poll = "2026-03-28T00:00:00Z"

# Poll files for ONE job (repeat per watched project — no global file search)
job = {"IDString": "100_1", "_id": 100, "_server_id": 1}
page = 1
while True:
    data = POST("/api/v1/files/search", json={"FileName":"","Contents":"","Page":page,"PageSize":100,"ShowDeletedFiles":False,"Attributes":[],"LimitSearchTo":2,"LimitID":job}).json()  # LimitID REQUIRED — omitting it returns HTTP 500
    for file in data["Result"]:
        if file["LastModified"] > last_poll: process_changed_file(file)
    if page >= data["TotalPages"]: break
    page += 1
last_poll = now_utc()
```

Applies to Files (LastModified, per job — `/jobs/search` is not job-scoped), Jobs (CreatedDate), etc. Limitation: must page through each job's results; server-side date filtering not guaranteed (verify search support per entity).

Strategy 2 — search-based (server-side date filter, if supported). `Attributes` array on `JobSearchModel`/`FileSearchModel`; file search still needs `LimitSearchTo:2`+`LimitID` (always job-scoped):

```
POST /api/v1/files/search
{"FileName":"","Page":1,"PageSize":100,"LimitSearchTo":2,"LimitID":{"IDString":"100_1","_id":100,"_server_id":1},"Attributes":[{"Attribute":{"Name":"ModifiedDate"},"Value":"2026-03-28T00:00:00Z","SearchQueryType":4,"Operation":2,"OperationName":">"}]}
```

Whether search supports date filtering is unconfirmed per entity — test each.

Strategy 3 — snapshot comparison (entities without date fields). Maintain a local ID set, diff:

```python
current_ids = set(); page = 1
while True:
    data = POST("/api/v1/Contacts/search", json={"FirstName":"","LastName":"","Email":"","UsersOnly":False,"Page":page,"PageSize":100}).json()
    for c in data["Result"]: current_ids.add(c["ID"]["IDString"])
    if page >= data["TotalPages"]: break
    page += 1
added = current_ids - known_ids; removed = known_ids - current_ids
for id in added:
    detail = GET(f"/api/v1/Contacts/{id}/true/true")  # retrieve_attributes + retrieve_companies required
    process_new_contact(detail.json())
known_ids = current_ids
```

Poll intervals: real-time 5 min (high usage, critical data only); active 15 min (most cases); background 30–60 min; reference data (companies, teams) 4–6 hr. Never poll <2 min.

## Error handling

Error response schema is UNKNOWN — Swagger documents no error schemas. Guidance below is [INFERRED] for a .NET REST API; all handling must be defensive and tested against the real API. Do NOT hard-code error parsing on an assumed schema.

Defensive pattern:

```python
def handle_response(response):
    if 200 <= response.status_code < 300:
        return response.json()
    error_info = {"status_code": response.status_code, "raw_body": None, "parsed_body": None, "message": f"HTTP {response.status_code}"}
    try:
        error_info["raw_body"] = response.text
        error_info["parsed_body"] = response.json()
    except: pass
    log.error("12d Synergy API error", extra=error_info)
    raise ApiError(error_info)
```

Expected HTTP status codes [INFERRED — verify against real API]:
| Status | Likely meaning | Action |
| --- | --- | --- |
| 200 | Success | process response |
| 201 | Created | process new entity |
| 204 | No Content | success, no body (e.g. delete) |
| 400 | Bad Request | check body/params; likely validation error |
| 401 | Unauthorized | PAT expired/invalid — prompt re-auth |
| 403 | Forbidden | user lacks permission — check role/access |
| 404 | Not Found | entity missing or wrong ID format |
| 409 | Conflict | concurrent modification (e.g. file already checked out) |
| 500 | Server Error | retry with backoff, then report |

401 — PAT expiry (180-day max lifetime): do NOT retry the same PAT; notify user token expired; prompt for new PAT; re-test with `GET /health` (no auth) then an authed endpoint.
409 — file checkout conflict: `POST /api/v1/files/{id}/checkout` → 409 [INFERRED status] when already checked out. Fetch file details to read `IsCheckedOut`; inform user who holds it (if in response); offer retry later.

## Counter-Exceptions (looks like an error, is correct)

| Situation                               | Actually                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `POST /api/Tasks` returns 200 (not 201) | API may return 200 on create — check if body has the new entity                  |
| empty page beyond TotalPages            | valid: `TotalRows:0, Result:[]` — not an error                                   |
| EntityID has underscore-prefixed fields | correct: `_id`, `_server_id`, `_server_guid` are underscore by design            |
| mixed casing between models             | intentional: TaskItemModel/ContactModel snake_case, JobModel PascalCase          |
| delete task needs description in path   | correct: `DELETE /api/v1/tasks/{task_id}/{description}` requires both            |
| task endpoints have no `/v1/`           | correct: `POST /api/Tasks` skips the version prefix (same POST = update; no PUT) |
| inconsistent pagination style           | correct: search = body, content-listing = path, never query string               |

## Retry logic

```python
MAX_RETRIES = 3; BACKOFF_FACTOR = 2  # seconds
def api_call_with_retry(method, url, **kwargs):
    for attempt in range(MAX_RETRIES):
        response = requests.request(method, url, **kwargs)
        if response.status_code < 500: return response  # don't retry client errors
        if attempt < MAX_RETRIES - 1: time.sleep(BACKOFF_FACTOR * (2 ** attempt))
    return response
```

Do NOT retry: 401 (token expired), 403 (permission denied), 404 (missing), 400 (fix the request).
Do retry (backoff): 500 (transient), 502/503 (unavailable), connection errors.

## Rate limiting (UNKNOWN — assume it exists)

Space requests ≥100ms apart; exponential backoff on any 429; add a small delay between pages on bulk pagination; reduce frequency on unexpected 503s.

```python
if response.status_code == 429:
    time.sleep(int(response.headers.get("Retry-After", "60")))
    # retry
```

## Health check

`GET https://{instance}/health` — no auth, no `/api/v1/` prefix → `{"status":"Healthy"}`. Use for: initial setup (verify instance URL), before re-auth (verify server up, separate from auth), lightweight keepalive. Do NOT use as an auth check — it requires no auth; verify the PAT with `GET /api/v1/auth/getPersonalAccessTokens`.

## Logging (Numa integration)

Log at each API call boundary:
`{"_name":"12D_SYNERGY_API","method":"POST","path":"/api/v1/jobs/search","status_code":200,"duration_ms":342,"page":1,"total_rows":142,"instance":"client-instance.12dsynergy.com","error":null}`
On error:
`{"_name":"12D_SYNERGY_API_ERROR","method":"POST","path":"/api/v1/jobs/search","status_code":400,"duration_ms":150,"error_body":"...","instance":"client-instance.12dsynergy.com"}`
