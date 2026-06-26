---
api_name: isolved People Cloud API
api_slug: isolved
base_url: https://{tenant}.myisolved.com/rest/api   (PER-TENANT — from the admin's Instance URL)
path_version_segment: none confirmed; base ends at /rest/api [VERIFY WITH PARTNER DOCS]
account_base_override: every tenant has its OWN host ({tenant}.myisolved.com); the admin supplies the Instance URL
urls: relative preferred through the connector (`/employees`); absolute per-tenant on fallback (see 03 §wiring)
call_surface: HTTP via `numa integrations request` (connector=isolved); native data connector, authType oauth2 + oauthAdapter 'isolved' (client-credentials) + instanceUrlRequired — NOT Pipedream, NOT a Files connector
auth: OAuth 2.0 CLIENT-CREDENTIALS ONLY — company-level service credential; NO per-user OAuth, NO refresh token
spec_format: none (no public OpenAPI/Swagger/Postman)
docs_url: per-tenant /rest reference, LOGIN-WALLED behind isolved Network partner access
date_researched: 2026-06-26
confidence: NO AUTHENTICATED CALL was made (no partner credentials; authoritative /rest docs login-walled). Auth model + host pattern + capability surface corroborated across third-party integrators (Finch/Merge/CozyROC/RoboMQ). Exact endpoint paths, the token path, scopes, pagination, rate limits, and error bodies are [VERIFY WITH PARTNER DOCS] / [UNKNOWN]. Inline tags: [CORROBORATED]=agreed across ≥2 integrator docs; [PARTNER-DOC]=one source/partner material; [VERIFY WITH PARTNER DOCS]=authoritative answer walled; [UNKNOWN]=not found.
---

# isolved — API Specification & Investigation

Developer reference for the isolved People Cloud REST API, condensed from
`00-api-investigation-questionnaire.md`. Sources: third-party isolved integrator docs (Finch, Merge,
CozyROC SSIS templates, RoboMQ) + isolved Network partner material. The authoritative endpoint
reference is the per-tenant `/rest` docs, **login-walled behind isolved Network partner access**.

## Overview

- **Vendor/product:** isolved — HCM/payroll/HR/benefits/time platform, sold through a partner
  network. [CORROBORATED]
- **API style:** REST, JSON. [CORROBORATED]
- **Base URL:** **per-tenant** — `https://{tenant}.myisolved.com/rest/api` (e.g.
  `rkl.myisolved.com`, `aee.myisolved.com`). The admin supplies the Instance URL; the API base is
  that host + `/rest/api`. [CORROBORATED host pattern; `/rest/api` suffix VERIFY]
- **Auth:** OAuth 2.0 **client-credentials** only — a **company-level** `client_id`/`client_secret`
  mints a Bearer token server-side; **no per-user OAuth, no refresh token.** [CORROBORATED]
- **Token endpoint:** `{instance}/rest/api/token` — **exact path [VERIFY WITH PARTNER DOCS]**.
- **Scopes / allowed methods:** isolved whitelists, per integration, which methods/objects are
  callable; ungranted → 403/404. Exact names + granularity, and whether scopes are passed at the
  token endpoint at all, are **[VERIFY WITH PARTNER DOCS]**. [CORROBORATED concept]
- **Pagination:** scheme not published **[VERIFY WITH PARTNER DOCS]**.
- **Rate limits:** none published **[UNKNOWN]**.
- **Webhooks:** none evidenced → polling-first **[VERIFY]**.
- **SDKs:** none public **[UNKNOWN]**.

**Summary:** an under-documented HCM REST API behind a partner program. The _shape_ is corroborated
(client-credentials auth, per-tenant host, Employees/Payroll/Deductions/Benefit-Enrollment surface,
new hires → Pending Employees, per-Client-Code access grant). The _specifics_ (exact paths, token
path, scopes, pagination, limits, error bodies, field schemas) are walled and unverified.

**Numa integration model:** native data connector, `authType: oauth2` + `oauthAdapter: 'isolved'`
(client-credentials) + `instanceUrlRequired`. The agent calls `numa integrations request` with
`connector="isolved"` and a (preferably relative) `url`; Numa resolves the per-tenant base, mints +
injects the company-level Bearer token, and forwards. The agent never sees the token. See 03 for the
real registry entry and the **to-be-built** backend pieces.

## Authentication — OAuth 2.0 client-credentials (the only method)

| Property              | Value                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Grant type            | `client_credentials` [CORROBORATED: CozyROC `Bearer {{=token.Access}}` after a client-credentials mint; RoboMQ "OAuth Client Credentials"] |
| Token endpoint        | `{instance}/rest/api/token` — **exact path [VERIFY WITH PARTNER DOCS]**                                                                    |
| Token request         | `grant_type=client_credentials` + `client_id`/`client_secret` (form fields or HTTP Basic — placement [VERIFY])                             |
| Credential owner      | the **partner company** — one credential shared by all users [CORROBORATED]                                                                |
| Per-user consent      | **none** — no authorize URL, no redirect, no per-user grant [CORROBORATED]                                                                 |
| Token type / lifetime | `Bearer`; lifetime a typical `expires_in` (e.g. 3600s) — exact value [VERIFY]                                                              |
| Refresh               | **none** — re-mint from `client_id`/`client_secret` on expiry [CORROBORATED]                                                               |
| Data-call header      | `Authorization: Bearer {access_token}` [CORROBORATED]                                                                                      |

**Failure semantics:**

| Status | Meaning                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401    | token bad/expired/invalid → the server-side **mint failed** (company credential) → admin fixes the API Application credential; no per-user reconnect [CORROBORATED model]                    |
| 403    | token valid but the **integration lacks the allowed-methods grant**, OR the per-client access grant / Refresh System Data not done → fix the grant/setup, not the token [CORROBORATED model] |

