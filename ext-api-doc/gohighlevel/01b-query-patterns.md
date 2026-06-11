---
api_name: 'GoHighLevel'
api_slug: 'gohighlevel'
generated_from: '00-api-investigation (GoHighLevel, 2026-05-04) + official marketplace docs'
generated_date: '2026-06-10'
source_phases: ['Phase 4: Query Patterns']
---

# GoHighLevel -- Query Patterns Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs, **no Authorization header**
> (Numa injects the Bearer PIT automatically), and an explicit `Version` header on EVERY call
> (Numa does NOT add it). Facts tagged [DOCS] / [UNVERIFIED].

## The Two Non-Negotiables on Every Read

1. **`headers: {"Version": "2021-07-28"}`** — required by the API on every request [DOCS]. Contacts
   docs are written against `2023-02-21`; switch only if a contacts response looks wrong.
2. **`locationId`** — required as a query param on most list/search endpoints [DOCS].

## Step 0: Resolve the locationId (always do this first)

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/locations/search", "headers": {"Version": "2021-07-28"}})
```

- Returns the location(s) visible to the PIT [DOCS]. A PIT is created inside one location, so expect
  one result in the normal case [DOCS]; if several come back, ask the user which to use.
- Cache `locationId` for the whole session — never re-derive it per call, never guess it.
- This is also the cheapest **connection health probe**: a 200 here proves the PIT works at all
  (it needs the "View Locations" scope [DOCS]).

## Pagination (cursor / keyset)

Mechanics [DOCS — official pagination behaviour, confirmed by the community walkthrough]:

| Param          | Type            | Notes                                            |
| -------------- | --------------- | ------------------------------------------------ |
| `limit`        | integer         | Default **20**, max **100**                      |
| `startAfter`   | epoch ms number | Cursor from `meta.startAfter` of the previous page |
| `startAfterId` | string          | Cursor from `meta.startAfterId` of the previous page |
| `locationId`   | string          | Required for most lists                          |

Response envelope: `{ "<collection>": [...], "meta": {...} }` — e.g. `contacts` [DOCS].

The loop:

```
page 1:  /contacts/?locationId={loc}&limit=100
         → read meta.startAfter + meta.startAfterId
page 2:  /contacts/?locationId={loc}&limit=100&startAfter={meta.startAfter}&startAfterId={meta.startAfterId}
page N:  …until meta cursors are absent/null or the collection array is empty
```

- **Pass BOTH cursors** — they work as a pair (timestamp + id tiebreak) [DOCS].
- Stop condition: meta cursors absent/null [UNVERIFIED — inferred]; an empty collection array is the
  unambiguous stop [DOCS — "response is empty" is the community stop condition].
- No reliable total count is documented [UNVERIFIED whether `meta` carries one] — phrase totals as
  "at least N" unless you drained all pages.
- **Pace pages ~1/sec** — rate limits are numerically unknown; the community guidance inserts 1000ms
  between page calls [DOCS — community practice; thresholds [UNVERIFIED]].

## Common Patterns

### Pattern 1: List contacts (paged)

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/?locationId=ve9EPM428h8vShlRW1KT&limit=100",
  "headers": {"Version": "2021-07-28"}})
```

`GET /contacts/` is **deprecated in favour of `/contacts/search`** [DOCS] but is the path with
fully-documented cursor pagination — use it for "list/dump all contacts" work until search is
validated through Numa.

### Pattern 2: Get one record by id

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/{contactId}", "headers": {"Version": "2021-07-28"}})
```

Single-record responses appear wrapped (`{ "contact": {...} }` per SDK examples) [UNVERIFIED for all
entities] — unwrap defensively (use the entity key if present, else the body itself).

### Pattern 3: Search contacts (preferred per docs — shape UNVERIFIED)

`/contacts/search` is the documented replacement for the deprecated list [DOCS], but the exact
request shape (GET with params vs POST with a filter body) was **not pinned down** in the
investigation [UNVERIFIED]. Approach:

1. Try `GET /contacts/search?locationId={loc}&query={text}&limit=20` (query-param style) [UNVERIFIED].
2. If that 4xxs, try `POST /contacts/search` with `{"locationId": "...", "query": "...", "pageLimit": 20}` [UNVERIFIED].
3. Whichever works, note it for the rest of the session — and fall back to Pattern 1 + client-side
   filtering if neither cooperates.

Never present search-shape guesses as fact to the user; say you're locating the working form.

### Pattern 4: Opportunities — pipelines first, then search

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/opportunities/pipelines?locationId=ve9EPM428h8vShlRW1KT",
  "headers": {"Version": "2021-07-28"}})

connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/opportunities/search?location_id=ve9EPM428h8vShlRW1KT&limit=20",
  "headers": {"Version": "2021-07-28"}})
```

