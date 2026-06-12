---
api_name: 'ProWorkflow'
api_slug: 'proworkflow'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-10'
update_source: 'official API docs + live API testing (trial account "ArcanumAI", Advanced plan)'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# ProWorkflow -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Contains event-driven capabilities (webhooks, polling),
> error handling patterns, rate limiting, and recovery playbooks.
> Facts marked [CONFIRMED -- live API test 2026-06-10] were verified against a live trial account.

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                                  |
| ------------------------ | --------- | ----------------------------------------------------------------------- |
| Webhooks ("Web Hooks")   | Yes       | Register via `/settings/webhooks`; broad event catalog; ID-only payload |
| WebSocket                | No        | Not available                                                           |
| Server-Sent Events (SSE) | No        | Not available                                                           |
| Long polling             | No        | Not available                                                           |
| Change feeds / streams   | No        | Use `lastmodifiedfrom` polling instead                                  |

---

## Webhooks

### Setup

- **Registration method:** API only (`/settings/webhooks`)
- **One event per hook** -- register multiple hooks for multiple events
- **Webhook traffic does NOT count against your API rate limit** and fires (near) instantly

**Register a webhook:**

```http
POST /settings/webhooks

{ "event": "newproject", "url": "https://your-receiver.example.com/pwf-hook" }
```

**Response (201):** `{ "message": "Web Hook Added", "status": "Success", "details": [ { "id": 3 } ] }`

**Manage hooks:**

```http
GET    /settings/webhooks                 # list active hooks (filter: ?event=project|task|time|...)
GET    /settings/webhooks/{webhookid}     # view one
PUT    /settings/webhooks/{webhookid}     # update URL ONLY: { "url": "https://..." }
DELETE /settings/webhooks/{webhookid}     # remove
```

**The `event` of a hook CANNOT be changed** -- delete the hook and create a new one.

### Event Catalog

Per-resource `new*` / `edit*` / `delete*` triads, plus lifecycle events:

| Resource        | Events                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| Contact         | `newcontact`, `newpendingcontact`, `editcontact`, `editcontactlocation`, `deletecontact`     |
| Company         | `newcompany`, `newpendingcompany`, `editcompany`, `deletecompany`                            |
| File            | `newfile`, `deletefile`                                                                      |
| Invoice         | `newinvoice`, `editinvoice`, `deleteinvoice`                                                 |
| Message         | `newmessage`, `editmessage`, `deletemessage`                                                 |
| Project         | `newproject`, `editproject`, `deleteproject`, `completeproject`, `reactivateproject`         |
| Project Request | `newprojectrequest`, `editprojectrequest`, `deleteprojectrequest`, `approveprojectrequest`, `declineprojectrequest` |
| Quote           | `newquote`, `editquote`, `deletequote`                                                       |
| Shared Note     | `newsharednote`, `editsharednote`, `deletesharednote`                                        |
| Task            | `newtask`, `edittask`, `deletetask`, `completetask`, `reactivatetask`                        |
| Time Record     | `newtime`, `edittime`, `deletetime`                                                          |
| Timer           | `starttimer`, `stoptimer`                                                                    |

**One action can fire multiple events** -- e.g. stopping a timer fires `stoptimer` AND
`newtime`. If you subscribe to both, de-duplicate so you only act once.

### Payload Format

The POST your receiver gets is minimal -- **an ID plus a GET URL**, not the object itself:

```json
{ "id": 395, "url": "https://api.proworkflow.net/contacts/395" }
```

- For **delete events the `url` is omitted** (there is nothing left to GET).
- Standard pattern: receive the ping, then GET the `url` (with normal auth) for full details.
- No signature header, no shared secret, no documented IP allowlist. Treat inbound payloads
  as **untrusted hints**: never act on payload content directly -- always re-fetch by ID
  through the authenticated API, and use an unguessable receiver URL.

### Reliability -- the 10-Second Rule

- **Your receiver must respond within 10 seconds.** If your processing might take longer,
  acknowledge immediately (the docs suggest an intermediary page) and process async.
- **A 4xx response removes the webhook IMMEDIATELY.** Never return 4xx from a receiver unless
  you want to unsubscribe.
