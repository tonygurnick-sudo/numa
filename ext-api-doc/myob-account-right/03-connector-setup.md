---
doc: connector-setup (MYOB-side credential setup + OAuth flow; no Numa wiring) — MYOB AccountRight (MYOB Business API v2)
base_url_cloud: https://api.myob.com/accountright/{businessId}/{Resource}
base_url_local: http://localhost:8080/accountright/{businessId}/{Resource} (LAN: http://{IP}:8080/...)
auth: OAuth 2.0 Authorization Code (post-March 2025). Authorize https://secure.myob.com/oauth2/account/authorize · Token+Refresh https://secure.myob.com/oauth2/v1/authorize
confidence: [DOCUMENTED] from MYOB docs unless noted
---

# Connecting to the MYOB Business API

## 1. Product context [DOCUMENTED https://developer.myob.com/api/myob-business-api/api-overview/getting-started/]

The MYOB Business API (formerly AccountRight Live API) is the **single** API behind three brands. The `_UIAccessFlags` property (returned by the API) lets a client detect the variant.
| Brand | `UIAccessFlags` | Notes |
| --- | --- | --- |
| MYOB AccountRight (online + browser) | 3 | active for existing AU/NZ customers |
| MYOB AccountRight (local desktop) | 0 | via `localhost:8080` |
| MYOB Essentials (new) | 2 | migrating to MYOB Business |
| MYOB Business | (same as Essentials) | branding for new AU customers from May 2020; same platform/API as AccountRight |
AccountRight Classic (v19 and earlier) becomes read-only from Feb 2026.

## 2. Developer registration [DOCUMENTED getting-started]

1. https://developer.myob.com → submit "Register for API Access".
2. MYOB emails **my.MYOB** portal login credentials.
3. Accept the **shared sandbox company file** invite from inside my.MYOB before testing.
4. my.MYOB → **Developer** tab → **Register App**.
5. Provide app name + **redirect URI** (must match the auth-URL one byte-for-byte, incl. trailing slash).
6. MYOB displays **API key** (client_id) + **API secret** (client_secret) — capture both immediately; the secret is shown once.

