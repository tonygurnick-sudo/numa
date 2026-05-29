---
api_name: 'Flowingly'
api_slug: 'flowingly'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
confidence: 'LOW — write request shapes are DOCUMENTED; write RESPONSE shapes and validation behaviour are INFERRED/UNKNOWN and not live-tested.'
---

# Flowingly -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Covers write operations: starting flows, updating step fields,
> the auth token exchange, business rules, and dangerous operations.
>
> ⚠️ **DISCOVERY-REQUIRED.** Request bodies below are [DOCUMENTED]. The **responses** to writes (and
> the exact validation-error shapes) are [INFERRED] from the Start Flow envelope and are NOT
> live-verified. Run a GET→POST→GET round-trip on a real step to confirm. There are NO [CONFIRMED]
> facts in this file.

---

## Write Capabilities Summary

| Operation              | Supported  | Method | Path                                | Notes                                                   |
| ---------------------- | ---------- | ------ | ----------------------------------- | ------------------------------------------------------- |
| Authenticate           | Yes        | POST   | /public/authorise                   | Credentials in query string [DOCUMENTED]                |
| Start flow instance    | Yes        | POST   | /public/startflow                   | **PascalCase** body; NOT idempotent [DOCUMENTED]        |
| Update step fields     | Yes        | POST   | /public/flow/{flowId}/step/{stepId} | Bulk array; camelCase body [DOCUMENTED]                 |
| Update single field    | (via bulk) | POST   | /public/flow/{flowId}/step/{stepId} | Send a one-element array (or the full array) [INFERRED] |
| Advance / approve step | **No**     | —      | —                                   | Not in documented surface [UNKNOWN/None]                |
| Complete / cancel flow | **No**     | —      | —                                   | Not in documented surface [UNKNOWN/None]                |
| Delete flow / step     | **No**     | —      | —                                   | Not in documented surface [UNKNOWN/None]                |
| File upload            | **No**     | —      | —                                   | No file endpoints [UNKNOWN/None]                        |
| Bulk start flows       | **No**     | —      | —                                   | One instance per call [UNKNOWN]                         |

---

## Pattern 0: Token Exchange (precondition for every write)

Every write requires a bearer token from `/public/authorise`. The backend handles this; the agent
just calls operations. Documented placement: **credentials in the query string**, Content-Type
`application/x-www-form-urlencoded`.

```http
POST /public/authorise?username=admin@acme.com&password=******** HTTP/1.1
Host: publicapi.flowingly.net
Content-Type: application/x-www-form-urlencoded
```

```json
{ "accessToken": "eyJhbGci...", "refreshToken": null, "idToken": "", "tokenType": "Bearer", "expiresIn": 0 }
```

**On 401 later:** `refreshToken` is `null`, so refresh is likely unsupported — **re-run `/authorise`
with the stored username/password and retry the original write once.** [INFERRED]

---

## Pattern 1: Start a Flow Instance

> Instantiate a published flow MODEL (by `Name`) into a new running flow instance.

**IMPORTANT — request body is PascalCase:**

```http
POST /public/startflow HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "Name": "New Customer Onboarding",
  "Subject": "Acme Ltd onboarding",
  "ActorsToStartFlowFor": [{ "UserEmail": "jo@acme.com" }],
  "CCActors": [{ "Team": "Finance" }],
  "AssignedActor": "manager@acme.com",
  "FlowInitiator": "system@acme.com"
}
```

**Success response (camelCase envelope):**

```json
{
  "success": true,
  "errorCode": null,
  "errorMessage": null,
  "dataModel": [{ "flowIdentifier": "FLOW-9042", "stepIdentifier": "Step 1" }]
}
```

**Field semantics:** [DOCUMENTED]

| Field                | Required    | Meaning                                                                                      |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| Name                 | yes         | **Flow MODEL name** — uniquely identifies the published template. NOT the instance subject.  |
| Subject              | yes         | Subject/title of the new instance.                                                           |
| ActorsToStartFlowFor | yes         | Array of `{UserEmail}` and/or `{Team}` — who the flow is started for.                        |
| CCActors             | no          | Array of CC actors.                                                                          |
| AssignedActor        | conditional | Assignee email for the first step — **required only when the first step needs an approver**. |
| FlowInitiator        | yes         | Email of the initiating user.                                                                |

**Behaviour:**

- **NOT idempotent** — each POST starts a new instance. No idempotency-key support. [INFERRED]
- The model must already exist and be published; there is no API to discover model names. [INFERRED]
- Capture `dataModel[0].flowIdentifier` and `stepIdentifier` to address the instance afterward. [DOCUMENTED]
- Required/optional flags are [INFERRED] from docs prose — confirm via validation-error mining. [INFERRED]

