---
api_name: 'NetSuite SuiteTalk REST + NetSuite AI Connector Service (MCP)'
auth_type: 'oauth2-pkce'
category: 'erp'
---

# Connecting to NetSuite

> Step-by-step setup for obtaining credentials and getting the first successful API call against a NetSuite account. Pure NetSuite-side reference — no Numa internals.

NetSuite is **per-account**: every URL — OAuth, REST, MCP — contains your `accountId` (e.g. `5721181`, `5721181_SB1` for a sandbox). There is no global "NetSuite API" endpoint.

---

## 1. Choose the API surface

NetSuite exposes the same underlying data through several APIs. Pick the one that matches your use case:

| Surface                                 | Endpoint root                                                 | Best for                                                            | OAuth scope        |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------ |
| **SuiteTalk REST — Record API**         | `/services/rest/record/v1/{recordType}`                       | CRUD on individual records (`customer`, `salesOrder`, `invoice`, …) | `rest_webservices` |
| **SuiteTalk REST — SuiteQL**            | `/services/rest/query/v1/suiteql`                             | Ad-hoc SQL-like queries across records                              | `rest_webservices` |
| **RESTlets**                            | `/app/site/hosted/restlet.nl?script=…&deploy=…`               | Custom server-side SuiteScript endpoints                            | `restlets`         |
| **SuiteAnalytics Connect**              | (driver)                                                      | BI / data warehouse loads                                           | `suite_analytics`  |
| **NetSuite AI Connector Service (MCP)** | `/services/mcp/v1/suiteapp/{appId}` or `/services/mcp/v1/all` | LLM/agent integration via JSON-RPC tools                            | `mcp`              |

> ⚠️ **The `mcp` scope is exclusive.** You cannot combine it with `restlets`, `rest_webservices`, or `suite_analytics` in the same OAuth flow. If your integration needs both MCP and REST, run two independent OAuth flows.

[DOCUMENTED] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081944642.html

---

## 2. Account-level prerequisites

The customer's NetSuite administrator must enable these features (Setup → Company → Enable Features):

- [ ] **OAuth 2.0** (SuiteCloud subtab)
- [ ] **REST Web Services** (SuiteCloud subtab) — required for the REST + SuiteQL surfaces
- [ ] **Server SuiteScript** (SuiteCloud subtab) — required for RESTlets and MCP
- [ ] **Token-Based Authentication** (only if also using TBA alongside OAuth — optional)

For MCP specifically:

- [ ] Install the **MCP Standard Tools SuiteApp** (`com.netsuite.mcpstandardtools`) from SuiteApp Marketplace. NetSuite often bundles this by default in newer accounts.

---

## 3. Create the Integration Record

Setup → Integration → Manage Integrations → New.

| Field                      | Value                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                       | Free text (shown to users on the consent screen)                                                                                                                              |
| State                      | Enabled                                                                                                                                                                       |
| Concurrency Limit          | Leave default (account-level setting; per-integration cap)                                                                                                                    |
| User Credentials           | Unchecked                                                                                                                                                                     |
| Token-Based Authentication | Optional                                                                                                                                                                      |
| Authorization Code Grant   | **Checked**                                                                                                                                                                   |
| Public Client              | **Checked** for PKCE-only flows (no client secret); unchecked for confidential clients                                                                                        |
| Redirect URI               | The exact callback URL your application will use — must match byte-for-byte on every OAuth request                                                                            |
| Scope                      | One of: `RESTlets`, `REST Web Services`, `SuiteAnalytics Connect`, `NetSuite AI Connector Service` (one per integration record; multiple records if you need multiple scopes) |
| OAuth 2.0 Consent Policy   | Usually `Ask First Time`                                                                                                                                                      |

On save, NetSuite displays:

- **Client ID** (also called `Consumer Key`) — capture immediately
- **Client Secret** (also called `Consumer Secret`) — capture immediately, **shown once**. If using a Public Client, no secret is generated.

[DOCUMENTED] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html

---

## 4. Role & user requirements

OAuth 2.0 access is bound to the user who completes the consent flow. That user's role determines what data the integration can touch.