- **No/late response -> retries, then removal:** the API overview states the request is
  retried 3 times with 1 / 15 / 60 minute delays before the hook is deemed failed and
  **removed**. (The `/settings/webhooks/requests` debugging docs describe a longer schedule --
  1 minute, then 4x at 15-minute intervals, then 4x hourly -- before the request and parent
  hook are deleted. Either way: transient receiver downtime of a few minutes survives;
  sustained downtime kills the subscription.)
- **Email alert on removal:** the person who created the hook is emailed when it is removed.
  That email is the only push notification you get -- also poll `GET /settings/webhooks`
  periodically to verify your subscriptions still exist.
- **Ordering / duplicates:** no guarantees documented. De-duplicate on `(event hook, id)`
  and re-fetch current state rather than assuming event order.

### Receiver Implementation Checklist

1. Respond `200` within 10 seconds -- enqueue and return immediately; process async.
2. Never return 4xx (instant unsubscribe). Return 200 even for payloads you ignore.
3. De-duplicate on `(hook, id)` -- multi-event actions and retries can deliver twice.
4. On receipt, GET the `dataurl` through the authenticated API; never trust payload contents.
5. Use an unguessable URL path (no signature support) and require HTTPS on your side.
6. Reconcile subscriptions periodically (`GET /settings/webhooks`) -- silent removal after
   sustained failures is the failure mode you will actually hit.

### Debugging Deliveries

```http
GET /settings/webhooks/requests?status=pending          # or complete | all
GET /settings/webhooks/requests?resthookid=3&event=task
```

Returns per-delivery records (kept 7 days): `requestid`, `resthookid`, `event`, `dataid`,
`dataurl`, `url`, `httpstatuscode` (most recent attempt), `tries`, `starttime`,
`completetime`, `nextruntime`. This is the first place to look when "the webhook didn't fire"
-- it usually did, and `httpstatuscode`/`tries` tell you why it isn't landing.

---

## Polling Fallback

> Use when a receiver endpoint isn't available (e.g. agent-driven syncs) or as a safety net
> alongside webhooks.

### Recommended Approach

- **Endpoint:** any list call with `lastmodifiedfrom` (contacts, companies, projects, tasks,
  time, quotes, invoices...)
- **Change detection field:** `lastmodified` on each item; relative filter `Xn/h/d/w/m`
  (**`n` = minutes**) or `lastmodifiedutcfrom` with a stored UTC timestamp
- **Recommended interval:** 5-15 minutes for near-real-time needs; the 500 req/30s budget is
  generous, but be a good citizen
- **Remember default filters:** add `status=all` on `/projects`/`/tasks` or recently-modified
  completed items are invisible

### Polling Pattern

```
1. GET /projects?lastmodifiedfrom=20n&status=all&fields=number,title,lastmodified
2. Process returned records (de-dup by id; window > interval to cover boundary edits)
3. Wait 15 minutes
4. Goto 1
```

### Efficient Polling Tips

- Use `If-None-Match` with the stored ETag -- unchanged lists come back as an empty 304.
  [CONFIRMED -- live API test 2026-06-10]
- Restrict `fields` to the minimum (e.g. `fields=lastmodified`) to shrink payloads.
- Prefer `lastmodifiedfrom` over ETags for very large lists -- a 304 still costs server-side
  list preparation; a modified-window query does not.
- Deletes do NOT show up in modified-window polls. If delete detection matters, use the
  `delete*` webhooks or periodically reconcile full ID lists.

---

## Error Handling

### Standard Error Response Format [CONFIRMED -- live API test 2026-06-10]

```json
{ "status": "Error", "details": ["pagesize and pagenumber must both be provided in order to use paging"] }
```

**Error fields:**

| Field     | Type            | Always present?           | Description                                                       |
| --------- | --------------- | -------------------------- | ------------------------------------------------------------------ |
| `status`  | string          | Yes (when body is JSON)    | `"Error"`                                                          |
| `details` | array OR string | Usually                    | Human-readable message(s). **Bare string on some 500s** [CONFIRMED] |

### The Four Body Shapes You Must Parse Defensively [CONFIRMED -- live API test 2026-06-10]

1. **Normal error (4xx):** `{"status": "Error", "details": ["...message..."]}` -- `details`
   is an array of strings.
