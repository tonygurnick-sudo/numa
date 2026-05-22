# API Spec Investigation — Jobber (GraphQL)

> Clean consolidated reference. Everything verified live against the introspectable schema at `https://api.getjobber.com/api/graphql` (2026-05-19) unless marked otherwise.

---

## API Identity

| Property                    | Value                                               |
| --------------------------- | --------------------------------------------------- |
| Vendor                      | Jobber Software Inc.                                |
| Product                     | Jobber                                              |
| API style                   | **GraphQL only**                                    |
| Endpoint                    | `POST https://api.getjobber.com/api/graphql`        |
| Schema introspection        | Enabled, unauthenticated                            |
| Developer portal            | https://developer.getjobber.com (Cloudflare-walled) |
| Status page                 | https://status.getjobber.com                        |
| Latest verified API version | `2025-04-16`                                        |

---

## Authentication

| Property                            | Value                                                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth type                           | OAuth 2.0 Authorization Code                                                                                                                                                                         |
| Authorize URL                       | `https://api.getjobber.com/api/oauth/authorize`                                                                                                                                                      |
| Token URL                           | `https://api.getjobber.com/api/oauth/token`                                                                                                                                                          |
| Revoke URL                          | `https://api.getjobber.com/api/oauth/revoke`                                                                                                                                                         |
| Auth header                         | `Authorization: Bearer {access_token}`                                                                                                                                                               |
| Access token format                 | JWT                                                                                                                                                                                                  |
| Access token lifetime               | **60 minutes (3600 s)** [DOCUMENTED — developer.getjobber.com/docs/building_your_app/app_authorization]                                                                                              |
| Refresh rotation                    | App-configurable per Jobber app ("Refresh Token Rotation" ON/OFF). ON → new `refresh_token` returned on every refresh; OFF → original keeps working. [DOCUMENTED]                                    |
| Token response (documented example) | `{ "access_token": "...JWT...", "refresh_token": "..." }` — no `expires_in` / `token_type` / `scope` fields shown in Jobber's example. Decode JWT `exp` for expiry.                                  |
| Scope vocabulary                    | `read_<entity>` / `write_<entity>` (e.g. `read_clients`, `write_jobs`). Full scope list page on dev portal returned 404 at the URLs I tried — check developer.getjobber.com directly when logged in. |

---

## Required Headers

| Header                     | Value                   | Required                                  |
| -------------------------- | ----------------------- | ----------------------------------------- |
| `Authorization`            | `Bearer {access_token}` | Yes (for data queries)                    |
| `Content-Type`             | `application/json`      | Yes                                       |
| `Accept`                   | `application/json`      | Standard                                  |
| `X-JOBBER-GRAPHQL-VERSION` | `2025-04-16`            | Strongly recommended (calendar-versioned) |

---

## Pagination — Relay-style Connection

Every list field returns a Connection with the standard shape:

```graphql
{
  nodes { … }
  edges { node { … } cursor }
  pageInfo {
    endCursor
    hasNextPage
    hasPreviousPage
  }
  totalCount
}
```

Pagination args (per Connection):

- `first: Int`, `after: String` — forward
- `last: Int`, `before: String` — backward
- `offset: Int` — also supported
- `sort: { key, direction }`, `filter: { … }` — per-connection input types (introspect each one)

---

## Schema scale

| Metric                              | Count  |
| ----------------------------------- | ------ |
| Query fields                        | 348    |
| Mutation fields                     | 556    |
| Domain object types                 | 1,973  |
| Enum types                          | (many) |
| Webhook topics (`WebHookTopicEnum`) | 46     |

---

## Core Query Catalogue (representative — 348 total)

Pick the most useful for an integrator. Use schema introspection to discover the rest:
`query { __schema { queryType { fields { name description } } } }`

### Account / config