- For **REST Web Services / RESTlets**: the user's role needs the relevant record-level permissions (e.g. Lists → Customers: View/Edit) plus **REST Web Services** and **OAuth 2.0 Access Tokens**.
- For **MCP**: create a **custom role** (the Administrator role is **not supported** for MCP) with at least: `MCP Server Connection` + `OAuth 2.0 Access Tokens` + any record permissions the agent needs.

[DOCUMENTED — MCP custom-role requirement] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html

---

## 5. OAuth 2.0 — Authorization Code with PKCE

### 5.1 Authorize URL

```
https://<accountID>.app.netsuite.com/app/login/oauth2/authorize.nl
  ?response_type=code
  &client_id={CLIENT_ID}
  &redirect_uri={REDIRECT_URI}             ← URL-encoded; must match integration record exactly
  &scope=rest_webservices                  ← OR: restlets, suite_analytics, mcp (one of)
  &state={22_TO_1024_CHAR_OPAQUE_STRING}
  &code_challenge={SHA256(code_verifier)}  ← required for public clients and ALL mcp flows
  &code_challenge_method=S256
```

If the account ID is unknown at flow-start time, use the catch-all host:

```
https://system.netsuite.com/app/login/oauth2/authorize.nl?...
```

After the user signs in, NetSuite resolves the account and redirects back to `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}&company={accountId}`.

**NetSuite-specific constraints:**

- `state` must be **22–1024 characters**, printable ASCII, unique per flow.
- `code_verifier` must be **43–128 characters** from `[A-Za-z0-9-._~]`.
- `code_challenge` = `BASE64URL( SHA256(code_verifier) )`.
- `code_challenge_method` **must be `S256`**. `plain` is unsupported since 2020.2.
- `code_challenge` is **required even for confidential clients** when scope is `mcp`.

Example (verbatim from Oracle docs):

```
https://<accountID>.app.netsuite.com/app/login/oauth2/authorize.nl
  ?scope=restlets+rest_webservices
  &redirect_uri=https%3A%2F%2Fmyapplication.com%2Fnetsuite%2Foauth2callback
  &response_type=code
  &client_id=6794a3086e4f61a120350d01b8527aed3631472ef33412212495be65a8fc8d4c
  &state=ykv2XLx1BpT5Q0F3MRPHb94j
  &code_challenge=Who5QBshz2Mu1Mq6GuAknYA5TnjA-0z7VhAgLloec1s
  &code_challenge_method=S256
```

[DOCUMENTED] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081944642.html

### 5.2 Token endpoint

```
POST https://<accountID>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded
```

Three authentication variants — pick one based on client type:

**(a) Confidential client (HTTP Basic header):**

```
Authorization: Basic BASE64URL(client_id:client_secret)

code={AUTH_CODE}
&redirect_uri={REDIRECT_URI}
&grant_type=authorization_code
&code_verifier={ORIGINAL_CODE_VERIFIER}
```

**(b) Public client — variant 1 (`client_id` in body):**

```
code={AUTH_CODE}
&redirect_uri={REDIRECT_URI}
&grant_type=authorization_code
&code_verifier={ORIGINAL_CODE_VERIFIER}
&client_id={CLIENT_ID}
```

**(c) Public client — variant 2 (`client_id` in Basic header, empty secret):**

```
Authorization: Basic BASE64URL(client_id:)

code=...&redirect_uri=...&grant_type=authorization_code&code_verifier=...
```

Response (JSON):

```json
{
  "access_token": "{JWT_RS256}",
  "refresh_token": "{JWT}",
  "expires_in": 3600,
  "token_type": "bearer",
  "id_token": "{JWT — OIDC only, optional}"
}
```

### 5.3 Token lifetimes

|                         | Access token | Refresh token                                                               | Rotates on refresh?                                                 |
| ----------------------- | ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Confidential client** | 3600s (1 hr) | 7 days                                                                      | No — refresh token can be reused until expiry                       |
| **Public client**       | 3600s (1 hr) | 2 days (default; configurable 1 hour – 720 hours on the integration record) | **Yes — one-time use**, response always returns a new refresh token |

[DOCUMENTED — token endpoint reference]

### 5.4 Refresh

