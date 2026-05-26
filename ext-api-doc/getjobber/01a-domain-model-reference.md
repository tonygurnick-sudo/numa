# Domain Model Reference — Jobber (GraphQL)

> All entity field names, types, and enum values verified live against `__type(name:"…")` introspection on `https://api.getjobber.com/api/graphql` (2026-05-19). The schema has 1,973 object types; this file covers the ~10 you'll use 95% of the time. For anything else, ask the schema directly: `query { __type(name: "TypeName") { fields { name description type { name } } } }`.

---

## Scalars used everywhere

| Scalar                              | Form                | Example                                  |
| ----------------------------------- | ------------------- | ---------------------------------------- |
| `EncodedId`                         | Opaque string       | `"Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM0NQ=="` |
| `ISO8601DateTime`                   | RFC 3339 string     | `"2026-05-19T14:30:00Z"`                 |
| `ISO8601Date`                       | `YYYY-MM-DD` string | `"2026-05-19"`                           |
| `Float`, `Int`, `String`, `Boolean` | as expected         |                                          |

`EncodedId` is base64-encoded internally but the agent **must treat it as opaque** — do not parse or construct one.

---

## Connection pattern (every list)

Every list field is a Relay Connection — same shape across the API:

```graphql
{
  <listField>(first: N, after: "<cursor>", filter: { ... }, sort: { key, direction }) {
    nodes { ... }              # the actual records
    edges { node { ... } cursor }   # alternative — exposes per-record cursor
    pageInfo {
      endCursor
      hasNextPage
      hasPreviousPage
    }
    totalCount                 # on most connections
  }
}
```

Forward paginate by passing `after: "<endCursor>"` until `hasNextPage: false`. Page sizes default ~20; max varies (typically 100 — verify per endpoint).

---

## Account (the tenant)

Every authenticated query is scoped to one Account. Fetch via the top-level `account` query.

| Field                            | Type                  | Notes                                |
| -------------------------------- | --------------------- | ------------------------------------ |
| `id`                             | EncodedId             |                                      |
| `name`                           | String                | Trading name                         |
| `accountOwner`                   | User                  |                                      |
| `companyDetails`                 | AccountCompanyDetails | address, billing details             |
| `countryCode`                    | String                | ISO 3166 alpha-2                     |
| `industry`                       | Industry              | enum-like                            |
| `inTrial`, `inSubscriptionPause` | Boolean               |                                      |
| `crews`                          | CrewConnection        | Field crews for scheduling           |
| `connectedApps`                  | ApplicationConnection | OAuth apps the account has installed |
| `dedicatedPhoneNumber`           | String                | If account has provisioned one       |
| `features`                       | (object)              | Feature flags on the account         |
| `messages`                       | (connection)          | Messaging settings/templates         |

40 fields total; the above are the common ones.

---

## Client (customer)

The main CRM entity. Can represent an individual or a company.

| Field                    | Type                       | Notes                                                       |
| ------------------------ | -------------------------- | ----------------------------------------------------------- |
| `id`                     | EncodedId                  |                                                             |
| `firstName`              | String                     |                                                             |
| `lastName`               | String                     |                                                             |
| `companyName`            | String                     |                                                             |
| `isCompany`              | Boolean                    | `true` → company customer; `false` → individual             |
| `isLead`                 | Boolean                    | Lead vs. converted customer                                 |
| `isArchived`             | Boolean                    | Soft-deleted                                                |
| `isArchivable`           | Boolean                    | Whether archive is allowed (e.g. has open invoices = false) |
| `balance`                | Float                      | Outstanding balance across all invoices                     |
| `billingAddress`         | ClientAddress              | `{ street1, street2, city, province, postalCode, country }` |
| `billingAddressPresent`  | Boolean                    |                                                             |
| `email`                  | String                     | Primary email (legacy; prefer `emails`)                     |
| `emails`                 | (custom list)              | Multiple emails per client                                  |
| `phones`                 | (custom list)              | Multiple phones per client                                  |
| `contacts`               | ContactModelConnection     | Additional contact persons attached to this client          |
| `clientProperties`       | PropertyConnection         | All job sites for this client                               |
| `jobs`                   | JobConnection              | All jobs for this client                                    |
| `invoices`               | InvoiceConnection          | All invoices for this client                                |
| `messages`               | MessageInterfaceConnection | All inbound/outbound communications                         |
| `notes`                  | (connection)               | Internal notes attached to the client                       |
| `customFields`           | (list)                     | Account-defined custom fields                               |
| `leadSource`             | String                     | Where the lead came from                                    |
| `clientHubUserId`        | String                     | If client has a Client Hub login                            |
| `jobberWebUri`           | String                     | Direct URL into the Jobber web UI for this client           |
| `createdAt`, `updatedAt` | ISO8601DateTime            |                                                             |