- Pipelines give you stage ids/names — you need them to interpret (and later move) deals [DOCS].
- The search param casing (`location_id` vs `locationId`) is [UNVERIFIED] — try `location_id` first
  (snake_case appears in community examples for this endpoint), fall back to `locationId`.
- Useful filters (status, pipeline, assignedTo) are [UNVERIFIED] — discover from a working response.

### Pattern 5: Conversations and messages

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/conversations/search?locationId=ve9EPM428h8vShlRW1KT&limit=20",
  "headers": {"Version": "2021-07-28"}})

connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/conversations/{conversationId}/messages",
  "headers": {"Version": "2021-07-28"}})
```

Search supports filter/sort per the MCP tool description ("Search/filter/sort conversations") [DOCS];
the specific filter params are [UNVERIFIED].

### Pattern 6: Calendar events (needs an anchor id)

`GET /calendars/events` **requires `userId`, `groupId`, or `calendarId`** [DOCS — MCP tool doc].

```
# 1. find calendars (or users) first  — path for calendar listing [UNVERIFIED]; users family exists [DOCS]
# 2. then:
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/calendars/events?locationId=ve9EPM428h8vShlRW1KT&calendarId={calId}&startTime=...&endTime=...",
  "headers": {"Version": "2021-07-28"}})
```

Time-window params (`startTime`/`endTime`) are the natural shape but [UNVERIFIED] — expect the 400
message to name the required params, and use them.

### Pattern 7: Payments

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/payments/transactions?locationId=ve9EPM428h8vShlRW1KT&limit=20",
  "headers": {"Version": "2021-07-28"}})

connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/payments/orders/{orderId}", "headers": {"Version": "2021-07-28"}})
```

Transactions are "paginated list, supports filtering" [DOCS — MCP tool]; filter params [UNVERIFIED].

### Pattern 8: Contact sub-resources

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/{contactId}/tasks", "headers": {"Version": "2021-07-28"}})
```

Tasks documented [DOCS]; notes/followers follow the same nesting pattern [UNVERIFIED paths].

### Pattern 9: Custom field definitions (decode contact custom values)

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/locations/{locationId}/customFields", "headers": {"Version": "2021-07-28"}})
```

Path inferred from the MCP tool `locations_get-custom-fields` [UNVERIFIED — locations-scoped route].
Fetch once per session; use `fieldKey`/`name` to translate the opaque custom-field entries on
contact records into human-readable answers.

### Pattern 10: Users (for calendar anchors and "assigned to" names)

The users family is documented ([DOCS] — SDK service + docs nav); the list path is [UNVERIFIED]:

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/users/?locationId=ve9EPM428h8vShlRW1KT", "headers": {"Version": "2021-07-28"}})
```

Needed to resolve `userId` for `/calendars/events` queries and to display owner names on
opportunities. If the path 404s, note it and ask the user for the relevant person's id from the
HighLevel UI instead.

## Choosing `limit`

| Situation                     | `limit` | Why                                                |
| ----------------------------- | ------- | --------------------------------------------------- |
| Interactive lookups           | 20 (default) | Fast, small payloads                            |
| "Find X" scans                | 100     | Fewer pages = fewer requests against unknown limits |
| Full exports / sync walks     | 100     | Mandatory — a 10k-contact book is 100 pages at 100, 500 at 20 |
| Probes / health checks        | 1       | Cheapest possible signal                            |

## Worked Examples

### Example 1: "Find Jane Smith and show her details"

```
# Resolve location (once per session)
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/locations/search", "headers": {"Version": "2021-07-28"}})

