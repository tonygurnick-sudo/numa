---
api_name: GoHighLevel
api_slug: gohighlevel
base_url: https://services.leadconnectorhq.com
path_version_segment: none (version is the Version header, never a path)
auth: Bearer PIT (backend-injected); NEVER set Authorization
required_on_every_read: Version header — BACKEND-INJECTED (2021-07-28 via static_headers; override per-call to 2023-02-21 only for the newest contacts schema) + locationId query param on most lists
field_casing: camelCase
call_surface: HTTP via `numa integrations request gohighlevel GET <URL>` (Version is backend-injected; add `--headers '{"Version":"2023-02-21"}'` only to override). NOT a file-store connector.
confidence: docs-derived [DOCS], NOT live-validated. First successful response of each shape in a session is ground truth — prefer it over this file. Non-default markers [UNVERIFIED] inline.
companions: 01=api-rules, 01a=domain-model, 01c=mutation-patterns, 01d=events+errors
---

# GoHighLevel — Query Patterns

URLs are relative paths; backend prepends base_url and injects the Bearer PIT **and** the `Version: 2021-07-28` header (from the connector's `static_headers`). You do NOT pass the Version header — add `--headers '{"Version":"2023-02-21"}'` only to override it for the newest contacts schema. `locationId` is a required query param on most list/search endpoints. (Examples below omit the Version flag because the backend supplies it.)

## Step 0: resolve locationId (always first)

```
numa integrations request gohighlevel GET /locations/search -m "find location"
```

- Returns the location(s) the PIT sees. A PIT lives in one location → expect one result; if several, ask the user which.
- Cache `locationId` for the session — never re-derive per call, never guess.
- Also the cheapest **connection health probe**: 200 proves the PIT works (needs "View Locations" scope).

## Pagination (cursor / keyset)

| Param          | Type            | Notes                                           |
| -------------- | --------------- | ----------------------------------------------- |
| `limit`        | integer         | default 20, max 100                             |
| `startAfter`   | epoch ms number | cursor from previous page's `meta.startAfter`   |
| `startAfterId` | string          | cursor from previous page's `meta.startAfterId` |
| `locationId`   | string          | required for most lists                         |

Envelope: `{"<collection>":[...],"meta":{...}}` (e.g. `contacts`).
Loop:

```
page 1:  /contacts/?locationId={loc}&limit=100              → read meta.startAfter + meta.startAfterId
page 2:  /contacts/?locationId={loc}&limit=100&startAfter={meta.startAfter}&startAfterId={meta.startAfterId}
page N:  …until meta cursors absent/null OR the collection array is empty
```

- **Pass BOTH cursors** — they work as a pair (timestamp + id tiebreak).
- Stop: meta cursors absent/null [UNVERIFIED — inferred]; an empty collection array is the unambiguous stop (community-confirmed).
- No reliable total count [UNVERIFIED whether `meta` carries one] — phrase as "at least N" unless you drained all pages.
- Pace pages ~1/sec — well under the published 100-req/10s burst limit; a 429 is the live ceiling (01d).

## Patterns

### 1: List contacts (paged)

```
numa integrations request gohighlevel GET "/contacts/?locationId=ve9EPM428h8vShlRW1KT&limit=100" -m "list contacts"
```

`GET /contacts/` is deprecated in favour of `/contacts/search`, but is the path with fully-documented cursor pagination — use it for "list/dump all contacts" until search is validated.

### 2: Get one record by id

```
numa integrations request gohighlevel GET /contacts/{contactId} -m "get contact"
```

Single-record responses appear wrapped (`{"contact":{...}}` per SDK) [UNVERIFIED for all entities] — unwrap defensively (use the entity key if present, else the body).

### 3: Search contacts (preferred per docs — shape UNVERIFIED)

`/contacts/search` is the documented replacement, but the exact request shape (GET-with-params vs POST-with-filter-body) was not pinned [UNVERIFIED]. Approach:

1. Try `GET /contacts/search?locationId={loc}&query={text}&limit=20` [UNVERIFIED].
2. If 4xx, try `POST /contacts/search` body `{"locationId":"...","query":"...","pageLimit":20}` [UNVERIFIED].
3. Whichever works, note it for the session — and fall back to Pattern 1 + client-side filtering if neither cooperates.
   Never present search-shape guesses as fact; say you're locating the working form.

### 4: Opportunities — pipelines first, then search

```
numa integrations request gohighlevel GET "/opportunities/pipelines?locationId=ve9EPM428h8vShlRW1KT" -m "list pipelines"
numa integrations request gohighlevel GET "/opportunities/search?location_id=ve9EPM428h8vShlRW1KT&limit=20" -m "search deals"
```

- Pipelines give stage ids/names — needed to interpret and later move deals.
- Search param casing (`location_id` vs `locationId`) [UNVERIFIED] — try `location_id` first (snake_case in community examples for this endpoint), fall back to `locationId`.
- Filters (status, pipeline, assignedTo) [UNVERIFIED] — discover from a working response.

### 5: Conversations and messages

```
numa integrations request gohighlevel GET "/conversations/search?locationId=ve9EPM428h8vShlRW1KT&limit=20" -m "search conversations"
numa integrations request gohighlevel GET /conversations/{conversationId}/messages -m "get messages"
```

Search supports filter/sort per the MCP tool ("Search/filter/sort conversations"); specific filter params [UNVERIFIED].

### 6: Calendar events (needs an anchor id)

`GET /calendars/events` requires `userId`, `groupId`, or `calendarId`.

```
# 1. find calendars (or users) first — calendar listing path [UNVERIFIED]; users family exists
# 2. then:
numa integrations request gohighlevel GET "/calendars/events?locationId=ve9EPM428h8vShlRW1KT&calendarId={calId}&startTime=...&endTime=..." -m "list events"
```

`startTime`/`endTime` are the natural window params but [UNVERIFIED] — expect the 400 message to name the required params.

### 7: Payments

```
numa integrations request gohighlevel GET "/payments/transactions?locationId=ve9EPM428h8vShlRW1KT&limit=20" -m "list transactions"
numa integrations request gohighlevel GET /payments/orders/{orderId} -m "get order"
```

Transactions are "paginated list, supports filtering"; filter params [UNVERIFIED].

### 8: Contact sub-resources

```
numa integrations request gohighlevel GET /contacts/{contactId}/tasks -m "list tasks"
```

Tasks documented; notes/followers follow the same nesting [UNVERIFIED paths].

### 9: Custom field definitions (decode contact custom values)

```
numa integrations request gohighlevel GET /locations/{locationId}/customFields -m "custom fields"
```

Path inferred from the MCP tool `locations_get-custom-fields` [UNVERIFIED]. Fetch once per session; use `fieldKey`/`name` to translate opaque custom-field entries on contacts.

### 10: Users (for calendar anchors and "assigned to" names)

Users family documented; list path [UNVERIFIED]:

```
numa integrations request gohighlevel GET "/users/?locationId=ve9EPM428h8vShlRW1KT" -m "list users"
```

Resolves `userId` for `/calendars/events` and displays owner names on opportunities. If it 404s, note it and ask the user for the person's id from the HighLevel UI.

## Choosing limit

| Situation                 | limit        | Why                                                    |
| ------------------------- | ------------ | ------------------------------------------------------ |
| Interactive lookups       | 20 (default) | fast, small payloads                                   |
| "Find X" scans            | 100          | fewer pages = fewer requests vs unknown limits         |
| Full exports / sync walks | 100          | mandatory — 10k contacts = 100 pages at 100, 500 at 20 |
| Probes / health checks    | 1            | cheapest signal                                        |

## Worked examples

### "Find Jane Smith and show her details"

```
numa integrations request gohighlevel GET /locations/search -m "find location"
numa integrations request gohighlevel GET "/contacts/?locationId={loc}&limit=100" -m "list contacts"
# …page until found; match on name/email client-side
```

For ≤ a few thousand contacts, paged list + client-side match is reliable and avoids the unverified search shape. 3,000 contacts ≈ 30 pages at limit=100.

### "How many deals in the Sales pipeline, by stage?"

```
numa integrations request gohighlevel GET "/opportunities/pipelines?locationId={loc}" -m "list pipelines"
# pick the pipeline id by name; then
numa integrations request gohighlevel GET "/opportunities/search?location_id={loc}&pipeline_id={pid}&limit=100" -m "search deals"
```

`pipeline_id` filter [UNVERIFIED] — if rejected, search without it and group client-side by `pipelineId`/`stageId`. Map stage ids to names via the pipelines response.

### "Show the last messages with contact X"

```
numa integrations request gohighlevel GET "/conversations/search?locationId={loc}&contactId={contactId}" -m "find conversation"
# contactId filter [UNVERIFIED] — fall back to search + client-side match on contactId
numa integrations request gohighlevel GET /conversations/{convId}/messages -m "get messages"
```

### Full contact export (cursor drain)

```
loop:
  GET /contacts/?locationId={loc}&limit=100[&startAfter={t}&startAfterId={id}]   (Version header)
  append response.contacts to the workspace file
  t, id = response.meta.startAfter, response.meta.startAfterId
  stop when cursors absent/null or contacts == []
  sleep ~1s between pages
```

Write batches to a `/workdir` file as you go — don't hold tens of thousands of records in context.

### "Which contacts were added this week?"

No documented server-side date filter [UNVERIFIED — search may support one]; robust path is a cursor walk with client-side filtering:

```
numa integrations request gohighlevel GET "/contacts/?locationId={loc}&limit=100" -m "list contacts"
# inspect page 1: identify the created-date field (likely dateAdded [UNVERIFIED]) and whether
# results are ordered newest-first; if so, stop paging once records pre-date the window
```

If page 1 shows oldest-first (or no clear order), drain pages and filter — warn the user it may take a moment on large books; consider proposing a scheduled agent for recurring versions (see 01d).

## Query gotchas

1. **Version header omitted → request fails.** First thing to check on any 4xx.
2. **Missing `locationId` on a list → 4xx.** Second thing to check.
3. **`startAfter` is epoch milliseconds**, not seconds and not ISO. Pass `meta` values through verbatim — never compute your own cursor.
4. **Both cursors or neither.** Sending only `startAfter` without `startAfterId` may mis-page [UNVERIFIED] — always send the pair.
5. **403 on one family, 200 on another = scope gap**, not a broken connection. Tell the user which scope to add.
6. **Empty page ≠ error.** `[]` with 200 = no matches / end of data. Stop paging; don't retry.
7. **Deprecated ≠ broken:** `GET /contacts/` works today; prefer `/contacts/search` once its shape is validated.
8. **Server-side date filtering is unproven.** No documented `dateUpdated>=` filter found — change detection is cursor walks + client-side date comparison until search filters are validated [UNVERIFIED]. See 01d.
9. **Responses may differ per `Version` value** — pin one value per session; don't mix.