55 fields total.

---

## Property (job site / address)

Properties belong to Clients. A Job is scheduled at a Property.

| Field              | Type                             | Notes                                                         |
| ------------------ | -------------------------------- | ------------------------------------------------------------- |
| `id`               | EncodedId                        |                                                               |
| `client`           | Client                           | Owning client                                                 |
| `address`          | PropertyAddress                  | Same shape as ClientAddress                                   |
| `name`             | String                           | Optional label (e.g. "Main Office")                           |
| `isBillingAddress` | Boolean                          | Whether this property doubles as the client's billing address |
| `taxRate`          | TaxRate                          | Inherited or overridden tax rate                              |
| `jobs`             | JobConnection                    | Jobs at this property                                         |
| `quotes`           | QuoteConnection                  | Quotes for work at this property                              |
| `requests`         | RequestConnection                | Inbound leads for this property                               |
| `scheduledItems`   | ScheduledItemInterfaceConnection | All scheduled visits/tasks                                    |
| `contacts`         | ContactModelConnection           | Site-specific contact persons                                 |
| `customFields`     | (list)                           |                                                               |
| `routingOrder`     | Int                              | Used by route optimisation                                    |

---

## Request (inbound lead)

Form-submitted lead from Jobber's Request form. Convert to a Quote or Job.

| Field          | Type       | Notes                                     |
| -------------- | ---------- | ----------------------------------------- |
| `id`           | EncodedId  |                                           |
| `client`       | Client     | Auto-created client (or matched existing) |
| `property`     | Property   | Site for the request                      |
| `title`        | String     | Summary                                   |
| `customFields` | (list)     |                                           |
| `assessment`   | Assessment | Optional on-site assessment booking       |
| `convertedTo`  | (union)    | Quote or Job after conversion             |

---

## Quote

A proposal sent to a client. Statuses: `draft`, `awaiting_response`, `archived`, `approved`, `converted`, `changes_requested`.

| Field                       | Type                    | Notes                                               |
| --------------------------- | ----------------------- | --------------------------------------------------- |
| `id`                        | EncodedId               |                                                     |
| `client`                    | Client                  |                                                     |
| `lineItems`                 | QuoteLineItemConnection |                                                     |
| `amounts`                   | QuoteAmounts            | `{ subtotal, total, discountAmount, taxAmount }`    |
| `discount`                  | CostModifier            |                                                     |
| `message`                   | String                  | Free-text message to client                         |
| `contractDisclaimer`        | String                  |                                                     |
| `clientHubUri`              | String                  | Public URL the client receives                      |
| `clientHubViewedAt`         | ISO8601DateTime         | When client opened the quote in Client Hub          |
| `lastTransitioned`          | QuoteLastTransitioned   | `{ status, transitionedAt }`                        |
| `eligibleForFinancing`      | Boolean                 | Wisetack consumer financing                         |
| `consumerFinancing`         | WisetackFinanced        |                                                     |
| `previewUrl`                | String                  | PDF preview URL                                     |
| `jobs`                      | JobConnection           | Job(s) created from this quote                      |
| `depositAmountUnallocated`  | Float                   | Deposit collected but not yet applied to an invoice |
| `depositRecords`            | PaymentRecordConnection |                                                     |
| `customFields`              | (list)                  |                                                     |
| `createdAt`, `jobberWebUri` |                         |                                                     |

46 fields total. To create a quote: `quoteCreate`. To approve on the client's behalf: `quoteApprove`. To convert to a job: `jobCreateFromQuote`.

---

## Job

A unit of work — can be one-off or recurring. Statuses: `requires_invoicing`, `archived`, `late`, `today`, `upcoming`, `action_required`, `on_hold`, `unscheduled`, `active`, `expiring_within_30_days`.

