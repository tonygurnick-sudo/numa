# Connecting to the MYOB Business API

> Step-by-step setup for obtaining credentials and getting the first successful API call. Pure MYOB-side reference — no Numa-specific wiring.

---

## 1. Product context

The MYOB Business API (formerly the AccountRight Live API) is the **single** API behind three product brands:

| Brand                                | `UIAccessFlags`      | Notes                                                                                          |
| ------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| MYOB AccountRight (online + browser) | `3`                  | Active for existing AU/NZ customers                                                            |
| MYOB AccountRight (local desktop)    | `0`                  | Accessed via `localhost:8080`                                                                  |
| MYOB Essentials (new)                | `2`                  | Migrating to MYOB Business                                                                     |
| MYOB Business                        | (same as Essentials) | The branding for **new** AU customers from May 2020 onward — same platform/API as AccountRight |

The `_UIAccessFlags` property is returned by the API and lets a client detect what product variant they're talking to. AccountRight Classic (v19 and earlier) becomes read-only from Feb 2026.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/

---

## 2. Developer registration

1. Visit https://developer.myob.com and submit the "Register for API Access" form.
2. MYOB creates login credentials for the **my.MYOB** portal and emails them to you.
3. MYOB sends an **invitation to the shared sandbox company file** — accept it from inside my.MYOB before testing.
4. In my.MYOB, open the **Developer** tab → **Register App**.
5. Provide an app name and a **redirect URI** (must match the one used in the auth URL exactly — including trailing slash).
6. MYOB generates and displays the **API key** (client_id) and **API secret** (client_secret). Capture both immediately; the secret is not shown again.

If the company file is cloud-hosted and the API key was created **after 12 March 2025**, you must additionally submit https://apisupport.myob.com/hc/en-us/requests/new?ticket_form_id=6175906535311 to be enrolled into the new flow.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/

---

## 3. OAuth 2.0 — Authorization Code flow (Post-March 2025)

### 3.1 Authorize URL

```
GET https://secure.myob.com/oauth2/account/authorize
  ?client_id={API_KEY}
  &redirect_uri={REDIRECT_URI}
  &response_type=code
  &scope=sme-company-file sme-contacts-customer sme-sales
  &prompt=consent
```

| Parameter       | Required                  | Notes                                                                                                          |
| --------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `client_id`     | yes                       | API key from my.MYOB                                                                                           |
| `redirect_uri`  | yes                       | Must match registered URI byte-for-byte                                                                        |
| `response_type` | yes                       | Always `code`                                                                                                  |
| `scope`         | yes                       | Space-separated `sme-*` scopes — see §6                                                                        |
| `prompt`        | **yes (post-March 2025)** | Must be `consent`. Without it the redirect omits `businessId` and every subsequent API call has nowhere to go. |

### 3.2 Redirect response

MYOB redirects back with:

```
{REDIRECT_URI}?code={AUTH_CODE}
              &scope={GRANTED_SCOPES}
              &state={OPTIONAL_STATE}
              &businessId={COMPANY_FILE_GUID}
              &businessName={COMPANY_FILE_DISPLAY_NAME}
```

`businessId` is the **primary identifier for every subsequent call** — it's the `{cf_guid}` placeholder in the base URL. Persist it alongside the tokens.

### 3.3 Token exchange (authorization_code)

```
POST https://secure.myob.com/oauth2/v1/authorize
Content-Type: application/x-www-form-urlencoded

client_id={API_KEY}
&client_secret={API_SECRET}
&code={AUTH_CODE}
&redirect_uri={REDIRECT_URI}
&grant_type=authorization_code
```

Response (JSON):

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "scope": "sme-company-file sme-contacts-customer sme-sales",
  "expires_in": 1200,
  "token_type": "bearer"
}
```

> The exact `expires_in` value is not in MYOB's public docs — trust whatever the response says and refresh defensively on `401`. Anecdotally ~20 min for access tokens.

### 3.4 Token refresh

Same endpoint, different body:

```
POST https://secure.myob.com/oauth2/v1/authorize
Content-Type: application/x-www-form-urlencoded

