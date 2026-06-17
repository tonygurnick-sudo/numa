---
api_name: Flowingly
api_slug: flowingly
base_url: https://publicapi.flowingly.net
route_prefix: /public (literal path segment, part of every path — NOT a version)
path_version_segment: none (unversioned — no /v1/; adding one → 404)
base_url_warning: connector brief said api.flowingly.io — UNCONFIRMED, likely the marketing site; documented Public API host is publicapi.flowingly.net (.net). Resolve before build. [UNKNOWN]
call_surface: HTTP via `numa integrations request` (Direct-API). NOT a Files/Data-Connector (no list/download). NOT MCP.
spec_format: none (no OpenAPI/Swagger found)
docs_url: https://help.flowingly.net (search "Public API")
date_researched: 2026-05-29
date_live_tested: NOT live-tested — web research only
confidence: every fact is [DOCUMENTED] (Flowingly Help Center) or [INFERRED]/[UNKNOWN] — NO [CONFIRMED] facts. Auth-credential placement (query vs body), token lifetime, refresh, error HTTP codes, full endpoint catalogue need live verification. Tags inline where not [DOCUMENTED].
sources: help.flowingly.net articles 5608036 (Start Flow), 5572732 (Integration Example), 5578808 (Update Step Fields), 6402692 (Flow-to-flow Webhooks); flowingly.io/platform/integrations
---

# Flowingly — API Specification & Investigation

Condensed developer reference. Flowingly is an NZ no-code BPM / workflow platform; workflows ("flow models") are designed in a web modeller. The Public API is a **narrow, action-oriented** surface: (a) start a flow instance from a published model, (b) read/write the form fields of a specific step in a running flow. **No list/search/browse endpoints** — the integrator must already hold the model name + `flowIdentifier`.

## Overview

- **Vendor:** Flowingly (New Zealand) — BPM / workflow automation SaaS.
- **API type / format:** REST, JSON over HTTPS [DOCUMENTED].
- **Version:** unversioned — paths under `/public/`, no `/v1/` segment [DOCUMENTED].
- **Base URL:** `https://publicapi.flowingly.net` (paths begin with the literal `/public/...`) [DOCUMENTED — help.flowingly.net]. ⚠️ Brief's `api.flowingly.io` could NOT be confirmed and is likely wrong (`.io` = marketing site). Resolve before build [UNKNOWN].
- **Sandbox / status page:** not documented [UNKNOWN].
- **Field casing — INCONSISTENT across endpoints:** authorise response = camelCase (`accessToken`,`tokenType`); startflow REQUEST = PascalCase (`Name`,`Subject`,`ActorsToStartFlowFor`); startflow RESPONSE + step-field objects = camelCase (`success`,`flowIdentifier`,`name`,`type`,`value`). **Preserve casing exactly per endpoint** [DOCUMENTED].
- **ID format:** `flowIdentifier`=`FLOW-<number>` (`FLOW-604`,`FLOW-9042`); field `identifier`=`field<digits>` (`field70872750533`); `stepIdentifier`=step display name (`Step 1`, `New Customer (Debtor) Form`) [DOCUMENTED].
- **Documentation:** help.flowingly.net — a handful of Help Center articles; **no developer portal, no API catalogue, no Swagger UI.**
- **OpenAPI spec:** not available [UNKNOWN — probe `…/swagger`, `…/swagger/v1/swagger.json`, `…/openapi.json` on `publicapi.flowingly.net` during discovery].

---

## Authentication — Username/Password → Bearer (custom token exchange)

Registered `authType: 'username-password'` with two credential fields (`username`, `password`). The backend POSTs them to authorise, gets a bearer token, sends it on every subsequent call. Resembles OAuth2 Resource-Owner-Password but is **not** standard OAuth2 (no `grant_type`, no `/token` semantics) [DOCUMENTED]. Header on all resource calls: `Authorization: Bearer {accessToken}`.

