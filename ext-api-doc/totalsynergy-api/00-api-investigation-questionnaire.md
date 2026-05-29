---
api_name: 'Total Synergy (API Key)'
api_slug: 'totalsynergy-api'
vendor: 'Total Synergy Pty Ltd'
website: 'https://totalsynergy.com'
investigation_started: '2026-05-29'
investigator: 'Claude Code (doc-based investigation)'
investigation_status: 'blocked' # docs are partner/Swagger-SPA gated; field-level detail needs discovery
documentation_quality: 'poor' # public landing + FAQ are good; the reference itself is a JS-rendered Swagger SPA, mostly unreadable without a live key + tenant
api_types: [REST]
overall_confidence: 'medium'
integration_path: 'Direct API (spec-driven, chat-only)'
auth_type: 'api-key'
blockers:
  - 'No static API key / tenant available at research time — Phase 2 first-call gate NOT satisfied'
  - 'Reference docs (developers.totalsynergy.com/Documentation/* and /swagger/ui/index) render client-side; endpoint/field detail could not be scraped'
  - 'Registry collects an `instance_url` (placeholder `https://yourcompany.totalsynergy.com`), but the actual REST host is the shared `https://api.totalsynergy.com/api/v2/` and resources are scoped by an organisation `{Slug}` in the path — the instance_url is NOT the API base. Reconcile before building.'
---

# Total Synergy (API Key) — API Investigation Questionnaire