| Query                       | Description                                   |
| --------------------------- | --------------------------------------------- |
| `account`                   | The account the authenticated user belongs to |
| `users(first, after, …)`    | Account users (staff)                         |
| `appAlerts`                 | App-level alerts for the account              |
| `apps(searchTerm, …)`       | Installed/available apps                      |
| `accountPlanInfo`           | Subscription plan                             |
| `availableBillingCountries` | List of supported countries                   |

### Clients (CRM)

| Query                                             | Description                                          |
| ------------------------------------------------- | ---------------------------------------------------- |
| `clients(first, after, filter, sort, searchTerm)` | List clients                                         |
| `client(id)`                                      | Single client by EncodedId                           |
| `clientMeta(id)`                                  | Metadata for a client                                |
| `clientEmails(searchTerm, …)`                     | Search across client email addresses                 |
| `clientBalanceReport(filter, sort, …)`            | Outstanding balance report                           |
| `clientBalanceOverview(filter)`                   | Aggregate balance overview                           |
| `blankClient`                                     | Returns an "empty" client (handy for form templates) |

### Properties / sites

| Query                                                        | Description     |
| ------------------------------------------------------------ | --------------- |
| `property(id)`                                               | Single property |
| (properties listed via `client.clientProperties` connection) |                 |

### Quotes

| Query                            | Description  |
| -------------------------------- | ------------ |
| `quotes(first, filter, sort, …)` | List quotes  |
| `quote(id)`                      | Single quote |

### Jobs

| Query                          | Description         |
| ------------------------------ | ------------------- |
| `jobs(first, filter, sort, …)` | List jobs           |
| `job(id)`                      | Single job          |
| `averageJobValue(filter)`      | Aggregate job value |

### Visits / Schedule

| Query                                                 | Description  |
| ----------------------------------------------------- | ------------ |
| `visit(id)`                                           | Single visit |
| (lists via `job.visits` or `property.scheduledItems`) |              |

### Invoices / Payments / Payouts

| Query                              | Description                                           |
| ---------------------------------- | ----------------------------------------------------- |
| `invoices(first, filter, sort, …)` | List invoices                                         |
| `invoice(id)`                      | Single invoice                                        |
| `billingPayments(first, …)`        | Payments for the account (max 12 records inc. failed) |

### Requests (inbound leads)

| Query                                            | Description                       |
| ------------------------------------------------ | --------------------------------- |
| `assessment(id)`                                 | On-site assessment booking        |
| `assessmentFormSubmission(formId, assessmentId)` | Form submission for an assessment |

### Catalog / line items

| Query                                | Description                                        |
| ------------------------------------ | -------------------------------------------------- |
| `catalogItems(searchTerm, sort, …)`  | Catalog items (product/service list)               |
| `catalogItem(catalogItemId, sort)`   | Single catalog item                                |
| `catalogItemCustomPricing(items, …)` | Custom pricing for items from connected supply app |

### Automation

| Query                                                 | Description                                          |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `automationRules(filter, …)`                          | Account automation rules                             |
| `automationRule(id)`                                  | Single rule                                          |
| `automationRuleBuilder`                               | List of models + trigger events the builder supports |
| `automationTasks(objectType, automationRulePhase, …)` | Fetch automation tasks for an object type / phase    |

### Reports

| Query                                             | Description                        |
| ------------------------------------------------- | ---------------------------------- |
| `clientBalanceReport(filter, sort, …)`            | Client balance report              |
| `businessHealthOverview(filter)`                  | Business health overview           |
| `aiReceptionistUsageAndActivityReport(filter, …)` | AI Receptionist usage (if enabled) |

### Jobber-specific surface (less common for integrators)

`aiAssistant*`, `aiReceptionist*` — Copilot / receptionist features
`capitalLoans`, `capitalLendingAssociation` — Jobber Capital lending
`businessCoachingGoals` — Coaching module
`assetBookkeepingAuthToken` — Asset Bookkeeping component
`callToAction(s)` — CTAs / promotions

---

## Core Mutation Catalogue (representative — 556 total)

