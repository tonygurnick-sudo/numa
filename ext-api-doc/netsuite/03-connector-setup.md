---
api_name: NetSuite SuiteTalk REST + NetSuite AI Connector Service (MCP)
api_slug: netsuite
auth_type: oauth2-pkce
category: erp
doc: NetSuite-side connector setup (credentials + first successful call). No Numa internals.
per_account: every URL (OAuth, REST, MCP) contains your numeric accountId (e.g. 5721181, 5721181_SB1 sandbox). No global endpoint.
path_version_segment: literal `/v1/` IS in every data/OAuth path (real segment)
---

# Connecting to NetSuite

Step-by-step setup to obtain credentials and make the first API call. NetSuite is **per-account**: every URL contains your `accountId`; there is no global "NetSuite API" endpoint.

## 1. Choose the API surface

| Surface                     | Endpoint root                                                 | Best for                     | OAuth scope        |
| --------------------------- | ------------------------------------------------------------- | ---------------------------- | ------------------ |
| SuiteTalk REST — Record API | `/services/rest/record/v1/{recordType}`                       | CRUD on individual records   | `rest_webservices` |
| SuiteTalk REST — SuiteQL    | `/services/rest/query/v1/suiteql`                             | Ad-hoc SQL-like queries      | `rest_webservices` |
| RESTlets                    | `/app/site/hosted/restlet.nl?script=…&deploy=…`               | Custom SuiteScript endpoints | `restlets`         |
| SuiteAnalytics Connect      | (driver)                                                      | BI / data warehouse          | `suite_analytics`  |
| AI Connector Service (MCP)  | `/services/mcp/v1/suiteapp/{appId}` or `/services/mcp/v1/all` | LLM/agent via JSON-RPC tools | `mcp`              |

> ⚠️ **The `mcp` scope is EXCLUSIVE** — cannot combine with `restlets`/`rest_webservices`/`suite_analytics` in one OAuth flow. Need both MCP and REST → run two independent OAuth flows (two integration records). [DOCUMENTED] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081944642.html

## 2. Account-level prerequisites

Admin enables in Setup → Company → Enable Features (SuiteCloud subtab): OAuth 2.0; REST Web Services (REST + SuiteQL); Server SuiteScript (RESTlets + MCP); Token-Based Authentication (optional, only if using TBA alongside OAuth).
For MCP: install the **MCP Standard Tools SuiteApp** (`com.netsuite.mcpstandardtools`) from SuiteApp Marketplace (often bundled by default in newer accounts).

## 3. Create the Integration Record

Setup → Integration → Manage Integrations → New.
| Field | Value |
| --- | --- |
| Name | Free text (shown on consent screen) |
| State | Enabled |
| Concurrency Limit | Leave default (per-integration cap) |
| User Credentials | Unchecked |
| Token-Based Authentication | Optional |
| Authorization Code Grant | **Checked** |
| Public Client | **Checked** for PKCE-only (no secret); unchecked for confidential |
| Redirect URI | Exact callback URL — must match byte-for-byte on every OAuth request |
| Scope | One of: `RESTlets`, `REST Web Services`, `SuiteAnalytics Connect`, `NetSuite AI Connector Service` (one per record) |
| OAuth 2.0 Consent Policy | Usually `Ask First Time` |

On save NetSuite shows (**once**): **Client ID** (= Consumer Key) — capture immediately; **Client Secret** (= Consumer Secret) — capture immediately, shown once. Public Client → no secret generated. [DOCUMENTED] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html

## 4. Role & user requirements

OAuth access is bound to the user who completes consent; their role determines accessible data.

- **REST / RESTlets:** role needs the record-level permissions (e.g. Lists → Customers: View/Edit) + **REST Web Services** + **OAuth 2.0 Access Tokens**.
- **MCP:** create a **custom role** (Administrator is **NOT supported** for MCP) with at least `MCP Server Connection` + `OAuth 2.0 Access Tokens` + record permissions the agent needs. [DOCUMENTED] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html

## 5. OAuth 2.0 — Authorization Code with PKCE

### 5.1 Authorize URL

```
https://<accountID>.app.netsuite.com/app/login/oauth2/authorize.nl
  ?response_type=code
  &client_id={CLIENT_ID}
  &redirect_uri={REDIRECT_URI}             ← URL-encoded; must match integration record exactly
  &scope=rest_webservices                  ← OR: restlets, suite_analytics, mcp (one of)
  &state={22_TO_1024_CHAR_OPAQUE_STRING}
  &code_challenge={BASE64URL(SHA256(code_verifier))}
  &code_challenge_method=S256
```

If account ID unknown at flow start, use catch-all host `https://system.netsuite.com/app/login/oauth2/authorize.nl?...`. After sign-in NetSuite resolves the account and redirects to `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}&company={accountId}`.

**Constraints:** `state` 22–1024 chars, printable ASCII, unique per flow. `code_verifier` 43–128 chars from `[A-Za-z0-9-._~]`. `code_challenge` = `BASE64URL(SHA256(code_verifier))`. `code_challenge_method` MUST be `S256` (`plain` unsupported since 2020.2). `code_challenge` required even for confidential clients when scope is `mcp`.

Verbatim Oracle-docs example:

