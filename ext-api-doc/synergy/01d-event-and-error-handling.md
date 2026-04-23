# 12d Synergy — Event & Error Handling

> Webhooks, polling strategies, error formats, and exception handling.

---

## Webhooks & Events

### Status: NO WEBHOOKS

12d Synergy does **not** provide any webhook or event subscription mechanism. The Swagger spec (369 endpoints) contains zero webhook-related endpoints, no callback registration, and no event streaming.

**All change detection must be done via polling.**

---

## Polling Strategies

### Strategy 1: Modified-Date Polling (Preferred)

For entities with date fields (`LastModified`, `CreatedDate`), poll and filter client-side:

```python
# Track last successful poll time
last_poll = "2026-03-28T00:00:00Z"

# Fetch all files via the search endpoint (body pagination)
page = 1
while True:
    response = POST("/api/v1/files/search", json={
        "FileName": "", "Contents": "",
        "Page": page, "PageSize": 100,
        "ShowDeletedFiles": False, "RetrieveAttributes": True,
    })
    data = response.json()

    for file in data["Result"]:
        if file["LastModified"] > last_poll:
            process_changed_file(file)

    if page >= data["TotalPages"]:
        break
    page += 1

# Update poll timestamp
last_poll = now_utc()
```

**Applicable to:** Files (LastModified), Jobs (CreatedDate), and other entities with timestamps.

**Limitation:** Must page through all results to find changes. No server-side date filtering is guaranteed (search endpoint support for date ranges should be verified).

### Strategy 2: Search-Based Polling

If search endpoints support date range criteria via the `Attributes`
array, you can filter server-side:

```
POST /api/v1/files/search
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "FileName": "",
  "Page": 1,
  "PageSize": 100,
  "Attributes": [
    { "Attribute": { "Name": "ModifiedDate" },
      "Value": "2026-03-28T00:00:00Z",
      "SearchQueryType": 4, "Operation": 2, "OperationName": ">" }
  ]
}
```

**Note:** Whether search supports date filtering is not confirmed for all entities. Test each search endpoint to determine available filter fields.

### Strategy 3: Snapshot Comparison

For entities without date fields, maintain a local ID set and compare:

```python
# Fetch current IDs via the search endpoint (body pagination, capital C)
current_ids = set()
page = 1
while True:
    response = POST("/api/v1/Contacts/search", json={
        "FirstName": "", "LastName": "", "Email": "",
        "UsersOnly": False, "Page": page, "PageSize": 100,
    })
    data = response.json()
    for contact in data["Result"]:
        current_ids.add(contact["ID"]["IDString"])
    if page >= data["TotalPages"]:
        break
    page += 1

# Compare with previously known IDs
added = current_ids - known_ids
removed = known_ids - current_ids

# For added items, fetch full details — note path params retrieve_attributes
# and retrieve_companies are required
for id in added:
    detail = GET(f"/api/v1/Contacts/{id}/true/true")
    process_new_contact(detail.json())

known_ids = current_ids
```

### Recommended Poll Intervals

| Use Case        | Interval      | Notes                                   |
| --------------- | ------------- | --------------------------------------- |
| Real-time sync  | 5 minutes     | High API usage — only for critical data |
| Active sync     | 15 minutes    | Good balance for most use cases         |
| Background sync | 30-60 minutes | For less time-sensitive data            |
| Infrequent sync | 4-6 hours     | For reference data (companies, teams)   |

**Rule:** Never poll more frequently than every 2 minutes. Be respectful of the API server.

---

## Error Handling

### Error Response Format: UNKNOWN

The Swagger spec does **not** document error response schemas. The following is guidance based on reasonable assumptions for a .NET REST API, but **all error handling must be defensive and tested against the real API**.

**DO NOT** hard-code error parsing logic based on assumed schemas. Instead:

### Defensive Error Handling Pattern

```python
def handle_response(response):
    if response.status_code >= 200 and response.status_code < 300:
        return response.json()

    # Try to extract error details
    error_info = {
        "status_code": response.status_code,
        "raw_body": None,
        "parsed_body": None,
        "message": f"HTTP {response.status_code}"
    }

    try:
        error_info["raw_body"] = response.text
        error_info["parsed_body"] = response.json()
    except:
        pass

    # Log the full error for debugging
    log.error("12d Synergy API error", extra=error_info)

    # Raise with whatever information we have
    raise ApiError(error_info)
```

### Expected HTTP Status Codes

Based on standard REST conventions (verify against real API):

| Status | Likely Meaning | Action                                                    |
| ------ | -------------- | --------------------------------------------------------- |
| 200    | Success        | Process response                                          |
| 201    | Created        | Process response (new entity)                             |
| 204    | No Content     | Success, no body (e.g., delete)                           |
| 400    | Bad Request    | Check request body/params. Likely validation error.       |
| 401    | Unauthorized   | PAT expired or invalid. Prompt for re-auth.               |
| 403    | Forbidden      | User lacks permission. Check role/access.                 |
| 404    | Not Found      | Entity doesn't exist or wrong ID format.                  |
| 409    | Conflict       | Concurrent modification (e.g., file already checked out). |
| 500    | Server Error   | Retry with backoff, then report.                          |