### Client (CRM) mutations

`clientCreate`, `clientEdit`, `clientDelete`, `clientArchive`, `clientUnarchive`, `clientsCreate`, `clientsDelete`, `clientsEditTags`, `clientsImport`, `clientsImportRevert`, `clientExport`, `clientCreateNote`, `clientEditNote`, `clientDeleteNote`, `clientNoteAddAttachment`, `clientCreatePaymentRecord`, `clientHubAccountEdit`, `clientHubReferralSettingsUpsert`

### Quote mutations

`quoteCreate`, `quoteEdit`, `quoteDelete`, `quoteArchive`, `quoteSend`, `quoteApprove`, `quoteRevise`, `quoteCreateNote`, `quoteEditNote`, `quoteDeleteNote`, `quoteCreateLineItems`, `quoteEditLineItems`, `quoteDeleteLineItems`, `quoteCollectSignature`, `quoteEditDeposit` (verify exact names via introspection)

### Job mutations

`jobCreate`, `jobEdit`, `jobDelete`, `jobClose`, `jobReopen`, `jobCreateFromQuote`, `jobCreateLineItems`, `jobEditLineItems`, `jobEditLineItemsSection`, `jobOrderLineItems`, `jobDeleteLineItems`, `jobCreateNote`, `jobEditNote`, `jobDeleteNote`, `jobNoteAddAttachment`, `jobCollectSignature`, `jobCreateJobCosting`, `jobEditJobForms`, `jobFormCreate`, `jobFormEdit`, `jobFormDelete`, `jobExportCsv`, `jobExternalTransactionLink`, `jobExternalTransactionLinkBulk`, `jobFollowUpSurveySendEmail`, `jobPushToQuickBooks`, `jobReportExportCsv`

### Visit / appointment mutations

`appointmentEditSchedule`, `appointmentEditAssignment`, `appointmentEditCompleteness` — unified across Visit, Task, Assessment, Event

### Invoice mutations

`invoiceCreate`, `invoiceCreateFromJob`, `invoiceCreateFromQuote`, `invoiceCreateFromVisits`, `invoiceEdit`, `invoiceDelete`, `invoiceClose`, `invoiceReopen`, `invoiceMarkAsSent`, `invoiceUnmarkBadDebt`, `invoicePushToQuickBooks`, `invoiceCreatePaymentRecord`, `invoiceCreateLineItems`, `invoiceEditLineItems`, `invoiceDeleteLineItems`, `invoiceEditTotals`, `invoiceRemoveTaxRate`, `invoiceReminderCreate`, `invoiceReminderEdit`, `invoiceReminderDelete`, `invoiceCreateNote`, `invoiceEditNote`, `invoiceDeleteNote`, `invoiceCollectSignature`

### Webhook mutations

`webhookEndpointCreate`, `webhookEndpointDelete`

### Payments

`jobberPaymentsCreateRefunds`, `jobberPaymentsEnabledStatusUpdate`, `jobberPaymentsLimitsChangeRequestCancel`, `achPayment`, `batchCardOnFileRequesterCreate`

### App lifecycle

`appDisconnect`, `appRemove`, `appAlertEdit`, `appInstanceLastSyncDateEdit`, `appRequestCreate`

---

## Status enums (verified)

| Enum                    | Values                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `JobStatusTypeEnum`     | `requires_invoicing`, `archived`, `late`, `today`, `upcoming`, `action_required`, `on_hold`, `unscheduled`, `active`, `expiring_within_30_days` |
| `InvoiceStatusTypeEnum` | `draft`, `awaiting_payment`, `paid`, `past_due`, `bad_debt`, `sent_not_due`                                                                     |
| `QuoteStatusTypeEnum`   | `draft`, `awaiting_response`, `archived`, `approved`, `converted`, `changes_requested`                                                          |

---

## Error Reference

See `01d-event-and-error-handling.md` for full table. Quick summary:

