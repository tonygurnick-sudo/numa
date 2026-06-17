---
api_name: MYOB AccountRight (MYOB Business API v2)
api_slug: myob-account-right
base_url: https://api.myob.com/accountright/{businessId}
path_template: {METHOD} https://api.myob.com/accountright/{businessId}/{Resource}
path_version_segment: none (version is the HEADER x-myobapi-version:v2, NOT a path prefix; never put /v2/ in a path)
businessId: GUID path segment, in user secret, REQUIRED on every call (extracted from OAuth redirect)
auth: Bearer {access_token} + x-myobapi-key:{api_key} (BOTH required; bearer alone → 403 DeveloperInactive)
field_casing: PascalCase, case-sensitive (LastModified, IsActive, Status, CompanyName)
id_format: GUID/UID (UUID v4 string)
query_protocol: OData v2 ($top/$skip/$orderby/$filter); v3 ops any/all supported
rate_limit: 8 req/s + 1,000,000/day per api_key → 403 RateLimitError (NOT 429); timeout ~30s → 504 GatewayTimeout
call_surface: HTTP via "numa integrations request" (NOT file-browse, NOT MCP)
local_files: swap api.myob.com→localhost:8080, add header x-myobapi-cftoken:base64(user:pass)
confidence: facts are [DOCUMENTED] from MYOB docs/SDK unless tagged [INFERRED] (not live-confirmed; verify against sandbox) or [UNKNOWN]
companions: 01a=entities, 01b=queries, 01c=mutations, 01d=errors, 02=endpoint catalogue, 03=MYOB setup, 04=Numa wiring
---

# MYOB AccountRight — API Rules

## Paths (read first)

- `{METHOD} https://api.myob.com/accountright/{businessId}/{Resource}`. `{businessId}` (GUID, from user secret) is required on EVERY call.
- NO version path segment. Version is the header `x-myobapi-version: v2`. `/v2/...` in a path → wrong.
- `{Resource}` examples: `Contact/Customer`, `Sale/Invoice/Item`, `GeneralLedger/Account`.
- Local desktop files: `localhost:8080` instead of `api.myob.com`, plus header `x-myobapi-cftoken: base64(user:pass)`.

## Auth (every call)

```
Authorization: Bearer {access_token}
x-myobapi-key:  {api_key}
x-myobapi-version: v2
Content-Type:   application/json    # POST/PUT only
Accept:         application/pdf     # PDF download only
```

BOTH `Authorization` and `x-myobapi-key` required — bearer alone → `403 DeveloperInactive`.

## Five rules you must not forget

1. **Rate limit = 403, NOT 429.** Inspect response `Name`: `RateLimitError` → backoff+retry; `AccessDenied`/`DeveloperInactive` → do NOT retry.
2. **PUT requires current `RowVersion`.** GET the entity, copy its `RowVersion` into the PUT body. Stale → `409 IncorrectRowVersionSupplied` → re-GET + retry.
3. **Refresh tokens rotate.** Every refresh returns a NEW `refresh_token`; persist it, old one is dead.
4. **OData field names are case-sensitive PascalCase.** Wrong case → wrong results, silently.
5. **Line items reference UIDs, never inline objects.** Before POSTing an invoice, fetch Customer UID + Item UID + TaxCode UID + income Account UID. Sequence in `01c`.

## Defaults

|                       | Value                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| Page size (`$top`)    | 400 default · 1000 max                                                           |
| Pagination            | OData v2 (`$top`+`$skip`); response has `NextPageLink` (null/absent = last page) |
| Date filter syntax    | `datetime'2024-06-15'`                                                           |
| Cross-entity refs     | `{ "UID": "{guid}" }`                                                            |
| Change detection      | poll `?$filter=LastModified ge datetime'...'` (NO webhooks)                      |
| Daily / per-sec limit | 1,000,000/day · 8 req/s per api_key → 403 `RateLimitError`                       |
| Timeout               | ~30s → 504 `GatewayTimeout` (spikes ~20th–5th of month)                          |

## Capabilities

