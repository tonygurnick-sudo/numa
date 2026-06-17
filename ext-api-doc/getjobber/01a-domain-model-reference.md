---
doc: domain-model-reference
api: Jobber (GraphQL)
endpoint: POST https://api.getjobber.com/api/graphql
id_type: EncodedId (opaque string — treat as opaque, never parse/construct)
confidence: all field names/types/enums verified via __type introspection 2026-05-19
scope_note: schema has 1,973 object types; this covers the ~10 used 95% of the time. For anything else, ask the schema directly (see end)
---

# Domain Model Reference — Jobber (GraphQL)

## Scalars

| Scalar                           | Form                                               | Example                                  |
| -------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| `EncodedId`                      | Opaque string (base64 internally; treat as opaque) | `"Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM0NQ=="` |
| `ISO8601DateTime`                | RFC3339 string                                     | `"2026-05-19T14:30:00Z"`                 |
| `ISO8601Date`                    | `YYYY-MM-DD`                                       | `"2026-05-19"`                           |
| `Float`,`Int`,`String`,`Boolean` | as expected                                        |                                          |

## Connection pattern (every list)

Every list field is a Relay Connection — same shape across the API:

```graphql
{ <listField>(first: N, after: "<cursor>", filter: { ... }, sort: { key, direction }) {
    nodes { ... }                  # the actual records
    edges { node { ... } cursor }  # alternative — exposes per-record cursor
    pageInfo { endCursor hasNextPage hasPreviousPage }
    totalCount } }                 # on most connections
```

Forward-paginate with `after: "<endCursor>"` until `hasNextPage: false`. Page size default ~20; max typically 100 (verify per endpoint).

## Account (the tenant)

Every authenticated query scoped to one Account. Fetch via top-level `account`. 40 fields total; common ones:
| Field | Type | Notes |
| --- | --- | --- |
| `id` | EncodedId | |
| `name` | String | Trading name |
| `accountOwner` | User | |
| `companyDetails` | AccountCompanyDetails | address, billing |
| `countryCode` | String | ISO 3166 alpha-2 |
| `industry` | Industry | enum-like |
| `inTrial`,`inSubscriptionPause` | Boolean | |
| `crews` | CrewConnection | field crews for scheduling |
| `connectedApps` | ApplicationConnection | installed OAuth apps |
| `dedicatedPhoneNumber` | String | if provisioned |
| `features` | object | account feature flags |
| `messages` | connection | messaging settings/templates |

## Client (customer) — main CRM entity; individual or company. 55 fields total

| Field                                | Type                       | Notes                                                |
| ------------------------------------ | -------------------------- | ---------------------------------------------------- |
| `id`                                 | EncodedId                  |                                                      |
| `firstName`,`lastName`,`companyName` | String                     |                                                      |
| `isCompany`                          | Boolean                    | true → company; false → individual                   |
| `isLead`                             | Boolean                    | lead vs converted customer                           |
| `isArchived`                         | Boolean                    | soft-deleted                                         |
| `isArchivable`                       | Boolean                    | archive allowed? (open invoices → false)             |
| `balance`                            | Float                      | outstanding across all invoices                      |
| `billingAddress`                     | ClientAddress              | `{street1,street2,city,province,postalCode,country}` |
| `billingAddressPresent`              | Boolean                    |                                                      |
| `email`                              | String                     | primary email (legacy; prefer `emails`)              |
| `emails`,`phones`                    | list                       | multiple per client                                  |
| `contacts`                           | ContactModelConnection     | additional contact persons                           |
| `clientProperties`                   | PropertyConnection         | all job sites for this client                        |
| `jobs`                               | JobConnection              |                                                      |
| `invoices`                           | InvoiceConnection          |                                                      |
| `messages`                           | MessageInterfaceConnection | inbound/outbound comms                               |
| `notes`                              | connection                 | internal notes                                       |
| `customFields`                       | list                       | account-defined                                      |
| `leadSource`                         | String                     |                                                      |
| `clientHubUserId`                    | String                     | if client has Client Hub login                       |
| `jobberWebUri`                       | String                     | direct Jobber web UI URL                             |
| `createdAt`,`updatedAt`              | ISO8601DateTime            |                                                      |