```
https://<accountID>.app.netsuite.com/app/login/oauth2/authorize.nl?scope=restlets+rest_webservices&redirect_uri=https%3A%2F%2Fmyapplication.com%2Fnetsuite%2Foauth2callback&response_type=code&client_id=6794a3086e4f61a120350d01b8527aed3631472ef33412212495be65a8fc8d4c&state=ykv2XLx1BpT5Q0F3MRPHb94j&code_challenge=Who5QBshz2Mu1Mq6GuAknYA5TnjA-0z7VhAgLloec1s&code_challenge_method=S256
```

[DOCUMENTED] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081944642.html

### 5.2 Token endpoint

`POST https://<accountID>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`, `Content-Type: application/x-www-form-urlencoded`. Three variants by client type:

- **(a) Confidential:** header `Authorization: Basic BASE64URL(client_id:client_secret)`; body `code={AUTH_CODE}&redirect_uri={REDIRECT_URI}&grant_type=authorization_code&code_verifier={CODE_VERIFIER}`.
- **(b) Public, variant 1 (`client_id` in body):** body adds `&client_id={CLIENT_ID}` (no secret).
- **(c) Public, variant 2 (`client_id` in Basic header, empty secret):** header `Authorization: Basic BASE64URL(client_id:)`; body `code=…&redirect_uri=…&grant_type=authorization_code&code_verifier=…`.

Response: `{"access_token":"{JWT_RS256}","refresh_token":"{JWT}","expires_in":3600,"token_type":"bearer","id_token":"{JWT — OIDC only, optional}"}`.

### 5.3 Token lifetimes

|              | Access | Refresh                                 | Rotates on refresh?                                                 |
| ------------ | ------ | --------------------------------------- | ------------------------------------------------------------------- |
| Confidential | 3600s  | 7 days                                  | No — reusable until expiry                                          |
| Public       | 3600s  | 2 days default (configurable 1–720 hrs) | **Yes — one-time use**, response always returns a new refresh token |

### 5.4 Refresh

Same endpoint, `grant_type=refresh_token`, body shape mirrors the chosen variant. Public clients: **persist the rotated refresh token immediately** — the old one dies after the first refresh.

## 6. Required headers (data calls)

```
Authorization: Bearer {ACCESS_TOKEN}
Content-Type:  application/json    ← POST/PATCH only
Prefer:        transient           ← optional, for SuiteQL — avoids saving the query
```

The access token is a signed JWT (RS256); don't validate the signature, just present it.

## 7. First successful call — smoke test (pick per scope)

**REST Web Services:** `GET https://<accountID>.suitetalk.api.netsuite.com/services/rest/record/v1/customer?limit=1` with Bearer → `200 OK` with `{"links":[…],"count":1,"hasMore":…,"items":[{"id":"…","links":[…]}],"offset":0,"totalResults":…}`.
**SuiteQL:** `POST …/services/rest/query/v1/suiteql?limit=10` with Bearer + `Content-Type: application/json` + `Prefer: transient`, body `{"q":"SELECT id, companyname FROM customer WHERE ROWNUM <= 10"}`.
**MCP:** `POST …/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools` with Bearer + `Content-Type: application/json`, body `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`.

**Failure modes:** `400 INVALID_LOGIN_ATTEMPT` + `Insufficient scope` → integration record scope ≠ requested scope. `401 INVALID_LOGIN` → token expired → refresh. `403 USER_ERROR` → role lacks record permission (REST) or `MCP Server Connection` (MCP). `429 / Concurrency` → account concurrency limit hit, exponential backoff.

## 8. Account ID vs hostname

The `accountId` is NOT the company name — it's numeric (or numeric+suffix), at Setup → Company → Company Information → Account ID.
| Account type | Format | Example |
| --- | --- | --- |
| Production | digits only | `5721181` |
| Sandbox | `{prod_id}_SB{n}` (lowercase in URL) | `5721181_sb1` |
| Release Preview | `{prod_id}_RP` | `5721181_rp` |

Same account ID appears in OAuth URLs (`<accountID>.app.netsuite.com`), data URLs (`<accountID>.suitetalk.api.netsuite.com`), and UI URLs.

## 9. Per-account concurrency model

NetSuite governs by **concurrency** (parallel in-flight requests), not request rate.
| Tier | Default concurrency |
| --- | --- |
| Standard | 5 |
| Premium | 10 |
| Premium Plus / SuiteCloud Plus | 10–25, scalable per add-on |

Exceeding → HTTP 429 `CONCURRENCY_LIMIT_EXCEEDED`, no `Retry-After` — back off exponentially (1s,2s,4s,…). Per-integration-record limits can cap a single integration below the account total (integration record "Concurrency Limit" field).

## 10. Sandbox testing

Sandbox refreshes copy production data + integration records, but **integration secrets must be re-issued** for the sandbox account ID (re-create the integration record under the sandbox account). Sandbox account ID uses `_sb{n}` (e.g. `5721181_sb1`) — use it everywhere (host, scope target, record id). The Release Preview account (`_rp`) validates against the next NetSuite version before production.

## 11. Quick-reference URLs

- OAuth 2.0 overview: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html
- Step 1 authorize: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081944642.html
- Step 2 token: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081952044.html
- REST API Browser: https://system.netsuite.com/help/helpcenter/en_US/APIs/REST_API_Browser/record/v1/2024.1/index.html
- SuiteQL docs: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156257770590.html
- Status: https://status.netsuite.com
- Release notes: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1539886829.html
- Community: https://community.oracle.com/netsuite
