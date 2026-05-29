---
api_name: 'Flowingly'
api_slug: 'flowingly'
base_url: 'https://publicapi.flowingly.net/public/'
version: 'unversioned (paths under /public/)'
spec_format: 'none' # no OpenAPI/Swagger found
spec_url: 'Not available'
docs_url: 'https://help.flowingly.net (search "Public API")'
date_researched: '2026-05-29'
date_live_tested: 'NOT live-tested — web research only'
---

# Flowingly -- API Specification & Investigation

> Clean developer reference for the Flowingly Public API. This document is the condensed
> output of the investigation questionnaire -- everything a developer needs to integrate
> with this API, in one place.
>
> ⚠️ **DISCOVERY-REQUIRED BANNER.** Everything here is [DOCUMENTED] (sourced from the
> Flowingly Help Center) or [INFERRED]/[UNKNOWN]. **No live API call has been made — there
> are NO [CONFIRMED] facts.** Auth-credential placement (query vs body), token lifetime,
> refresh behaviour, error HTTP status codes, and the full endpoint catalogue must be
> verified against a live instance before being relied on in production. Treat unexpected
> behaviour as a documentation gap, not a bug.

---

## Overview

- **Vendor:** Flowingly (New Zealand) — Business Process Management / workflow automation SaaS
- **API name:** Flowingly Public API
- **API version:** Unversioned — paths sit under `/public/` with no `/v1/` segment [DOCUMENTED]
- **Base URL:** `https://publicapi.flowingly.net/public/` [DOCUMENTED — help.flowingly.net]
  - ⚠️ The connector brief named `api.flowingly.io` as the host. This **could not be confirmed**
    and is likely wrong: the documented Public API host is `publicapi.flowingly.net` (the `.net`
    domain), while `.io` is the marketing site. **Resolve before build.** [UNKNOWN: api.flowingly.io]
- **Sandbox URL:** Not documented [UNKNOWN]
- **API type:** REST (JSON over HTTPS) [DOCUMENTED]
- **Data format:** JSON [DOCUMENTED]
- **Field casing:** ⚠️ **INCONSISTENT across endpoints.** Authorise response = camelCase
  (`accessToken`, `tokenType`). Start Flow **request** = **PascalCase** (`Name`, `Subject`,
  `ActorsToStartFlowFor`). Start Flow **response** + step-field objects = camelCase
  (`success`, `flowIdentifier`, `name`, `type`, `value`). **Preserve casing exactly per
  endpoint.** [DOCUMENTED]
- **ID format:** `flowIdentifier` = `FLOW-<number>` (e.g. `FLOW-604`, `FLOW-9042`). Field
  `identifier` = `field<digits>` (e.g. `field70872750533`). `stepIdentifier` = the step's
  display name (e.g. `Step 1`, `New Customer (Debtor) Form`). [DOCUMENTED]