> **Confidence markers:** `[CONFIRMED]` = verified against a live API call · `[DOCUMENTED]` =
> stated in official Total Synergy docs / KB · `[INFERRED]` = deduced from conventions or partial
> docs · `[UNKNOWN]` = not yet established, discovery needed.
>
> ⚠️ **This is a documentation-based investigation.** No live Total Synergy call was made (no
> static API key or tenant slug available at research time). **Phase 2's "first successful call"
> gate is therefore NOT satisfied.** Every auth/format claim below is `[DOCUMENTED]` or
> `[INFERRED]`, never `[CONFIRMED]`. Items needing a live run are tagged **🔬 DISCOVER**.
>
> 📌 **Relationship to `totalsynergy-oauth`:** This is the **same vendor REST API** as the
> `totalsynergy-oauth` connector — `https://api.totalsynergy.com/api/v2/`, same resources
> (Projects, Contacts, Transactions/Invoices, Timesheets, Staff), same organisation-scoped paths,
> same `criteria.*` pagination, same rate limits, same error model, and — crucially — the **same
> `access-token` request header.** **The only difference is how the bearer credential is
> obtained:** a long-lived **static API key copied from the user's profile** here, vs. the OAuth2
> authorization-code flow there. The domain/query/mutation/pagination/error sections below are
> deliberately kept consistent with the OAuth doc; do not let them diverge. If you change one,
> change both.
>
> 🚩 **Registry vs. reality discrepancy (read before building).** The connector registry entry
> (`connectorRegistry.ts:589`) declares `authType: 'api-key'` and collects two credential fields:
> `api_key` (password) and `instance_url` (url, placeholder `https://yourcompany.totalsynergy.com`).
> The `api_key` part is correct and simple — but the `instance_url` is **misleading**: Total
> Synergy's REST API is served from the **shared host** `https://api.totalsynergy.com/api/v2/`,
> **not** from a per-tenant `*.totalsynergy.com` subdomain. Tenancy is expressed by an
> organisation **`{Slug}`** in the path (`…/Organisation/{Slug}/{Resource}`), not by the hostname.
> So either (a) `instance_url` should be reinterpreted/repurposed as the org slug (or a "my
> organisation" lookup should derive the slug from the key), or (b) the field is informational
> only and the connector hard-codes `api.totalsynergy.com`. **This must be reconciled before the
> connector can make a single call.** See Phase 2.

---

## Phase 1 — Information Sources

### 1.1 Primary Documentation

| Item                | Value                                                                             | Confidence   |
| ------------------- | --------------------------------------------------------------------------------- | ------------ |
| Vendor              | Total Synergy Pty Ltd — practice management for architecture & engineering firms  | [DOCUMENTED] |
| Marketing site      | https://totalsynergy.com/features-open-api/                                       | [DOCUMENTED] |
| Developer portal    | https://developers.totalsynergy.com/                                              | [DOCUMENTED] |
| Endpoint reference  | https://developers.totalsynergy.com/swagger/ui/index (v2), `/swagger/v4` (v4)     | [DOCUMENTED] |
| Per-resource docs   | https://developers.totalsynergy.com/Documentation/{Projects\|Timesheets\|...}     | [DOCUMENTED] |
| API FAQ (KB)        | https://help.totalsynergy.com/en/articles/8696457-api-faq                         | [DOCUMENTED] |
| Premium API (KB)    | https://support.totalsynergy.com/hc/en-us/articles/360001631275-Premium-API       | [DOCUMENTED] |
| API & Connect (KB)  | https://help.totalsynergy.com/en/collections/3530581-api-and-connect              | [DOCUMENTED] |
| Legacy support docs | https://support.totalsynergy.com/hc/en-us/articles/214508823                      | [DOCUMENTED] |
| Zapier integration  | https://help.totalsynergy.com/en/articles/8673421-integrating-zapier-with-synergy | [DOCUMENTED] |
| Changelog           | KB release notes (e.g. .../articles/9746982-synergy-release-17th-august-2024)     | [DOCUMENTED] |
| Status page         | Not located                                                                       | [UNKNOWN]    |

### 1.2 Supplementary Sources

| Item                  | Value                                                                  | Confidence    |
| --------------------- | ---------------------------------------------------------------------- | ------------- |
| OpenAPI / Swagger     | Swagger UI exists at `/swagger/ui/index`; raw JSON spec URL not found  | [INFERRED] 🔬 |
| Postman collection    | None located                                                           | [UNKNOWN]     |
| Official SDKs (Py/JS) | None located — REST only                                               | [UNKNOWN]     |
| Power BI / reporting  | `https://publicapi.totalsynergy.com/` is the Power BI / public surface | [DOCUMENTED]  |

### 1.3 Documentation Quality Assessment

| Area                      | Rating | Notes                                                                                       |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Authentication            | 4      | Static-key acquisition documented step-by-step (Profile settings → ellipsis → API Key)      |
| Endpoint reference        | 2      | Swagger UI exists but is a client-rendered SPA; not readable without a live key + tenant 🔬 |
| Request/response examples | 2      | A few examples in KB articles; full schemas behind the SPA                                  |
| Error documentation       | 2      | Status codes named (401/404/500); no error-body schema published                            |
| Rate limit documentation  | 4      | Clearly stated: 300/day standard, 50/day transactions; Premium 60k/20k                      |
| Pagination documentation  | 3      | `criteria.pagesize` (max 1000) documented; keyset variant mentioned but not detailed        |
| Webhook documentation     | 1      | None found — appears to be polling-only                                                     |
| SDKs / code examples      | 1      | No official SDKs                                                                            |
| Changelog / versioning    | 3      | KB release notes exist; v2 + v4 surfaces both live                                          |

**Overall documentation quality:** poor — the public _narrative_ docs (FAQ, static-key acquisition,
limits) are good, but the actual _reference_ (endpoints, fields, request/response schemas) is locked
behind a JS-rendered Swagger SPA that returns near-empty HTML to a scraper, and several
`/Documentation/*` pages 500/404 unauthenticated. **Field-level detail requires a live static key +
tenant to enumerate.**

### 1.4 Discovery Status

- [x] Found official API documentation (portal + KB)
- [ ] Found or confirmed no OpenAPI/Swagger spec — Swagger **UI** confirmed; raw spec URL not found 🔬
- [x] Identified authentication method (long-lived static API key in the `access-token` header)
- [x] Found at least one documented example (static-key acquisition; Projects/Timesheet endpoints by name)
- [x] Identified rate limit information (300/day; 50/day transactions; Premium 60k/20k)
- [x] Identified pagination approach (`criteria.pagesize`, max 1000; keyset on some endpoints)
- [x] Checked for webhook/event support — none found (polling only)
- [x] Checked for official SDKs — none

---

## Phase 2 — Authentication (HARD GATE — not satisfied; see warnings above)

> Total Synergy supports **static, long-lived API keys** as an alternative to its OAuth2 flow.
> Per the API FAQ: _"For customers wanting to build batch applications, internal applications or
> for testing before deployment, limited duration hard coded keys can be used for static
> integrations."_ This connector uses that static-key path — **much simpler than OAuth**: the user
> generates a key in their Synergy profile, pastes it into Numa, and it is sent verbatim on every
> call. There is **no authorize redirect, no code exchange, no refresh token.**

| Item                       | Value                                                                                                   | Confidence              |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------- |
| Auth standard              | Static API key ("hard coded key" for static integrations)                                               | [DOCUMENTED]            |
| Credential header          | **`access-token: {apiKey}`** on every API call — NOT `Authorization: Bearer`                            | [DOCUMENTED]            |
| How to obtain the key      | In Synergy: profile icon (top-right) → **Profile settings** → **ellipsis (⋯)** → **API Key**, then copy | [DOCUMENTED]            |
| Key options / lifetime     | **Two keys offered — a 1-year key and a 3-year key.** The key is the access token; no refresh.          | [DOCUMENTED]            |
| Key is the access token    | "copy the complete API key and use it as an access token" — the key IS the bearer value                 | [DOCUMENTED]            |
| Refresh mechanism          | **None.** When the key expires (after 1 or 3 yrs), the user must generate a **new** key and re-paste it | [DOCUMENTED]            |
| Scopes                     | **None.** No scope system — access is governed by the role of the user who issued the key               | [DOCUMENTED]            |
| Per-user vs. per-tenant    | Key is **personal** (issued from a user's profile); its data access = that user's Synergy permissions   | [DOCUMENTED]            |
| Key format / pattern       | Opaque string (exact length/charset unconfirmed) 🔬                                                     | [UNKNOWN] 🔬            |
| API base host              | `https://api.totalsynergy.com/api/v2/` (shared host — NOT the registry's per-tenant `instance_url`) 🚩  | [DOCUMENTED]            |
| Tenancy mechanism          | Organisation **`{Slug}`** in the path: `…/Organisation/{Slug}/{Resource}` — not the hostname            | [DOCUMENTED]            |
| Slug discovery             | Resolve via `GET /api/v2/Organisation` / `Organisation/MySlug` using the key                            | [DOCUMENTED]            |
| Registry credential fields | `api_key` (password) + `instance_url` (url) — `instance_url` is misleading; see registry note above 🚩  | [DOCUMENTED — registry] |
| Revocation                 | Implicitly: regenerate the key in profile, invalidating the old one (exact behaviour 🔬)                | [INFERRED] 🔬           |
| Rate limits per key        | Counted **per organisation**, not per key: 300/day (50/day transactions) standard; 60k/20k Premium      | [DOCUMENTED]            |

**Documented static-key flow (paraphrased from the API FAQ / support docs):**

```
1. The Synergy user generates a static key:
   Profile icon (top-right) → "Profile settings" → ellipsis (⋯) → "API Key".
   Two keys are offered with different expiries: 1 year and 3 years. Copy one.

2. Paste the key into Numa's "Total Synergy (API Key)" connector (the `api_key` field).

3. Every API call carries the key in a CUSTOM header (the key itself is the access token):
   GET https://api.totalsynergy.com/api/v2/Organisation/{Slug}/Projects
       access-token: <apiKey>
       Content-Type: application/json

4. There is NO refresh. When the key expires, generate a new one and re-paste it.
```

**Key contrast vs. `totalsynergy-oauth`:** identical wire calls (same host, same paths, same
`access-token` header), but the credential is a static key from the profile page instead of a token
minted by the `Oauth2/GetAccessToken` exchange. **None of the OAuth machinery (authorize redirect,
`ApplicationKey`/`ApplicationSecret`, `Oauth2/GetAccessToken`, `RefreshAccessToken`) applies to this
connector.** This makes the API-key connector the **lower-friction option**, and the natural
fallback for OAuth-averse tenants — at the cost of a manually rotated, longer-lived secret.

### 2.4 First Successful Call — CRITICAL GATE

- [ ] **GATE CHECK: NOT satisfied.** No static API key / tenant available; no live call made.

Smoke test to run once a static key + tenant slug are available (🔬 DISCOVER):

```http
GET /api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1 HTTP/1.1
Host: api.totalsynergy.com
access-token: <apiKey>
Content-Type: application/json
```

**Gotchas anticipated during setup:**

- The connector framework must send the credential in the **`access-token`** header, **not**
  `Authorization: Bearer`. A generic API-key adapter that defaults to `Authorization` (or to
  `X-API-Key`) will 401. 🚩
- The registry's `instance_url` is **not** the API base. Calls must go to `api.totalsynergy.com`,
  and the org `{Slug}` (a path value, distinct from any hostname) must be resolved/supplied. If a
  customer pastes `https://acme.totalsynergy.com` expecting it to be the API endpoint, requests
  will fail. Confirm how the slug is discovered (likely `GET /api/v2/Organisation` →
  "my organisations / MySlug"). 🔬 DISCOVER.
- Because the key is long-lived (1–3 yrs) and personal, treat it as a high-value secret in the
  vault; its data scope equals the issuing user's Synergy role. [INFERRED]

---

## Phase 3 — Domain Model & Behaviour

> Resources are **organisation-scoped**: most paths are `…/Organisation/{Slug}/{Resource}`.
> "Transactions" is Synergy's billing/financial surface and is where **invoices** and
> **timesheet entries** are written (the rate-limited "Transactions API"). Field-level schemas
> are behind the Swagger SPA — the fields below are **[INFERRED] from KB articles + UI naming**
> and must be confirmed against a live spec dump. 🔬 DISCOVER. (This section is identical to the
> `totalsynergy-oauth` doc — same product, same data model.)

| Entity          | Resource (path under `…/Organisation/{Slug}/`)    | CRUD (likely)         | Notes                                                                              | Confidence    |
| --------------- | ------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------- | ------------- |
| Project         | `Projects`                                        | Read (+ likely write) | Central job/engagement record; paged list returns `totalItems` + `items[]`         | [DOCUMENTED]  |
| Stage           | (sub of Project) `Stages`                         | Read                  | Project breakdown — referenced by `stageId` on timesheet entries                   | [INFERRED] 🔬 |
| Task            | (sub of Project/Stage) `Tasks`                    | Read                  | Referenced by `taskId` on timesheet entries                                        | [INFERRED] 🔬 |
| Contact         | `Contacts`                                        | Read (+ likely write) | People & organisations in the address book; searchable by `criteria.Id`            | [DOCUMENTED]  |
| Staff           | `Staff`                                           | Read                  | Internal employees/users; referenced by `staffId`                                  | [DOCUMENTED]  |
| Organisation    | `Organisation`, `Organisation/MySlug`             | Read                  | Tenant metadata; resolves the `{Slug}` used in every other path                    | [DOCUMENTED]  |
| Transaction     | `Transactions`                                    | Read + Create         | Billing/financial records — invoices live here; **rate-limited** (50/day standard) | [DOCUMENTED]  |
| Invoice         | (a Transaction type)                              | Read (+ create)       | Modelled as a Transaction; exact path/shape 🔬 DISCOVER                            | [INFERRED] 🔬 |
| Timesheet entry | `Transactions` (create) / `Timesheet/Week` (read) | Read + Create         | Created via the Transactions API; read via `Timesheet/Week`                        | [DOCUMENTED]  |
| Timer           | `Timers`                                          | Read + write          | Running/stored timers (referenced on the portal landing)                           | [DOCUMENTED]  |
| Leaderboard     | `Timesheet/Leaderboard`                           | Read                  | Aggregate timesheet metric                                                         | [DOCUMENTED]  |

**3.1 — Project (likely fields, [INFERRED] 🔬):**

| Field           | Type          | Required?    | Writable? | Notes                                          |
| --------------- | ------------- | ------------ | --------- | ---------------------------------------------- |
| `id`            | string / int  | —            | no        | Unique project id; queryable via `criteria.Id` |
| `name`          | string        | yes (create) | yes       |                                                |
| `projectNumber` | string        | —            | maybe     | Human-facing job number                        |
| `status`        | enum/string   | —            | yes       | e.g. active / on-hold / closed 🔬              |
| `clientId`      | string / int  | —            | yes       | FK → Contact (the client)                      |
| `createdDate`   | string (ISO?) | —            | no        | Date serialised as a string (see 3.5)          |

> All field names/types above are **[INFERRED]** — Synergy serialises strongly-typed values
> (e.g. dates) as **strings** in JSON, but exact key names and casing are unconfirmed. 🔬 DISCOVER.

### 3.2 Entity Relationships (inferred)

```
┌──────────────┐  1:N   ┌───────────┐  1:N   ┌────────┐  1:N   ┌───────┐
│ Organisation │───────▶│  Project  │───────▶│ Stage  │───────▶│ Task  │
│   ({Slug})   │        └───────────┘        └────────┘        └───────┘
└──────────────┘              │ N:1                                  ▲
       │ 1:N                  ▼                                      │ referenced by
       ▼                ┌───────────┐                               │
┌────────────┐         │  Contact   │◀── client                     │
│   Staff    │         │ (client)   │                               │
└────┬───────┘         └───────────┘                               │
     │ logs time                                                    │
     ▼                                                              │
┌──────────────────────────┐   creates   ┌──────────────────────────┐
│  Transactions API        │────────────▶│ Timesheet entry / Invoice │
│ (rate-limited 50/day std) │             │ (staffId, projectId,      │
└──────────────────────────┘             │  stageId, taskId, …)──────┘
```

### 3.3 State Machines

Project lifecycle (active → on-hold → closed/archived) is **[INFERRED]** from the product UI; the
exact enum values and allowed transitions are **[UNKNOWN]** and must be discovered from the spec. 🔬

### 3.4 Business Rules (inferred / documented)

- A **timesheet entry** must reference a valid `staffId` + `projectId` (and usually `stageId` /
  `taskId`) — these must exist first. [INFERRED] 🔬
- Timesheet/invoice creation goes through the **Transactions API**, which carries its **own,
  much tighter rate budget** (50/day standard, 20,000/day Premium). [DOCUMENTED]
- Resources are **tenant-isolated by `{Slug}`** — you cannot read across organisations with one
  key. [DOCUMENTED]
- The static key inherits the **issuing user's role/permissions** — data the user cannot see in
  the Synergy UI is not visible through their key. [DOCUMENTED]
- Dates are serialised/accepted as **strings** (and some endpoints use **integer-encoded dates**,
  e.g. `fromDateAsInt` / `toDateAsInt`). [DOCUMENTED / INFERRED] 🔬

### 3.5 Field Format Reference

| Format   | Pattern                                    | Example         | Notes                                                            | Confidence    |
| -------- | ------------------------------------------ | --------------- | ---------------------------------------------------------------- | ------------- |
| Date     | ISO-8601 string (serialised)               | `"2026-05-29"`  | "dates are serialized and delivered in string format"            | [DOCUMENTED]  |
| Int-date | `yyyymmdd`-style integer on some endpoints | `20260529`      | `fromDateAsInt` / `toDateAsInt` seen on timesheet/leave inputs   | [INFERRED] 🔬 |
| ID       | string or integer per resource             | `"12345"`       | Queryable via `criteria.Id`; exact type per resource unconfirmed | [INFERRED] 🔬 |
| Currency | decimal number                             | `1500.00`       | On Transactions/invoices                                         | [INFERRED] 🔬 |
| Slug     | org identifier string in path              | `acme-eng`      | `…/Organisation/{Slug}/…`                                        | [DOCUMENTED]  |
| API key  | opaque string (the access token)           | `<long string>` | Pasted into the `api_key` field; sent as `access-token` header   | [DOCUMENTED]  |

---

## Phase 4 — Endpoint Catalog

- **Base URL (prod):** `https://api.totalsynergy.com/api/v2/` [DOCUMENTED]
- **Base URL (v4 surface):** also live — `/swagger/v4` reference exists; v2 is the primary documented surface [DOCUMENTED]
- **Base URL (test/beta):** `https://betaapi.totalsynergy.com/` [DOCUMENTED]
- **Base URL (Power BI / public):** `https://publicapi.totalsynergy.com/` [DOCUMENTED]
- **Auth header:** `access-token: {apiKey}` on every call [DOCUMENTED]
- **Path pattern:** `/api/v2/Organisation/{Slug}/{Resource}` (most resources) [DOCUMENTED]

> ⚠️ The registry's `instance_url` (`https://yourcompany.totalsynergy.com`) is **not** the base
> URL. Calls go to the shared `api.totalsynergy.com` host with the org `{Slug}` in the path. 🚩

### 4.1 Critical Endpoints

#### GET `api/v2/Organisation/{Slug}/Projects` — list/search projects [DOCUMENTED path]

- **Auth:** required (`access-token: {apiKey}`)
- **Pagination:** `criteria.pagesize` (≤ 1000); page index param assumed `criteria.page` 🔬
- **Filter by id:** `criteria.Id` returns the single matching project [DOCUMENTED]

```http
GET /api/v2/Organisation/acme-eng/Projects?criteria.pagesize=50 HTTP/1.1
Host: api.totalsynergy.com
access-token: <apiKey>
Content-Type: application/json
```

**Success response (shape DOCUMENTED, fields INFERRED 🔬):**

```json
{
  "totalItems": 312,
  "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade", "status": "Active", "clientId": "551" }]
}
```

#### GET `api/v2/Organisation/{Slug}/Contacts` — list/search contacts [DOCUMENTED path]

- Same `criteria.pagesize` / `criteria.Id` query convention. Returns `totalItems` + `items[]`. 🔬

#### GET `api/v2/Organisation/{Slug}/Staff` — list staff [DOCUMENTED path]

- Used to resolve `staffId` for timesheet creation. 🔬

#### GET `api/v2/Organisation/{Slug}/Timesheet/Week` — weekly timesheet read [DOCUMENTED path]

- Read timesheet entries for a week. Query params (week-start, staff) 🔬 DISCOVER.

#### POST `api/v2/Organisation/{Slug}/Transactions` — create timesheet entry / invoice [DOCUMENTED resource; exact path 🔬]

- **Rate-limited:** counts against the Transactions budget (50/day std, 20k/day Premium). [DOCUMENTED]
- **Returns:** the created `timesheetId` (for timesheet entries). [DOCUMENTED]

```http
POST /api/v2/Organisation/acme-eng/Transactions HTTP/1.1
Host: api.totalsynergy.com
access-token: <apiKey>
Content-Type: application/json
```

```json
{
  "staffId": "88",
  "projectId": "10042",
  "stageId": "3",
  "taskId": "17",
  "fromDateAsInt": 20260526,
  "toDateAsInt": 20260526,
  "units": 7.5
}
```

```json
{ "timesheetId": "990123" }
```

> Field set above is **[INFERRED]** from KB naming (`staffId`, `projectId`, `stageId`, `taskId`,
> `fromDateAsInt`, `toDateAsInt`). The exact request path under Transactions, the units/hours
> field name, and the response envelope are **🔬 DISCOVER**.

#### GET `api/v2/Organisation/{Slug}/Timers` — timers [DOCUMENTED resource]

#### GET `api/v2/Organisation/MySlug` (or `/Organisation`) — resolve tenant slug [DOCUMENTED resource]

#### GET `api/v2/Organisation/{Slug}/Timesheet/Leaderboard` — timesheet leaderboard [DOCUMENTED resource]

### 4.2 Full Endpoint Index

> No `Oauth2/*` token endpoints apply to this connector — the static key is pasted directly. The
> data endpoints are identical to the OAuth connector.

| Method | Path (under `api/v2/`)                      | Purpose                        | Auth? | Pagination?         | Confidence    |
| ------ | ------------------------------------------- | ------------------------------ | ----- | ------------------- | ------------- |
| GET    | `Organisation` / `Organisation/MySlug`      | List tenants / resolve slug    | yes   | maybe               | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Projects`              | List/search projects           | yes   | `criteria.pagesize` | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Contacts`              | List/search contacts           | yes   | `criteria.pagesize` | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Staff`                 | List staff                     | yes   | `criteria.pagesize` | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Timesheet/Week`        | Weekly timesheet               | yes   | 🔬                  | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Timesheet/Leaderboard` | Timesheet leaderboard          | yes   | 🔬                  | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Timers`                | Timers                         | yes   | 🔬                  | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Transactions`          | List transactions/invoices     | yes   | keyset? 🔬          | [INFERRED] 🔬 |
| POST   | `Organisation/{Slug}/Transactions`          | Create timesheet entry/invoice | yes   | n/a                 | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Projects/{id}/Stages`  | Project stages                 | yes   | 🔬                  | [INFERRED] 🔬 |
| GET    | `Organisation/{Slug}/Projects/{id}/Tasks`   | Project tasks                  | yes   | 🔬                  | [INFERRED] 🔬 |

> **🔬 DISCOVER:** the full inventory must be enumerated from `/swagger/ui/index` (v2) and
> `/swagger/v4` against a live static key — the SPA returns near-empty HTML to a scraper, so this
> table is the documented/inferred subset, not the complete catalog.

---

## Phase 5 — Query & Filter Capabilities

| Capability                | Supported?     | Syntax                               | Confidence    |
| ------------------------- | -------------- | ------------------------------------ | ------------- |
| Filter by id              | Yes            | `?criteria.Id={id}`                  | [DOCUMENTED]  |
| Page size                 | Yes            | `?criteria.pagesize={n}` (max 1000)  | [DOCUMENTED]  |
| Page index / offset       | Likely         | `?criteria.page={n}` (param name) 🔬 | [INFERRED] 🔬 |
| Keyset pagination         | Yes (some EPs) | endpoint-specific; not detailed 🔬   | [DOCUMENTED]  |
| Filter by other fields    | Likely         | additional `criteria.*` params 🔬    | [INFERRED] 🔬 |
| Date-range filter         | Likely         | `criteria.*Date*` / `*AsInt` 🔬      | [INFERRED] 🔬 |
| Full-text search          | Unknown        | 🔬                                   | [UNKNOWN]     |
| Sort by field / direction | Unknown        | 🔬                                   | [UNKNOWN]     |
| Field selection / sparse  | Unknown        | 🔬                                   | [UNKNOWN]     |
| Include related records   | Unknown        | 🔬                                   | [UNKNOWN]     |

**General filter pattern (DOCUMENTED for `criteria.Id` / `criteria.pagesize`; rest INFERRED):**

```
GET /api/v2/Organisation/{Slug}/{Resource}?criteria.Id=123&criteria.pagesize=200
```

**🔬 DISCOVER:** the complete `criteria.*` parameter family (the biggest query gap), the
page-index parameter name, sort syntax, and which endpoints use keyset vs. `pagesize`.

### 5.6 Common Query Patterns

**Pattern 1 — get one project by id:**

```http
GET /api/v2/Organisation/{Slug}/Projects?criteria.Id=10042
```

**Pattern 2 — page through all contacts:**

```http
GET /api/v2/Organisation/{Slug}/Contacts?criteria.pagesize=1000      # page 1
GET /api/v2/Organisation/{Slug}/Contacts?criteria.pagesize=1000&criteria.page=2   # page 2 🔬
```

---

## Phase 6 — Pagination & Bulk

| Item                | Value                                                                      | Confidence    |
| ------------------- | -------------------------------------------------------------------------- | ------------- |
| Pagination model    | Offset/page via `criteria.pagesize` (+ page index); **keyset** on some EPs | [DOCUMENTED]  |
| Max page size       | **1000** records (for non-keyset endpoints)                                | [DOCUMENTED]  |
| Default page size   | Not documented — always send `criteria.pagesize` explicitly                | [UNKNOWN] 🔬  |
| Page index param    | Assumed `criteria.page` (spelling unconfirmed)                             | [INFERRED] 🔬 |
| Total count         | `totalItems` in the response envelope                                      | [DOCUMENTED]  |
| Items array         | `items[]`                                                                  | [DOCUMENTED]  |
| Last-page detection | `(page * pagesize) >= totalItems`, or `items` shorter than `pagesize`      | [INFERRED]    |
| Keyset endpoints    | Exist but unidentified; do **not** assume `pagesize` works on them         | [DOCUMENTED]  |

**Response envelope (DOCUMENTED shape):**

```json
{
  "totalItems": 312,
  "items": [
    /* … */
  ]
}
```

**Bulk operations:** None documented. Timesheet/invoice creation is one-at-a-time via the
Transactions API, which makes the **50/day standard transaction cap** the binding constraint for
any write-heavy use. [DOCUMENTED / INFERRED]

**🔬 DISCOVER:** default page size; exact page-index param; which endpoints are keyset and how
their cursors work.

---

## Phase 7 — Real-Time & Events

| Mechanism   | Supported? | Notes                   | Confidence |
| ----------- | ---------- | ----------------------- | ---------- |
| Webhooks    | No         | None found in portal/KB | [INFERRED] |
| WebSocket   | No         | —                       | [INFERRED] |
| SSE         | No         | —                       | [INFERRED] |
| Change feed | No         | —                       | [INFERRED] |

**Polling fallback:** Change detection is **polling-only**. Poll list endpoints and diff on a
date/modified field. Given the **300/day** standard cap (50/day for Transactions), polling must be
**low-frequency** unless the tenant has the Premium API add-on (60k/day, 20k/day transactions).
[DOCUMENTED rate limits / INFERRED strategy] 🔬 DISCOVER which field reliably exposes "modified
since".

---

## Phase 8 — Operational Concerns

### 8.1 Rate Limits

| Scope                       | Limit  | Window | Confidence   |
| --------------------------- | ------ | ------ | ------------ |
| All API calls (standard)    | 300    | / day  | [DOCUMENTED] |
| Transactions API (standard) | 50     | / day  | [DOCUMENTED] |
| All API calls (Premium)     | 60,000 | / day  | [DOCUMENTED] |
| Transactions API (Premium)  | 20,000 | / day  | [DOCUMENTED] |

- Limits are **per organisation** (not per key), set/raised via the Subscription page ("Premium
  API" add-on). Multiple static keys for the same org share one daily budget. [DOCUMENTED]
- **Rate-limit headers / exact 429 body:** not documented. 🔬 DISCOVER (whether limit is 429 or a
  bespoke status, and whether `Retry-After` is sent).
- **Backoff strategy:** because the budget is daily (not per-second), the practical mitigation is
  **call frugality + caching**, not tight retry loops. [INFERRED]

### 8.2 Error Handling

| HTTP Status | Meaning            | Retryable?   | Recovery                                      | Confidence    |
| ----------- | ------------------ | ------------ | --------------------------------------------- | ------------- |
| 200         | OK (JSON body)     | —            | —                                             | [DOCUMENTED]  |
| 401         | Unauthorized       | No\*         | Re-issue/replace the static key; check header | [DOCUMENTED]  |
| 404         | Not found          | No           | Verify slug / id                              | [DOCUMENTED]  |
| 500         | Internal error     | Yes          | Retry with backoff                            | [DOCUMENTED]  |
| 429 (?)     | Rate limit (daily) | Yes/next-day | Reduce call volume / buy Premium              | [INFERRED] 🔬 |

\* Unlike OAuth, a 401 here is **not** fixable by refreshing — there is no refresh flow. A 401
usually means the static key is **missing, expired (past its 1/3-yr life), wrong-cased in the
`access-token` header, or revoked**. Recovery = the user regenerates a key and re-pastes it.
[DOCUMENTED / INFERRED]

- **Error body schema:** **not published.** All responses are JSON, but the error envelope shape
  (code/message/details) is **[UNKNOWN]** — do not fabricate it; discover it by triggering errors. 🔬
- A common 401 cause is the key being sent under the wrong header (`Authorization` instead of the
  required **`access-token`**). [DOCUMENTED]

### 8.3 Idempotency

- GET is naturally idempotent. **POST to Transactions is NOT** — there is no documented idempotency
  key, so a retried timesheet/invoice POST risks duplicates **and** burns the tight transaction
  budget. Track created `timesheetId`s client-side before retrying. [INFERRED] 🔬

### 8.5 File Handling

- No general file upload/download surface identified (this is a practice-management data API, not a
  document store). Invoice PDFs/exports, if any, are 🔬 DISCOVER.

---

## Phase 9 — Platform Integration Assessment

### 9.1 Integration Path Decision

| Path                   | Fits? | Notes                                                                 |
| ---------------------- | ----- | --------------------------------------------------------------------- |
| Data Connector (Files) | No    | Not a file/document store — no browsable folders/files                |
| Data Connector         | No    | No file-like browsable content                                        |
| **Direct API Only**    | ✅    | Action/data-oriented: projects, contacts, invoices, timesheets, staff |
| Hybrid                 | No    | No file surface to pair with the API                                  |

**Selected integration path:** **Direct API (spec-driven, chat-only).** [DECISION]

**Justification:** Total Synergy exposes structured practice-management data (projects, contacts,
transactions/invoices, timesheets, staff), not browsable files/folders — so it is **not** a
Files-Remote connector. It is the **same product and integration shape as `totalsynergy-oauth`**;
only the credential acquisition differs (long-lived static key here vs. OAuth there). It mirrors
the Actionstep / NetSuite / Zoho pattern: a connector whose specs live in `ext-api-doc/` and are
read by the workspace agent via the existing `connect_request` path — **no `lib/oauth-providers/`
provider class** is needed. `surfaces: ['chat']`.

> ✅ **Why this connector is the _simpler_ of the two Total Synergy variants:** the static-key path
> sidesteps the entire non-standard OAuth flow that makes `totalsynergy-oauth` fragile (custom
> authorize params, `api/v2/Oauth2/GetAccessToken` token endpoint, refresh handling). Here the
> credential is one pasted string. The **only** non-standard requirement the framework must honour
> is the **`access-token` header** (not `Authorization: Bearer`) and the **`api.totalsynergy.com`
> host + org `{Slug}` path** (not the registry's `instance_url`). For OAuth-averse or
> batch/internal-tooling tenants, **steer customers to this connector.**

### 9.3 Workspace Agent Capabilities

**CAN do (in scope):**

1. List / search Projects, Contacts, Staff (read), with id and `pagesize` filtering.
2. Read timesheets (`Timesheet/Week`, Leaderboard) and Timers.
3. Read Transactions/invoices; **create** timesheet entries / invoices via the Transactions API
   (sparingly — tight daily cap).

**CANNOT do (out of scope / dangerous):**

1. High-frequency polling or bulk sync — the **300/day (50/day transactions)** standard cap makes
   this impractical without the Premium add-on. The key is per-user but the budget is per-org, so
   multiple keys do not help.
2. Cross-organisation queries — every call is scoped to one `{Slug}`, and the key's data scope is
   the issuing user's role.
3. Blind retries of Transaction POSTs — no idempotency key; risks duplicate invoices/entries and
   exhausts the transaction budget.

**Default parameters:**

| Parameter           | Default                 | Reason                                                   |
| ------------------- | ----------------------- | -------------------------------------------------------- |
| `criteria.pagesize` | 200 (read), 1000 (sync) | Stay well under the 1000 max while minimising call count |
| API version         | `v2`                    | Primary documented surface                               |
| API host            | `api.totalsynergy.com`  | Shared host; NOT the registry `instance_url`             |
| Token header        | `access-token`          | Vendor-mandated; NOT `Authorization: Bearer`             |

### 9.4 SDK Assessment

No official SDKs. REST + raw HTTP only. [UNKNOWN/none]

---

## Phase 10 — Generation Instructions

### 10.1 Readiness Checklist

- [x] Phase 1 — sources identified, quality assessed (reference is SPA-gated)
- [ ] **Phase 2 — first successful live call: NOT DONE (no static key/tenant)** 🔬🚩
- [x] Phase 2 — auth documented (static-key acquisition, `access-token` header, 1/3-yr lifetime, no refresh) + registry `instance_url` discrepancy flagged
- [~] Phase 3 — core entities catalogued (field-level detail INFERRED, needs spec dump) 🔬
- [~] Phase 4 — documented endpoints listed; full catalog needs Swagger enumeration 🔬
- [x] Phase 5 — `criteria.Id` / `criteria.pagesize` documented; full filter family pending 🔬
- [x] Phase 6 — pagination model documented with envelope + max page size
- [x] Phase 7 — event support assessed (none; polling only)
- [x] Phase 8 — rate limits documented; error-body schema pending 🔬
- [x] Phase 9 — integration path selected + justified (simpler than OAuth variant)

**Overall investigation confidence:** **medium** — the static-key auth model, rate limits,
pagination, base URL, and resource set are well-established from official docs; endpoint paths and
field schemas are partly inferred because the reference is a JS-rendered Swagger SPA. Auth
confidence is _higher_ than the OAuth variant (the static-key flow is simple and unambiguous), but
the shared data-model gaps keep the overall rating at medium.

**Known gaps that will reduce output quality:**

1. **Registry `instance_url` does not match the real API base** (shared host + org slug). #1 fix. 🚩
2. Confirm the framework can send the credential in a custom **`access-token`** header. 🚩
3. Field-level schemas for every entity (behind the Swagger SPA). 🔬
4. Error-response body shape and exact 429/rate-limit behaviour (headers, `Retry-After`). 🔬
5. Complete `criteria.*` filter family, page-index param name, and which endpoints are keyset. 🔬
6. Exact Transactions create path + request/response for invoices vs. timesheet entries. 🔬
7. Exact static-key format/length and revocation behaviour on regeneration. 🔬

### 10.3 Confidence Report

| Output Document              | Can Generate? | Confidence | Gaps                                                          |
| ---------------------------- | ------------- | ---------- | ------------------------------------------------------------- |
| 01-llm-api-rules             | Yes           | Medium     | Auth header + rate limits solid; endpoint detail inferred     |
| 01a-domain-model-reference   | Partial       | Low-Med    | Entities known; fields inferred — needs spec dump             |
| 01b-query-patterns           | Partial       | Medium     | `criteria.Id`/`pagesize` solid; full filter family unknown    |
| 01c-mutation-patterns        | Partial       | Low-Med    | Transactions create shape inferred                            |
| 01d-event-and-error-handling | Partial       | Medium     | No webhooks (clear); error body schema unknown                |
| 02-api-spec-investigation    | Partial       | Medium     | Documented subset only until Swagger is enumerated            |
| 03-connector-setup           | Yes           | Medium     | Path decided; must document `access-token` header + host/slug |

---

## Appendix — Discovery Playbook (what to run with a live static key)

1. In Synergy: Profile settings → ellipsis (⋯) → **API Key** → copy the 1-year or 3-year key.
2. Resolve the org `{Slug}` (`GET /api/v2/Organisation` / `Organisation/MySlug`) with
   `access-token: <apiKey>`.
3. Smoke test: `GET /api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1` with the
   `access-token` header → satisfies the Phase 2 gate.
4. Open `/swagger/ui/index` (v2) and `/swagger/v4` **in an authenticated browser**, export the
   OpenAPI JSON, and backfill: full endpoint list, every entity's fields/types/casing, the
   complete `criteria.*` family, keyset vs. pagesize endpoints, and the Transactions create
   request/response.
5. Trigger errors (bad/expired key, bad id, exceed transaction cap) to capture the real error-body
   schema and rate-limit response (status, headers, `Retry-After`).
6. Confirm the static-key format/length, and whether regenerating a key in the profile immediately
   revokes the prior key.
7. Confirm whether the registry `instance_url` field should be repurposed as the org slug or dropped
   in favour of a `MySlug` lookup.
