---
api_name: ProWorkflow
api_slug: proworkflow
base_url: https://api.proworkflow.net
call_surface: HTTP via connectors(name="request", ...) — flat relative paths, no version segment; backend injects apikey + Basic auth
doc: events & errors — webhooks, polling, error shapes, rate limits, recovery, output formatting (companion to 01)
confidence: every fact live-API-confirmed 2026-06-10 unless tagged [INFERRED]/[DOCS]
---

# ProWorkflow — Events & Error Handling

## Event-Driven Capabilities

| Mechanism                                     | Supported | Notes                                                                                                  |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| Webhooks ("Web Hooks")                        | Yes       | register via `/settings/webhooks`; broad catalog; ID-only payload. **No Numa receiver — poll instead** |
| WebSocket / SSE / long polling / change feeds | No        | use `lastmodifiedfrom` polling                                                                         |

## Webhooks

> ProWorkflow webhooks exist but Numa has no receiver — this section documents them; for change detection in Numa use polling (below).

Setup: API only (`/settings/webhooks`). **One event per hook** — register multiple hooks for multiple events. Webhook traffic does NOT count against the API rate limit and fires near-instantly.
`POST /settings/webhooks {"event":"newproject","url":"https://your-receiver.example.com/pwf-hook"}` → 201 `{"message":"Web Hook Added","status":"Success","details":[{"id":3}]}`
Manage:

```
GET    /settings/webhooks                 # list (filter ?event=project|task|time|...)
GET    /settings/webhooks/{webhookid}
PUT    /settings/webhooks/{webhookid}     # update URL ONLY: {"url":"https://..."}
DELETE /settings/webhooks/{webhookid}
```

The `event` of a hook CANNOT be changed — delete + create a new one.

### Event Catalog

Per-resource `new*`/`edit*`/`delete*` triads plus lifecycle events:
| Resource | Events |
| --- | --- |
| Contact | `newcontact`, `newpendingcontact`, `editcontact`, `editcontactlocation`, `deletecontact` |
| Company | `newcompany`, `newpendingcompany`, `editcompany`, `deletecompany` |
| File | `newfile`, `deletefile` |
| Invoice | `newinvoice`, `editinvoice`, `deleteinvoice` |
| Message | `newmessage`, `editmessage`, `deletemessage` |
| Project | `newproject`, `editproject`, `deleteproject`, `completeproject`, `reactivateproject` |
| Project Request | `newprojectrequest`, `editprojectrequest`, `deleteprojectrequest`, `approveprojectrequest`, `declineprojectrequest` |
| Quote | `newquote`, `editquote`, `deletequote` |
| Shared Note | `newsharednote`, `editsharednote`, `deletesharednote` |
| Task | `newtask`, `edittask`, `deletetask`, `completetask`, `reactivatetask` |
| Time Record | `newtime`, `edittime`, `deletetime` |
| Timer | `starttimer`, `stoptimer` |

One action can fire multiple events — e.g. stopping a timer fires `stoptimer` AND `newtime`. If you subscribe to both, de-duplicate.

### Payload Format

Minimal — an ID plus a GET URL, NOT the object: `{"id":395,"url":"https://api.proworkflow.net/contacts/395"}`. For **delete events the `url` is omitted**. Pattern: receive ping → GET the `url` (with normal auth) for full details. No signature header, no shared secret, no IP allowlist — treat inbound payloads as untrusted hints: never act on payload content; always re-fetch by ID through the authenticated API; use an unguessable receiver URL.

### Reliability — the 10-Second Rule

- Receiver must respond within **10 seconds**. If processing might take longer, acknowledge immediately (docs suggest an intermediary page) and process async.
- **A 4xx response removes the webhook IMMEDIATELY.** Never return 4xx from a receiver unless you want to unsubscribe; return 200 even for payloads you ignore.
- No/late response → retries then removal. Retry schedule is documented inconsistently: the overview says 3 retries at 1/15/60-min delays; the `/settings/webhooks/requests` reference says 1 min, then 4× at 15-min, then 4× hourly — before the request AND parent hook are deleted. Either way: a few minutes of transient downtime survives; sustained downtime kills the subscription.
- The creator is emailed when a hook is removed — the only push notification you get; also poll `GET /settings/webhooks` periodically to verify subscriptions exist.
- No ordering/duplicate guarantees — de-duplicate on `(event hook, id)` and re-fetch current state rather than assuming order.

### Receiver Checklist

