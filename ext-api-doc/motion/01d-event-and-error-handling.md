---
api_name: Motion
api_slug: motion
base_url: https://api.usemotion.com/v1
call_surface: HTTP via `numa integrations request`
auth: X-API-Key header (static per-user key; NO refresh)
companions: 01=api-rules, 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns
confidence: [DOCUMENTED] from docs.usemotion.com unless tagged [INFERRED]/[UNKNOWN]; NO live call made
---

# Motion — Event & Error Handling Reference

Events, polling, errors, and the all-important rate-limit discipline. Companion to `01-llm-api-rules.md`.

## Event-Driven Capabilities

| Mechanism              | Supported | Notes                             |
| ---------------------- | --------- | --------------------------------- |
| Webhooks               | **No**    | None documented in the public API |
| WebSocket              | No        | [INFERRED]                        |
| Server-Sent Events     | No        | [INFERRED]                        |
| Change feeds / streams | No        | Poll list endpoints instead       |

**There is no push/event mechanism.** To detect changes, **poll** a scoped, filtered list endpoint on a generous interval (see below) — minding the 12/120-per-minute budget.

## Polling Fallback (the only "events" you get)

- **Endpoint:** a scoped task list, e.g. `GET /tasks?workspaceId=ws_123&status=To%20Do`. Re-query and diff against the previous result.
- **No "modified since" filter** is documented — Motion has no `updatedAfter` param. You compare full (filtered) result sets, keyed by task `id`, and inspect `updatedTime` to spot changes.
- **Interval:** keep it well inside the rate budget. On an **individual** key (12/min) poll **no more than every few minutes**; on a **team** key (120/min) a tighter cadence is possible but still pace it. Each poll may be several paginated calls — count them against the budget.

```
1. snapshot = GET /tasks?workspaceId=…&<filters>   (paginate, keyed by id; note updatedTime)
2. wait N minutes (generous — respect 12/120 per min)
3. re-fetch the same query
4. diff: new ids = created; missing ids = deleted/moved; changed updatedTime = updated
5. goto 2
```

## Error Handling

JSON error bodies. The exact field shape is **not fully published** — confirm against live calls. Assume at least a human-readable message field.

```json
{ "message": "..." }
```

| Field   | Type   | Always present? | Description                      |
| ------- | ------ | --------------- | -------------------------------- |
| message | string | likely          | Human-readable error description |

> [UNKNOWN] whether errors include a code/details array. Parse leniently.

### Recovery Playbook

| Status      | Meaning            | Retryable? | Action                                                                                                                                                        | Max Retries |
| ----------- | ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 200/201     | Success            | —          | —                                                                                                                                                             | —           |
| 400         | Bad request        | No         | Fix params/body: invalid `priority`/`duration`, malformed ISO-8601 `dueDate`, both `status` AND `includeAllStatuses`, missing required `workspaceId`/`taskId` | 0           |
| 401         | Unauthorized       | No         | **`X-API-Key` missing/invalid/revoked.** Verify the stored key; re-mint in Motion → Settings → API. No token to refresh — do **not** blind-retry.             | 0           |
| 403         | Forbidden          | No         | The user's key lacks access to that workspace/resource (per-user permissions). Not a credential problem — surface it.                                         | 0           |
| 404         | Not found          | No         | Verify the id (opaque string) and that `/v1` isn't doubled in the path (base already ends in `/v1`).                                                          | 0           |
| 405         | Method not allowed | No         | Mainly the **move** endpoint (POST vs PATCH ambiguity) — retry with the other verb.                                                                           | 1           |
| 429         | **Rate limited**   | **Yes**    | **No `Retry-After`.** Exponential backoff + jitter; serialize and slow down (see below). THE failure mode for this API.                                       | 5           |
| 500/502/503 | Server error       | Yes        | Exponential backoff + jitter.                                                                                                                                 | 3           |

### ⚠️ Rate Limits — the dominant operational concern

Limits are **per account**, very low, and have **no `Retry-After`** to lean on:

| Account type | Limit                   | Implied spacing         |
| ------------ | ----------------------- | ----------------------- |
| Individual   | **12 req / min**        | ~1 call every **5 s**   |
| Team         | up to **120 req / min** | ~1 call every **0.5 s** |
| Enterprise   | higher (contact Motion) | —                       |