### Status 401 — PAT Expiry

PATs have a 180-day maximum lifetime. When receiving 401:

1. Do NOT retry the same PAT
2. Notify the user that their token has expired
3. Prompt for a new PAT
4. Re-test with `GET /health` (no auth) then an authenticated endpoint

### Status 409 — File Checkout Conflicts

When trying to check out a file that's already checked out:

```
POST /api/v1/files/2000_1/checkout
-> 409 Conflict (assumed — actual status code may differ)
```

Handle by:

1. Fetch file details to check `IsCheckedOut` flag
2. Inform user who has the file checked out (if available in response)
3. Offer to retry later

---

## Counter-Exceptions

Things that look like errors but are correct API behavior:

| Situation                               | Looks Like             | Actually                                                                                                      |
| --------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /api/Tasks` returns 200           | Should be 201?         | May return 200 on create — the API is inconsistent. Check if body contains new entity.                        |
| Empty page beyond TotalPages            | Error?                 | Valid — returns `TotalRows: 0, Result: []`. Not an error.                                                     |
| EntityID has underscore-prefixed fields | Malformed JSON?        | Correct — `_id`, `_server_id`, `_server_guid` all start with underscore by design.                            |
| Mixed casing between models             | API bug?               | Intentional — TaskItemModel is snake_case, JobModel is PascalCase. Both are correct.                          |
| Delete task needs description in path   | Bad API design?        | Correct — `DELETE /api/v1/tasks/{task_id}/{description}` requires both.                                       |
| Task endpoints have no `/v1/`           | Wrong base URL?        | Correct — `POST /api/Tasks` genuinely skips the version prefix. (Same POST handles update; no `PUT` variant.) |
| Pagination style is inconsistent        | Misconfigured routing? | Correct — search endpoints use body, content-listing endpoints use path. Never query string.                  |

---

## Retry Logic

### Recommended Retry Strategy

```python
import time

MAX_RETRIES = 3
BACKOFF_FACTOR = 2  # seconds

def api_call_with_retry(method, url, **kwargs):
    for attempt in range(MAX_RETRIES):
        response = requests.request(method, url, **kwargs)

        if response.status_code < 500:
            return response  # Don't retry client errors

        if attempt < MAX_RETRIES - 1:
            wait = BACKOFF_FACTOR * (2 ** attempt)
            time.sleep(wait)

    return response  # Return last response after all retries
```

### Do NOT Retry

- **401:** Token expired — retry won't help
- **403:** Permission denied — retry won't help
- **404:** Resource doesn't exist — retry won't help
- **400:** Bad request — fix the request, don't retry

### Do Retry

- **500:** Server error — transient, retry with backoff
- **502/503:** Service unavailable — retry with backoff
- **Connection errors:** Network issues — retry with backoff

---

## Rate Limiting

### Status: UNKNOWN

The Swagger spec does not document rate limits. Assume they exist and be conservative:

- Space requests at least 100ms apart
- Use exponential backoff on any 429 (Too Many Requests) response
- For bulk operations (paginating through all entities), add a small delay between pages
- If you receive unexpected 503s, reduce request frequency

### Defensive Rate Limit Handling

```python
if response.status_code == 429:
    retry_after = response.headers.get("Retry-After", "60")
    time.sleep(int(retry_after))
    # Retry the request
```

---

## Health Check

The only guaranteed way to verify API connectivity:

```
GET https://{instance}/health
# No auth required
# No /api/v1/ prefix
```

Use this:

1. On initial connection setup — verify instance URL is correct
2. Before re-authenticating — verify server is up (separate from auth issues)
3. As a lightweight keepalive check

**Do NOT use health check as an auth verification.** It doesn't require auth. Use an authenticated endpoint like `GET /api/v1/auth/getPersonalAccessTokens` to verify the PAT is valid.

---

## Logging Recommendations

For Numa integration, log the following at each API call boundary:

```python
{
    "_name": "12D_SYNERGY_API",
    "method": "POST",
    "path": "/api/v1/jobs/search",
    "status_code": 200,
    "duration_ms": 342,
    "page": 1,
    "total_rows": 142,
    "instance": "client-instance.12dsynergy.com",
    "error": null
}
```

On error:

```python
{
    "_name": "12D_SYNERGY_API_ERROR",
    "method": "POST",
    "path": "/api/v1/jobs",
    "status_code": 400,
    "duration_ms": 150,
    "error_body": "...",
    "instance": "client-instance.12dsynergy.com"
}
```
