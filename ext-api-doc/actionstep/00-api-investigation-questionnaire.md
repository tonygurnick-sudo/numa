---
api_name: 'Actionstep'
api_slug: 'actionstep'
researcher: 'Claude Code (doc-based investigation)'
date_researched: '2026-05-27'
integration_path: 'Direct API (spec-driven, chat-only)'
auth_type: 'oauth2'
---

# Actionstep — API Investigation Questionnaire

> **Confidence markers:** `[CONFIRMED]` = verified against a live API call · `[DOCUMENTED]` =
> stated in official Actionstep docs · `[INFERRED]` = deduced from conventions/partial docs ·
> `[UNKNOWN]` = not yet established.
>
> ⚠️ **This is a documentation-based investigation.** No live Actionstep sandbox call was made
> (no API credentials available at research time). **Phase 2's "first successful call" gate is
> therefore NOT satisfied** — every auth/format claim below is `[DOCUMENTED]` or `[INFERRED]`,
> not `[CONFIRMED]`. A developer with a sandbox must run the Phase 2 smoke test before this
> connector is trusted in production. Items needing live confirmation are tagged
> **🔬 SANDBOX-CONFIRM**.

---

## Phase 1 — Documentation Discovery

| Item             | Value                                                                     | Confidence   |
| ---------------- | ------------------------------------------------------------------------- | ------------ |
| Vendor           | Actionstep Pty Ltd (legal practice management SaaS)                       | [DOCUMENTED] |
| Primary docs     | https://docs.actionstep.com/                                              | [DOCUMENTED] |
| Legacy API guide | https://actionstep.atlassian.net/wiki/spaces/API                          | [DOCUMENTED] |
| v2 API reference | https://docs.actionstepdev.com/                                           | [DOCUMENTED] |
| OpenAPI/Swagger  | Per-endpoint OpenAPI YAML specs published; no single aggregate spec found | [DOCUMENTED] |
| Auth docs        | https://docs.actionstep.com/authentication/                               | [DOCUMENTED] |
| Scopes           | https://docs.actionstep.com/api-scopes/                                   | [DOCUMENTED] |
| RestHooks        | https://docs.actionstep.com/webhooks/                                     | [DOCUMENTED] |
| Errors           | https://docs.actionstep.com/error-codes/ , /api-responses/                | [DOCUMENTED] |
| Rate limits      | https://docs.actionstep.com/api-limits/                                   | [DOCUMENTED] |

**Two API versions exist:** v1 (full-featured, `application/vnd.api+json`) and v2 (cleaner JSON,
currently a partial surface — Matters/FileNotes/Tags). This package targets **v1** as the
primary surface because it is feature-complete. [DOCUMENTED]

---

## Phase 2 — Authentication (HARD GATE — not satisfied, see warning above)

| Item                    | Value                                                                                                 | Confidence   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------ |
| Auth standard           | OAuth 2.0, Authorization Code grant **only**                                                          | [DOCUMENTED] |
| Machine-to-machine      | Not supported — every call runs under a user's security context                                       | [DOCUMENTED] |
| Authorize URL (prod)    | `https://go.actionstep.com/api/oauth/authorize`                                                       | [DOCUMENTED] |
| Token URL (prod)        | `https://api.actionstep.com/api/oauth/token`                                                          | [DOCUMENTED] |
| Authorize URL (staging) | `https://go.actionstepstaging.com/api/oauth/authorize`                                                | [DOCUMENTED] |
| Token URL (staging)     | `https://api.actionstepstaging.com/api/oauth/token`                                                   | [DOCUMENTED] |
| Scope format            | Space-separated resource names; `all` wildcard available                                              | [DOCUMENTED] |
| PKCE                    | Not documented as required                                                                            | [INFERRED]   |
| Access token            | JWT bearer, `expires_in` = 28800s (8 hours)                                                           | [DOCUMENTED] |
| Refresh token           | 21-day lifetime; refresh returns a **new** refresh token (rotation)                                   | [DOCUMENTED] |
| `api_endpoint`          | Returned in token response — region-specific REST base URL; **use it as the base for every API call** | [DOCUMENTED] |
| `orgkey`                | Returned in token response — unique organisation identifier                                           | [DOCUMENTED] |

**Token response (documented shape):**

```json
{
  "access_token": "<JWT>",
  "token_type": "bearer",
  "expires_in": 28800,
  "refresh_token": "<token>",
  "api_endpoint": "https://ap-southeast-2.actionstep.com",
  "orgkey": "<org>"
}
```

**🔬 SANDBOX-CONFIRM:** exact `api_endpoint` host values per region; whether `token_type` is
returned lowercase `bearer`; whether scopes are echoed in the token response.

---

## Phase 3 — Domain Model & Behaviour

Core entities (Actionstep calls matters "Actions"). [DOCUMENTED] from /endpoint-resources/:

| Entity          | Resource                                                                 | Notes                              |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| Matter          | `actions`                                                                | The central case/matter record     |
| Contact         | `participants`                                                           | People and organisations           |
| Time entry      | `timeentries` (v1) / `timerecords` (scope name)                          | Recorded time/units                |
| File note       | `filenotes`                                                              | Notes attached to a matter         |
| Task            | `tasks`                                                                  | To-dos/assignments                 |
| Bill            | `bills`                                                                  | Billing records                    |
| Document        | `actiondocuments`                                                        | Documents stored against a matter  |
| Matter type     | `actiontypes`                                                            | Configuration of matter categories |
| Step            | `steps` / `StepChanged` event                                            | Workflow stage of a matter         |
| Data collection | `datacollections`, `datacollectionrecords`, `datacollectionrecordvalues` | Custom data fields                 |
| RestHook        | `resthooks`                                                              | Webhook subscriptions              |