| Field                               | Type                     | Notes                                            |
| ----------------------------------- | ------------------------ | ------------------------------------------------ |
| `id`                                | EncodedId                |                                                  |
| `jobNumber`                         | Int                      | Sequential per-account                           |
| `jobStatus`                         | JobStatusTypeEnum        | See above                                        |
| `jobType`                           | JobTypeTypeEnum          | One-off vs recurring                             |
| `billingType`                       | BillingStrategy          | Fixed, per-visit, etc.                           |
| `client`                            | Client                   |                                                  |
| `startAt`, `endAt`                  | ISO8601DateTime          | Job-level schedule (visits have their own)       |
| `completedAt`                       | ISO8601DateTime          |                                                  |
| `instructions`                      | String                   |                                                  |
| `title`                             | (via visits)             |                                                  |
| `lineItems`                         | JobLineItemConnection    |                                                  |
| `visits`                            | (connection)             | Scheduled appointments                           |
| `invoices`                          | InvoiceConnection        |                                                  |
| `invoiceSchedule`                   | InvoiceSchedule          | When to invoice (per-visit, on-completion, etc.) |
| `invoicedTotal`                     | Float                    |                                                  |
| `completedAndUninvoicedVisitsCount` | Int                      |                                                  |
| `completedAndUninvoicedVisitsTotal` | Float                    |                                                  |
| `jobBalanceTotals`                  | JobBalanceTotals         |                                                  |
| `expenses`                          | ExpenseConnection        |                                                  |
| `jobCosting`                        | JobCosting               |                                                  |
| `jobForms`                          | FormConnection           | Forms (checklists) attached                      |
| `chemicalTreatments`                | TreatmentConnection      | Industry-specific (lawn care etc.)               |
| `bookingConfirmationSentAt`         | ISO8601DateTime          |                                                  |
| `allowReviewRequest`                | Boolean                  |                                                  |
| `feedbackResults`                   | FeedbackResultConnection | Client reviews                                   |
| `arrivalWindow`                     | ArrivalWindow            |                                                  |
| `customFields`                      | (list)                   |                                                  |
| `jobberWebUri`                      | String                   |                                                  |
| `createdAt`                         |                          |                                                  |

57 fields total.

---

## Visit

A single scheduled appointment on a Job. Multiple Visits per Job for recurring work.

| Field                            | Type                   | Notes                                       |
| -------------------------------- | ---------------------- | ------------------------------------------- |
| `id`                             | EncodedId              |                                             |
| `job`                            | Job                    | Parent job                                  |
| `client`                         | Client                 | Convenience                                 |
| `property`                       | Property               | Where the visit happens                     |
| `assignedUsers`                  | UserConnection         | Team members assigned                       |
| `startAt`, `endAt`               | ISO8601DateTime        |                                             |
| `allDay`                         | Boolean                |                                             |
| `duration`                       | Int                    | Seconds                                     |
| `isComplete`                     | Boolean                |                                             |
| `completedAt`, `completedBy`     |                        |                                             |
| `clientConfirmed`                | Boolean                | Has the client confirmed?                   |
| `arrivalWindow`                  | ArrivalWindow          |                                             |
| `instructions`                   | String                 |                                             |
| `lineItems`                      | JobLineItemConnection  |                                             |
| `jobForms`, `jobFormSubmissions` |                        |                                             |
| `notes`                          | JobNoteUnionConnection |                                             |
| `invoice`                        | Invoice                | Invoice this visit was rolled into (if any) |
| `incompleteJobFormsCount`        | Int                    |                                             |
| `routingOrder`, `overrideOrder`  | Int                    |                                             |
| `isLastScheduledVisit`           | Boolean                |                                             |
| `amounts`                        | VisitAmounts           |                                             |

36 fields total.

---

## Invoice

Billing document. Statuses: `draft`, `awaiting_payment`, `paid`, `past_due`, `bad_debt`, `sent_not_due`.