---

## Pattern 2: Update Step Fields (bulk)

> Save/populate the values of a step's form fields. **GET the step first** to obtain field
> `identifier`s, set `value`s, POST the array back.

**Step A — read the field array (see 01b):**

```http
GET /public/flow/FLOW-9042/step/Step%201 HTTP/1.1
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

**Step B — write values back (camelCase array body):**

```http
POST /public/flow/FLOW-9042/step/Step%201 HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
Content-Type: application/json

[
  { "name": "Customer Name", "type": "Text",  "order": 1, "identifier": "field4938201746", "value": "Acme Ltd",   "options": null },
  { "name": "Email",         "type": "Email", "order": 2, "identifier": "field4938201747", "value": "jo@acme.com", "options": null }
]
```

**Response (INFERRED — mirrors the Start Flow envelope):**

```json
{ "success": true, "errorCode": null, "errorMessage": null }
```

> The write response is **not explicitly documented** — it may instead echo the updated field array
> or return a bare 200. Verify with a follow-up GET. [INFERRED / UNKNOWN]

**Rules:**

- Preserve `name`, `type`, `order`, `identifier` exactly as returned by GET — only mutate `value`. [DOCUMENTED]
- This is the **only bulk-like operation**: multiple field values update in one request (per step). [DOCUMENTED]
- **Partial-failure behaviour is unknown** — if one field fails validation, whether the whole array is rejected or partially applied is undocumented. Treat the call as all-or-nothing and re-GET to confirm. [UNKNOWN]
- Field values are validated against modeller-configured rules; custom messages (from the modeller) are returned, else default validation errors. [DOCUMENTED]
- Per-type `value` encoding (Date, Currency, MultiSelectList, CheckBox) is undocumented — discover via round-trip. [UNKNOWN]

---

## Pattern 3: Update a Single Field

There is no documented single-field endpoint. To change one field, either:

1. POST a one-element array containing just that field object (with its `identifier`), or
2. GET the full array, mutate the one field, POST the whole array back (safest — avoids surprises if a full-array overwrite is required).

Which form is accepted is **unverified** — prefer option 2 until confirmed. [INFERRED]

---

## Field Validation Rules

| Entity | Field                | Rule                                                                       | Source       |
| ------ | -------------------- | -------------------------------------------------------------------------- | ------------ |
| Flow   | Name                 | Must match an existing, published flow MODEL name                          | [DOCUMENTED] |
| Flow   | Subject              | Required                                                                   | [DOCUMENTED] |
| Flow   | ActorsToStartFlowFor | Required; each actor is `{UserEmail}` and/or `{Team}`                      | [DOCUMENTED] |
| Flow   | FlowInitiator        | Required; valid user email                                                 | [DOCUMENTED] |
| Flow   | AssignedActor        | Required only if the first step requires approver selection                | [DOCUMENTED] |
| Field  | value                | Validated against modeller-configured rules; custom/default error returned | [DOCUMENTED] |
| Auth   | username/password    | Account must be a **Business Administrator**                               | [DOCUMENTED] |

> The structure of validation errors (per-field array vs single message) is **undocumented**.
> Expect the `success:false` + `errorCode`/`errorMessage` envelope, possibly with field detail in
> `errorMessage`. [UNKNOWN]

---

## Server-Side / Computed Fields

| Entity | Field           | Behaviour                                              |
| ------ | --------------- | ------------------------------------------------------ |
| Flow   | flowIdentifier  | System-assigned on start (`FLOW-####`) [DOCUMENTED]    |
| Flow   | stepIdentifier  | System-assigned; name of the current step [DOCUMENTED] |
| Field  | identifier      | Model-assigned `field<digits>`; read-only [DOCUMENTED] |
| Field  | name/type/order | Model-defined; read-only via API [DOCUMENTED]          |

---

## Worked Examples

### Example 1: Start a flow and immediately populate its first step

> End-to-end: authenticate → start → read field ids → write values.

**1. Authorise** → store `accessToken` (handled by backend).

**2. Start flow:**

```http
POST /public/startflow
Authorization: Bearer {accessToken}
Content-Type: application/json

{ "Name": "Purchase Request", "Subject": "Laptops for Eng team",
  "ActorsToStartFlowFor": [{ "UserEmail": "buyer@acme.com" }],
  "FlowInitiator": "system@acme.com" }
```