## Property (job site / address) — belongs to a Client; a Job is scheduled at a Property

| Field              | Type                             | Notes                                |
| ------------------ | -------------------------------- | ------------------------------------ |
| `id`               | EncodedId                        |                                      |
| `client`           | Client                           | owning client                        |
| `address`          | PropertyAddress                  | same shape as ClientAddress          |
| `name`             | String                           | optional label (e.g. "Main Office")  |
| `isBillingAddress` | Boolean                          | doubles as client's billing address? |
| `taxRate`          | TaxRate                          | inherited or overridden              |
| `jobs`             | JobConnection                    |                                      |
| `quotes`           | QuoteConnection                  |                                      |
| `requests`         | RequestConnection                | inbound leads                        |
| `scheduledItems`   | ScheduledItemInterfaceConnection | all scheduled visits/tasks           |
| `contacts`         | ContactModelConnection           | site-specific contacts               |
| `customFields`     | list                             |                                      |
| `routingOrder`     | Int                              | route optimisation                   |

## Request (inbound lead) — form-submitted; convert to Quote or Job

| Field          | Type       | Notes                               |
| -------------- | ---------- | ----------------------------------- |
| `id`           | EncodedId  |                                     |
| `client`       | Client     | auto-created or matched existing    |
| `property`     | Property   |                                     |
| `title`        | String     |                                     |
| `customFields` | list       |                                     |
| `assessment`   | Assessment | optional on-site assessment booking |
| `convertedTo`  | union      | Quote or Job after conversion       |

## Quote — proposal to a client. Statuses: `draft`,`awaiting_response`,`archived`,`approved`,`converted`,`changes_requested`. 46 fields total

| Field                      | Type                    | Notes                                       |
| -------------------------- | ----------------------- | ------------------------------------------- |
| `id`                       | EncodedId               |                                             |
| `client`                   | Client                  |                                             |
| `lineItems`                | QuoteLineItemConnection |                                             |
| `amounts`                  | QuoteAmounts            | `{subtotal,total,discountAmount,taxAmount}` |
| `discount`                 | CostModifier            |                                             |
| `message`                  | String                  | free-text to client                         |
| `contractDisclaimer`       | String                  |                                             |
| `clientHubUri`             | String                  | public URL client receives                  |
| `clientHubViewedAt`        | ISO8601DateTime         | when client opened it                       |
| `lastTransitioned`         | QuoteLastTransitioned   | `{status,transitionedAt}`                   |
| `eligibleForFinancing`     | Boolean                 | Wisetack financing                          |
| `consumerFinancing`        | WisetackFinanced        |                                             |
| `previewUrl`               | String                  | PDF preview                                 |
| `jobs`                     | JobConnection           | job(s) created from this quote              |
| `depositAmountUnallocated` | Float                   | deposit collected, not yet applied          |
| `depositRecords`           | PaymentRecordConnection |                                             |
| `customFields`             | list                    |                                             |
| `createdAt`,`jobberWebUri` |                         |                                             |

Create: `quoteCreate`. Approve on client's behalf: `quoteApprove`. Convert to job: `jobCreateFromQuote`.

## Job — unit of work, one-off or recurring. Statuses: `requires_invoicing`,`archived`,`late`,`today`,`upcoming`,`action_required`,`on_hold`,`unscheduled`,`active`,`expiring_within_30_days`. 57 fields total