client_id={API_KEY}
&client_secret={API_SECRET}
&refresh_token={REFRESH_TOKEN}
&grant_type=refresh_token
```

> ⚠️ The response contains a **new `refresh_token`**. Persist it — the old one is dead the moment the response is sent.

### 3.5 Administrator requirement

Only a user with the **Administrator** role on the company file can complete the consent screen. Non-admins get an Access Denied at consent time and are stuck. Surface this expectation to the end user before sending them to the authorize URL.

### 3.6 Multi-company-file accounts

`GET /accountright/` (the legacy "list my company files" endpoint) was removed for new API keys post-March 2025. The replacement is: run the OAuth flow **once per company file** with `prompt=consent` and store the returned `businessId` for each. There is no other way to enumerate a user's files.

[DOCUMENTED — Post-March 2025 flow article] https://apisupport.myob.com/hc/en-us/articles/13065472856719

---

## 4. Base URL

```
Cloud:       https://api.myob.com/accountright/{businessId}/{Resource}
Local file:  http://localhost:8080/accountright/{businessId}/{Resource}
Local LAN:   http://{IP}:8080/accountright/{businessId}/{Resource}
```

`{businessId}` is the GUID captured from the OAuth redirect (cloud) or returned by `GET /accountright/` (local desktop only).

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/

---

## 5. Required headers (every authenticated call)

```
Authorization:      Bearer {ACCESS_TOKEN}
x-myobapi-key:      {API_KEY}
x-myobapi-version:  v2
Content-Type:       application/json     ← POST/PUT only
```

Optional:

```
x-myobapi-cftoken:  {base64(username:password)}   ← LOCAL desktop files only
Accept:             application/pdf                ← invoice PDF download
```

`x-myobapi-cftoken` is the company-file credential pair for **local** files (not cloud) — it's a separate auth check inside the desktop AccountRight app for the file's own user/password.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/v2/

---

## 6. OAuth scopes

All scopes are space-separated in the authorize URL. Use the smallest set you need — admin users see the list at consent time.

| Scope                   | Grants access to                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `sme-company-file`      | Company file access — treat as the always-required base scope                                     |
| `sme-general-ledger`    | Accounts, tax codes, journals, jobs, cost-centre categories                                       |
| `sme-sales`             | Invoices (Item/Service), orders, quotes, customer payments, credit refunds/settlements            |
| `sme-purchases`         | Bills (Item/Service/Miscellaneous), purchase orders, supplier payments, debit refunds/settlements |
| `sme-contacts-customer` | Customer contacts                                                                                 |
| `sme-contacts-supplier` | Supplier contacts                                                                                 |
| `sme-contacts-employee` | Employee contacts                                                                                 |
| `sme-contacts-personal` | Personal contacts                                                                                 |
| `sme-banking`           | Spend/receive/transfer money transactions                                                         |
| `sme-inventory`         | Inventory items, locations, adjustments, item pricing matrix                                      |
| `sme-payroll`           | Payroll-related data                                                                              |
| `sme-timebilling`       | Time billing activities                                                                           |
| `sme-company-settings`  | Company file settings and preferences                                                             |

The legacy umbrella scope `CompanyFile` is deprecated for API keys created after 12 March 2025 — use the granular `sme-*` scopes.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/scopes/
[DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719

---

## 7. First successful call — smoke test

After obtaining `access_token` + `businessId`:

```http
GET https://api.myob.com/accountright/{businessId}/Contact/Customer?$top=1
Authorization: Bearer {ACCESS_TOKEN}
x-myobapi-key: {API_KEY}
x-myobapi-version: v2
```

Expected: `200 OK` with `{ "Count": …, "Items": [ … ], "NextPageLink": … }`. If you get:

- **401** → access token bad/expired → refresh.
- **403 `Name: "RateLimitError"`** → you hit 8 req/s; back off.
- **403 `Name: "DeveloperInactive"`** → API key not approved or revoked → contact MYOB.
- **403 `Name: "AccessDenied"`** → user isn't an Administrator on this company file.
- **400 missing `businessId`** → you skipped `prompt=consent` in the authorize URL.

For the full error map, see `01d-event-and-error-handling.md`.

---

## 8. Sandbox & testing

- Sandbox access is provisioned by MYOB on a per-developer basis; you'll receive an invite to a shared sandbox company file after your developer registration is approved.
- For load/perf testing locally, install AccountRight desktop and point at `http://localhost:8080/accountright/`.
- Apideck and ocerra both note MYOB servers slow significantly between the 20th of each month and the 5th of the next (end-of-month batch processing) — keep that out of any latency baselines.

---

## 9. Rate limits & timeouts (operational summary)

| Limit           | Value                         | Signal                           |
| --------------- | ----------------------------- | -------------------------------- |
| Per-second      | 8 req/s                       | `403` + `Name: "RateLimitError"` |
| Daily           | 1,000,000 req/day per API key | `403` + `Name: "RateLimitError"` |
| Request timeout | ~30 s                         | `504` + `Name: "GatewayTimeout"` |

Note: rate-limit responses use **HTTP 403** (not 429). Distinguish from auth failures by inspecting the response body's `Name` field.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

---

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