# Search (Pattern 3 probing), or list + filter client-side:
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/?locationId={loc}&limit=100", "headers": {"Version": "2021-07-28"}})
# …page until found; match on name/email client-side
```

For small-to-medium books (≤ a few thousand contacts) the paged list + client-side match is reliable
and avoids the unverified search shape. 3,000 contacts ≈ 30 pages at limit=100 [DOCS — community
account had 3,016 across 151 dashboard pages].

### Example 2: "How many deals are in the Sales pipeline, by stage?"

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/opportunities/pipelines?locationId={loc}", "headers": {"Version": "2021-07-28"}})
# pick the pipeline id by name; then
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/opportunities/search?location_id={loc}&pipeline_id={pid}&limit=100",
  "headers": {"Version": "2021-07-28"}})
```

`pipeline_id` filter param [UNVERIFIED] — if rejected, search without it and group client-side by
`pipelineId`/`stageId`. Map stage ids to names using the pipelines response.

### Example 3: "Show the last messages with contact X"

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/conversations/search?locationId={loc}&contactId={contactId}",
  "headers": {"Version": "2021-07-28"}})
# contactId filter [UNVERIFIED] — fall back to search + client-side match on contactId
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/conversations/{convId}/messages", "headers": {"Version": "2021-07-28"}})
```

### Example 4: Full contact export (cursor drain)

```
loop:
  GET /contacts/?locationId={loc}&limit=100[&startAfter={t}&startAfterId={id}]   (Version header)
  append response.contacts to the workspace file
  t, id = response.meta.startAfter, response.meta.startAfterId
  stop when cursors absent/null or contacts == []
  sleep ~1s between pages
```

Write batches to a `/workdir` file as you go — don't hold tens of thousands of records in context.

### Example 5: "Which contacts were added this week?"

No documented server-side date filter [UNVERIFIED — search may support one]; the robust path is a
cursor walk with client-side filtering:

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/?locationId={loc}&limit=100", "headers": {"Version": "2021-07-28"}})
# inspect the first page: identify the created-date field (likely dateAdded [UNVERIFIED])
# and whether results are ordered newest-first; if so, stop paging once records pre-date the window
```

If page 1 shows oldest-first ordering (or no clear order), you must drain pages and filter — warn
the user it may take a moment on large books, and consider proposing a scheduled agent for
recurring versions of this question (see 01d).

## Query Gotchas & Counter-Exceptions

1. **Version header omitted → request fails.** It's the first thing to check on any 4xx. [DOCS]
2. **Missing `locationId` on a list → 4xx.** Second thing to check. [DOCS]
3. **`startAfter` is epoch milliseconds, not seconds and not ISO.** Pass `meta` values through
   verbatim — never compute your own cursor. [DOCS]
4. **Both cursors or neither.** Sending only `startAfter` without `startAfterId` may mis-page
   [UNVERIFIED] — always send the pair.
5. **403 on one family, 200 on another = scope gap**, not a broken connection. Tell the user which
   scope to add to their Private Integration. [DOCS]
6. **Empty page ≠ error.** `[]` with 200 means no matches / end of data. Stop paging; don't retry.
7. **Deprecated ≠ broken**: `GET /contacts/` works today [DOCS]; just don't be surprised by an
   eventual sunset — prefer `/contacts/search` once its shape is validated through Numa.
8. **Server-side date filtering is unproven.** No documented `dateUpdated>=` filter was found —
   change detection is cursor walks + client-side date comparison until search filters are validated
   [UNVERIFIED]. See 01d for the polling recipe.
9. **Responses may differ per `Version` value** — pin one value per session; don't mix. [DOCS]
10. **Nothing here is live-validated.** First successful response of each shape in a session is your
    ground truth — prefer it over this file and note discrepancies.

---

_Generated 2026-06-10 from the 2026-05-04 docs investigation. Companion to `01-llm-api-rules.md`.
See `01c-mutation-patterns.md` for writes and `01d-event-and-error-handling.md` for polling and errors._