| Field                               | Type                     | Notes                                |
| ----------------------------------- | ------------------------ | ------------------------------------ |
| `id`                                | EncodedId                |                                      |
| `jobNumber`                         | Int                      | sequential per-account               |
| `jobStatus`                         | JobStatusTypeEnum        | see above                            |
| `jobType`                           | JobTypeTypeEnum          | one-off vs recurring                 |
| `billingType`                       | BillingStrategy          | fixed, per-visit, etc.               |
| `client`                            | Client                   |                                      |
| `startAt`,`endAt`                   | ISO8601DateTime          | job-level schedule (visits have own) |
| `completedAt`                       | ISO8601DateTime          |                                      |
| `instructions`                      | String                   |                                      |
| `title`                             | via visits               |                                      |
| `lineItems`                         | JobLineItemConnection    |                                      |
| `visits`                            | connection               | scheduled appointments               |
| `invoices`                          | InvoiceConnection        |                                      |
| `invoiceSchedule`                   | InvoiceSchedule          | when to invoice                      |
| `invoicedTotal`                     | Float                    |                                      |
| `completedAndUninvoicedVisitsCount` | Int                      |                                      |
| `completedAndUninvoicedVisitsTotal` | Float                    |                                      |
| `jobBalanceTotals`                  | JobBalanceTotals         |                                      |
| `expenses`                          | ExpenseConnection        |                                      |
| `jobCosting`                        | JobCosting               |                                      |
| `jobForms`                          | FormConnection           | checklists attached                  |
| `chemicalTreatments`                | TreatmentConnection      | industry-specific (lawn care etc.)   |
| `bookingConfirmationSentAt`         | ISO8601DateTime          |                                      |
| `allowReviewRequest`                | Boolean                  |                                      |
| `feedbackResults`                   | FeedbackResultConnection | client reviews                       |
| `arrivalWindow`                     | ArrivalWindow            |                                      |
| `customFields`                      | list                     |                                      |
| `jobberWebUri`,`createdAt`          |                          |                                      |

## Visit — single scheduled appointment on a Job (multiple per Job for recurring). 36 fields total

| Field                           | Type                   | Notes                                   |
| ------------------------------- | ---------------------- | --------------------------------------- |
| `id`                            | EncodedId              |                                         |
| `job`                           | Job                    | parent                                  |
| `client`                        | Client                 | convenience                             |
| `property`                      | Property               | where the visit happens                 |
| `assignedUsers`                 | UserConnection         | team members assigned                   |
| `startAt`,`endAt`               | ISO8601DateTime        |                                         |
| `allDay`                        | Boolean                |                                         |
| `duration`                      | Int                    | seconds                                 |
| `isComplete`                    | Boolean                |                                         |
| `completedAt`,`completedBy`     |                        |                                         |
| `clientConfirmed`               | Boolean                |                                         |
| `arrivalWindow`                 | ArrivalWindow          |                                         |
| `instructions`                  | String                 |                                         |
| `lineItems`                     | JobLineItemConnection  |                                         |
| `jobForms`,`jobFormSubmissions` |                        |                                         |
| `notes`                         | JobNoteUnionConnection |                                         |
| `invoice`                       | Invoice                | invoice this visit rolled into (if any) |
| `incompleteJobFormsCount`       | Int                    |                                         |
| `routingOrder`,`overrideOrder`  | Int                    |                                         |
| `isLastScheduledVisit`          | Boolean                |                                         |
| `amounts`                       | VisitAmounts           |                                         |

## Invoice — billing document. Statuses: `draft`,`awaiting_payment`,`paid`,`past_due`,`bad_debt`,`sent_not_due`. 52 fields total

| Field                            | Type                      | Notes                                                          |
| -------------------------------- | ------------------------- | -------------------------------------------------------------- |
| `id`                             | EncodedId                 |                                                                |
| `invoiceNumber`                  | String                    | display number, NOT the EncodedId                              |
| `invoiceStatus`                  | InvoiceStatusTypeEnum     |                                                                |
| `invoiceTermType`                | PaymentTermKind           | Net 7 / Net 30 / on-receipt                                    |
| `invoiceNet`                     | Int                       | days                                                           |
| `client`                         | Client                    |                                                                |
| `issuedDate`,`dueDate`           | ISO8601DateTime           |                                                                |
| `lineItems`                      | InvoiceLineItemConnection |                                                                |
| `amounts`                        | InvoiceAmounts            | `{subtotal,total,discountAmount,taxAmount,paidAmount,balance}` |
| `discount`                       | CostModifier              |                                                                |
| `billingAddress`                 | InvoiceBillingAddress     |                                                                |
| `billingIsSameAsPropertyAddress` | Boolean                   |                                                                |
| `clientHubUri`                   | String                    | public URL client receives                                     |
| `dateViewedInClientHub`          | ISO8601DateTime           |                                                                |
| `lastCommunication`              | MessageInterface          |                                                                |
| `jobs`,`archivedJobs`            | JobConnection             |                                                                |
| `automaticPaymentsError`         | String                    | auto-pay failure reason                                        |
| `hasRefundableSurchargePayments` | Boolean                   |                                                                |
| `customFields`                   | list                      |                                                                |
| `contractDisclaimer`             | String                    |                                                                |
| `eligibleForFinancing`           | Boolean                   |                                                                |
| `consumerFinancing`              | WisetackFinanced          |                                                                |
| `createdAt`,`jobberWebUri`       |                           |                                                                |