1. Respond 200 within 10s — enqueue and return; process async.
2. Never return 4xx (instant unsubscribe). 200 even for ignored payloads.
3. De-duplicate on `(hook, id)` — multi-event actions and retries can deliver twice.
4. On receipt, GET the `url` through the authenticated API; never trust payload contents.
5. Use an unguessable URL path (no signature support); require HTTPS.
6. Reconcile subscriptions periodically (`GET /settings/webhooks`) — silent removal after sustained failures is the failure mode you'll hit.

### Debugging Deliveries

```
GET /settings/webhooks/requests?status=pending          # or complete | all
GET /settings/webhooks/requests?resthookid=3&event=task
```

Per-delivery records (kept 7 days): `requestid`, `resthookid`, `event`, `dataid`, `dataurl`, `url`, `httpstatuscode` (most recent attempt), `tries`, `starttime`, `completetime`, `nextruntime`. First place to look when "the webhook didn't fire" — it usually did, and `httpstatuscode`/`tries` say why it isn't landing.

## Polling Fallback (the Numa path)

- Endpoint: any list call with `lastmodifiedfrom` (contacts, companies, projects, tasks, time, quotes, invoices...).
- Change-detection field: `lastmodified` on each item; relative filter `Xn/h/d/w/m` (**`n` = minutes**) or `lastmodifiedutcfrom` with a stored UTC timestamp.
- Interval: 5-15 min for near-real-time; the 500 req/30s budget is generous but be a good citizen.
- Remember default filters: add `status=all` on `/projects`/`/tasks` or recently-modified completed items are invisible.

```
1. GET /projects?lastmodifiedfrom=20n&status=all&fields=number,title,lastmodified
2. Process returned records (de-dup by id; window > interval to cover boundary edits)
3. Wait 15 minutes; goto 1
```

Tips: use `If-None-Match` with the stored ETag — unchanged lists come back as an empty 304; restrict `fields` to the minimum to shrink payloads; prefer `lastmodifiedfrom` over ETags for very large lists (a 304 still costs server-side list prep). Deletes do NOT show up in modified-window polls — use `delete*` webhooks or periodically reconcile full ID lists.

## Error Handling

### Body Shapes — Parse Defensively

Standard error: `{"status":"Error","details":["pagesize and pagenumber must both be provided in order to use paging"]}`. The four shapes you must handle:

1. **Normal error (4xx):** `{"status":"Error","details":["...message..."]}` — `details` is an array of strings.
2. **500 variant:** `details` is a **bare string**, e.g. `{"status":"Error","details":"An unidentified error occurred, please contact development@proworkflow.com for assistance."}`.
3. **401:** completely EMPTY body — no JSON. Bad API key OR bad username/password look identical.
4. **Unknown path:** an HTML 404 page, not JSON (e.g. `GET /nonexistent`).

Additionally, some validation messages contain embedded HTML (`<ul><li>...`) inside the details strings — strip tags before showing them to users.
Robust parse order: check HTTP status → if body empty and 401, report auth failure → try JSON parse; on failure treat as HTML 404/unknown path → normalize `details` to a list (`[details] if isinstance(details, str)`), strip HTML tags.

Field-level validation failures are plain strings in `details` — no structured field/code format. Observed live:

```
{"status":"Error","details":["'content' is a required field"]}
{"status":"Error","details":["pagesize and pagenumber must both be provided in order to use paging"]}
{"status":"Error","details":["You must provide one of the following combinations: 'starttime' & 'endtime', 'starttime' & 'timetracked', 'endtime' & 'timetracked' or 'timetracked'"]}
```

Map these back to the request by string matching; quote the message verbatim (HTML-stripped) when surfacing — it usually names the offending field.

### Recovery Playbook

| Status | Meaning                                | Retryable | Recovery                                                                                                                                                      | Max retries |
| ------ | -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 200    | Success (GET/PUT/DELETE)               | —         | —                                                                                                                                                             | —           |
| 201    | Success (POST; new IDs in `details`)   | —         | —                                                                                                                                                             | —           |
| 304    | Not Modified (`If-None-Match` matched) | —         | use cached copy; empty body is intentional, not an error                                                                                                      | —           |
| 400    | Bad request / validation               | No        | fix per `details`; common: paging params split, wrong field name, bad date format                                                                             | 0           |
| 401    | API key or username/password invalid   | No        | EMPTY body. Surface "ProWorkflow credentials invalid" → user re-enters PWF email/password (vault); admin re-checks account API key. Do NOT blind-retry        | 0           |
| 403    | Permissions deny it                    | No        | user's "View Work"/role permissions block it. Tell user; an admin must grant access in ProWorkflow                                                            | 0           |
| 404    | Item doesn't exist                     | No        | verify the numeric ID (not the P-xxxx number!). Unknown PATHS return HTML, not this JSON                                                                      | 0           |
| 429    | Rate limit (500 req/30s)               | Yes       | wait `x-ratelimit-reset` seconds, then retry                                                                                                                  | 3           |
| 500    | Server error                           | Sometimes | if `details` indicates a malformed body (e.g. task `contacts` array) FIX the request — retrying is useless; else retry with backoff and report to ProWorkflow | 2           |

