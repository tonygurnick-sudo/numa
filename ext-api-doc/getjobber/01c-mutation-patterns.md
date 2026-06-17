---
doc: mutation-patterns
api: Jobber (GraphQL)
endpoint: POST https://api.getjobber.com/api/graphql
rule: every mutation returns a Payload with the entity AND a userErrors list — ALWAYS select both. 200 OK with non-empty userErrors = FAILURE (entity is null), not success
---

# Mutation Patterns — Jobber (GraphQL)

Natural-language → GraphQL write operations.

## Universal shape

```graphql
mutation { <mutationName>(input: { … }) { <entityField> { id … } userErrors { message path } } }
```

`<entityField>` is the created/updated entity, or null on failure. A business-rule rejection (duplicate email, missing required field, invalid date) returns **200 OK with `<entityField>: null` and populated `userErrors`** — treating it as success silently loses data. `path` is a JSON path to the offending field, e.g. `["emails","0","address"]`.

## Client mutations (CRM)

Create individual:

```graphql
mutation CreateIndividual {
  clientCreate(
    input: {
      firstName: "Tony"
      lastName: "Gurnick"
      isCompany: false
      emails: [{ address: "tony@arcanum.ai", description: main, primary: true }]
      phones: [{ number: "+64 27 000 0000", description: mobile, primary: true }]
      billingAddress: { street1: "123 Main St", city: "Auckland", province: "AUK", postalCode: "1010", country: "NZ" }
    }
  ) {
    client {
      id
      firstName
      lastName
      email
    }
    userErrors {
      message
      path
    }
  }
}
```

Create company:

```graphql
mutation CreateCompany { clientCreate(input: { companyName: "Acme Plumbing Ltd", isCompany: true, emails: [{ address: "ops@acme.example", primary: true }], billingAddress: { street1: "1 Industrial Way", city: "Sydney", province: "NSW", postalCode: "2000", country: "AU" }, contacts: [{ firstName: "James", lastName: "Smith", role: "Accounts", emails: [{ address: "james@acme.example" }] }], customFields: { /* shape per account-defined fields */ } }) { client { id companyName } userErrors { message path } } }
```

`ClientCreateInput` fields (introspection 2026-05-19): `title`, `firstName`, `lastName`, `companyName`, `isCompany`, `sampleData`, `trackingOrigin`, `receivesReminders`, `receivesFollowUps`, `receivesQuoteFollowUps`, `receivesInvoiceFollowUps`, `receivesReviewRequests`, `isBillingContact`, `role`, `phones`, `emails`, `properties`, `billingAddress`, `customFields`, `sourceAttribution`, `contacts`.

Update (only include fields to change):

```graphql
mutation EditClient($id: EncodedId!) {
  clientEdit(input: { id: $id, firstName: "Anthony" }) {
    client {
      id
      firstName
      lastName
    }
    userErrors {
      message
      path
    }
  }
}
```

Archive (soft delete):

```graphql
mutation Archive($id: EncodedId!) {
  clientArchive(input: { id: $id }) {
    client {
      id
      isArchived
    }
    userErrors {
      message
      path
    }
  }
}
```

Related: `clientUnarchive`, `clientDelete` (hard delete — gated by NO open invoices), `clientsDelete` (bulk).

Add a note:

```graphql
mutation AddNote($id: EncodedId!) {
  clientCreateNote(input: { clientId: $id, message: "Called re: outstanding invoice — promised payment by Friday" }) {
    note {
      id
      message
      createdAt
    }
    userErrors {
      message
      path
    }
  }
}
```

Bulk: `clientsCreate(input: { clients: [...] })` (create up to N), `clientsDelete(input: { ids: [...] })`, `clientsEditTags(input: { ids, addTags, removeTags })`, `clientsImport`/`clientsImportRevert` (CSV flow).

## Quote mutations

Create:

```graphql
mutation CreateQuote($clientId: EncodedId!, $propertyId: EncodedId!) {
  quoteCreate(
    input: {
      clientId: $clientId
      propertyId: $propertyId
      title: "Spring cleanup"
      message: "Thanks for the opportunity to quote."
      contractDisclaimer: "Standard T&Cs apply."
      lineItems: [
        { name: "Lawn mowing", description: "Front + back", quantity: 1, unitCost: 80.00, taxable: true }
        { name: "Hedge trim", quantity: 2, unitCost: 45.00, taxable: true }
      ]
      discount: { unit: percentage, amount: 10 }
    }
  ) {
    quote {
      id
      clientHubUri
      amounts {
        total
      }
    }
    userErrors {
      message
      path
    }
  }
}
```