| Field                            | Type                      | Notes                                                                 |
| -------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| `id`                             | EncodedId                 |                                                                       |
| `invoiceNumber`                  | String                    | Display number; not the EncodedId                                     |
| `invoiceStatus`                  | InvoiceStatusTypeEnum     |                                                                       |
| `invoiceTermType`                | PaymentTermKind           | Net 7 / Net 30 / on-receipt etc.                                      |
| `invoiceNet`                     | Int                       | Days                                                                  |
| `client`                         | Client                    |                                                                       |
| `issuedDate`                     | ISO8601DateTime           |                                                                       |
| `dueDate`                        | ISO8601DateTime           |                                                                       |
| `lineItems`                      | InvoiceLineItemConnection |                                                                       |
| `amounts`                        | InvoiceAmounts            | `{ subtotal, total, discountAmount, taxAmount, paidAmount, balance }` |
| `discount`                       | CostModifier              |                                                                       |
| `billingAddress`                 | InvoiceBillingAddress     |                                                                       |
| `billingIsSameAsPropertyAddress` | Boolean                   |                                                                       |
| `clientHubUri`                   | String                    | Public URL the client receives                                        |
| `dateViewedInClientHub`          | ISO8601DateTime           |                                                                       |
| `lastCommunication`              | MessageInterface          |                                                                       |
| `jobs`                           | JobConnection             | Jobs invoiced                                                         |
| `archivedJobs`                   | JobConnection             |                                                                       |
| `automaticPaymentsError`         | String                    | Auto-pay failure reason                                               |
| `hasRefundableSurchargePayments` | Boolean                   |                                                                       |
| `customFields`                   | (list)                    |                                                                       |
| `contractDisclaimer`             | String                    |                                                                       |
| `eligibleForFinancing`           | Boolean                   |                                                                       |
| `consumerFinancing`              | WisetackFinanced          |                                                                       |
| `createdAt`, `jobberWebUri`      |                           |                                                                       |

52 fields total.

---

## Payment

Read-only on the public schema (writes go via `invoiceCreatePaymentRecord` / `clientCreatePaymentRecord`).

| Field           | Type            | Notes                                                   |
| --------------- | --------------- | ------------------------------------------------------- |
| `id`            | EncodedId       |                                                         |
| `amount`        | Float           |                                                         |
| `currency`      | String          | ISO 4217                                                |
| `date`          | ISO8601Date     |                                                         |
| `invoiceNumber` | String          | Invoice this payment was applied to                     |
| `invoiceUrl`    | String          |                                                         |
| `platform`      | PaymentPlatform | enum — Jobber Payments / external / cash / check / etc. |
| `success`       | Boolean         |                                                         |

Only 8 fields.

---

## User (employee / staff)

| Field                          | Type                         | Notes                                  |
| ------------------------------ | ---------------------------- | -------------------------------------- |
| `id`                           | EncodedId                    |                                        |
| `name`                         | Name                         | `{ first, last, full }`                |
| `email`                        | UserEmail                    |                                        |
| `phone`                        | UserPhone                    |                                        |
| `address`                      | UserAddress                  |                                        |
| `isAccountAdmin`               | Boolean                      |                                        |
| `isAccountOwner`               | Boolean                      | One per account                        |
| `isCurrentUser`                | Boolean                      | True for the user the token belongs to |
| `isRestricted`                 | Boolean                      |                                        |
| `labourRate`                   | Float                        | $/hour                                 |
| `assignedColor`                | String                       | Calendar colour                        |
| `assignedVehicle`              | Vehicle                      |                                        |
| `availableForScheduling`       | Boolean                      |                                        |
| `account`                      | Account                      |                                        |
| `permissions`                  | UserPermissionConnection     | Granular permission set                |
| `paymentCollectionPermissions` | PaymentCollectionPermissions |                                        |
| `language`                     | String                       |                                        |
| `firstDayOfTheWeek`            | enum                         |                                        |
| `lastLoginAt`                  | ISO8601DateTime              |                                        |
| `hasJobberPaymentsSetup`       | Boolean                      |                                        |
| `customFields`                 | (list)                       |                                        |
| `apps`                         | ApplicationConnection        | OAuth apps this user has authorised    |
| `createdAt`                    |                              |                                        |

44 fields total.

---

## Webhook (subscription endpoint)

Configure via `webhookEndpointCreate` / `webhookEndpointDelete` mutations.

| Field    | Type               | Notes                                 |
| -------- | ------------------ | ------------------------------------- |
| `id`     | EncodedId          |                                       |
| `url`    | String             | Your webhook receiver                 |
| `topics` | [WebHookTopicEnum] | List of topics this endpoint receives |
| `active` | Boolean            |                                       |

Payload shape: `WebHookPayload` type — see `01d-event-and-error-handling.md` for the full webhook contract.

---

## Discovering anything else

The schema is fully introspectable. From any agent context:

```graphql
# List all query fields
query {
  __schema {
    queryType {
      fields {
        name
        description
      }
    }
  }
}

# List all mutation fields
query {
  __schema {
    mutationType {
      fields {
        name
        description
      }
    }
  }
}

# Full shape of a specific type
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
}

# All enum values
query {
  __type(name: "JobStatusTypeEnum") {
    enumValues {
      name
      description
    }
  }
}
```

This is preferable to guessing field names from naming conventions — the schema is the contract.
