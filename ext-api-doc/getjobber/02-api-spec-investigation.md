---
doc: api-spec-investigation
api: Jobber (GraphQL)
api_style: GraphQL only (NO REST)
endpoint: POST https://api.getjobber.com/api/graphql
path_version_segment: none — version is the X-JOBBER-GRAPHQL-VERSION header, not a path
auth: OAuth 2.0 Authorization Code; Bearer {JWT}
confidence: everything verified live against the introspectable schema 2026-05-19 unless tagged [DOCUMENTED]/[UNKNOWN]
---

# API Spec Investigation — Jobber (GraphQL)

## API Identity

| Property                    | Value                                               |
| --------------------------- | --------------------------------------------------- |
| Vendor                      | Jobber Software Inc.                                |
| API style                   | GraphQL only (no REST)                              |
| Endpoint                    | `POST https://api.getjobber.com/api/graphql`        |
| Schema introspection        | Enabled, unauthenticated                            |
| Developer portal            | https://developer.getjobber.com (Cloudflare-walled) |
| Status page                 | https://status.getjobber.com                        |
| Latest verified API version | `2025-04-16` (header value, not a path)             |

## Authentication

| Property              | Value                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth type             | OAuth 2.0 Authorization Code                                                                                                                                   |
| Authorize URL         | `https://api.getjobber.com/api/oauth/authorize`                                                                                                                |
| Token URL             | `https://api.getjobber.com/api/oauth/token`                                                                                                                    |
| Revoke URL            | `https://api.getjobber.com/api/oauth/revoke`                                                                                                                   |
| Auth header           | `Authorization: Bearer {access_token}`                                                                                                                         |
| Access token format   | JWT                                                                                                                                                            |
| Access token lifetime | 60 min (3600 s) [DOCUMENTED — developer.getjobber.com/docs/building_your_app/app_authorization]                                                                |
| Refresh rotation      | App-configurable per app ("Refresh Token Rotation" ON/OFF). ON → new `refresh_token` each refresh; OFF → original keeps working. [DOCUMENTED]                  |
| Token response        | `{ "access_token": "...JWT...", "refresh_token": "..." }` — no `expires_in`/`token_type`/`scope` in Jobber's example. Decode JWT `exp` for expiry.             |
| Scope vocabulary      | `read_<entity>`/`write_<entity>` (e.g. `read_clients`, `write_jobs`). Full scope-list page 404'd at URLs tried — check developer.getjobber.com when logged in. |

## Required headers

| Header                     | Value                   | Required                                  |
| -------------------------- | ----------------------- | ----------------------------------------- |
| `Authorization`            | `Bearer {access_token}` | Yes (for data queries)                    |
| `Content-Type`             | `application/json`      | Yes                                       |
| `Accept`                   | `application/json`      | Standard                                  |
| `X-JOBBER-GRAPHQL-VERSION` | `2025-04-16`            | Strongly recommended (calendar-versioned) |

## Pagination — Relay-style Connection

Every list field returns a Connection:

```graphql
{ nodes { … } edges { node { … } cursor } pageInfo { endCursor hasNextPage hasPreviousPage } totalCount }
```

Args (per connection): `first: Int`/`after: String` (forward), `last: Int`/`before: String` (backward), `offset: Int`, `sort: { key, direction }`, `filter: { … }` (per-connection input types — introspect each).

## Schema scale

| Metric                              | Count |
| ----------------------------------- | ----- |
| Query fields                        | 348   |
| Mutation fields                     | 556   |
| Domain object types                 | 1,973 |
| Webhook topics (`WebHookTopicEnum`) | 46    |

## Core query catalogue (representative — 348 total; discover rest via `query { __schema { queryType { fields { name description } } } }`)