- **Documentation:** [help.flowingly.net](https://help.flowingly.net) — a handful of Help Center
  articles; **no dedicated developer portal, no API catalogue, no Swagger UI.**
- **OpenAPI spec:** Not available [UNKNOWN — probe `…/swagger`, `…/swagger/v1/swagger.json`,
  `…/openapi.json` on `publicapi.flowingly.net` during discovery]
- **Status page:** Not found [UNKNOWN]

**Summary:** Flowingly is an NZ-based no-code BPM / workflow platform. Workflows ("flow models")
are designed in a web modeller; the Public API is a **narrow, action-oriented** surface that lets
external systems (a) start a flow instance from a published model, and (b) read and write the form
fields of a specific step within a running flow. There are **no list/search/browse endpoints** —
the integrator must already hold the model name and `flowIdentifier`.

---

## Authentication

### Method: Username/Password → Bearer access token (custom token exchange)

The connector is registered `authType: 'username-password'` with two credential fields
(`username`, `password`). The backend POSTs those to the authorise endpoint, receives a bearer
access token, and sends it on every subsequent call. This resembles OAuth2 Resource-Owner-Password
but is **not** a standard OAuth2 endpoint (no `grant_type`, no `/token` semantics). [DOCUMENTED]

**Header format (all resource calls):**

```
Authorization: Bearer {accessToken}
```

**Token exchange — `POST /public/authorise`:**

| Property       | Value                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Endpoint       | `POST https://publicapi.flowingly.net/public/authorise`                                        |
| Credentials    | `username` (a Flowingly **Business Administrator** email) + `password`, as **query params**    |
| Content-Type   | `application/x-www-form-urlencoded`                                                            |
| Returns        | `{ accessToken, refreshToken, idToken, tokenType, expiresIn }`                                 |
| Token lifetime | `expiresIn` present; the documented example shows `0`. Real value/unit **UNKNOWN** [UNKNOWN]   |
| Refresh        | `refreshToken` documented as `null` — refresh likely **not issued / not supported** [INFERRED] |
| Account req.   | The authenticating user MUST be a **Business Administrator** in Flowingly [DOCUMENTED]         |
| PKCE / state   | N/A — not an OAuth redirect flow                                                               |

```http
POST /public/authorise?username=admin@company.com&password=******** HTTP/1.1
Host: publicapi.flowingly.net
Content-Type: application/x-www-form-urlencoded
```

```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": null,
  "idToken": "",
  "tokenType": "Bearer",
  "expiresIn": 0
}
```

> The Help Center documents the credentials **in the query string** even though the
> `Content-Type` is `application/x-www-form-urlencoded`. Whether the credentials also work in the
> form body is unverified. [DOCUMENTED — placement needs live verification]
>
> Because `refreshToken` is (apparently) always `null`, the backend should **re-run `/authorise`
> with the stored username/password whenever the access token expires** (catch 401 → re-authorise
> → retry once). There is no documented refresh grant. [INFERRED]

**Scopes:** None. Access is implicitly scoped to what the authenticating Business Administrator
can do in Flowingly. [UNKNOWN — no scope vocabulary published]

---

## Endpoint Catalog

> ⚠️ This is the **entire documented surface** — four endpoints. Additional undocumented endpoints
> (list flows, list models, complete/approve a step, comments, attachments) may exist but were not
> found in any public doc. **A discovery pass against a live instance is required to learn the true
> catalogue.** [UNKNOWN]

### Full Endpoint Index

| #   | Method | Path                                                  | Purpose                              | Auth | Paginated | Idempotent | Confidence |
| --- | ------ | ----------------------------------------------------- | ------------------------------------ | ---- | --------- | ---------- | ---------- |
| 1   | POST   | `/public/authorise`                                   | Exchange username/password → token   | No   | No        | Yes        | DOCUMENTED |
| 2   | POST   | `/public/startflow`                                   | Start a new flow instance from model | Yes  | No        | **No**     | DOCUMENTED |
| 3   | GET    | `/public/flow/{flowIdentifier}/step/{stepIdentifier}` | Read a step's fields + values        | Yes  | No        | Yes        | DOCUMENTED |
| 4   | POST   | `/public/flow/{flowIdentifier}/step/{stepIdentifier}` | Update a step's field values         | Yes  | No        | Yes        | DOCUMENTED |

> Endpoint #2 is documented as both `/public/startflow` (integration-example article) and
> `/public/startFlow` (start-flow article). Path casing is almost certainly case-insensitive on the
> server, but **verify on live**. The connector docs use lowercase `startflow`. [DOCUMENTED — casing
>
> > unconfirmed]

### 1. `POST /public/authorise`

Exchange credentials for a bearer token. See **Authentication** above. No auth header required (this
_is_ the auth call).

### 2. `POST /public/startflow`

Start a new instance of a published flow model. **Not idempotent** — each call creates a new flow.

**Request body (PascalCase):**

```json
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

Field semantics — see **Data Models → Flow (instance)**.

### 3. `GET /public/flow/{flowIdentifier}/step/{stepIdentifier}`

Read all fields (definitions + current values) of a step in a running flow. Use this to **discover
field identifiers** before writing values back. `{stepIdentifier}` is the step's **display name** and
must be **URL-encoded** in the path (spaces, parentheses).

```http
GET /public/flow/FLOW-604/step/New%20Customer%20(Debtor)%20Form HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
```

**Success response — array of field objects:** [DOCUMENTED — fields/types; exact wrapper INFERRED]

```json
[
  { "name": "Short text", "type": "Text", "order": 1, "identifier": "field70872750533", "value": "", "options": null },
  {
    "name": "Dropdown list",
    "type": "SelectList",
    "order": 2,
    "identifier": "field61149927188",
    "value": null,
    "options": [
      { "key": "1", "value": "Option 1" },
      { "key": "2", "value": "Option 2" }
    ]
  },
  { "name": "Email", "type": "Email", "order": 3, "identifier": "field61149927198", "value": "", "options": null }
]
```

> The Help Center documents the field **object** shape (`name`, `type`, `order`, `identifier`,
> `value`, `options`) but does not show a complete GET response verbatim. Whether the response is a
> bare array or an enveloped `{ success, dataModel: [...] }` is **UNKNOWN** — verify on live. For
> `SelectList`/`MultiSelectList`/`RadioButtonList`, the first **10,000** options are returned via GET.
> [DOCUMENTED: option cap / INFERRED: wrapper]

### 4. `POST /public/flow/{flowIdentifier}/step/{stepIdentifier}`

Save/update field values for the step. Send back an array of field objects with the `value` set.
This is the only "bulk" operation — multiple fields are updated in one request. **You should GET the
step first** to obtain the `identifier` values.

```http
POST /public/flow/FLOW-604/step/New%20Customer%20(Debtor)%20Form HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
Content-Type: application/json

[
  { "name": "Short text", "type": "Text",  "identifier": "field70872750533", "value": "Acme Ltd" },
  { "name": "Email",      "type": "Email", "identifier": "field61149927198", "value": "jo@acme.com" }
]
```

**Success response:** Not explicitly documented. Most likely the same `success`/`errorCode`/
`errorMessage` envelope as Start Flow, or a bare 200. [INFERRED / UNKNOWN — verify on live]

**Validation:** Values are validated in sequence (auth → payload model → modeller field rules).
Modeller-configured **Custom Value** error messages are returned when present; otherwise default
validation errors apply. **Step Created Date** and **Previous Field Value** validations are NOT
processed by the API (Runner-only). [DOCUMENTED]

---

## Data Models

### Flow (instance)

A running instance of a workflow, created via `POST /public/startflow`, addressed by
`flowIdentifier`.

| Field                  | Type           | Required (create) | Writable    | Description                                                                                                   |
| ---------------------- | -------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `Name`                 | string         | yes               | create only | **Flow MODEL name** — the published template to instantiate                                                   |
| `Subject`              | string         | yes               | create only | Subject/title of this flow instance                                                                           |
| `ActorsToStartFlowFor` | array          | yes               | create only | Who the flow is for: objects with `UserEmail` and/or `Team`                                                   |
| `CCActors`             | array          | no (optional)     | create only | CC actors: objects with `UserEmail` and/or `Team`                                                             |
| `AssignedActor`        | string (email) | conditional       | create only | Email to assign the first step to — required only when the first step needs an approver selected [DOCUMENTED] |
| `FlowInitiator`        | string (email) | yes               | create only | Email of the flow initiator                                                                                   |
| `flowIdentifier`       | string         | n/a (response)    | no          | System-assigned instance ID, e.g. `FLOW-9042`                                                                 |
| `stepIdentifier`       | string         | n/a (response)    | no          | Display name of the current/first step, e.g. `Step 1`                                                         |

> Required/optional flags are mostly [DOCUMENTED] from field descriptions (`Name`, `Subject`,
> `AssignedActor`, `CCActors`); the exact mandatory set is [INFERRED] until live validation-error
> mining confirms it. `Name` is the **model** name (not a subject) and the model must already exist
> and be published. There is no API to discover model names. [DOCUMENTED]

### WorkflowDefinition / Flow Model (template)

Not directly exposed by the Public API. Referenced **by name** via the `Name` field of Start Flow.
Authored in the Flowingly web modeller; defines the steps and their fields. **No documented endpoint
to list available models or their exact names** — the integrator must know the model name
out-of-band. [INFERRED / UNKNOWN]

### Step

A step within a flow instance, addressed by `flowIdentifier` + `stepIdentifier` (display name).
Read fields via GET, write values via POST. Steps are defined by the model — there is no
create/delete and no documented complete/approve/advance action. [DOCUMENTED for read/write; UNKNOWN
for transition]

### Field (step form field)

The unit the Public API reads/writes.

| Field        | Type                       | Writable | Description                                              |
| ------------ | -------------------------- | -------- | -------------------------------------------------------- |
| `name`       | string                     | no       | Field display name (model-defined)                       |
| `type`       | string (enum)              | no       | Field type — see **Field Type → Value Encoding** below   |
| `order`      | integer                    | no       | Display order within the step (present on GET)           |
| `identifier` | string                     | no (key) | Stable field key, e.g. `field70872750533`                |
| `value`      | string/object/array/number | yes      | The value to set — **encoding varies by `type`** (below) |
| `options`    | array / null               | no       | Choices for list-type fields (else `null`); GET only     |

#### Field Type → Value Encoding [DOCUMENTED — from the Update Step Fields article]

This is the most important reference for writing field values — encodings differ by type:

| `type`            | UI control           | `value` encoding                                                      | Notes                                               |
| ----------------- | -------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `Text`            | Short text           | string — `"This is a short text"`                                     |                                                     |
| `TextArea`        | Long text            | string — `"This is a long text."`                                     |                                                     |
| `SelectList`      | Dropdown (single)    | object — `{ "key": "2", "value": "Option 2", "isSelected": true }`    | `isSelected` must be `true`                         |
| `RadioButtonList` | Option list (single) | object — `{ "key": "1", "value": "Option 1", "isSelected": true }`    | `isSelected` must be `true`                         |
| `MultiSelectList` | Multi-select         | array of option objects, each with `isSelected` `true`/`false`        | `false` un-sets a previously selected value         |
| `CheckBox`        | Checkbox             | string — `"true"` or `"false"`                                        | **String, not boolean**                             |
| `Email`           | Email                | string — must be a valid email                                        |                                                     |
| `Date`            | Date                 | string — `"dd/MM/yyyy"` (e.g. `"19/07/1990"`)                         | Only Custom Value validation processed              |
| `Datetime`        | Date + time          | string — `"dd/MM/yyyy hh:mm:ss tt"` (e.g. `"02/07/2021 02:05:00 PM"`) | Only Custom Value validation processed              |
| `Currency`        | Currency             | number — `5000.50`                                                    | Max length 15; currency code auto-set if configured |
| `Number`          | Number               | number — `35`                                                         | Max length 15                                       |

**Unsupported for update:** `Instruction`, `FileUpload`, `Signature` field types are **not**
writable via the API. [DOCUMENTED]

Single-select example:

```json
{
  "name": "Dropdown list",
  "type": "SelectList",
  "identifier": "field61149927188",
  "value": { "key": "2", "value": "Option 2", "isSelected": true }
}
```

Multi-select example:

```json
{
  "name": "Multi-selection list",
  "type": "MultiSelectList",
  "identifier": "field61149927196",
  "value": [
    { "key": "1", "value": "Option 1", "isSelected": true },
    { "key": "2", "value": "Option 2", "isSelected": false },
    { "key": "3", "value": "Option 3", "isSelected": true }
  ]
}
```

### Actor

Not a standalone resource — referenced inline within Start Flow as either an individual user
(`UserEmail`) or a Team (`Team`):

```json
{ "UserEmail": "jo@acme.com" }   // individual actor
{ "Team": "Finance" }            // team actor
```

**Relationships:**

```
WorkflowDefinition (Flow Model) ──instantiates by Name──> Flow (instance, flowIdentifier)
        │ 1:N                                                      │ 1:N
        ▼                                                          ▼
   Step (definition)                                       Step (instance, stepIdentifier)
        │ 1:N                                                      │ 1:N
        ▼                                                          ▼
   Field (definition)                                      Field (value: identifier/value)

Actors (UserEmail | Team) attach to a Flow instance at start time
(ActorsToStartFlowFor, CCActors, AssignedActor, FlowInitiator).
```

[INFERRED from payload structures — the API exposes no relationship metadata.]

---

## Pagination

- **Type:** None / not applicable. No list endpoints exist. The only multi-item response (GET step
  fields) returns a complete array with no paging. [INFERRED]
- **Default / max page size:** N/A
- **Option cap:** For list-type fields, GET returns the first **10,000** options. [DOCUMENTED]
- **How to "page":** N/A. To act on a flow you must already hold its `flowIdentifier` (captured from
  a Start Flow response or an inbound webhook). [INFERRED]

---

## Rate Limits

| Scope | Limit                    | Window |
| ----- | ------------------------ | ------ |
| —     | Not documented [UNKNOWN] | —      |

**Headers:** None documented [UNKNOWN]. **429 shape:** None documented [UNKNOWN].

**Recommended strategy:** Throttle conservatively client-side; exponential backoff on 429/5xx until
real limits are discovered. [INFERRED]

---

## Error Handling

**Standard application-level envelope (Start Flow; likely shared by update):** [DOCUMENTED]

```json
{
  "success": false,
  "errorCode": "SOME_CODE",
  "errorMessage": "Human readable reason",
  "dataModel": null
}
```

⚠️ It is **UNKNOWN** whether failures return HTTP `200` with `success: false`, or a `4xx`/`5xx`. The
envelope returns `success` rather than relying solely on the HTTP status. **Always inspect BOTH the
HTTP status AND the `success` field.** The `errorCode` catalogue is undocumented. [DOCUMENTED
envelope / UNKNOWN codes]

**Status codes (all INFERRED — none confirmed):**

| Status | Meaning                  | Retryable | Recovery                                          |
| ------ | ------------------------ | --------- | ------------------------------------------------- |
| 200    | OK — **check `success`** | n/a       | If `success: false`, surface `errorMessage`       |
| 400    | Bad request / validation | No        | Fix payload (casing, required fields, value type) |
| 401    | Unauthorized / expired   | Yes       | Re-run `/authorise`, retry once                   |
| 403    | Forbidden                | No        | Confirm the account is a Business Administrator   |
| 404    | Flow/step not found      | No        | Verify `flowIdentifier` + URL-encoded step name   |
| 429    | Rate limited (assumed)   | Yes       | Backoff + retry                                   |
| 5xx    | Server error             | Yes       | Exponential backoff, max 3 retries                |

---

## Webhooks / Events

**Supported:** Outbound webhooks only, via a **"Webhook - Form" step** added in the flow modeller
(web UI). Not configurable via the Public API. [DOCUMENTED]

| Event               | Trigger                                                | Payload                                               |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Webhook step submit | The form/step containing the Webhook step is submitted | JSON of that step's form fields [DOCUMENTED, partial] |

- **Setup:** Enter an **Endpoint URL** on the Webhook step in the modeller. Flowingly POSTs the form
  JSON to that URL when the step is submitted. [DOCUMENTED]
- **Payload format:** JSON matching the webhook step's form fields. The exact envelope/field naming
  is not documented verbatim. [DOCUMENTED, partial]
- **Verification / signature:** **None documented** — no HMAC, no secret header, no IP allowlist.
  Treat inbound webhooks as **unauthenticated** unless a shared secret is manually added to the URL.
  **Flag for security review.** [UNKNOWN — security gap]
- **Reliability (retries, ordering, dedup):** Not documented [UNKNOWN]

**Canonical integration shape (flow-to-flow):** Webhook step → middleware (e.g. Azure Logic Apps)
→ `POST /public/startflow` of another flow. [DOCUMENTED]

**Polling fallback:** None viable — there is no "list recently modified flows" endpoint. The only
readable state is GET step fields for a **known** flow. For event-driven Numa automations, the
outbound Webhook step is the only realistic trigger source. [INFERRED]

---

## Known Limitations

1. **No browse/list surface** — cannot enumerate flows, flow models, steps, actors, or teams. The
   caller must supply identifiers / model names. [UNKNOWN]
2. **No step-progression API** — cannot advance, approve, complete, reassign, or cancel a flow/step.
   [UNKNOWN]
3. **No file handling** — no upload/download endpoints; `FileUpload`/`Signature` fields are not
   API-writable. [DOCUMENTED]
4. **Webhooks are modeller-configured + outbound-only** — no API to manage them, no documented
   signature scheme. [DOCUMENTED]
5. **`startflow` is NOT idempotent** and there is no idempotency-key support — duplicate flows on
   retry are a real risk. [INFERRED]
6. **Base URL, auth-credential placement, token lifetime, refresh behaviour, and error HTTP codes are
   all UNVERIFIED.** Run the discovery checklist (00-questionnaire appendix) before production use.
   [UNKNOWN]

---

## SDKs & Tooling

| SDK | Language | Repository | Quality | Notes         |
| --- | -------- | ---------- | ------- | ------------- |
| —   | —        | —          | —       | No SDKs exist |

**Postman collection:** Not available [UNKNOWN]
**OpenAPI spec:** Not available [UNKNOWN — probe `publicapi.flowingly.net/swagger`,
`/swagger/v1/swagger.json`, `/openapi.json`]

---

## Integration Path Assessment

**Recommended path:** **Direct API via `connect_request`** (action-oriented; NOT a Files /
Data-Connector).

**Justification:** Flowingly's Public API is a small, action-oriented surface — authenticate, start
a flow, read/update the fields of a specific step. There are no list/search/browse endpoints, no
file content, and nothing to enumerate in Files Remote, so the Data Connector (Files) pattern does
not apply. The workspace agent calls Flowingly through the standard direct-API mechanism
(`connect_request`); the backend handles the username/password → bearer token exchange and
re-authorises on 401. The connector is correctly registered as `authType: 'username-password'` with
`username` + `password` credential fields. The most natural event hook is Flowingly's outbound
Webhook step (a Numa Automations trigger source), not API polling.

**Connector compatibility (Files methods — NOT applicable):**

| Connector Method  | API Endpoint | Feasibility |
| ----------------- | ------------ | ----------- |
| list_files        | (none)       | none        |
| download_file     | (none)       | none        |
| search_files      | (none)       | none        |
| get_file_metadata | (none)       | none        |

**Direct-API capabilities instead:**

| Capability         | API Endpoint                               | Notes                                       |
| ------------------ | ------------------------------------------ | ------------------------------------------- |
| Authenticate       | `POST /public/authorise`                   | Backend exchanges username/password → token |
| Start flow         | `POST /public/startflow`                   | Requires model `Name` known out-of-band     |
| Read step fields   | `GET /public/flow/{flowId}/step/{stepId}`  | Discover field identifiers                  |
| Update step fields | `POST /public/flow/{flowId}/step/{stepId}` | Bulk array of field values                  |

---

_Researched on 2026-05-29 via web research only (Flowingly Help Center articles). **NOT live-tested.**_
_Sources: help.flowingly.net articles 5608036 (Start Flow), 5572732 (Integration Example),
5578808 (Update Step Fields), 6402692 (Flow-to-flow Webhooks); flowingly.io/platform/integrations._
