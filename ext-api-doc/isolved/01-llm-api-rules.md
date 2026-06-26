---
api_name: isolved People Cloud
api_slug: isolved
base_url: https://{tenant}.myisolved.com/rest/api   (PER-TENANT — resolved from the admin's Instance URL; never a fixed global host)
path_version_segment: none confirmed; the base ends at /rest/api. Do NOT invent a /v1, /v2, etc. [VERIFY WITH PARTNER DOCS]
urls: prefer RELATIVE (`/employees?...`) so the connector expands them against the per-tenant base. If a relative call errors with "No base URL is configured for connector 'isolved'", the Instance URL isn't wired yet (see 03/04) — then pass the ABSOLUTE per-tenant URL `https://{tenant}.myisolved.com/rest/api/...`.
call_surface: HTTP via `numa integrations request` (connector=isolved). NOT a file-store connector; NOT MCP.
auth: OAuth2 CLIENT-CREDENTIALS — Numa mints a COMPANY-LEVEL Bearer token server-side from the admin's client_id/client_secret and re-mints on expiry. The agent NEVER sets Authorization and never sees the token. NO per-user OAuth, NO refresh token.
allowed_methods: isolved whitelists which methods/objects THIS integration may call, per-integration. Ungranted calls return 403/404 — that is a GRANT problem, not a retry problem.
field_casing: NOT confirmed — mirror whatever a live GET returns. The one corroborated filter is `employment_status=ACTIVE` (snake_case, uppercase value) [VERIFY WITH PARTNER DOCS].
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
confidence: auth model + host pattern + capability surface corroborated across third-party isolved integrators (Finch/Merge/CozyROC/RoboMQ); exact endpoint paths, the token path, scopes, pagination, and rate limits are behind isolved's login-walled /rest docs and are tagged [VERIFY WITH PARTNER DOCS]. NOT live-validated. Trust real responses over this file; never claim live-confirmed behaviour, and NEVER fabricate endpoint paths.
---

# isolved — API Rules

## Call mechanics (read first)

- Surface: `numa integrations request` with `connector="isolved"`, a `url`, a `method`. POST/PUT pass JSON `body` (single object); `Content-Type: application/json`.
- **Per-tenant base URL.** isolved is served at `https://{tenant}.myisolved.com` (e.g. `rkl.myisolved.com`, `aee.myisolved.com`). The admin sets the **Instance URL**; the API base is that host + **`/rest/api`**. There is **no fixed global host** — every tenant differs.
- **URLs:** prefer **relative** (`/employees?employment_status=ACTIVE`) so the connector expands them against the configured per-tenant base. If a relative call fails with **"No base URL is configured for connector 'isolved'"**, the Instance URL hasn't been wired into the vault yet — fall back to the **absolute** per-tenant URL (`https://{tenant}.myisolved.com/rest/api/...`) and flag the setup gap to the user (03/04).
- **Auth = OAuth2 client-credentials, server-side.** Numa POSTs the admin's company-level `client_id`/`client_secret` with `grant_type=client_credentials` to the token endpoint, gets a Bearer token, and injects `Authorization: Bearer {access_token}`. **NEVER set an Authorization header; you never see the token.** This is one **company-level** credential shared by all users — there is no per-user login, no consent screen, no refresh token.
- **Do NOT fabricate paths.** Exact endpoint paths and the token-endpoint path are **[VERIFY WITH PARTNER DOCS]**. Use only paths a user/partner-doc has confirmed, or that you've seen return 200. If you don't know the path, say so — don't guess `/rest/api/v2/...`.

## CAN (subject to the allowed-methods grant)

Read HCM records: **Employees** (filter e.g. `employment_status=ACTIVE`), **Payroll**, **Deductions**, **Benefit Enrollment**. Where the integration is granted write: create/maintain **new hires** (post as **Pending Employees**), **deductions**, **benefit elections/enrollment**. Run a connection sanity check via the smallest granted read (e.g. one page of employees).

## CANNOT

Set the `Authorization` header (backend-injected). Call any object/method **outside the integration's allowed-methods grant** (→ 403/404 — fix the grant, don't retry-loop). Assume a created employee is immediately **active** (new hires are **Pending**). Use a fixed/global base URL — it's per-tenant. **Fabricate endpoint paths or the token path** — they're walled `[VERIFY WITH PARTNER DOCS]`. Rely on JobAdder-style `>`/`<` date filters or any pagination scheme until confirmed.

## Critical Gotchas