If the company file is cloud-hosted and the API key was created **after 12 March 2025**, also submit the enrolment ticket (https://apisupport.myob.com/hc/en-us/requests/new?ticket_form_id=6175906535311) for the new flow.

## 3. OAuth 2.0 — Authorization Code flow (post-March 2025)

### 3.1 Authorize URL

```
GET https://secure.myob.com/oauth2/account/authorize
  ?client_id={API_KEY}&redirect_uri={REDIRECT_URI}&response_type=code
  &scope=sme-company-file sme-contacts-customer sme-sales&prompt=consent
```

| Param           | Required                | Notes                                                                                                      |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `client_id`     | yes                     | API key from my.MYOB                                                                                       |
| `redirect_uri`  | yes                     | must match registered URI byte-for-byte                                                                    |
| `response_type` | yes                     | always `code`                                                                                              |
| `scope`         | yes                     | space-separated `sme-*` (see §6)                                                                           |
| `prompt`        | **yes (post-Mar 2025)** | must be `consent` — without it the redirect omits `businessId` and every subsequent call has nowhere to go |

### 3.2 Redirect response

```
{REDIRECT_URI}?code={AUTH_CODE}&scope={GRANTED_SCOPES}&state={OPTIONAL_STATE}&businessId={COMPANY_FILE_GUID}&businessName={COMPANY_FILE_DISPLAY_NAME}
```

`businessId` is the **primary identifier for every subsequent call** — the `{businessId}` in the base URL. Persist it alongside the tokens.

### 3.3 Token exchange (authorization_code)

```
POST https://secure.myob.com/oauth2/v1/authorize
Content-Type: application/x-www-form-urlencoded

client_id={API_KEY}&client_secret={API_SECRET}&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}&grant_type=authorization_code
```

Response: `{"access_token":"...","refresh_token":"...","scope":"sme-company-file sme-contacts-customer sme-sales","expires_in":1200,"token_type":"bearer"}`

> `expires_in` is not in MYOB's public docs — trust the response, refresh defensively on 401. Anecdotally ~20 min for access tokens.

### 3.4 Token refresh

Same endpoint, body: `client_id={API_KEY}&client_secret={API_SECRET}&refresh_token={REFRESH_TOKEN}&grant_type=refresh_token`

> ⚠️ Response contains a **new `refresh_token`** — persist it; the old one is dead the moment the response is sent.

### 3.5 Administrator requirement

Only a user with the **Administrator** role on the company file can complete consent. Non-admins get Access Denied at consent and are stuck. Surface this before sending the user to the authorize URL.

### 3.6 Multi-company-file accounts

`GET /accountright/` (legacy "list my company files") was removed for new API keys post-March 2025. Replacement: run the OAuth flow **once per company file** (each with `prompt=consent`) and store each returned `businessId`. No other way to enumerate a user's files. [DOCUMENTED https://apisupport.myob.com/hc/en-us/articles/13065472856719]

## 4. Base URL

```
Cloud:       https://api.myob.com/accountright/{businessId}/{Resource}
Local file:  http://localhost:8080/accountright/{businessId}/{Resource}
Local LAN:   http://{IP}:8080/accountright/{businessId}/{Resource}
```

`{businessId}` = GUID from the OAuth redirect (cloud) or from `GET /accountright/` (local desktop only). [DOCUMENTED getting-started]

## 5. Required headers (every authenticated call)

```
Authorization:      Bearer {ACCESS_TOKEN}
x-myobapi-key:      {API_KEY}
x-myobapi-version:  v2
Content-Type:       application/json     ← POST/PUT only
```

Optional: `x-myobapi-cftoken: {base64(username:password)}` ← LOCAL desktop files only (separate auth check inside the desktop app for the file's own user/password); `Accept: application/pdf` ← invoice PDF download. [DOCUMENTED https://developer.myob.com/api/myob-business-api/v2/]

## 6. OAuth scopes [DOCUMENTED scopes + post-Mar-2025 article]

Space-separated in the authorize URL. Use the smallest set needed — admin users see the list at consent time. The legacy umbrella scope `CompanyFile` is deprecated for API keys created after 12 March 2025 — use granular `sme-*`.
| Scope | Grants |
| --- | --- |
| `sme-company-file` | company file access — always-required base scope |
| `sme-general-ledger` | accounts, tax codes, journals, jobs, cost-centre categories |
| `sme-sales` | invoices (Item/Service), orders, quotes, customer payments, credit refunds/settlements |
| `sme-purchases` | bills (Item/Service/Miscellaneous), purchase orders, supplier payments, debit refunds/settlements |
| `sme-contacts-customer` | customer contacts |
| `sme-contacts-supplier` | supplier contacts |
| `sme-contacts-employee` | employee contacts |
| `sme-contacts-personal` | personal contacts |
| `sme-banking` | spend/receive/transfer money transactions |
| `sme-inventory` | inventory items, locations, adjustments, item pricing matrix |
| `sme-payroll` | payroll-related data |
| `sme-timebilling` | time billing activities |
| `sme-company-settings` | company file settings and preferences |

## 7. First successful call — smoke test

```http
GET https://api.myob.com/accountright/{businessId}/Contact/Customer?$top=1
Authorization: Bearer {ACCESS_TOKEN}
x-myobapi-key: {API_KEY}
x-myobapi-version: v2
```

Expected: `200 OK` with `{ "Count": …, "Items": [ … ], "NextPageLink": … }`. Failures:

- **401** → access token bad/expired → refresh.
- **403 `Name:"RateLimitError"`** → hit 8 req/s → back off.
- **403 `Name:"DeveloperInactive"`** → API key not approved/revoked → contact MYOB.
- **403 `Name:"AccessDenied"`** → user isn't an Administrator on this company file.
- **400 missing `businessId`** → you skipped `prompt=consent`.
  Full error map in `01d`.

## 8. Sandbox & testing

- Sandbox is provisioned per-developer; you get a shared sandbox company file invite after registration is approved.
- For local load/perf testing, install AccountRight desktop, point at `http://localhost:8080/accountright/`.
- MYOB servers slow significantly between the 20th of each month and the 5th of next (end-of-month batch) — keep out of latency baselines.

## 9. Rate limits & timeouts [DOCUMENTED errors]

| Limit      | Value                         | Signal                          |
| ---------- | ----------------------------- | ------------------------------- |
| Per-second | 8 req/s                       | `403` + `Name:"RateLimitError"` |
| Daily      | 1,000,000 req/day per API key | `403` + `Name:"RateLimitError"` |
| Timeout    | ~30s                          | `504` + `Name:"GatewayTimeout"` |

Rate-limit responses use **HTTP 403** (not 429); distinguish from auth failures via the body `Name` field.

## 10. Quick-reference URLs

| Resource                     | URL                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| Developer portal             | https://developer.myob.com                                                                 |
| API support centre           | https://apisupport.myob.com/hc/en-us                                                       |
| my.MYOB (AU)                 | https://my.myob.com.au                                                                     |
| Post-March 2025 flow article | https://apisupport.myob.com/hc/en-us/articles/13065472856719                               |
| API status page              | https://status.myob.com/                                                                   |
| Postman collection           | https://www.postman.com/myob-accountright                                                  |
| Scopes reference             | https://developer.myob.com/api/myob-business-api/api-overview/scopes/                      |
| Error messages reference     | https://developer.myob.com/api/myob-business-api/api-overview/error-messages/              |
| Retrieving data (OData)      | https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/             |
| Community forum              | https://community.myob.com/t5/AccountRight-API-questions-and/bd-p/AccountRightAPIquestions |