**Token exchange — `POST /public/authorise`:**
| Property | Value |
| --- | --- |
| Endpoint | `POST https://publicapi.flowingly.net/public/authorise` |
| Credentials | `username` (a Flowingly **Business Administrator** email) + `password`, as **query params** |
| Content-Type | `application/x-www-form-urlencoded` |
| Returns | `{accessToken, refreshToken, idToken, tokenType, expiresIn}` |
| Token lifetime | `expiresIn` present; example shows `0`. Real value/unit UNKNOWN [UNKNOWN] |
| Refresh | `refreshToken` documented as `null` — refresh likely NOT issued/supported [INFERRED] |
| Account req. | authenticating user MUST be a **Business Administrator** [DOCUMENTED] |
| PKCE / state | N/A — not an OAuth redirect flow |
| Scopes | none — access implicitly scoped to what the Business Administrator can do [UNKNOWN — no scope vocabulary] |

`POST /public/authorise?username=admin@company.com&password=********`, `Content-Type: application/x-www-form-urlencoded`
→ `{"accessToken":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...","refreshToken":null,"idToken":"","tokenType":"Bearer","expiresIn":0}`

Docs put credentials in the **query string** despite the form-urlencoded Content-Type; whether they also work in the form body is unverified — test both on live [DOCUMENTED — placement needs verification]. Because `refreshToken` is (apparently) always null, the backend should **re-run `/authorise` with stored username/password whenever the access token expires** (catch 401 → re-authorise → retry once). No documented refresh grant [INFERRED].

---

## Endpoint Catalog (entire documented surface = 4)

⚠️ Additional undocumented endpoints (list flows/models, complete/approve a step, comments, attachments) may exist but were not found in any public doc — a live discovery pass is required [UNKNOWN].

| #   | Method | Path                                                  | Purpose                              | Auth | Paginated | Idempotent | Confidence |
| --- | ------ | ----------------------------------------------------- | ------------------------------------ | ---- | --------- | ---------- | ---------- |
| 1   | POST   | `/public/authorise`                                   | exchange username/password → token   | No   | No        | Yes        | DOCUMENTED |
| 2   | POST   | `/public/startflow`                                   | start a new flow instance from model | Yes  | No        | **No**     | DOCUMENTED |
| 3   | GET    | `/public/flow/{flowIdentifier}/step/{stepIdentifier}` | read a step's fields + values        | Yes  | No        | Yes        | DOCUMENTED |
| 4   | POST   | `/public/flow/{flowIdentifier}/step/{stepIdentifier}` | update a step's field values         | Yes  | No        | Yes        | DOCUMENTED |

Endpoint #2 is documented as both `/public/startflow` and `/public/startFlow` — path casing almost certainly case-insensitive on the server; connector docs use lowercase `startflow`. Verify on live [DOCUMENTED — casing unconfirmed].

### 1. `POST /public/authorise`

Exchange credentials for a bearer token. See Authentication. No auth header required (this _is_ the auth call).

### 2. `POST /public/startflow`

Start a new instance of a published flow model. **Not idempotent** — each call creates a new flow.
Request (PascalCase): `{"Name":"New Customer Onboarding","Subject":"Acme Ltd onboarding","ActorsToStartFlowFor":[{"UserEmail":"jo@acme.com"}],"CCActors":[{"Team":"Finance"}],"AssignedActor":"manager@acme.com","FlowInitiator":"system@acme.com"}`
Success (camelCase envelope): `{"success":true,"errorCode":null,"errorMessage":null,"dataModel":[{"flowIdentifier":"FLOW-9042","stepIdentifier":"Step 1"}]}`
Field semantics → see Data Models → Flow (instance).

### 3. `GET /public/flow/{flowIdentifier}/step/{stepIdentifier}`