2. **500 variant:** `details` is a **bare string**, e.g.
   `{"status":"Error","details":"An unidentified error occurred, please contact development@proworkflow.com for assistance."}`
3. **401:** **completely EMPTY body** -- no JSON at all. Bad API key OR bad username/password
   both look identical.
4. **Unknown path:** an **HTML 404 page**, not JSON (e.g. `GET /nonexistent`).

Additionally, some validation messages contain **embedded HTML** (`<ul><li>...`) inside the
details strings -- strip tags before showing them to users.

**Robust parse order:** check HTTP status -> if body empty and 401, report auth failure ->
try JSON parse; on failure treat as HTML 404/unknown path -> normalize `details` to a list
(`[details] if isinstance(details, str)`), strip HTML tags.

### Validation Error Examples [CONFIRMED -- live API test 2026-06-10]

Field-level validation failures are plain strings in `details` -- there is no structured
field/code format. Messages observed live:

```json
{ "status": "Error", "details": ["'content' is a required field"] }
{ "status": "Error", "details": ["pagesize and pagenumber must both be provided in order to use paging"] }
{ "status": "Error", "details": ["You must provide one of the following combinations: 'starttime' & 'endtime', 'starttime' & 'timetracked', 'endtime' & 'timetracked' or 'timetracked'"] }
```

Map these back to the request by string matching; quote the message verbatim (HTML-stripped)
when surfacing to the user, since it usually names the offending field.

### Recovery Playbook

| HTTP Status | Meaning                                       | Retryable? | Recovery action                                                                                     | Max retries |
| ----------- | --------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- | ----------- |
| 200         | Success (GET / PUT / DELETE)                  | --         | --                                                                                                   | --          |
| 201         | Success (POST; new IDs in `details`)          | --         | --                                                                                                   | --          |
| 304         | Not Modified (`If-None-Match` matched)        | --         | Use cached copy; body is intentionally empty -- not an error                                          | --          |
| 400         | Bad request / validation failure              | No         | Fix request per `details`; common causes: paging params split, wrong field name, bad date format      | 0           |
| 401         | API key or username/password invalid          | No         | Body is EMPTY. Surface "ProWorkflow credentials invalid" -> user re-enters PWF email/password (vault); admin re-checks account API key. Do NOT blind-retry | 0           |
| 403         | Permissions don't allow this request          | No         | The user's ProWorkflow "View Work"/role permissions block it. Tell the user; an admin must grant access in ProWorkflow | 0           |
| 404         | Item does not exist                           | No         | Verify the numeric ID (not the P-xxxx number!). NOTE: unknown PATHS return HTML, not this JSON        | 0           |
| 429         | Rate limit exceeded (500 req / 30 s)          | Yes        | Wait `x-ratelimit-reset` seconds, then retry                                                          | 3           |
| 500         | Server error                                  | Sometimes  | If `details` indicates a malformed body (e.g. task `contacts` array bug) FIX the request -- retrying is useless. Otherwise retry with backoff and report to ProWorkflow | 2           |

**500-specific warning:** ProWorkflow returns 500 (not 400) for some malformed request bodies
-- the confirmed example is sending task `contacts` as an array of objects. Before treating a
500 as transient, re-check the request body against `01c-mutation-patterns.md`.
[CONFIRMED -- live API test 2026-06-10]

**Never auto-retry non-idempotent writes** (POST creates, `adjustdates`) on timeout -- check
whether the write landed first (e.g. search by title / `lastmodifiedfrom=5n`).

### Rate Limit Details [CONFIRMED -- live API test 2026-06-10]

| Scope       | Limit        | Window     | Headers                                                           |
| ----------- | ------------ | ---------- | ------------------------------------------------------------------ |
| Per API key | 500 requests | 30 seconds | `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`  |

**Rate limit headers (present on EVERY response):**

| Header                  | Meaning                                | Example |
| ----------------------- | --------------------------------------- | ------- |
| `x-ratelimit-limit`     | Max requests per 30s window             | `500`   |
| `x-ratelimit-remaining` | Requests left in the current window     | `477`   |
| `x-ratelimit-reset`     | Seconds until the window resets         | `30`    |

**Notes:**

- The key is the **account API key** -- all Numa users on a tenant share one 500/30s budget.
- Exceeding it returns **429**; there is no documented `Retry-After` header -- use
  `x-ratelimit-reset`.