Send to client:

```graphql
mutation SendQuote($id: EncodedId!) {
  quoteSend(input: { id: $id }) {
    quote {
      id
      lastTransitioned {
        status
        transitionedAt
      }
    }
    userErrors {
      message
      path
    }
  }
}
```

Approve on client's behalf:

```graphql
mutation Approve($id: EncodedId!) {
  quoteApprove(input: { id: $id }) {
    quote {
      id
      lastTransitioned {
        status
        transitionedAt
      }
    }
    userErrors {
      message
      path
    }
  }
}
```

Convert to job:

```graphql
mutation QuoteToJob($quoteId: EncodedId!) {
  jobCreateFromQuote(
    input: {
      quoteId: $quoteId
      startAt: "2026-06-01T09:00:00Z"
      endAt: "2026-06-01T12:00:00Z"
      assignedUserIds: ["<userEncodedId>"]
    }
  ) {
    job {
      id
      jobNumber
      jobStatus
    }
    userErrors {
      message
      path
    }
  }
}
```

## Job mutations

Create one-off from scratch:

```graphql
mutation CreateJob($clientId: EncodedId!, $propertyId: EncodedId!) {
  jobCreate(
    input: {
      clientId: $clientId
      propertyId: $propertyId
      title: "Emergency callout — burst pipe"
      instructions: "Access via back gate. Dog friendly."
      startAt: "2026-05-20T14:00:00Z"
      endAt: "2026-05-20T16:00:00Z"
      jobType: ONE_OFF
      billingType: FIXED_PRICE
      lineItems: [{ name: "Emergency callout", quantity: 1, unitCost: 150.00, taxable: true }]
      assignedUserIds: ["<userEncodedId>"]
    }
  ) {
    job {
      id
      jobNumber
    }
    userErrors {
      message
      path
    }
  }
}
```

Edit:

```graphql
mutation EditJob($id: EncodedId!) {
  jobEdit(input: { id: $id, instructions: "Updated: access via front door — homeowner will meet you" }) {
    job {
      id
      instructions
    }
    userErrors {
      message
      path
    }
  }
}
```

Close / reopen:

```graphql
mutation CloseJob($id: EncodedId!) {
  jobClose(input: { id: $id }) {
    job {
      id
      jobStatus
      completedAt
    }
    userErrors {
      message
      path
    }
  }
}
mutation ReopenJob($id: EncodedId!) {
  jobReopen(input: { id: $id }) {
    job {
      id
      jobStatus
    }
    userErrors {
      message
      path
    }
  }
}
```

Add a note:

```graphql
mutation JobNote($id: EncodedId!) {
  jobCreateNote(input: { jobId: $id, message: "Customer said the tap is now leaking again" }) {
    note {
      id
      message
      createdAt
    }
    userErrors {
      message
      path
    }
  }
}
```

Line items: `jobCreateLineItems`, `jobEditLineItems`, `jobDeleteLineItems`, `jobEditLineItemsSection`, `jobOrderLineItems`.

## Visit / scheduling mutations