**Account/config:** `account`, `users(first,after,…)`, `appAlerts`, `apps(searchTerm,…)`, `accountPlanInfo`, `availableBillingCountries`.
**Clients (CRM):** `clients(first,after,filter,sort,searchTerm)`, `client(id)`, `clientMeta(id)`, `clientEmails(searchTerm,…)`, `clientBalanceReport(filter,sort,…)`, `clientBalanceOverview(filter)`, `blankClient` (empty client for form templates).
**Properties/sites:** `property(id)`; properties listed via `client.clientProperties`.
**Quotes:** `quotes(first,filter,sort,…)`, `quote(id)`.
**Jobs:** `jobs(first,filter,sort,…)`, `job(id)`, `averageJobValue(filter)`.
**Visits/schedule:** `visit(id)`; lists via `job.visits` or `property.scheduledItems`.
**Invoices/payments/payouts:** `invoices(first,filter,sort,…)`, `invoice(id)`, `billingPayments(first,…)` (account payments, max 12 records inc. failed).
**Requests (leads):** `assessment(id)`, `assessmentFormSubmission(formId,assessmentId)`.
**Catalog/line items:** `catalogItems(searchTerm,sort,…)`, `catalogItem(catalogItemId,sort)`, `catalogItemCustomPricing(items,…)`.
**Automation:** `automationRules(filter,…)`, `automationRule(id)`, `automationRuleBuilder`, `automationTasks(objectType,automationRulePhase,…)`.
**Reports:** `clientBalanceReport(filter,sort,…)`, `businessHealthOverview(filter)`, `aiReceptionistUsageAndActivityReport(filter,…)`.
**Jobber-specific (less common):** `aiAssistant*`, `aiReceptionist*` (Copilot/receptionist), `capitalLoans`/`capitalLendingAssociation` (Jobber Capital), `businessCoachingGoals`, `assetBookkeepingAuthToken`, `callToAction(s)`.

## Core mutation catalogue (representative — 556 total)

**Client (CRM):** `clientCreate`, `clientEdit`, `clientDelete`, `clientArchive`, `clientUnarchive`, `clientsCreate`, `clientsDelete`, `clientsEditTags`, `clientsImport`, `clientsImportRevert`, `clientExport`, `clientCreateNote`, `clientEditNote`, `clientDeleteNote`, `clientNoteAddAttachment`, `clientCreatePaymentRecord`, `clientHubAccountEdit`, `clientHubReferralSettingsUpsert`.
**Quote:** `quoteCreate`, `quoteEdit`, `quoteDelete`, `quoteArchive`, `quoteSend`, `quoteApprove`, `quoteRevise`, `quoteCreateNote`, `quoteEditNote`, `quoteDeleteNote`, `quoteCreateLineItems`, `quoteEditLineItems`, `quoteDeleteLineItems`, `quoteCollectSignature`, `quoteEditDeposit` (verify exact names via introspection).
**Job:** `jobCreate`, `jobEdit`, `jobDelete`, `jobClose`, `jobReopen`, `jobCreateFromQuote`, `jobCreateLineItems`, `jobEditLineItems`, `jobEditLineItemsSection`, `jobOrderLineItems`, `jobDeleteLineItems`, `jobCreateNote`, `jobEditNote`, `jobDeleteNote`, `jobNoteAddAttachment`, `jobCollectSignature`, `jobCreateJobCosting`, `jobEditJobForms`, `jobFormCreate`, `jobFormEdit`, `jobFormDelete`, `jobExportCsv`, `jobExternalTransactionLink`, `jobExternalTransactionLinkBulk`, `jobFollowUpSurveySendEmail`, `jobPushToQuickBooks`, `jobReportExportCsv`.
**Visit/appointment:** `appointmentEditSchedule`, `appointmentEditAssignment`, `appointmentEditCompleteness` — unified across Visit, Task, Assessment, Event.
**Invoice:** `invoiceCreate`, `invoiceCreateFromJob`, `invoiceCreateFromQuote`, `invoiceCreateFromVisits`, `invoiceEdit`, `invoiceDelete`, `invoiceClose`, `invoiceReopen`, `invoiceMarkAsSent`, `invoiceUnmarkBadDebt`, `invoicePushToQuickBooks`, `invoiceCreatePaymentRecord`, `invoiceCreateLineItems`, `invoiceEditLineItems`, `invoiceDeleteLineItems`, `invoiceEditTotals`, `invoiceRemoveTaxRate`, `invoiceReminderCreate`, `invoiceReminderEdit`, `invoiceReminderDelete`, `invoiceCreateNote`, `invoiceEditNote`, `invoiceDeleteNote`, `invoiceCollectSignature`.
**Webhook:** `webhookEndpointCreate`, `webhookEndpointDelete`.
**Payments:** `jobberPaymentsCreateRefunds`, `jobberPaymentsEnabledStatusUpdate`, `jobberPaymentsLimitsChangeRequestCancel`, `achPayment`, `batchCardOnFileRequesterCreate`.
**App lifecycle:** `appDisconnect`, `appRemove`, `appAlertEdit`, `appInstanceLastSyncDateEdit`, `appRequestCreate`.

