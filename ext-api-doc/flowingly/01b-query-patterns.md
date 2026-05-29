---
api_name: 'Flowingly'
api_slug: 'flowingly'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
confidence: 'LOW — confirmed (from docs) that there is NO query surface; the one read endpoint is documented but not live-tested.'
---

# Flowingly -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Covers read operations, filtering, search, and pagination.
>
> ⚠️ **There is almost nothing to query.** Flowingly's Public API is action-oriented. It has **no
> list, search, filter, or pagination capability**. The only read endpoint reads the fields of a
> **single, already-known** step. This file documents that one pattern and explains the implications.
> [DOCUMENTED that the surface is absent; the GET endpoint itself is not live-tested.]

---

## Query Capabilities Summary

| Capability                 | Supported | Syntax | Notes                                            |
| -------------------------- | --------- | ------ | ------------------------------------------------ |
| Filter by field value      | **No**    | —      | No list endpoints exist [DOCUMENTED — absent]    |
| Filter by date range       | **No**    | —      | [UNKNOWN/None]                                   |
| Full-text search           | **No**    | —      | No search endpoint [UNKNOWN/None]                |
| Sort by field              | **No**    | —      | [UNKNOWN/None]                                   |
| Field selection / sparse   | **No**    | —      | GET step returns the full field array [INFERRED] |
| Include related records    | **No**    | —      | No `?include=` / `?expand=` [INFERRED]           |
| Aggregation / count        | **No**    | —      | [UNKNOWN/None]                                   |
| Logical operators (AND/OR) | **No**    | —      | [UNKNOWN/None]                                   |
| Comparison operators       | **No**    | —      | [UNKNOWN/None]                                   |
| Null checks                | **No**    | —      | [UNKNOWN/None]                                   |

> **Bottom line:** This is **not a query API**. You cannot ask "list my flows", "find flows for
> customer X", or "search steps". To read anything you must already hold the exact `flowIdentifier`
> AND the step's display name. [INFERRED]

---

## The Only Read Pattern: Get a Step's Fields

> Retrieve all fields (definitions + current values) for one step of one flow instance.

**Syntax:**

```http
GET /public/flow/{flowIdentifier}/step/{stepIdentifier} HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
```

**Path parameters:**

| Parameter      | Type   | Required | Description                                                                            |
| -------------- | ------ | -------- | -------------------------------------------------------------------------------------- |
| flowIdentifier | string | yes      | e.g. `FLOW-9042` — obtained from a Start Flow response or an inbound webhook           |
| stepIdentifier | string | yes      | The step's **display name**, **URL-encoded** (e.g. `New%20Customer%20(Debtor)%20Form`) |

**Response (array of field objects, no wrapper):** [DOCUMENTED shape; raw-array vs enveloped is INFERRED]

```json
[
  {
    "name": "Customer Name",
    "type": "Text",
    "order": 1,
    "identifier": "field4938201746",
    "value": "",
    "options": null
  },
  { "name": "Email", "type": "Email", "order": 2, "identifier": "field4938201747", "value": "", "options": null },
  {
    "name": "Account Type",
    "type": "RadioButtonList",
    "order": 3,
    "identifier": "field4938201748",
    "value": "",
    "options": ["Standard", "Premium"]
  }
]
```

**Why you GET before you write:** the field `identifier`s (`field<digits>`) are model-assigned and
are required keys in the update body. Always GET first, mutate `value`, POST the array back. See
`01c-mutation-patterns.md`. [DOCUMENTED]

---

## How to Obtain a `flowIdentifier` (since you cannot list them)

There is no list endpoint, so a `flowIdentifier` must come from one of:

1. **A Start Flow response** — `dataModel[0].flowIdentifier` from your own `POST /public/startflow` call. [DOCUMENTED]
2. **An inbound webhook payload** — a Webhook step in the flow model can carry the flow identifier and field data to your endpoint. See `01d-event-and-error-handling.md`. [DOCUMENTED]
3. **The user** — they can copy a `FLOW-####` id from the Flowingly UI. [INFERRED]