- Webhook deliveries do not consume the budget.
- Record cap is separate: max 5,000 records per response (silent truncation) -- design for
  <= 500 per page.

**Backoff strategy:**

1. On 429: wait `x-ratelimit-reset` seconds (max 30), then retry.
2. Proactively: when `x-ratelimit-remaining` drops below ~50, pause bulk loops until reset.
3. Add 0-1 s jitter when several operations run concurrently.
4. Max 3 retries, then surface the error.

---

## Counter-Exceptions

> Behaviors that differ from standard HTTP/REST conventions.

1. **401 has an empty body.** [CONFIRMED -- live API test 2026-06-10]
   - Standard: JSON error body with a message.
   - Actual: nothing -- distinguish auth failures by status code alone. Wrong API key and
     wrong password are indistinguishable.

2. **Unknown paths return HTML, not JSON 404.** [CONFIRMED -- live API test 2026-06-10]
   - Standard: JSON `{"error": "Not Found"}`.
   - Actual: a full HTML 404 page. JSON 404s only occur for valid paths with missing IDs.

3. **`details` is usually an array but sometimes a bare string** (500s), and may contain
   embedded HTML. [CONFIRMED -- live API test 2026-06-10]

4. **Malformed bodies can yield 500 instead of 400** (task `contacts` array bug) -- a 500 is
   not automatically "their fault, retry later". [CONFIRMED -- live API test 2026-06-10]

5. **Action endpoints use PUT** (`/complete`, `/approve`, `/markaspaid`, timers) and bulk
   task delete is `PUT /tasks/delete` -- non-standard verb mapping throughout.

6. **A 4xx from YOUR webhook receiver deletes the subscription instantly** -- most providers
   just retry. With ProWorkflow, 4xx = unsubscribe.

7. **ETag values are unquoted** (`etag: 10f7b92898aa74de`); echo back exactly what you
   received in `If-None-Match`. [CONFIRMED -- live API test 2026-06-10]

8. **PUT/DELETE return 200 with a JSON body** (`details` array), never 204 No Content.

---

## Output Formatting Guide

> How to present ProWorkflow API responses to the user in the workspace agent.

### Recommended Display Formats

| Data type      | Format                       | Example                                                                |
| -------------- | ---------------------------- | ----------------------------------------------------------------------- |
| Project        | Number + title + status      | "P-0103: Website Refresh (Active) -- ABC Media, due Jun 24, 2026"        |
| Task           | Name + project + due         | "Draft homepage copy (P-0103) -- due Jun 12, priority High"              |
| Contact        | Name + company + type        | "Amy West -- ABC Media (client, amy@abcmedia.com)"                       |
| Time record    | Person + minutes as h:mm     | "Tony Gurnick: 0:30 on Jun 10 -- Initial draft (task: Draft homepage copy)" |
| Quote/Invoice  | Number + total + state       | "Q-0009: $1,955.00 incl. tax -- Approved Jun 10"                         |
| Workload       | Minutes -> hours per day     | "Mon Jun 15: 6.5h booked / 1.5h available"                               |
| Dates          | Human-readable, no TZ claims | "June 24, 2026" (API gives no timezone -- don't invent one)              |
| Currency       | Account currency from /login | "$1,234.56" (currency code is in the login/account details)              |
| Errors         | details[] joined, HTML-stripped | "ProWorkflow rejected the request: pagesize and pagenumber must both be provided" |

### Conversion Rules

- **Minutes -> hours everywhere.** `timetracked`, `timeallocated`, line `time`, and workload
  values are minutes. Display as `7.5h` or `0:30`, never raw "450".
- **Show the project NUMBER (P-xxxx) to users, use the numeric `id` in API calls.**
- **Priorities:** 1-5 = Very High, High, Normal, Low, Very Low.

### Truncation Rules

- Lists: show the first 10-15 records as a table, then "Showing 15 of {totalcount}" (the
  envelope gives you `totalcount` for free).
- Long descriptions/notes: truncate at ~200 chars with "...".
- Offer to fetch the next page rather than auto-walking large `totalcount`s.

---

_Generated from the official ProWorkflow API documentation and live API testing, Phases 7-8._