## Payment — read-only on public schema (writes via `invoiceCreatePaymentRecord`/`clientCreatePaymentRecord`). 8 fields

| Field           | Type            | Notes                                                   |
| --------------- | --------------- | ------------------------------------------------------- |
| `id`            | EncodedId       |                                                         |
| `amount`        | Float           |                                                         |
| `currency`      | String          | ISO 4217                                                |
| `date`          | ISO8601Date     |                                                         |
| `invoiceNumber` | String          | invoice this was applied to                             |
| `invoiceUrl`    | String          |                                                         |
| `platform`      | PaymentPlatform | enum — Jobber Payments / external / cash / check / etc. |
| `success`       | Boolean         |                                                         |

## User (employee/staff). 44 fields total

| Field                          | Type                         | Notes                           |
| ------------------------------ | ---------------------------- | ------------------------------- |
| `id`                           | EncodedId                    |                                 |
| `name`                         | Name                         | `{first,last,full}`             |
| `email`                        | UserEmail                    |                                 |
| `phone`                        | UserPhone                    |                                 |
| `address`                      | UserAddress                  |                                 |
| `isAccountAdmin`               | Boolean                      |                                 |
| `isAccountOwner`               | Boolean                      | one per account                 |
| `isCurrentUser`                | Boolean                      | true for the token's user       |
| `isRestricted`                 | Boolean                      |                                 |
| `labourRate`                   | Float                        | $/hour                          |
| `assignedColor`                | String                       | calendar colour                 |
| `assignedVehicle`              | Vehicle                      |                                 |
| `availableForScheduling`       | Boolean                      |                                 |
| `account`                      | Account                      |                                 |
| `permissions`                  | UserPermissionConnection     |                                 |
| `paymentCollectionPermissions` | PaymentCollectionPermissions |                                 |
| `language`                     | String                       |                                 |
| `firstDayOfTheWeek`            | enum                         |                                 |
| `lastLoginAt`                  | ISO8601DateTime              |                                 |
| `hasJobberPaymentsSetup`       | Boolean                      |                                 |
| `customFields`                 | list                         |                                 |
| `apps`                         | ApplicationConnection        | OAuth apps this user authorised |
| `createdAt`                    |                              |                                 |

## Webhook (subscription endpoint) — configure via `webhookEndpointCreate`/`webhookEndpointDelete`

| Field    | Type               | Notes                         |
| -------- | ------------------ | ----------------------------- |
| `id`     | EncodedId          |                               |
| `url`    | String             | your receiver                 |
| `topics` | [WebHookTopicEnum] | topics this endpoint receives |
| `active` | Boolean            |                               |

Payload shape: `WebHookPayload` type — full webhook contract in `01d`.

## Discovering anything else (schema is fully introspectable)

```graphql
query {
  __schema {
    queryType {
      fields {
        name
        description
      }
    }
  }
} # all query fields
query {
  __schema {
    mutationType {
      fields {
        name
        description
      }
    }
  }
} # all mutation fields
query {
  __type(name: "Quote") {
    fields {
      name
      description
      type {
        name
        kind
        ofType {
          name
        }
      }
    }
  }
} # type shape
query {
  __type(name: "JobStatusTypeEnum") {
    enumValues {
      name
      description
    }
  }
} # enum values
```

Prefer introspection over guessing field names — schema is the contract.