**500-specific:** ProWorkflow returns 500 (not 400) for some malformed bodies — the confirmed example is task `contacts` as an array of objects. Before treating a 500 as transient, re-check the body against 01c.
**Never auto-retry non-idempotent writes** (POST creates, `adjustdates`) on timeout — check whether the write landed first (e.g. search by title / `lastmodifiedfrom=5n`).

### Rate Limits

500 requests / 30 seconds per **account API key** — shared by ALL Numa users on the tenant. Headers on EVERY response: `x-ratelimit-limit` (500), `x-ratelimit-remaining` (e.g. 477), `x-ratelimit-reset` (seconds until reset, ≤30). Exceeding → **429**; no documented `Retry-After` — use `x-ratelimit-reset`. Webhook deliveries do not consume the budget. Record cap is separate: max 5,000 records/response (silent truncation) — design for ≤500/page.
Backoff: (1) on 429 wait `x-ratelimit-reset` s (max 30), retry; (2) when `x-ratelimit-remaining` drops below ~50, pause bulk loops until reset; (3) add 0-1 s jitter when running concurrently; (4) max 3 retries, then surface.

### Counter-Exceptions (non-standard behaviors)

1. **401 has an empty body** — distinguish auth failures by status code alone; wrong API key and wrong password are indistinguishable.
2. **Unknown paths return HTML, not JSON 404** — JSON 404s only occur for valid paths with missing IDs.
3. **`details` is usually an array but sometimes a bare string** (500s), and may contain embedded HTML.
4. **Malformed bodies can yield 500 instead of 400** (task `contacts` array bug) — a 500 is not automatically "their fault, retry later".
5. **Action endpoints use PUT** (`/complete`, `/approve`, `/markaspaid`, timers); bulk task delete is `PUT /tasks/delete` — non-standard verb mapping.
6. **A 4xx from YOUR webhook receiver deletes the subscription instantly** — most providers just retry; ProWorkflow unsubscribes.
7. **ETag values are unquoted** (`etag: 10f7b92898aa74de`) — echo back exactly what you received in `If-None-Match`.
8. **PUT/DELETE return 200 with a JSON `details` array**, never 204 No Content.

## Output Formatting Guide

How to present responses to the user in the workspace agent.

| Data type     | Format                          | Example                                                                           |
| ------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| Project       | number + title + status         | "P-0103: Website Refresh (Active) — ABC Media, due Jun 24, 2026"                  |
| Task          | name + project + due            | "Draft homepage copy (P-0103) — due Jun 12, priority High"                        |
| Contact       | name + company + type           | "Amy West — ABC Media (client, amy@abcmedia.com)"                                 |
| Time record   | person + minutes as h:mm        | "Tony Gurnick: 0:30 on Jun 10 — Initial draft (task: Draft homepage copy)"        |
| Quote/Invoice | number + total + state          | "Q-0009: $1,955.00 incl. tax — Approved Jun 10"                                   |
| Workload      | minutes → hours per day         | "Mon Jun 15: 6.5h booked / 1.5h available"                                        |
| Dates         | human-readable, no TZ claims    | "June 24, 2026" (API gives no timezone — don't invent one)                        |
| Currency      | account currency from /login    | "$1,234.56"                                                                       |
| Errors        | details[] joined, HTML-stripped | "ProWorkflow rejected the request: pagesize and pagenumber must both be provided" |

Conversion: minutes → hours everywhere (`timetracked`, `timeallocated`, line `time`, workload are minutes — display `7.5h` or `0:30`, never raw "450"). Show the project NUMBER (P-xxxx) to users, use the numeric `id` in API calls. Priorities: 1-5 = Very High, High, Normal, Low, Very Low.
Truncation: lists → first 10-15 records as a table, then "Showing 15 of {totalcount}"; long descriptions/notes → truncate at ~200 chars with "..."; offer to fetch the next page rather than auto-walking large `totalcount`s.
