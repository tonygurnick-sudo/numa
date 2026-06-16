---
api_name: Flowingly
api_slug: flowingly
companion_to: 01-llm-api-rules.md
source_phases: Phase 5 (query & filter), Phase 6 (pagination & bulk)
confidence: [DOCUMENTED] (from docs) that there is NO query surface; the one read endpoint is documented but not live-tested. Tags inline where not [DOCUMENTED].
---

# Flowingly — Query Patterns Reference

**This is NOT a query API.** No list, search, filter, sort, or pagination capability. The only read endpoint reads the fields of a **single, already-known** step. You cannot "list my flows", "find flows for customer X", or "search steps" — to read anything you must already hold the exact `flowIdentifier` AND the step's display name.

## Query capabilities (all unsupported)

| Capability                               | Supported | Notes                                            |
| ---------------------------------------- | --------- | ------------------------------------------------ |
| Filter by field value                    | No        | no list endpoints [DOCUMENTED — absent]          |
| Filter by date range                     | No        | [UNKNOWN/None]                                   |
| Full-text search                         | No        | no search endpoint [UNKNOWN/None]                |
| Sort by field                            | No        | [UNKNOWN/None]                                   |
| Field selection / sparse                 | No        | GET step returns the full field array [INFERRED] |
| Include related (`?include=`/`?expand=`) | No        | [INFERRED]                                       |
| Aggregation / count                      | No        | [UNKNOWN/None]                                   |
| Logical operators (AND/OR)               | No        | [UNKNOWN/None]                                   |
| Comparison operators                     | No        | [UNKNOWN/None]                                   |
| Null checks                              | No        | [UNKNOWN/None]                                   |

---

## The only read pattern: get a step's fields

`GET /public/flow/{flowIdentifier}/step/{stepIdentifier}`, `Authorization: Bearer {accessToken}`.

| Path param     | Required | Description                                                                            |
| -------------- | -------- | -------------------------------------------------------------------------------------- |
| flowIdentifier | yes      | e.g. `FLOW-9042` — from a startflow response or an inbound webhook                     |
| stepIdentifier | yes      | the step's **display name**, **URL-encoded** (e.g. `New%20Customer%20(Debtor)%20Form`) |

Response — array of field objects, no wrapper (raw-array vs enveloped is INFERRED):
`[{"name":"Customer Name","type":"Text","order":1,"identifier":"field4938201746","value":"","options":null},{"name":"Email","type":"Email","order":2,"identifier":"field4938201747","value":"","options":null},{"name":"Account Type","type":"RadioButtonList","order":3,"identifier":"field4938201748","value":"","options":["Standard","Premium"]}]`

GET before you write: field `identifier`s (`field<digits>`) are model-assigned and are required keys in the update body. Always GET first, mutate `value`, POST the array back (see 01c).

---

## How to obtain a `flowIdentifier` (no list endpoint)

1. A startflow response — `dataModel[0].flowIdentifier` from your own `POST /public/startflow` [DOCUMENTED].
2. An inbound webhook payload — a Webhook step in the flow model can carry the flow id + field data to your endpoint (see 01d) [DOCUMENTED].
3. The user — they can copy a `FLOW-####` id from the Flowingly UI [INFERRED].

If asked to "read flow X" without an identifier, ask the user for the `FLOW-####` id and the exact step name — you **cannot search for them**.

---

## Pagination — not applicable

No list endpoints; the single multi-item response (GET step fields) returns a complete array with no paging params, cursor, or total count [INFERRED]. Pagination type N/A · default/max page size N/A · total count N/A · last-page detection N/A (the array is the entire result). GET returns the first **10,000** options for list-type fields [DOCUMENTED].

## Bulk reads

The only "bulk" read is the field array from GET step — all fields of one step in one call. No way to read multiple flows or steps in one request [INFERRED].

---

## Worked Examples

### Example 1: start a flow, then read its first step's fields

The canonical "I just started a flow and want to inspect/populate its form" sequence.
`POST /public/startflow` (PascalCase): `{"Name":"New Customer Onboarding","Subject":"Acme Ltd onboarding","ActorsToStartFlowFor":[{"UserEmail":"jo@acme.com"}],"FlowInitiator":"system@acme.com"}`
→ `{"success":true,"errorCode":null,"errorMessage":null,"dataModel":[{"flowIdentifier":"FLOW-9042","stepIdentifier":"Step 1"}]}`
Then read that step (URL-encode the name `Step 1`→`Step%201`): `GET /public/flow/FLOW-9042/step/Step%201`
→ `[{"name":"Customer Name","type":"Text","order":1,"identifier":"field4938201746","value":"","options":null},{"name":"Email","type":"Email","order":2,"identifier":"field4938201747","value":"","options":null}]`
`flowIdentifier`+`stepIdentifier` come straight from the startflow response; response is a raw array, each field with a stable `identifier`.

### Example 2: inspect a step referenced by an inbound webhook

A Webhook step delivered a `FLOW-####` id + step name to your endpoint; read the live values before deciding what to write.
`GET /public/flow/FLOW-7781/step/Approval%20Form`
→ `[{"name":"Decision","type":"RadioButtonList","order":1,"identifier":"field5500110022","value":"","options":["Approve","Reject"]},{"name":"Comments","type":"TextArea","order":2,"identifier":"field5500110023","value":"","options":null}]`
Webhooks are the only way (other than your own startflow) to learn about a flow you didn't create. `options` is populated for list-type fields, `null` otherwise.

---

## Gotchas

1. **No list/search → no discovery.** Without a `FLOW-####` id and exact step name you cannot read anything — ask the user [DOCUMENTED — absent].
2. **`stepIdentifier` is a NAME (not numeric) and must be URL-encoded.** Spaces and parentheses appear in real step names [DOCUMENTED].
3. **GET response is a raw array, not an envelope** (differs from startflow's `{success,errorCode,errorMessage,dataModel}`). Whether GET is ever wrapped is unverified [DOCUMENTED / wrapper UNKNOWN].
4. **No `modified-since` / change feed.** Cannot poll for "what changed" — use webhooks for change detection (01d) [INFERRED].
5. **No field selection.** GET step always returns every field; cannot request a subset [INFERRED].
