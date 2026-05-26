# LLM Cheat Sheet — MYOB AccountRight (MYOB Business API v2)

> Chat-time reference loaded into the agent context. For deeper reading, see the other files in this folder (`00-…` long-form, `01a-…` entities, `01b-…` queries, `01c-…` mutations, `01d-…` errors, `02-…` endpoint catalogue, `03-…` Numa wiring).

---

## Base URL & call shape

```
{METHOD} https://api.myob.com/accountright/{businessId}/{Resource}
Authorization: Bearer {access_token}
x-myobapi-key:  {api_key}
x-myobapi-version: v2
Content-Type:   application/json    # POST/PUT only
```

- `{businessId}` is in the user secret — extracted at OAuth time from the redirect URI. **Every** call needs it.
- Local desktop files: swap `api.myob.com` for `localhost:8080` and add `x-myobapi-cftoken: base64(user:pass)`.

---

## Five rules you must not forget

1. **Rate limit = 403, not 429.** Inspect the response `Name` field: `RateLimitError` → backoff and retry; `AccessDenied` / `DeveloperInactive` → do NOT retry.
2. **PUT requires the current `RowVersion`.** Always GET the entity, copy `RowVersion` into your PUT payload. Stale `RowVersion` → `409 IncorrectRowVersionSupplied` → re-fetch + retry.
3. **Refresh tokens rotate.** Every successful refresh returns a NEW `refresh_token`. Persist it; the old one is dead.
4. **OData field names are case-sensitive.** `LastModified`, `IsActive`, `Status`, `CompanyName`. Wrong case → wrong results, silently.
5. **Line items reference UIDs, never inline objects.** Before POSTing an invoice, fetch the Customer UID, the Item UID, the TaxCode UID, and the income Account UID. See `01c-mutation-patterns.md` for the lookup sequence.

---

## Defaults at a glance

|                    | Value                                                            |
| ------------------ | ---------------------------------------------------------------- |
| Page size (`$top`) | 400 default · 1000 max                                           |
| Pagination         | OData v2 (`$top` + `$skip`); response has `NextPageLink`         |
| Per-second limit   | 8 req/s → 403 + `RateLimitError`                                 |
| Daily limit        | 1,000,000 req/day per API key                                    |
| Request timeout    | ~30s → 504 + `GatewayTimeout` (spikes around 20th–5th of month)  |
| Date filter syntax | `datetime'2024-06-15'`                                           |
| Cross-entity refs  | `{ "UID": "{guid}" }`                                            |
| Change detection   | Poll with `?$filter=LastModified ge datetime'...'` (no webhooks) |

---

## Capabilities

**Can:** create/read/update/delete contacts, invoices (5 variants), bills, customer/supplier payments, banking transactions, general journals, inventory items. Email invoices (cloud files only). Download invoice PDFs (`Accept: application/pdf`). OData `$filter`/`$orderby`/`$top`/`$skip`.

**Cannot:** subscribe to webhooks (poll instead). Create items inline in invoice lines. Delete transactions when the company file has "must be reversed" set (error 25003 — POST a reversal instead). Use foreign-currency quotes. List company files via `GET /accountright/` (deprecated post-March 2025). Use the legacy `CompanyFile` scope (use `sme-*`).

---

## Hot-path query examples

```http
# Active customers
GET /Contact/Customer?$filter=IsActive eq true&$top=1000

# Invoices modified since (incremental sync)
GET /Sale/Invoice/Item?$filter=LastModified ge datetime'2024-06-01'&$orderby=LastModified asc&$top=1000

# Open invoices for a specific customer
GET /Sale/Invoice/Item?$filter=Customer/UID eq guid'{customer_uid}' and Status eq 'Open'

# Chart of accounts — income only
GET /GeneralLedger/Account?$filter=Type eq 'Income'&$orderby=Number asc

# Invoice as PDF
GET /Sale/Invoice/Item/{uid}
Accept: application/pdf
```

For more, read `01b-query-patterns.md`.

---

## Hot-path mutation skeleton

Creating an invoice — full payload structure (every `{ "UID": "..." }` must already exist):

```json
POST /Sale/Invoice/Item
{
  "Date": "2024-06-15T00:00:00",
  "Customer": { "UID": "{customer_uid}" },
  "Number":   "INV-0001",
  "Lines": [
    {
      "LineType":    "Transaction",
      "Item":        { "UID": "{item_uid}" },
      "Description": "Widget A — 10 units",
      "ShipQuantity": 10,
      "UnitPrice":    99.99,
      "TaxCode":     { "UID": "{taxcode_uid}" },
      "Account":     { "UID": "{income_account_uid}" }
    }
  ]
}
```

For all other mutations and the prerequisite-lookup sequencing, read `01c-mutation-patterns.md`.

---

## Error → action

| Status + body                                                  | Action                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `200` / `201`                                                  | Process response                                                                      |
| `400 Required` / `NotFound` / `SerializationError`             | Fix payload — do not retry                                                            |
| `409 IncorrectRowVersionSupplied`                              | Re-GET entity, copy fresh `RowVersion`, retry once                                    |
| `400 DatePriorToBeginningOfFinancialYear` / `DateInLockPeriod` | Use a date in the current open period — do not retry                                  |
| `400 TransactionsCannotBeDeleted` (25003)                      | POST a reversal instead of DELETE                                                     |
| `400 FreightHasNotBeenSet`                                     | Add `FreightTaxCode: { "UID": "..." }` to payload                                     |
| `401`                                                          | Refresh access token, retry once. If still 401, surface "reconnect required" to user. |
| `403 RateLimitError`                                           | Exponential backoff (2^attempt seconds), retry up to 3×                               |
| `403 DeveloperInactive` / `AccessDenied`                       | Do NOT retry — config/permission issue                                                |
| `404`                                                          | Entity doesn't exist — verify UID                                                     |
| `504 GatewayTimeout`                                           | Linear backoff (5×attempt seconds), retry up to 3×                                    |

Full table + retry pseudocode in `01d-event-and-error-handling.md`.

---

## OAuth (Post-March 2025)

```
GET https://secure.myob.com/oauth2/account/authorize
  ?client_id={KEY}
  &redirect_uri={URI}
  &response_type=code
  &scope=sme-company-file sme-contacts-customer sme-sales
  &prompt=consent          ← MANDATORY
```

Redirect carries `code` + `businessId` + `businessName`. Exchange code at `POST https://secure.myob.com/oauth2/v1/authorize` (form-encoded, `grant_type=authorization_code`). Refresh at the same URL with `grant_type=refresh_token`. **Persist the rotated `refresh_token`.**

OAuth scopes use `sme-*` prefix — `sme-company-file` (always), plus the granular ones for the data areas you touch (`sme-sales`, `sme-purchases`, `sme-contacts-customer`, `sme-general-ledger`, `sme-banking`, `sme-inventory`, `sme-payroll`, …). Full list in `00-api-investigation.md` Phase 4.

**Only Administrator users can authorise.** Non-admins fail at the consent screen.

---

## Known [UNKNOWN]s

- Exact access-token + refresh-token lifetimes — MYOB doesn't publish, so the connector must trust `expires_in` from each token response and refresh defensively on 401.
- Some response-body field names are [INFERRED] from the pymyob SDK + apideck guide rather than confirmed against a live call — `01a-domain-model-reference.md` flags these. Verify when the sandbox is available.