## Status enums (verified)

| Enum                    | Values                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `JobStatusTypeEnum`     | `requires_invoicing`, `archived`, `late`, `today`, `upcoming`, `action_required`, `on_hold`, `unscheduled`, `active`, `expiring_within_30_days` |
| `InvoiceStatusTypeEnum` | `draft`, `awaiting_payment`, `paid`, `past_due`, `bad_debt`, `sent_not_due`                                                                     |
| `QuoteStatusTypeEnum`   | `draft`, `awaiting_response`, `archived`, `approved`, `converted`, `changes_requested`                                                          |

## Error reference (full table in `01d`)

| HTTP                                                         | Shape                                          | Cause                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| 200 + `errors` array                                         | GraphQL field error                            | inspect `extensions.code` (UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, BAD_USER_INPUT) |
| 200 + populated `userErrors` in mutation payload             | business-rule rejection                        | inspect `userErrors[].message` + `path`                                           |
| 401 + `{message:"Token not recognized"}`                     | bad bearer token                               | refresh OAuth                                                                     |
| 404 + `{message:"GraphQL API version '...' does not exist"}` | bad version header                             | fix `X-JOBBER-GRAPHQL-VERSION`                                                    |
| 429 + `errors[].extensions.code:"THROTTLED"`                 | exceeded 2,500 req/5 min OR query-cost ceiling | exponential backoff; no `Retry-After` header                                      |
| 5xx                                                          | server error                                   | retry w/ backoff; check status.getjobber.com                                      |

## SDKs

| Resource                  | URL                                        | Notes                                                                          |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| GraphQL endpoint          | https://api.getjobber.com/api/graphql      | Use directly — no SDK required                                                 |
| `Fundthrough/jobber-ruby` | https://github.com/Fundthrough/jobber-ruby | DEPRECATED REST client — do NOT use as a reference for the current GraphQL API |

No widely-maintained third-party GraphQL SDK. Integrate directly.

## Rate limits [DOCUMENTED — developer.getjobber.com/docs/using_jobbers_api/api_rate_limits, 2026-05-19]

Two independent limits per app per account:

- Request rate: **2,500 requests / 5 minutes** (≈8.3 RPS sustained).
- Query cost: each field = 1 pt; `edges`/`nodes`/`node` = 0 pt; connection cost = `first` (or `last`) × fields-per-node. E.g. `clients(first:10){ nodes { id firstName lastName email phone } }` = 10 × 5 = 50 pts. Default cap when no `first`/`last` = 100 nodes.

Exceeded → **HTTP 429 + GraphQL `errors[].extensions.code:"THROTTLED"`**. No `Retry-After`/`X-RateLimit-*` headers; exponential backoff (1s, 2s, 4s …).

## Versioning policy [DOCUMENTED — developer.getjobber.com/docs/using_jobbers_api/api_versioning, 2026-05-19]

- **Required:** `X-JOBBER-GRAPHQL-VERSION: YYYY-MM-DD` on every request (a HEADER, not a path segment).
- New versions published only on breaking/dangerous changes (irregular).
- Support window: minimum 12 months, max 18 months from release. Old versions removed in batches every 6 months.
- Latest as of 2026-05-19: `2025-04-16` (from developer.getjobber.com/docs/changelog).
- Active versions today: `2025-04-16`, `2025-01-20`, `2024-12-05`, `2024-11-12`, `2024-11-07`, `2024-09-23`, `2024-09-12`, `2024-08-30`, `2024-06-10`, `2024-04-17`, `2023-11-15`, `2023-08-18`, `2023-05-05`, `2023-03-29`, `2022-12-07`, `2022-09-15`, `2022-05-23`.

## Unknowns requiring live testing

| Unknown                                       | How to verify                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Refresh token lifetime                        | Wait + attempt refresh; observe expiry                                                                                         |
| Full scope vocabulary                         | Scope-list sub-pages 404'd; check developer.getjobber.com OAuth app config (login) or test scope strings against authorize URL |
| Webhook payload signature format              | Subscribe to a topic, trigger an event, inspect the HTTP POST headers + body                                                   |
| Query-cost ceiling per request                | Test progressively larger `first` × fields-per-node until `THROTTLED`                                                          |
| `userErrors` exhaustive shape (`code` field?) | Trigger a known-bad mutation in a sandbox account, inspect the response                                                        |