**Discipline (this is the core rule for the whole connector):**

1. **Serialize.** Never issue concurrent requests — one at a time.
2. **Pace proactively.** Don't wait for a 429; space calls to stay under the per-minute ceiling. On an individual key, treat ~5 s between calls as the floor.
3. **Budget before you loop.** A paginated read of N pages is N calls. A "create then verify" is 2 calls. Count them out before starting and stop early if you're near the ceiling.
4. **Back off on 429.** With no `Retry-After`: exponential backoff with jitter — start ~**5 s** (individual) / ~**1 s** (team), double each attempt, cap ~**60 s**, give up after ~5 tries and tell the user to wait.
5. **Cache stable reads** for the conversation — `/workspaces`, `/statuses`, `/schedules` change rarely; don't re-fetch them per task.
6. **Prefer one filtered call** to many broad ones — scope by `workspaceId` and add `status`/`assigneeId`/`projectId`/`name` filters.

```
on 429:
  attempt = 0
  delay   = 5s  (individual)  |  1s (team)
  while attempt < 5:
    wait(delay + random_jitter)
    retry the SAME request
    if not 429: break
    delay = min(delay * 2, 60s); attempt += 1
  if still 429: surface "Motion rate limit hit — please wait a minute and retry"
```

## Async Operations

**None documented.** No job/poll pattern, no bulk export, no auto-schedule async handle exposed via the API. Auto-scheduling is a property you set on a task (`autoScheduled`), not a separate async call you poll.

## File Handling

**No file/attachment API documented.** Tasks/projects/comments are record data only — there is no upload/download surface. (This is a record connector, not a Files connector.)

## Counter-Exceptions (differ from common REST conventions)

1. **Extremely low rate limit + no `Retry-After`** (12/min individual). Pace and back off blind — the single most important behaviour.
2. **`/v1` is in the base URL** — pass paths without a leading `/v1`.
3. **Custom Fields live on a different host path** (`/beta/workspaces/{id}/custom-fields`), not `/v1`.
4. **`status` is asymmetric** — string on write, object on read.
5. **No webhooks/events** — poll, and there's no "modified since" filter to make polling cheap.
6. **Cursor pagination, no total count** — `meta.nextCursor`; null = last page.
7. **Several resources are create-only or read-only** — no project update/delete, no recurring-task update, no comment edit/delete.
8. **Update requires `name` + `workspaceId`** even for a one-field PATCH.
9. **Static per-user key** — a 401 is a bad/revoked key (human fix), not expiry; there's nothing to refresh.

## Output Formatting Guide (presenting Motion responses to the user)

| Data Type   | Format            | Example                                                                     |
| ----------- | ----------------- | --------------------------------------------------------------------------- |
| Single task | Key-value summary | "Complete project proposal — HIGH, To Do, due Jan 15, assigned to Jane Doe" |
| Task list   | Markdown table    | Columns: Name, Status, Priority, Assignee, Due                              |
| Project     | Title + status    | "Q1 Campaign Launch — Not Started (Engineering)"                            |
| Workspace   | Name + type       | "Engineering (team)"                                                        |
| Status      | Name + flags      | "Done (resolved)"                                                           |
| Schedule    | Working hours     | "Work Hours (America/New_York): Mon–Fri 09:00–17:00"                        |
| Comment     | Author + snippet  | "Jane Doe: 'Looks good — shipping today.'"                                  |
| Timestamps  | Human-readable    | "Jan 15, 2026, 5:00 PM" (convert from the ISO-8601 string)                  |
| Errors      | Clear message     | "Motion hit its rate limit (12/min) — waiting before retrying."             |

### Truncation Rules

- Lists: show ~10 rows; note "showing 10 (paginate for more)" — there's no total count.
- Convert ISO-8601 timestamps to a human date/time before displaying.
- Render `description`/`content` HTML as readable text, not raw tags.
- Show ids as-is (opaque strings) — never reformat; they're needed for follow-up calls.
- **When you stop paginating early to save the rate budget, say so** ("more results available").