Read all fields (definitions + current values) of a step in a running flow. Use to **discover field identifiers** before writing. `{stepIdentifier}` = the step's display name, **URL-encoded** in the path (spaces, parens).
`GET /public/flow/FLOW-604/step/New%20Customer%20(Debtor)%20Form`, `Authorization: Bearer {accessToken}`
Success — array of field objects [DOCUMENTED fields/types; exact wrapper INFERRED]:
`[{"name":"Short text","type":"Text","order":1,"identifier":"field70872750533","value":"","options":null},{"name":"Dropdown list","type":"SelectList","order":2,"identifier":"field61149927188","value":null,"options":[{"key":"1","value":"Option 1"},{"key":"2","value":"Option 2"}]},{"name":"Email","type":"Email","order":3,"identifier":"field61149927198","value":"","options":null}]`
The Help Center documents the field **object** shape (`name`,`type`,`order`,`identifier`,`value`,`options`) but not a complete GET response verbatim; whether it's a bare array or an enveloped `{success,dataModel:[...]}` is UNKNOWN — verify on live. For `SelectList`/`MultiSelectList`/`RadioButtonList`, GET returns the first **10,000** options [DOCUMENTED: option cap / INFERRED: wrapper].

### 4. `POST /public/flow/{flowIdentifier}/step/{stepIdentifier}`

Save/update field values. Send back an array of field objects with `value` set — the only "bulk" operation (multiple fields per request). **GET the step first** to obtain the `identifier` values.
`POST /public/flow/FLOW-604/step/New%20Customer%20(Debtor)%20Form`, `Authorization: Bearer {accessToken}`, `Content-Type: application/json`
`[{"name":"Short text","type":"Text","identifier":"field70872750533","value":"Acme Ltd"},{"name":"Email","type":"Email","identifier":"field61149927198","value":"jo@acme.com"}]`
Success: not explicitly documented — most likely the same `success`/`errorCode`/`errorMessage` envelope as startflow, or a bare 200 [INFERRED/UNKNOWN — verify on live].
**Validation order:** auth → payload model → modeller field rules. Modeller-configured **Custom Value** error messages returned when present, else default validation errors. **Step Created Date** and **Previous Field Value** validations are NOT processed by the API (Runner-only) [DOCUMENTED].

---

## Data Models

### Flow (instance)

A running instance of a workflow, created via `POST /public/startflow`, addressed by `flowIdentifier`.
| Field | Type | Required (create) | Writable | Description |
| --- | --- | --- | --- | --- |
| `Name` | string | yes | create only | **Flow MODEL name** — the published template to instantiate |
| `Subject` | string | yes | create only | Subject/title of this flow instance |
| `ActorsToStartFlowFor` | array | yes | create only | Who the flow is for: objects with `UserEmail` and/or `Team` |
| `CCActors` | array | no | create only | CC actors: objects with `UserEmail` and/or `Team` |
| `AssignedActor` | string (email) | conditional | create only | Email to assign the first step to — required only when the first step needs an approver selected [DOCUMENTED] |
| `FlowInitiator` | string (email) | yes | create only | Email of the flow initiator |
| `flowIdentifier` | string | response | no | System-assigned instance ID, e.g. `FLOW-9042` |
| `stepIdentifier` | string | response | no | Display name of the current/first step, e.g. `Step 1` |

Required/optional mostly [DOCUMENTED] from field descriptions (`Name`,`Subject`,`AssignedActor`,`CCActors`); the exact mandatory set is [INFERRED] until live validation-error mining confirms it. `Name` is the **model** name (not a subject); the model must exist + be published; no API to discover model names [DOCUMENTED].

### WorkflowDefinition / Flow Model (template)

Not directly exposed by the Public API; referenced **by name** via `Name`. Authored in the web modeller; defines steps + fields. **No documented endpoint to list models or their names** — must know the model name out-of-band [INFERRED/UNKNOWN].

### Step

A step within a flow instance, addressed by `flowIdentifier`+`stepIdentifier` (display name). Read fields via GET, write values via POST. Model-defined — no create/delete, no documented complete/approve/advance [DOCUMENTED read/write; UNKNOWN transition].

### Field (step form field)

