---
api_name: Actionstep
api_slug: actionstep
base_url: dynamic — the api_endpoint returned in the OAuth token response (region-specific); NEVER hard-code a *.actionstep.com host
route_prefix: /api/rest
path_construction: "{api_endpoint}/api/rest/{resource}"  (e.g. https://ap-southeast-2.actionstep.com/api/rest/actions)
path_version_segment: none — "v1"/"v2" are content-type/label only, NEVER a path segment; /v1/... and /v2/... do NOT exist
api_variant: v1 (Content-Type application/vnd.api+json) is the full surface — USE v1; v2 (plain JSON) covers only Matters/FileNotes/Tags — skip unless told
auth: Bearer {token} (OAuth2 authorization-code, user-context only; managed by Numa connector layer)
field_casing: camelCase
id_format: integer (numeric, not opaque)
rate_limit: 429 live since Apr 2024; thresholds unpublished — back off on 429
call_surface: HTTP via `numa integrations request`. Direct-API spec-driven connector, surfaces=['chat']. NOT a file-browse connector — does NOT support list-files/search-files/download-file.
vocabulary: matter/case = Action (resource `actions`); contact = Participant (resource `participants`); time entry resource `timeentries`
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
confidence: doc-based research 2026-05-27, no live call yet — items tagged 🔬 are SANDBOX-CONFIRM (verify against a live org before trusting)
---

# Actionstep — API Rules

Legal practice management. Matters = **Actions**, contacts = **Participants**.

## Paths (read first)

- Full URL = `{api_endpoint}/api/rest/{resource}`. `api_endpoint` = the region host from the OAuth token response — always use the connector's stored value; a hard-coded `*.actionstep.com` host fails for other regions.
- NO version segment. "v1"/"v2" are API variants (content-type/label), never `/v1/` or `/v2/` → those 404. Path examples: `/api/rest/actions`, `/api/rest/actions/123`, `/api/rest/timeentries`.
- Use **v1** (`application/vnd.api+json`) — full surface. v2 (plain JSON) only covers Matters/FileNotes/Tags; skip unless told.

## Auth

Headers (v1):

```
Authorization: Bearer <access_token>
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json
```

- OAuth2 authorization-code, **user-context only** — no machine-to-machine / service-account mode.
- Access token 8h; refresh token 21 days and **rotates** on every refresh (persist the new one). Refresh: `POST https://api.actionstep.com/api/oauth/token`.

## CAN

Read + create + update: matters (`actions`), contacts (`participants`), time entries (`timeentries`), file notes (`filenotes`), tasks (`tasks`), bills (`bills`), documents (`actiondocuments`). DELETE per-resource. Subscribe to change events via RestHooks (24 event types — see 01d).

## CANNOT

- Act without a user (no service-account mode).
- Use a fixed base URL (per-region `api_endpoint`).
- Page > 200 (`pageSize` hard cap 200, default 50).

## Gotchas

1. **Base URL is dynamic** — use stored `api_endpoint`; hard-coded host fails cross-region.
2. **Matters are `actions`, time is `timeentries`** — no `matters` endpoint on v1.
3. **Content-Type `application/vnd.api+json`** on v1, not plain `application/json`.
4. **Responses are resource-keyed objects, not bare arrays:** records sit under a key named after the resource. Read `response["actions"]`, NOT `response[0]`. Related data under `linked`/`links`; pagination under `meta.paging.{resource}` (keyed by resource name, not a flat `paging`).
5. **Write bodies are resource-keyed too:** wrap the payload under the resource name → `{"timeentries":{...}}`. A bare `{...}` body is rejected.
6. **v1 uses PUT for updates** (not PATCH — 🔬 confirm PATCH support). If a partial PUT isn't honoured it can blank omitted fields → GET-merge-PUT.
7. **Writes are user-scoped:** a 403 = the connected user lacks permission, not a bad token.
8. **Filter/sort/sideload param names are under-documented** (🔬). Don't assume `?status=Active` works; page through and filter client-side until verified.
9. **Errors are under a top-level `errors` key** (success bodies are resource-keyed) — detect errors by presence of `errors`, not by array-vs-object shape.

## Defaults (override only if user specifies)

`pageSize=50` (raise toward 200 for bulk reads), `page=1` (1-based), API variant=v1.

## Operations

| Operation         | Method | Path                      | Key params / notes                                   |
| ----------------- | ------ | ------------------------- | ---------------------------------------------------- |
| List matters      | GET    | /api/rest/actions         | page, pageSize; resource-keyed response              |
| Get matter        | GET    | /api/rest/actions/{id}    | `linked` for related records                         |
| Create matter     | POST   | /api/rest/actions         | resource-keyed body                                  |
| Update matter     | PUT    | /api/rest/actions/{id}    | full record (GET-merge-PUT)                          |
| Delete matter     | DELETE | /api/rest/actions/{id}    | dangerous — confirm with user                        |
| List contacts     | GET    | /api/rest/participants    | page, pageSize                                       |
| List time entries | GET    | /api/rest/timeentries     | filter by matter: `?action={id}` (param spelling 🔬) |
| Create time entry | POST   | /api/rest/timeentries     | body `{action, minutes, note, date}` — fields 🔬     |
| Add file note     | POST   | /api/rest/filenotes       | body `{action, text}`                                |
| Create task       | POST   | /api/rest/tasks           | body `{name, ...}`; `action` optional                |
| List bills        | GET    | /api/rest/bills           | per-matter `?action={id}`                            |
| Documents         | GET    | /api/rest/actiondocuments | upload mechanism 🔬                                  |
| Matter config     | GET    | /api/rest/actiontypes     | step graph per ActionType                            |
| Subscribe event   | POST   | /api/rest/resthooks       | `{eventName, targetUrl}`; target must return 200     |

Example webhook events: `ActionCreated` (matter created), `TimeEntryCreated` (time logged), `FileNoteCreated` (file note added) — payload shape 🔬. Full 24-event catalog in 01d.

## Pagination

Page-number. Default 50, **max 200** (clamped/rejected above). `?page=1&pageSize=200` then `page=2`… Last page when `meta.paging.{resource}.nextPage === null`. Total via `meta.paging.{resource}.recordCount`/`.pageCount`.

## Errors

Format: `{"errors":{"id","status","code":"AS-TBC","title","detail","source":{"pointer","parameter"}}}` (codes prefixed `AS-`). Per-resource validation codes: `A01–A02` (actions), `P01–P03` (participants), `T01–T11` (tasks), `TR01–TR05` (time records).
Recovery: 400 fix body/params · 401 refresh token then retry once · 403 check user permissions/scopes · 404 verify id + region base URL · 409 re-read then retry · 422 read `code`/`source`, fix fields · 429 exponential backoff + jitter (limits session/orgkey-based — serialise bursty work) · 5xx exponential backoff (≤3).

## Examples

1. List matters:
   `GET {api_endpoint}/api/rest/actions?page=1&pageSize=50`
   → `{"actions":[{"id":123,"name":"Smith v Jones","status":"Active"}],"meta":{"paging":{"actions":{"recordCount":1,"pageCount":1,"page":1,"pageSize":50,"prevPage":null,"nextPage":null}}}}`

2. Get matter + related contacts:
   `GET {api_endpoint}/api/rest/actions/123`
   → `{"actions":{"id":123,"name":"Smith v Jones"},"linked":{"participants":[{"id":9,"displayName":"Jane Smith"}]},"links":{"actions.participants":{"href":"/api/rest/participants/{actions.participants}"}}}`

3. Log a time entry (`POST /api/rest/timeentries`, body resource-keyed):
   `{"timeentries":{"action":123,"minutes":30,"note":"Drafted advice","date":"2026-05-27"}}`
   → 201 `{"timeentries":{"id":555,"action":123,"minutes":30,"note":"Drafted advice"}}`
   🔬 Confirm whether duration is `minutes`/`units`/`hours` before trusting totals.