Same endpoint, `grant_type=refresh_token`, body shape mirrors the chosen client variant. For public clients, **persist the rotated refresh token immediately** — the old one is dead after the first refresh.

---

## 6. Required headers (data calls)

```
Authorization:  Bearer {ACCESS_TOKEN}
Content-Type:   application/json    ← POST/PATCH only
Prefer:         transient           ← optional, for SuiteQL — avoids saving the query
```

The access token is a signed JWT (RS256). You don't validate its signature client-side; just present it.

---

## 7. First successful call — smoke test

Pick one based on your scope:

### REST Web Services

```http
GET https://<accountID>.suitetalk.api.netsuite.com/services/rest/record/v1/customer?limit=1
Authorization: Bearer {ACCESS_TOKEN}
```

Expected: `200 OK` with `{ "links": [...], "count": 1, "hasMore": …, "items": [ { "id": "…", "links": […] } ], "offset": 0, "totalResults": … }`.

### SuiteQL

```http
POST https://<accountID>.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=10
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
Prefer: transient

{"q": "SELECT id, companyname FROM customer WHERE ROWNUM <= 10"}
```

### MCP

```http
POST https://<accountID>.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json

{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
```

Failure modes:

- **400 INVALID_LOGIN_ATTEMPT** with `Insufficient scope` → integration record's scope doesn't match what you requested in the authorize URL.
- **401 INVALID_LOGIN** → access token expired → refresh.
- **403 USER_ERROR** → role lacks the record permission (REST) or `MCP Server Connection` permission (MCP).
- **429 / Concurrency** → account-level concurrency limit hit; exponential backoff.

---

## 8. Account ID vs hostname

The `accountId` you put into URLs is _not_ the company name — it's a numeric (or numeric+suffix) identifier visible at:

```
Setup → Company → Company Information → Account ID
```

| Account type    | Format                               | Example       |
| --------------- | ------------------------------------ | ------------- |
| Production      | digits only                          | `5721181`     |
| Sandbox         | `{prod_id}_SB{n}` (lowercase in URL) | `5721181_sb1` |
| Release Preview | `{prod_id}_RP`                       | `5721181_rp`  |

The same account ID appears in OAuth URLs (`<accountID>.app.netsuite.com`), data URLs (`<accountID>.suitetalk.api.netsuite.com`), and UI URLs (`<accountID>.app.netsuite.com`).

---

## 9. Per-account concurrency model

NetSuite governs API usage by **concurrency** (parallel in-flight requests), not request rate. Quotas:

| Tier                           | Default concurrency limit  |
| ------------------------------ | -------------------------- |
| Standard                       | 5 concurrent               |
| Premium                        | 10 concurrent              |
| Premium Plus / SuiteCloud Plus | 10–25, scalable per add-on |

Exceeding it returns **HTTP 429** with `o:errorCode: "CONCURRENCY_LIMIT_EXCEEDED"`. There is no `Retry-After` header — back off exponentially (1s, 2s, 4s, …).

Per-integration-record limits can further cap a single integration below the account total — check the integration record's "Concurrency Limit" field.

---

## 10. Sandbox testing

- Sandbox refreshes copy production data + integration records, but **integration secrets must be re-issued** for the sandbox-account ID (re-create the integration record under the sandbox account).
- Sandbox account ID uses the `_sb{n}` suffix (e.g. `5721181_sb1`); use this everywhere — host, scope target, integration record ID.
- The "Release Preview" account (`_rp`) lets you validate against the next NetSuite version before it hits production.

---

## 11. Quick-reference URLs

| Resource                    | URL                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| OAuth 2.0 overview          | https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html             |
| Step 1 (authorize)          | https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081944642.html             |
| Step 2 (token)              | https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081952044.html             |
| REST API Browser            | https://system.netsuite.com/help/helpcenter/en_US/APIs/REST_API_Browser/record/v1/2024.1/index.html |
| SuiteQL documentation       | https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156257770590.html             |
| Status page                 | https://status.netsuite.com                                                                         |
| Release notes (per quarter) | https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1539886829.html               |
| Community forum             | https://community.oracle.com/netsuite                                                               |