`appointmentEditSchedule` is the unified mutation for Visit, Task, Assessment, and Event (Jobber's appointment supertype). `appointmentEditAssignment` reassigns the team member; `appointmentEditCompleteness` marks complete/incomplete.

Reschedule:

```graphql
mutation EditVisitSchedule($visitId: EncodedId!) {
  appointmentEditSchedule(input: { id: $visitId, startAt: "2026-05-21T10:00:00Z", endAt: "2026-05-21T12:00:00Z" }) {
    appointment {
      id
      startAt
      endAt
    }
    userErrors {
      message
      path
    }
  }
}
```

Mark complete:

```graphql
mutation VisitComplete($visitId: EncodedId!) {
  appointmentEditCompleteness(input: { id: $visitId, isComplete: true }) {
    appointment {
      id
      completedAt
    }
    userErrors {
      message
      path
    }
  }
}
```

## Invoice mutations

From a job (`invoiceCreateFromQuote(quoteId:...)` and `invoiceCreateFromVisits(visitIds:[...])` follow the same shape):

```graphql
mutation FromJob($jobId: EncodedId!) {
  invoiceCreateFromJob(input: { jobId: $jobId, issuedDate: "2026-05-19", dueDate: "2026-06-02" }) {
    invoice {
      id
      invoiceNumber
      amounts {
        total
        balance
      }
      clientHubUri
    }
    userErrors {
      message
      path
    }
  }
}
```

Standalone (no job):

```graphql
mutation CreateInvoice($clientId: EncodedId!) {
  invoiceCreate(
    input: {
      clientId: $clientId
      issuedDate: "2026-05-19"
      dueDate: "2026-06-02"
      lineItems: [{ name: "Consulting", description: "May", quantity: 8, unitCost: 200.00, taxable: true }]
    }
  ) {
    invoice {
      id
      invoiceNumber
    }
    userErrors {
      message
      path
    }
  }
}
```

Mark draft as sent:

```graphql
mutation MarkSent($id: EncodedId!) {
  invoiceMarkAsSent(input: { id: $id }) {
    invoice {
      id
      invoiceStatus
    }
    userErrors {
      message
      path
    }
  }
}
```

Record payment (`paymentType` enum — also check / bank_transfer / etc.):

```graphql
mutation RecordPayment($invoiceId: EncodedId!) {
  invoiceCreatePaymentRecord(
    input: { invoiceId: $invoiceId, amount: 1200.00, date: "2026-05-19", paymentType: cash, note: "Cash on completion" }
  ) {
    paymentRecord {
      id
      amount
      date
    }
    userErrors {
      message
      path
    }
  }
}
```

Related: `invoiceClose`, `invoiceReopen`, `invoiceDelete`, `invoiceUnmarkBadDebt`, `jobberPaymentsCreateRefunds` (Jobber Payments transactions only).

## Webhook subscription mutations

46 topics in `WebHookTopicEnum` — full list in `01d`.

```graphql
mutation CreateHook {
  webhookEndpointCreate(
    input: {
      url: "https://your-app.example/jobber/webhooks"
      topics: [CLIENT_CREATE, CLIENT_UPDATE, INVOICE_CREATE, INVOICE_UPDATE, JOB_CLOSED, QUOTE_APPROVED]
    }
  ) {
    webhookEndpoint {
      id
      url
      topics
      active
    }
    userErrors {
      message
      path
    }
  }
}
mutation DeleteHook($id: EncodedId!) {
  webhookEndpointDelete(input: { id: $id }) {
    deletedId
    userErrors {
      message
      path
    }
  }
}
```

## State transitions

| Entity  | Transition                   | Mutation                                                                   |
| ------- | ---------------------------- | -------------------------------------------------------------------------- |
| Quote   | draft → awaiting_response    | `quoteSend`                                                                |
| Quote   | awaiting_response → approved | `quoteApprove` (or client approves via Client Hub)                         |
| Quote   | approved → converted         | `jobCreateFromQuote`                                                       |
| Quote   | \* → archived                | `quoteArchive`                                                             |
| Job     | active → requires_invoicing  | automatic when visits complete with billing strategy                       |
| Job     | active → archived            | `jobClose`                                                                 |
| Job     | archived → active            | `jobReopen`                                                                |
| Visit   | scheduled → complete         | `appointmentEditCompleteness(isComplete: true)`                            |
| Invoice | draft → awaiting_payment     | `invoiceMarkAsSent`                                                        |
| Invoice | awaiting_payment → paid      | `invoiceCreatePaymentRecord` for the full balance (or via Jobber Payments) |
| Invoice | paid → awaiting_payment      | `invoiceReopen`                                                            |
| Invoice | \* → bad_debt                | `invoiceClose` with bad-debt flag (verify exact arg)                       |

## Dangerous operations

| Operation                               | Risk                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `clientDelete` / `clientsDelete`        | Hard-delete. Prefer `clientArchive` for soft-delete.                                                     |
| `invoiceDelete`                         | Hard-delete. Prefer `invoiceUnmarkBadDebt` + close, or leave past-due.                                   |
| `webhookEndpointDelete`                 | Silently stops your integration from receiving events.                                                   |
| `appDisconnect` / `appRemove`           | Disconnects the OAuth app — invalidates all tokens; customer must re-consent.                            |
| Bulk (`clientsCreate`, `clientsDelete`) | One bad row can fail the whole batch or partially succeed — read the `userErrors` shape carefully first. |

## Common rejection causes (`userErrors`)

| Symptom                                                      | Cause                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `Email is invalid`                                           | Bad format, or duplicate against another client                         |
| `clientId is required` / `propertyId is required`            | Most child entities need a parent reference                             |
| `quote can only be approved when in awaiting_response state` | State-machine violation — query current `lastTransitioned.status` first |
| `One or more line items is invalid`                          | Missing required field on a line item (e.g. `name`, `quantity`)         |
| `Property does not belong to this client`                    | Cross-tenant or cross-client reference rejected                         |
| `Cannot delete client with open invoices`                    | Pay/close/delete the invoices first, or archive the client instead      |