→ `{ "success": true, "dataModel": [{ "flowIdentifier": "FLOW-9101", "stepIdentifier": "Request Details" }] }`

**3. Read the step's fields:**

```http
GET /public/flow/FLOW-9101/step/Request%20Details
Authorization: Bearer {accessToken}
```

→ `[{ "name": "Item", "type": "Text", "order": 1, "identifier": "field880011", "value": "", "options": null },
     { "name": "Quantity", "type": "Number", "order": 2, "identifier": "field880012", "value": "", "options": null }]`

**4. Write values back:**

```http
POST /public/flow/FLOW-9101/step/Request%20Details
Authorization: Bearer {accessToken}
Content-Type: application/json

[{ "name": "Item", "type": "Text", "order": 1, "identifier": "field880011", "value": "MacBook Pro 14", "options": null },
 { "name": "Quantity", "type": "Number", "order": 2, "identifier": "field880012", "value": "5", "options": null }]
```

→ `{ "success": true, "errorCode": null, "errorMessage": null }` (response shape INFERRED — re-GET to confirm)

---

### Example 2: Start a flow whose first step needs an approver

> When the first step requires an approver to be selected, `AssignedActor` becomes required.

```http
POST /public/startflow
Authorization: Bearer {accessToken}
Content-Type: application/json

{ "Name": "Leave Request", "Subject": "Annual leave - July",
  "ActorsToStartFlowFor": [{ "UserEmail": "staff@acme.com" }],
  "AssignedActor": "lead@acme.com",
  "FlowInitiator": "staff@acme.com" }
```

→ `{ "success": true, "dataModel": [{ "flowIdentifier": "FLOW-9120", "stepIdentifier": "Manager Approval" }] }`

**Key point:** omitting `AssignedActor` here would likely return `success:false` with a validation
error about a required approver. [DOCUMENTED that it is conditionally required; exact error UNKNOWN]

---

### Example 3: Team actor instead of individual

```http
POST /public/startflow
Authorization: Bearer {accessToken}
Content-Type: application/json

{ "Name": "Incident Report", "Subject": "Outage 2026-05-29",
  "ActorsToStartFlowFor": [{ "Team": "Operations" }],
  "CCActors": [{ "UserEmail": "cto@acme.com" }],
  "FlowInitiator": "system@acme.com" }
```

**Key point:** actors can be a `Team` name or a `UserEmail`. Whether both can appear in one actor
object is unverified — supply one per actor. [INFERRED]

---

## Gotchas & Counter-Exceptions

1. **Request casing flips per endpoint.** Start Flow body = **PascalCase**; step-field body = **camelCase**. The auth + Start-Flow response are camelCase. [DOCUMENTED]
2. **`Name` = model, `Subject` = instance.** A common mistake is putting the instance title in `Name`. `Name` must exactly match a published model name. [DOCUMENTED]
3. **You cannot discover model names via the API.** Get the exact `Name` from the user or the Flowingly UI. [INFERRED]
4. **GET before POST on step fields** — the `identifier`s are required in the write body and are not guessable. [DOCUMENTED]
5. **`startflow` is not idempotent.** Never blind-retry on an ambiguous failure; you may create duplicate flows. Confirm with the user first. [INFERRED]
6. **Errors may be HTTP 200 with `success:false`.** Always read the envelope. [DOCUMENTED envelope / UNKNOWN codes]
7. **Step name must be URL-encoded in the path** (spaces → `%20`, parens → `%28`/`%29`). [DOCUMENTED]
8. **No step-progression API.** You can populate a step's fields but cannot submit/approve/advance it via the API — that happens in Flowingly. Set expectations with the user. [INFERRED]

---

## Dangerous Operations

> The workspace agent should confirm with the user before executing these.

| Operation                        | Why Dangerous                                                                                                     | Safeguard                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `POST /public/startflow`         | Starts a **real workflow** — notifies/assigns people, kicks off approvals. NOT idempotent (retries duplicate it). | Confirm model `Name`, `Subject`, and actors with the user before sending. Never auto-retry on ambiguous failure. |
| `POST /public/flow/.../step/...` | Overwrites live form values that real users may act on; partial-failure behaviour unknown.                        | Re-GET after writing to verify; confirm before overwriting non-empty values.                                     |

> Flowingly drives real business processes (onboarding, approvals, leave, purchasing). Starting a
> flow or writing step values has **real-world side effects** (emails, task assignments). Default to
> confirming intent before any write.

---

_Generated from the investigation questionnaire, Phases 3-4 (2026-05-29). LOW confidence — request shapes documented, responses inferred, not live-tested._