| Field        | Type                       | Writable | Description                                          |
| ------------ | -------------------------- | -------- | ---------------------------------------------------- |
| `name`       | string                     | no       | display name (model-defined)                         |
| `type`       | string (enum)              | no       | field type — see Field Type → Value Encoding         |
| `order`      | integer                    | no       | display order within the step (present on GET)       |
| `identifier` | string                     | no (key) | stable field key, e.g. `field70872750533`            |
| `value`      | string/object/array/number | yes      | value to set — **encoding varies by `type`**         |
| `options`    | array / null               | no       | choices for list-type fields (else `null`); GET only |

#### Field Type → Value Encoding [DOCUMENTED — Update Step Fields article]

Most important reference for writing values — encodings differ by type:
| `type` | UI control | `value` encoding | Notes |
| --- | --- | --- | --- |
| `Text` | short text | string `"This is a short text"` | |
| `TextArea` | long text | string `"This is a long text."` | |
| `SelectList` | dropdown (single) | object `{"key":"2","value":"Option 2","isSelected":true}` | `isSelected` must be `true` |
| `RadioButtonList` | option list (single) | object `{"key":"1","value":"Option 1","isSelected":true}` | `isSelected` must be `true` |
| `MultiSelectList` | multi-select | array of option objects, each with `isSelected` `true`/`false` | `false` un-sets a previously selected value |
| `CheckBox` | checkbox | string `"true"` or `"false"` | **string, not boolean** |
| `Email` | email | string — valid email | |
| `Date` | date | string `"dd/MM/yyyy"` (e.g. `"19/07/1990"`) | only Custom Value validation processed |
| `Datetime` | date+time | string `"dd/MM/yyyy hh:mm:ss tt"` (e.g. `"02/07/2021 02:05:00 PM"`) | only Custom Value validation processed |
| `Currency` | currency | number `5000.50` | max length 15; currency code auto-set if configured |
| `Number` | number | number `35` | max length 15 |

**Not writable via the API:** `Instruction`, `FileUpload`, `Signature` [DOCUMENTED].
Single-select: `{"name":"Dropdown list","type":"SelectList","identifier":"field61149927188","value":{"key":"2","value":"Option 2","isSelected":true}}`
Multi-select: `{"name":"Multi-selection list","type":"MultiSelectList","identifier":"field61149927196","value":[{"key":"1","value":"Option 1","isSelected":true},{"key":"2","value":"Option 2","isSelected":false},{"key":"3","value":"Option 3","isSelected":true}]}`

### Actor

Not a standalone resource — inline within startflow: individual `{"UserEmail":"jo@acme.com"}` or team `{"Team":"Finance"}`.

### Relationships

```
WorkflowDefinition (Flow Model) ──instantiates by Name──> Flow instance (flowIdentifier)
   │ 1:N                                                        │ 1:N
   ▼                                                            ▼
Step (definition) ──1:N──> Field (definition)        Step instance (stepIdentifier) ──1:N──> Field value (identifier/value)

Actors (UserEmail | Team) attach to a Flow instance at start time (ActorsToStartFlowFor, CCActors, AssignedActor, FlowInitiator).
```

[INFERRED from payload structures — the API exposes no relationship metadata.]

---

## Pagination

None / N/A — no list endpoints; GET step fields returns a complete array with no paging [INFERRED]. Default/max page size N/A. **Option cap:** for list-type fields GET returns the first **10,000** options [DOCUMENTED]. To "page" you must already hold the `flowIdentifier` (from a startflow response or inbound webhook) [INFERRED].

## Rate Limits

Not documented [UNKNOWN] — no scope/window/headers/429-shape documented. Strategy: throttle conservatively client-side; exponential backoff on 429/5xx until real limits are discovered [INFERRED].

## Error Handling