Full field-level catalog is in `01a-domain-model-reference.md`. **🔬 SANDBOX-CONFIRM:**
field-level detail per resource (download the per-endpoint OpenAPI YAMLs against a sandbox).

---

## Phase 4 — Endpoint Catalog

- **Base path:** `{api_endpoint}/api/rest/{resource}` (v1). [DOCUMENTED — resthooks path confirms `/api/rest/`]
- **Content type:** `application/vnd.api+json` (v1). [DOCUMENTED]
- Standard REST verbs per resource: `GET /{resource}`, `GET /{resource}/{id}`,
  `POST /{resource}`, `PUT /{resource}/{id}`, `DELETE /{resource}/{id}`. [INFERRED from REST + resthooks CRUD]

See `02-api-spec-investigation.md` for the full catalog.

---

## Phase 5 — Query & Filter Capabilities

| Capability                               | Supported                        | Confidence    |
| ---------------------------------------- | -------------------------------- | ------------- |
| Resource-keyed list responses            | Yes                              | [DOCUMENTED]  |
| Related records via `linked` / `links`   | Yes (JSON-API-style sideloading) | [DOCUMENTED]  |
| Field/relationship sideloading parameter | Yes (e.g. `include`-style)       | [INFERRED] 🔬 |
| Filter by field value                    | Yes                              | [INFERRED] 🔬 |
| Sort                                     | Yes                              | [INFERRED] 🔬 |
| Full-text search                         | Partial / resource-specific      | [UNKNOWN] 🔬  |

**🔬 SANDBOX-CONFIRM:** exact filter/sort/sideload query-parameter names and operator syntax —
these are the biggest documentation gap. Document them from a live sandbox before relying on
filtered queries. See `01b-query-patterns.md`.

---

## Phase 6 — Pagination & Bulk

| Item                | Value                                                                                             | Confidence                                               |
| ------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Pagination model    | Page-number                                                                                       | [DOCUMENTED]                                             |
| Default page size   | 50                                                                                                | [DOCUMENTED]                                             |
| Max page size       | 200 (`pageSize` limit)                                                                            | [DOCUMENTED]                                             |
| Paging params       | `page`, `pageSize`                                                                                | [DOCUMENTED — pageSize] / [INFERRED — param spelling] 🔬 |
| Paging metadata     | `meta.paging.{resource}` → `recordCount`, `pageCount`, `page`, `pageSize`, `prevPage`, `nextPage` | [DOCUMENTED]                                             |
| Last-page detection | `nextPage == null`                                                                                | [DOCUMENTED]                                             |

---

## Phase 7 — Real-Time & Events

- **RestHooks (webhooks): supported.** [DOCUMENTED]
- Subscribe: `POST /api/rest/resthooks` with `{"resthooks": {"eventName": "...", "targetUrl": "..."}}`. [DOCUMENTED]
- Manage: `GET`/`PUT`/`DELETE /api/rest/resthooks/{id}`. [DOCUMENTED]
- **24 event types** (ActionCreated, ActionUpdated, TaskCreated, TimeEntryCreated, FileNoteCreated, ParticipantCreated, StepChanged, …). [DOCUMENTED] — full list in `01d`.
- Target URL **must return HTTP 200** or the hook is disabled. [DOCUMENTED]
- **🔬 SANDBOX-CONFIRM:** the webhook payload body shape (not documented), and whether any
  signature/verification header is sent.

---

## Phase 8 — Operational Concerns

| Item                   | Value                                                                                       | Confidence   |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------ |
| Rate limiting          | HTTP 429; live since April 2024                                                             | [DOCUMENTED] |
| Limit basis            | user/session + `orgkey` + IP; **exact thresholds not published**                            | [DOCUMENTED] |
| Retry guidance         | exponential backoff                                                                         | [DOCUMENTED] |
| `Retry-After` header   | not documented                                                                              | [UNKNOWN] 🔬 |
| Error envelope         | `{"errors": {id, status, code, title, detail, source, links, meta}}`                        | [DOCUMENTED] |
| Validation error codes | per-resource (A01–A02 actions, P01–P03 participants, T01–T11 tasks, TR01–TR05 time records) | [DOCUMENTED] |

---

## Phase 9 — Integration Path

**Selected: Direct API (spec-driven, chat-only).** [DECISION]

Justification: Actionstep exposes structured legal-practice data (matters, contacts, time,
billing), not browsable files/folders, so it is **not** a Files-Remote connector. It mirrors
the NetSuite / simPRO / Zoho pattern: an OAuth2 connector whose specs live in `ext-api-doc/`
and are read by the workspace agent — **no `lib/oauth-providers/` provider class**. The agent
calls the API via the existing connector request path; `surfaces: ['chat']`.

---

## Phase 10 — Readiness Checklist

- [x] Documentation located (Phase 1)
- [ ] **Phase 2 first successful live call — NOT DONE (no sandbox creds)** 🔬
- [x] Auth flow documented (URLs, grants, token lifecycle)
- [x] Core entities catalogued (field detail pending sandbox) 🔬
- [x] Pagination model documented with worked metadata example
- [x] Webhook events catalogued (payload shape pending sandbox) 🔬
- [x] Error envelope documented
- [x] Rate-limit behaviour documented (thresholds unpublished) 🔬
- [x] Integration path selected + justified
- [x] Registry / scope-picker / native-connector wiring implemented (see `03`)

**Top unknowns blocking full production trust (all need a sandbox):**

1. Webhook payload body format + any signature header.
2. Exact filter / sort / sideload query-parameter syntax.
3. Field-level detail per resource (from per-endpoint OpenAPI YAMLs).
4. Exact rate-limit thresholds and whether `Retry-After` is sent.
