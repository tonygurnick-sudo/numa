---
doc: query-patterns
api: Jobber (GraphQL)
endpoint: POST https://api.getjobber.com/api/graphql
rule: every list is a Relay Connection — ALWAYS select pageInfo { endCursor hasNextPage } alongside nodes, or you can't continue past page 1
---

# Query Patterns — Jobber (GraphQL)

Natural-language → GraphQL read operations.

## Pagination (required)

Loop until `pageInfo.hasNextPage: false`, passing `after: "<endCursor>"`. `totalCount` on most connections gives an upfront total.

```graphql
query Page1 {
  clients(first: 50) {
    nodes {
      id
      firstName
      lastName
    }
    pageInfo {
      endCursor
      hasNextPage
    }
    totalCount
  }
}
query Page2 {
  clients(first: 50, after: "<endCursor-from-page-1>") {
    nodes {
      id
      firstName
      lastName
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

| Arg                        | Purpose                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `first: N`                 | forward page size (1–100 typical max)                                                  |
| `after: "<cursor>"`        | continue forward                                                                       |
| `last: N`                  | backward page size                                                                     |
| `before: "<cursor>"`       | continue backward                                                                      |
| `offset: N`                | offset-based — also accepted on most connections                                       |
| `sort: { key, direction }` | per-connection sort (key enum varies)                                                  |
| `filter: { … }`            | per-connection filter object (shape varies — introspect the connection's input filter) |

## Auth smoke test

Any 200 with `data.account.id` populated proves the token works.

```graphql
query Me {
  account {
    id
    name
    accountOwner {
      id
      name {
        full
      }
      email {
        primary {
          address
        }
      }
    }
  }
}
```

## Clients

All active customers:

```graphql
query ActiveClients($cursor: String) {
  clients(first: 50, after: $cursor, filter: { isArchived: false }) {
    nodes {
      id
      firstName
      lastName
      companyName
      isCompany
      isLead
      email
      balance
      billingAddress {
        street1
        city
        province
        postalCode
        country
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
    totalCount
  }
}
```

Find customer named Acme (`searchTerm` searches name, company, and email; most list endpoints accept it):

```graphql
query FindClient {
  clients(first: 25, searchTerm: "Acme") {
    nodes {
      id
      firstName
      lastName
      companyName
      email
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

One client by ID with jobs + invoices:

```graphql
query ClientDeep($id: EncodedId!) {
  client(id: $id) {
    id
    firstName
    lastName
    companyName
    balance
    billingAddress {
      street1
      city
    }
    clientProperties(first: 20) {
      nodes {
        id
        address {
          street1
          city
        }
        name
      }
    }
    jobs(first: 50, sort: { key: created_at, direction: descending }) {
      nodes {
        id
        jobNumber
        jobStatus
        startAt
        endAt
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
    invoices(first: 50) {
      nodes {
        id
        invoiceNumber
        invoiceStatus
        issuedDate
        dueDate
        amounts {
          total
          balance
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
}
```

All leads (not yet converted):

```graphql
query Leads {
  clients(first: 50, filter: { isLead: true }) {
    nodes {
      id
      firstName
      lastName
      email
      leadSource
      createdAt
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

## Quotes

Awaiting client response:

```graphql
query OpenQuotes {
  quotes(first: 50, filter: { quoteStatus: awaiting_response }) {
    nodes {
      id
      client {
        id
        firstName
        lastName
        companyName
      }
      amounts {
        subtotal
        total
      }
      lastTransitioned {
        status
        transitionedAt
      }
      clientHubUri
      jobberWebUri
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

Single quote with line items:

```graphql
query QuoteDetail($id: EncodedId!) { quote(id: $id) { id client { id firstName lastName companyName } message amounts { subtotal total discountAmount taxAmount } discount { amount unit } lineItems(first: 50) { nodes { id name description quantity unitCost totalCost taxable } } clientHubUri eligibleForFinancing customFields { ... } } }
```

Recently approved (ready to convert):

```graphql
query ApprovedQuotes {
  quotes(first: 50, filter: { quoteStatus: approved }, sort: { key: updated_at, direction: descending }) {
    nodes {
      id
      client {
        id
        companyName
      }
      amounts {
        total
      }
      lastTransitioned {
        transitionedAt
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

## Jobs

Scheduled today:

```graphql
query TodayJobs {
  jobs(first: 50, filter: { jobStatus: today }) {
    nodes {
      id
      jobNumber
      jobStatus
      client {
        id
        firstName
        lastName
      }
      property {
        address {
          street1
          city
        }
      }
      startAt
      endAt
      arrivalWindow {
        centeredOn
        duration
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

Requiring invoicing (work complete, not billed):

```graphql
query NeedInvoicing {
  jobs(first: 50, filter: { jobStatus: requires_invoicing }) {
    nodes {
      id
      jobNumber
      client {
        id
        firstName
        lastName
      }
      completedAndUninvoicedVisitsCount
      completedAndUninvoicedVisitsTotal
      completedAt
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

All visits for a job:

```graphql
query JobVisits($jobId: EncodedId!) {
  job(id: $jobId) {
    id
    jobNumber
    visits(first: 50, sort: { key: start_at, direction: ascending }) {
      nodes {
        id
        startAt
        endAt
        isComplete
        completedAt
        assignedUsers {
          nodes {
            id
            name {
              full
            }
          }
        }
        notes(first: 5) {
          nodes {
            id
            message
            createdAt
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
}
```

Overdue jobs:

```graphql
query OverdueJobs {
  jobs(first: 50, filter: { jobStatus: late }) {
    nodes {
      id
      jobNumber
      client {
        firstName
        lastName
        companyName
      }
      endAt
      jobStatus
    }
  }
}
```

## Invoices

Unpaid for a customer:

```graphql
query Unpaid($clientId: EncodedId!) {
  client(id: $clientId) {
    invoices(first: 50, filter: { invoiceStatus: awaiting_payment }) {
      nodes {
        id
        invoiceNumber
        issuedDate
        dueDate
        amounts {
          total
          paidAmount
          balance
        }
        invoiceTermType
        invoiceNet
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
}
```

All overdue across account:

```graphql
query AllOverdue {
  invoices(first: 50, filter: { invoiceStatus: past_due }, sort: { key: due_date, direction: ascending }) {
    nodes {
      id
      invoiceNumber
      dueDate
      client {
        id
        firstName
        lastName
        companyName
      }
      amounts {
        total
        balance
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
    totalCount
  }
}
```

Single invoice with line items + payment history:

```graphql
query InvoiceDetail($id: EncodedId!) {
  invoice(id: $id) {
    id
    invoiceNumber
    invoiceStatus
    issuedDate
    dueDate
    client {
      id
      firstName
      lastName
    }
    billingAddress {
      street1
      city
      province
      postalCode
      country
    }
    amounts {
      subtotal
      total
      discountAmount
      taxAmount
      paidAmount
      balance
    }
    lineItems(first: 50) {
      nodes {
        id
        name
        description
        quantity
        unitCost
        totalCost
      }
    }
    jobs(first: 5) {
      nodes {
        id
        jobNumber
      }
    }
    clientHubUri
  }
}
```

## Payments

No top-level `payments` list for arbitrary date ranges — access via `invoice.payments`, or list paid invoices. Writes via `invoiceCreatePaymentRecord`.

```graphql
query RecentPayments {
  invoices(first: 50, filter: { invoiceStatus: paid }, sort: { key: updated_at, direction: descending }) {
    nodes {
      id
      invoiceNumber
      amounts {
        paidAmount
      }
      client {
        firstName
        lastName
      }
    }
  }
}
```

## Schedule

All scheduled items at a property (`scheduledItems` is a union — use inline fragments per type):

```graphql
query PropertySchedule($propId: EncodedId!) {
  property(id: $propId) {
    id
    address {
      street1
      city
    }
    scheduledItems(first: 50, sort: { key: start_at, direction: ascending }) {
      nodes {
        ... on Visit {
          id
          startAt
          endAt
          isComplete
          job {
            jobNumber
          }
        }
        ... on Task {
          id
          startAt
          endAt
          title
          isComplete
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
}
```

## Account / config

Account info + features:

```graphql
query Account {
  account {
    id
    name
    countryCode
    accountOwner {
      name {
        full
      }
      email {
        primary {
          address
        }
      }
    }
    industry
    inTrial
    dedicatedPhoneNumber
    connectedApps(first: 50) {
      nodes {
        id
        name
      }
    }
  }
}
```

Users (employees):

```graphql
query Users {
  users(first: 50) {
    nodes {
      id
      name {
        first
        last
        full
      }
      email {
        primary {
          address
        }
      }
      isAccountAdmin
      isAccountOwner
      availableForScheduling
      labourRate
      assignedColor
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

## Schema discovery

Cheaper than guessing; `__schema`/`__type` need no auth.

```graphql
query {
  __type(name: "Quote") {
    fields {
      name
      description
      type {
        name
        kind
      }
    }
  }
} # fields on a type
query {
  __schema {
    queryType {
      fields {
        name
        args {
          name
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
  }
} # args of query fields
query {
  __type(name: "InvoiceStatusTypeEnum") {
    enumValues {
      name
      description
    }
  }
} # enum values
```

## Response shapes

Success:

```json
{
  "data": {
    "clients": {
      "nodes": [
        {
          "id": "Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM=",
          "firstName": "Tony",
          "lastName": "Gurnick",
          "companyName": "Arcanum AI",
          "balance": 0.0,
          "email": "tony@arcanum.ai"
        }
      ],
      "pageInfo": { "endCursor": "MQ", "hasNextPage": true },
      "totalCount": 42
    }
  }
}
```

Per-field error (rare for reads, common for mutations):

```json
{
  "data": null,
  "errors": [
    {
      "message": "...",
      "locations": [{ "line": 2, "column": 3 }],
      "path": ["clients"],
      "extensions": { "code": "UNAUTHENTICATED" }
    }
  ]
}
```

Full error handling in `01d`.