1. **Per-tenant host.** Base = `https://{tenant}.myisolved.com/rest/api`. Never hardcode another tenant's host. If you somehow know the tenant, you still don't know the exact object paths — those are `[VERIFY WITH PARTNER DOCS]`.
2. **Allowed-methods whitelist is the dominant constraint.** isolved grants the partner integration a _specific set_ of methods/objects. An object existing in isolved does **not** mean this integration can call it. Ungranted → **403/404**. When you hit 403/404 on a sensible path, suspect the grant, not the path.
3. **Per-client grant + "Refresh System Data" must be done first.** For each customer Client Code, the isolved admin must add the partner user under **Security → Partner Users → Client Access** and run **Production Utilities → Refresh System Data**. Until then, calls against that Client Code 403/404. If _everything_ 403/404s for a client, this step is the prime suspect (see 04).
4. **New hires are Pending Employees.** Creating an employee does not produce an active employee — it posts a pending record finalised inside isolved. Report "created as pending", never "employee is now active".
5. **No per-user identity in calls.** The Bearer token is company-level. Results are not scoped to "the current user's" view the way a per-user OAuth API would be — they reflect what the _integration_ was granted on the Client Code.
6. **Client-credentials has no refresh token.** On token expiry Numa simply re-mints from the company `client_id`/`client_secret`. A 401 surfacing to you means the **mint itself failed** (bad/disabled client credential) — an admin problem, not a per-user reconnect (see 04).
7. **`employment_status=ACTIVE` is the ONE corroborated filter.** Its exact casing and the existence of any other filter/sort/pagination param are `[VERIFY WITH PARTNER DOCS]`. Treat other query params as unproven until a live 200 confirms them.

## Default Parameters (override only if the user specifies)

| Param               | Default                                | Reason                                                              |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `employment_status` | `ACTIVE` for employee lists            | users usually mean current employees [VERIFY casing/values]         |
| URL form            | relative (`/employees?...`)            | connector expands against the per-tenant base; absolute on fallback |
| Pagination          | read the first response envelope first | scheme unknown — don't assume offset/page/cursor [VERIFY]           |
| Pacing              | ≤ ~2 calls/sec, sequential             | limits unpublished — be conservative                                |

## Operations (corroborated surface; exact paths VERIFY WITH PARTNER DOCS — see 01a/01b/01c)

| Operation                        | Method       | Path (UNCONFIRMED — verify) | Notes                                                        |
| -------------------------------- | ------------ | --------------------------- | ------------------------------------------------------------ |
| Mint token (internal)            | POST         | `/rest/api/token` [VERIFY]  | `grant_type=client_credentials`; **Numa does this, not you** |
| List employees                   | GET          | `/employees` [VERIFY]       | filter `employment_status=ACTIVE`                            |
| Get employee                     | GET          | `/employees/{id}` [VERIFY]  | id shape [VERIFY]                                            |
| Create new hire                  | POST         | `/employees` [VERIFY]       | lands as a **Pending Employee**; write must be granted       |
| Read payroll                     | GET          | [VERIFY]                    | grant-gated                                                  |
| Read/maintain deductions         | GET/POST/PUT | [VERIFY]                    | grant-gated                                                  |
| Read/maintain benefit enrollment | GET/POST/PUT | [VERIFY]                    | grant-gated                                                  |

> Every path above is **unconfirmed**. If a user gives you a confirmed path from their isolved `/rest` docs, use it verbatim and prefer it over anything here.

## Pagination

**Unknown — [VERIFY WITH PARTNER DOCS].** Do not assume offset/limit, page-number, or cursor. On the first list call, inspect the response envelope for a `totalCount`/`next`/`page`/`hasMore`-style field and follow whatever it actually uses. Until confirmed, fetch one page, report what you got, and tell the user the full count is unconfirmed.

## Errors (full playbook in 01d)

| Status  | Meaning                                                                                         | Action                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 401     | token missing/expired/invalid; **the server-side client-credentials mint failed**               | not a per-user reconnect — an admin must check the company client_id/secret (04); do not retry blindly |
| 403     | method **not in the integration's allowed-methods grant**, OR per-client grant/Refresh not done | confirm the grant + the per-client access steps; do NOT retry-loop                                     |
| 404     | wrong/unconfirmed path, OR an **ungranted** object surfaced as not-found                        | verify the path against partner docs; suspect the grant before the URL                                 |
| 422/400 | validation/bad request                                                                          | fix the body/params; quote the error verbatim; don't retry unchanged                                   |
| 429     | rate limited (limits unpublished)                                                               | back off 2s→10s→30s; slow the session                                                                  |
| 5xx     | isolved-side error                                                                              | retry once after 5s; for writes, check first whether it landed (Pending!)                              |

## Examples

Call form (relative URL preferred; Numa expands it against the per-tenant base and injects the Bearer token):

`numa integrations request isolved GET "/employees?employment_status=ACTIVE" -m "list active employees"`

1. **Active employees** (the one corroborated filter):
   `GET /employees?employment_status=ACTIVE`
   → a page of employee objects (envelope/pagination shape [VERIFY]; mirror what you actually receive).

2. **Connection sanity check** — smallest granted read, e.g. one employee page:
   `GET /employees?employment_status=ACTIVE` → 200 = token mint + grant OK · 401 = mint failed (admin) · 403/404 = not granted / per-client setup missing.

3. **Create a new hire** (only if write is granted; confirm with the user first):
   `POST /employees` body `{ ...employee fields... }` → record created as a **Pending Employee**. Report "created as pending — finalise in isolved", never "active". (Field schema [VERIFY WITH PARTNER DOCS] — GET an existing employee and mirror its fields before composing the body.)

4. **If a relative call errors "No base URL is configured for connector 'isolved'"** → the Instance URL isn't wired (03/04). Retry once with the absolute per-tenant URL the admin gave you (`https://{tenant}.myisolved.com/rest/api/employees?...`) and tell the user the connector's Instance URL needs configuring.