## Capability Surface (corroborated; exact paths VERIFY WITH PARTNER DOCS)

| Object             | Operations (corroborated) | Path                  | Notes                                                 |
| ------------------ | ------------------------- | --------------------- | ----------------------------------------------------- |
| Employee           | read; create (→ Pending)  | `/employees` [VERIFY] | filter `employment_status=ACTIVE` [CORROBORATED]      |
| Payroll            | read (+ write if granted) | [VERIFY]              | grant-gated; writes high-risk                         |
| Deductions         | read + some write         | [VERIFY]              | grant-gated; client-specific codes                    |
| Benefit Enrollment | read + some write         | [VERIFY]              | grant-gated; client-specific plan codes; window-bound |

- **New hires post as Pending Employees** — a created employee is finalised inside isolved, not
  immediately active. [PARTNER-DOC]
- **Client Code is the unit of access** — granted per Client Code, not tenant-wide. [PARTNER-DOC]

## Data Models

**All field-level schemas are [VERIFY WITH PARTNER DOCS].** Do not fabricate fields — GET a real
record and mirror it (01a). Corroborated _families_: Employee (the spine), Payroll, Deductions,
Benefit Enrollment, all hanging off employees within a Client Code. Ids/timestamps/enums shapes
unconfirmed; the only corroborated field-level fact is the `employment_status=ACTIVE` filter.

## Pagination

**Scheme not published [VERIFY WITH PARTNER DOCS].** Inspect the first live response envelope; do
not assume offset/limit, page-number, or cursor (01b).

## Query & Filter Grammar

**Mostly unverified.** Only `employment_status=ACTIVE` is corroborated. No confirmed sort, date, or
field-selection grammar; specifically **do not** use JobAdder-style `>`/`<` date prefixes (01b).

## Rate Limits

| Scope  | Limit     | Window | Notes                                                             |
| ------ | --------- | ------ | ----------------------------------------------------------------- |
| Global | [UNKNOWN] | —      | nothing published; capture headers on the first credentialed call |

Strategy: treat 429 as authoritative; back off 2s → 10s → 30s with jitter; pace ≤ ~2 calls/sec.

## Error Handling

**Error-body shape [UNKNOWN — VERIFY].** Parse defensively (status → JSON → raw text). 403/404 are
the signature failures of the allowed-methods grant + per-Client-Code setup model (01d), not retry
conditions. No confirmed idempotency keys — search-before-recreate on writes (a create may be a
stray Pending Employee).

## Webhooks / Events

**None evidenced [VERIFY].** Polling-first; but note there is no confirmed change/updated filter
(only `employment_status`), so change detection likely means full-list + client-side diff (01d).

## SDKs & Tooling

| Surface         | Status      | Notes                                     |
| --------------- | ----------- | ----------------------------------------- |
| Official SDKs   | none        | raw REST only [UNKNOWN]                   |
| OpenAPI/Swagger | none public | authoritative `/rest` ref is login-walled |
| Postman         | none found  | —                                         |

## Integration Path Assessment

**Recommended path:** Direct API via the Numa native data connector (`numa integrations request`),
registry `authType: oauth2` + `oauthAdapter: 'isolved'` (client-credentials) + `instanceUrlRequired`
— NOT Pipedream, NOT a Files connector.

**Justification:** an OAuth2 client-credentials HCM API on a per-tenant host; one company-level
service credential, no per-user consent. Fits the native `request` surface with a server-side token
mint.

> ⚠️ **Implementation status (honest):** the **registry entry exists** and the slug is registered in
> both native-connector lists, but the **client-credentials token-mint adapter is NOT yet built** and
> **OAuthWizard does not yet collect/persist the per-tenant Instance URL** for `oauth2` connectors.
> See 03 §"Implementation status". Until those are built, isolved is not functional end-to-end.

**Rollout checklist (per customer) — see 03/04 for detail:**

1. Partner: join the isolved Network, submit the API Questionnaire, register an API Application →
   isolved issues `client_id`/`client_secret`.
2. Numa admin: add isolved in Integrations → enter the company `client_id`/`client_secret` + the
   per-tenant **Instance URL** (`https://{tenant}.myisolved.com`).
3. Customer's isolved admin: grant the partner user access to the Client Code (Security → Partner
   Users → Client Access) and run **Production Utilities → Refresh System Data**.
4. Verify: agent runs the smallest granted read (e.g. `GET /employees?employment_status=ACTIVE`) → 200.
5. Burn down §Known Unknowns on the first connected account; update `01-llm-api-rules.md` + remove
   the relevant `[VERIFY WITH PARTNER DOCS]` tags.

## Known Unknowns — verify on a credentialed partner account before customer rollout

1. **Token-endpoint path** — exact (`/rest/api/token`? `/oauth/token`? `/rest/token`?) and whether
   credentials go in the form body or HTTP Basic. [VERIFY]
2. **Exact endpoint paths** for Employees/Payroll/Deductions/Benefit Enrollment. [VERIFY]
3. **Scope / allowed-methods names + granularity**; whether any scope is passed at the token
   endpoint. [VERIFY]
4. **Pagination scheme** + default page size. [VERIFY]
5. **Rate limits** + headers + `Retry-After` presence. [UNKNOWN]
6. **Error-body schema** for 401/403/404/422/429. [UNKNOWN]
7. **Field-level schemas** for every object + the Pending-Employee create body. [VERIFY]
8. **Token lifetime** (`expires_in`). [VERIFY]
9. **Change-detection** — whether any `updated`-style filter exists, or whether change sync means
   full-list + client-side diff. [VERIFY]
10. **Webhooks** — whether any event mechanism exists at all. [VERIFY]