Standard application-level envelope (startflow; likely shared by update) [DOCUMENTED]: `{"success":false,"errorCode":"SOME_CODE","errorMessage":"Human readable reason","dataModel":null}`
⚠️ UNKNOWN whether failures return HTTP 200 + `success:false` or 4xx/5xx — **inspect BOTH the HTTP status AND `success`**. `errorCode` catalogue undocumented [DOCUMENTED envelope / UNKNOWN codes].
Status codes (all INFERRED): 200 → if `success:false` surface `errorMessage` · 400 fix payload (casing, required fields, value type) · 401 re-run `/authorise`, retry once · 403 confirm Business Administrator · 404 verify `flowIdentifier` + URL-encoded step name · 429 backoff+retry · 5xx exponential backoff ≤3.

## Webhooks / Events

Outbound only, via a **"Webhook - Form" step** added in the flow modeller; not configurable via the API [DOCUMENTED].
| Event | Trigger | Payload |
| --- | --- | --- |
| Webhook step submit | the form/step containing the Webhook step is submitted | JSON of that step's form fields [DOCUMENTED, partial] |

Setup: enter an **Endpoint URL** on the Webhook step in the modeller; Flowingly POSTs the form JSON when the step is submitted [DOCUMENTED]. Payload: JSON matching the step's form fields; exact envelope/field naming not documented verbatim [DOCUMENTED, partial]. **Verification/signature: NONE documented** — no HMAC, no secret header, no IP allowlist; treat inbound webhooks as unauthenticated unless a shared secret is manually added to the URL. **Flag for security review** [UNKNOWN — security gap]. Reliability (retries, ordering, dedup) not documented [UNKNOWN].
Canonical flow-to-flow: Webhook step → middleware (e.g. Azure Logic Apps) → `POST /public/startflow` of another flow [DOCUMENTED]. Polling fallback: none viable (no "list recently modified flows"); only readable state is GET step fields for a known flow. For event-driven Numa automations the outbound Webhook step is the only realistic trigger source [INFERRED].

## Known Limitations

1. **No browse/list surface** — cannot enumerate flows, models, steps, actors, teams; caller supplies identifiers/model names [UNKNOWN].
2. **No step-progression API** — cannot advance/approve/complete/reassign/cancel a flow/step [UNKNOWN].
3. **No file handling** — no upload/download; `FileUpload`/`Signature` fields not API-writable [DOCUMENTED].
4. **Webhooks modeller-configured + outbound-only** — no API to manage them, no documented signature [DOCUMENTED].
5. **`startflow` NOT idempotent**, no idempotency-key — duplicate flows on retry are a real risk [INFERRED].
6. **Base URL, auth placement, token lifetime, refresh, error HTTP codes all UNVERIFIED** — run the 00-questionnaire discovery checklist before production [UNKNOWN].

## SDKs & Tooling

No SDKs exist. Postman collection: not available [UNKNOWN]. OpenAPI spec: not available [UNKNOWN — probe `publicapi.flowingly.net/swagger`, `/swagger/v1/swagger.json`, `/openapi.json`].

---

## Integration Path Assessment

**Recommended path: Direct API via `numa integrations request`** (action-oriented; NOT a Files/Data-Connector). Flowingly's Public API is a small surface — authenticate, start a flow, read/update a step's fields. There are no list/search/browse endpoints and no file content, so the Files (Data Connector) pattern does not apply. The backend handles the username/password → bearer token exchange and re-authorises on 401. Registered correctly as `authType: 'username-password'` (`username`+`password` fields). The most natural event hook is Flowingly's outbound Webhook step (a Numa Automations trigger source), not API polling.

Connector Files methods — **NOT applicable** (all `none`): `list_files`, `download_file`, `search_files`, `get_file_metadata` → no API endpoint, none feasible.

Direct-API capabilities instead:
| Capability | API Endpoint | Notes |
| --- | --- | --- |
| Authenticate | `POST /public/authorise` | backend exchanges username/password → token |
| Start flow | `POST /public/startflow` | requires model `Name` known out-of-band |
| Read step fields | `GET /public/flow/{flowId}/step/{stepId}` | discover field identifiers |
| Update step fields | `POST /public/flow/{flowId}/step/{stepId}` | bulk array of field values |