| HTTP                                                          | Shape                                            | Cause                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| 200 + `errors` array                                          | GraphQL field error                              | inspect `extensions.code` (UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, BAD_USER_INPUT) |
| 200 + populated `userErrors` in mutation payload              | business-rule rejection                          | inspect `userErrors[].message` + `path`                                           |
| 401 + `{message: "Token not recognized"}`                     | bad bearer token                                 | refresh OAuth                                                                     |
| 404 + `{message: "GraphQL API version '...' does not exist"}` | bad version header                               | fix `X-JOBBER-GRAPHQL-VERSION`                                                    |
| 429 + `errors[].extensions.code: "THROTTLED"`                 | exceeded 2,500 req / 5 min OR query-cost ceiling | exponential backoff; no `Retry-After` header documented                           |
| 5xx                                                           | server error                                     | retry with backoff; check status.getjobber.com                                    |

---

## SDKs

| Resource                  | URL                                        | Notes                                                                              |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| GraphQL endpoint          | https://api.getjobber.com/api/graphql      | Use directly — no SDK required                                                     |
| `Fundthrough/jobber-ruby` | https://github.com/Fundthrough/jobber-ruby | **DEPRECATED REST client** — do NOT use as a reference for the current GraphQL API |

No widely-maintained third-party GraphQL SDK exists. Integrate directly against the endpoint.

---

## Rate Limits

|                    |                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request rate       | **2,500 requests / 5 minutes** per app per account (≈8.3 RPS sustained)                                                                            |
| Query cost         | Field cost = 1 (except `edges`/`nodes`/`node` = 0). Connection cost = `first` × fields-per-node. Default cap when no `first` supplied = 100 nodes. |
| Exceeded → status  | `429 Too Many Requests`                                                                                                                            |
| Exceeded → body    | GraphQL `errors[].extensions.code: "THROTTLED"`                                                                                                    |
| Retry-After header | **Not documented** — use exponential backoff                                                                                                       |

[DOCUMENTED — developer.getjobber.com/docs/using_jobbers_api/api_rate_limits, 2026-05-19]

---

## Versioning Policy

[DOCUMENTED — developer.getjobber.com/docs/using_jobbers_api/api_versioning, 2026-05-19]

- **Required:** `X-JOBBER-GRAPHQL-VERSION: YYYY-MM-DD` on every request
- **Format:** date strings `YYYY-MM-DD` (e.g. `2025-04-16`)
- **Cadence:** new versions published only when a breaking/dangerous change is made (irregular)
- **Support window:** minimum 12 months, maximum 18 months from release
- **Removal:** old versions removed in batches every 6 months
- **Latest as of 2026-05-19:** `2025-04-16` (from developer.getjobber.com/docs/changelog)
- **Active versions today:** `2025-04-16`, `2025-01-20`, `2024-12-05`, `2024-11-12`, `2024-11-07`, `2024-09-23`, `2024-09-12`, `2024-08-30`, `2024-06-10`, `2024-04-17`, `2023-11-15`, `2023-08-18`, `2023-05-05`, `2023-03-29`, `2022-12-07`, `2022-09-15`, `2022-05-23`

---

## Unknowns Requiring Live Testing

| Unknown                                       | How to verify                                                                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh token lifetime                        | Wait + attempt refresh; observe expiry behaviour                                                                                                                       |
| Full scope vocabulary                         | Sub-pages I tried for the scope list 404'd. Check developer.getjobber.com OAuth app config UI (need login) or empirically test scope strings against the authorize URL |
| Webhook payload signature format              | Subscribe to a topic, trigger an event, inspect the HTTP POST headers + body                                                                                           |
| Query-cost ceiling per request                | Test progressively larger `first` × fields-per-node combinations until `THROTTLED` triggers                                                                            |
| `userErrors` exhaustive shape (`code` field?) | Trigger a known-bad mutation in a sandbox account, inspect the response                                                                                                |