If the agent is asked to "read flow X" without an identifier, it must ask the user for the
`FLOW-####` id and the exact step name — it **cannot search for them**.

---

## Pagination Handling

**Not applicable.** There are no list endpoints, and the single multi-item response (GET step fields)
returns a **complete array** with no paging parameters, no cursor, and no total count. [INFERRED]

| Aspect              | Value                                |
| ------------------- | ------------------------------------ |
| Pagination type     | None / N/A                           |
| Default page size   | N/A                                  |
| Max page size       | N/A                                  |
| Total count         | N/A                                  |
| Last-page detection | N/A — the array is the entire result |

---

## Bulk Reads

The only "bulk" read is the field array returned by GET step — all fields of one step in one call.
There is no documented way to read multiple flows or multiple steps in a single request. [INFERRED]

---

## Worked Examples

### Example 1: Start a flow, then read its first step's fields

> The canonical "I just started a flow and want to inspect/populate its form" sequence.

```http
POST /public/startflow HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
Content-Type: application/json

{ "Name": "New Customer Onboarding", "Subject": "Acme Ltd onboarding",
  "ActorsToStartFlowFor": [{ "UserEmail": "jo@acme.com" }], "FlowInitiator": "system@acme.com" }
```

```json
{
  "success": true,
  "errorCode": null,
  "errorMessage": null,
  "dataModel": [{ "flowIdentifier": "FLOW-9042", "stepIdentifier": "Step 1" }]
}
```

Then read that step (URL-encode the step name):

```http
GET /public/flow/FLOW-9042/step/Step%201 HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
```

```json
[
  {
    "name": "Customer Name",
    "type": "Text",
    "order": 1,
    "identifier": "field4938201746",
    "value": "",
    "options": null
  },
  { "name": "Email", "type": "Email", "order": 2, "identifier": "field4938201747", "value": "", "options": null }
]
```

**Key points:**

- The `flowIdentifier` and `stepIdentifier` come straight from the Start Flow response. [DOCUMENTED]
- URL-encode the `stepIdentifier` (`Step 1` → `Step%201`). [DOCUMENTED]
- The response is a raw array of fields, each with a stable `identifier`. [DOCUMENTED]

---

### Example 2: Inspect a step referenced by an inbound webhook

> A Webhook step in the source flow delivered a `FLOW-####` id and a step name to your endpoint.
> You read the live field values before deciding what to write.

```http
GET /public/flow/FLOW-7781/step/Approval%20Form HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
```

```json
[
  {
    "name": "Decision",
    "type": "RadioButtonList",
    "order": 1,
    "identifier": "field5500110022",
    "value": "",
    "options": ["Approve", "Reject"]
  },
  { "name": "Comments", "type": "TextArea", "order": 2, "identifier": "field5500110023", "value": "", "options": null }
]
```

**Key points:**

- Webhooks are the only way (other than your own Start Flow call) to learn about a flow you didn't create. [DOCUMENTED]
- `options` is populated for list-type fields and `null` otherwise. [DOCUMENTED]

---

## Gotchas & Counter-Exceptions

1. **No list/search means no discovery.** If you don't have a `FLOW-####` id and the exact step name, you cannot read anything — ask the user. [DOCUMENTED — absent]
2. **`stepIdentifier` is a NAME, not a numeric id, and must be URL-encoded.** Spaces and parentheses appear in real step names. [DOCUMENTED]
3. **The GET response is (documented as) a raw array, not an envelope.** This differs from Start Flow, which returns a `{success, errorCode, errorMessage, dataModel}` envelope. Whether the GET is ever wrapped is unverified. [DOCUMENTED / wrapper UNKNOWN]
4. **No `modified-since` / change feed.** You cannot poll for "what changed" — there is no list endpoint to filter. Use webhooks for change detection (see 01d). [INFERRED]
5. **No field selection.** GET step always returns every field of the step; you cannot request a subset. [INFERRED]

---

_Generated from the investigation questionnaire, Phases 5-6 (2026-05-29). LOW confidence — query surface confirmed absent from docs; the GET endpoint is not live-tested._