**Can:** create/read/update/delete contacts, invoices (Item/Service/Professional/TimeBilling/Miscellaneous), bills, customer/supplier payments, banking txns, general journals, inventory items. Email invoices (cloud files only). Download invoice PDFs (`Accept: application/pdf`). OData `$filter`/`$orderby`/`$top`/`$skip`.
**Cannot:** subscribe to webhooks (poll instead). Create items inline in invoice lines. DELETE transactions when company file has "must be reversed" set (error 25003 → POST a reversal). Foreign-currency quotes. List company files via `GET /accountright/` (deprecated post-March 2025). Use legacy `CompanyFile` scope (use `sme-*`).

## Hot-path queries (more in 01b)

```http
GET /Contact/Customer?$filter=IsActive eq true&$top=1000
GET /Sale/Invoice/Item?$filter=LastModified ge datetime'2024-06-01'&$orderby=LastModified asc&$top=1000   # incremental sync
GET /Sale/Invoice/Item?$filter=Customer/UID eq guid'{customer_uid}' and Status eq 'Open'
GET /GeneralLedger/Account?$filter=Type eq 'Income'&$orderby=Number asc
GET /Sale/Invoice/Item/{uid}    # with header Accept: application/pdf → PDF
```

## Hot-path mutation (more in 01c)

Create an invoice — every `{ "UID": "..." }` must already exist:

```json
POST /Sale/Invoice/Item
{"Date":"2024-06-15T00:00:00","Customer":{"UID":"{customer_uid}"},"Number":"INV-0001","Lines":[{"LineType":"Transaction","Item":{"UID":"{item_uid}"},"Description":"Widget A — 10 units","ShipQuantity":10,"UnitPrice":99.99,"TaxCode":{"UID":"{taxcode_uid}"},"Account":{"UID":"{income_account_uid}"}}]}
```

## Error → action (full table + retry pseudocode in 01d)

| Status + body `Name`                                         | Action                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 200 / 201                                                    | process response                                                              |
| 400 `Required`/`NotFound`/`SerializationError`               | fix payload — do not retry                                                    |
| 400 `DatePriorToBeginningOfFinancialYear`/`DateInLockPeriod` | use a date in the current open period — do not retry                          |
| 400 `TransactionsCannotBeDeleted` (25003)                    | POST a reversal instead of DELETE                                             |
| 400 `FreightHasNotBeenSet`                                   | add `FreightTaxCode:{"UID":"..."}` to payload                                 |
| 401                                                          | refresh access token, retry once; if still 401 → surface "reconnect required" |
| 403 `RateLimitError`                                         | exponential backoff (2^attempt s), retry ≤3×                                  |
| 403 `DeveloperInactive`/`AccessDenied`                       | do NOT retry — config/permission issue                                        |
| 404                                                          | entity doesn't exist — verify UID                                             |
| 409 `IncorrectRowVersionSupplied`                            | re-GET entity, copy fresh `RowVersion`, retry once                            |
| 504 `GatewayTimeout`                                         | linear backoff (5×attempt s), retry ≤3×                                       |

## OAuth (post-March 2025; full flow in 03/04)

```
GET https://secure.myob.com/oauth2/account/authorize
  ?client_id={KEY}&redirect_uri={URI}&response_type=code
  &scope=sme-company-file sme-contacts-customer sme-sales
  &prompt=consent          ← MANDATORY (without it, redirect omits businessId)
```

Redirect carries `code` + `businessId` + `businessName`. Exchange code at `POST https://secure.myob.com/oauth2/v1/authorize` (form-encoded, `grant_type=authorization_code`). Refresh at the same URL with `grant_type=refresh_token`. **Persist the rotated `refresh_token`.**
Scopes use `sme-*` prefix: `sme-company-file` (always) + granular for data areas touched (`sme-sales`, `sme-purchases`, `sme-contacts-customer`, `sme-general-ledger`, `sme-banking`, `sme-inventory`, `sme-payroll`, …).
**Only Administrator users can authorise** — non-admins fail at the consent screen.

## Known [UNKNOWN]s

- Access/refresh token lifetimes — MYOB doesn't publish; trust `expires_in` from each response, refresh defensively on 401.
- Some response field names are [INFERRED] from pymyob SDK + apideck guide, not live-confirmed — `01a` flags these; verify against sandbox.
