---
api_name: 'Flowingly'
api_slug: 'flowingly'
vendor: 'Flowingly (NZ)'
website: 'https://flowingly.io'
investigation_started: '2026-05-29'
investigation_updated: '2026-05-29'
investigator: 'Claude Code (automated) — web research only, no live API access'
investigation_status: 'in-progress'
documentation_quality: 'poor'
api_types: ['REST']
overall_confidence: 'low — no live testing, sparse public docs'
blockers:
  - 'No live credentials — nothing CONFIRMED against a running API'
  - 'No OpenAPI/Swagger spec found'
  - 'Response shapes for write endpoints and error formats undocumented'
---

# API Investigation Questionnaire: Flowingly

> Completed by automated web research on 2026-05-29. **No live API testing was performed** — there are no [CONFIRMED] answers in this document. Everything is [DOCUMENTED] (stated in the Flowingly Help Center), [INFERRED], or [UNKNOWN].
>
> Sources: Flowingly Help Center articles (help.flowingly.net), Flowingly marketing/integrations pages (flowingly.io), general web search.
>
> **⚠️ Base URL discrepancy:** The connector brief named `api.flowingly.io` as the host. The Help Center documents the Public API host as **`https://publicapi.flowingly.net/public/`**. `api.flowingly.io` could not be confirmed to serve the Public API and may be wrong. **This must be resolved during discovery before any build.** [DOCUMENTED: publicapi.flowingly.net] / [UNKNOWN: api.flowingly.io]

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** No dedicated developer portal. Documentation is a small set of Help Center articles: https://help.flowingly.net (search "Public API") [DOCUMENTED]
  - Start Flow: https://help.flowingly.net/en/articles/5608036-use-the-flowingly-public-api-to-start-flow [DOCUMENTED]
  - Integration example (multiple calls): https://help.flowingly.net/en/articles/5572732-flowingly-integration-example-using-various-api-calls [DOCUMENTED]
  - Update step fields: https://help.flowingly.net/en/articles/5578808-use-the-flowingly-public-api-to-update-a-step-s-fields [DOCUMENTED]
  - Flow-to-flow via webhooks: https://help.flowingly.net/en/articles/6402692-from-a-flow-to-another-using-public-api-webhooks [DOCUMENTED]
- **API reference / endpoint catalog URL:** None — no catalog, no Swagger UI [UNKNOWN]
- **Authentication guide URL:** A "Get an Access Token for Flowingly API" article is linked from the Start Flow article, but its full content was not retrievable. Auth is partially documented inline in the integration-example article. [DOCUMENTED, partial]
- **Changelog / release notes URL:** Not found [UNKNOWN]
- **Status page URL:** Not found [UNKNOWN]

> **Discovery tip:** `api.flowingly.io`, `developer.flowingly.io`, `docs.flowingly.io` were not confirmed. The working docs are on the `.net` domain (`help.flowingly.net`), and the API host is `publicapi.flowingly.net`. The product markets itself on the `.io` domain (`flowingly.io`). Don't assume the `.io` host serves the API.

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** None found [UNKNOWN] — try `https://publicapi.flowingly.net/swagger`, `/swagger/v1/swagger.json`, `/openapi.json` during discovery
- **Postman collection URL:** None found [UNKNOWN]
- **Official SDK repositories:**
  - Python: None [UNKNOWN]
  - Node.js: None [UNKNOWN]
  - Other: None [UNKNOWN]
- **Official blog / engineering blog:** Marketing site https://flowingly.io/platform/integrations/ describes integrations conceptually (webhooks + API), no engineering detail [DOCUMENTED]
- **Community forums / Stack Overflow tag:** None found [UNKNOWN]

> **Naming caution:** "Flowingly" is distinct from "Flow" / GetFlow (developer.getflow.com) and from "Flowable" (the open-source BPM engine). Several search hits refer to those unrelated products — ignore them. Flowingly is the NZ-based BPM/workflow SaaS at flowingly.io.

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                    |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| Authentication            | 2      | Endpoint + response shape documented in one article; token lifetime/refresh undocumented |
| Endpoint reference        | 2      | ~4 endpoints described across help articles; no catalog                                  |
| Request/response examples | 2      | Start Flow + Update Step Fields have request shapes; write responses thin                |
| Error documentation       | 1      | `success`/`errorCode`/`errorMessage` envelope mentioned; no code catalog, no HTTP codes  |
| Rate limit documentation  | 1      | None found                                                                               |
| Pagination documentation  | 1      | None found — API appears action-oriented, no list endpoints documented                   |
| Webhook documentation     | 2      | Webhook step configured in flow modeller; payload = form fields; no signature docs       |
| SDKs / code examples      | 1      | No SDKs; only an Azure Logic Apps walkthrough                                            |
| Changelog / versioning    | 1      | None found                                                                               |

**Overall documentation quality:** poor

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (Help Center articles only)
- [ ] Found or confirmed no OpenAPI/Swagger spec (none found; not exhaustively probed)
- [x] Identified authentication method (username/password → bearer token)
- [x] Found at least one working example (request shapes documented, not live-tested)
- [ ] Identified rate limit information (none found)
- [ ] Identified pagination approach (no list endpoints; N/A or undocumented)
- [x] Checked for webhook/event support (webhook step in flow modeller)
- [x] Checked for official SDKs (none)
- [ ] **Live API testing — NOT performed (no credentials)**

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Flowingly Public API [DOCUMENTED]
- **Vendor / company:** Flowingly (NZ-based, business process management / workflow automation) [DOCUMENTED]
- **Current API version:** No explicit version. Paths are under `/public/` with no version segment. [DOCUMENTED]
- **Base URL(s):**
  - Production: `https://publicapi.flowingly.net/public/` [DOCUMENTED]
  - **Brief-named host:** `https://api.flowingly.io` [UNKNOWN — could not confirm; treat as suspect, see top-of-file warning]
  - Sandbox / testing: Not documented [UNKNOWN]
- **API type:** REST (JSON over HTTPS) [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1 assumed) [INFERRED]
- **Data format:** JSON [DOCUMENTED]
- **Content-Type header(s):**
  - Authorize: `application/x-www-form-urlencoded` (credentials passed as username/password params) [DOCUMENTED — needs verification]
  - Other calls: `application/json` [INFERRED]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure pattern:** `https://publicapi.flowingly.net/public/{action}` and `.../public/flow/{flowIdentifier}/step/{stepIdentifier}` [DOCUMENTED]
- **Versioning strategy:** None in URL (no `/v1/`) [DOCUMENTED]
- **CORS policy:** Not documented [UNKNOWN]
- **Field casing:** Mixed. Auth response uses camelCase (`accessToken`, `idToken`, `refreshToken`, `tokenType`, `expiresIn`). Start Flow request uses **PascalCase** (`Name`, `Subject`, `ActorsToStartFlowFor`, `CCActors`, `AssignedActor`, `FlowInitiator`). Start Flow response uses camelCase (`success`, `errorCode`, `errorMessage`, `dataModel`, `flowIdentifier`, `stepIdentifier`). Update Step Fields body uses camelCase (`name`, `type`, `order`, `identifier`, `value`, `options`). **Casing is inconsistent across endpoints — preserve exactly as documented per endpoint.** [DOCUMENTED]
- **ID format:** Flow identifier is a human-readable string `FLOW-XXX` (e.g. `FLOW-604`). Field identifier is a string `fieldXXXXXXXXXX` (numeric suffix). Step identifier appears to be the step name itself (e.g. `New Customer (Debtor) Form`). [DOCUMENTED]
- **Required headers:**

| Header        | Value                               | Purpose                                           |
| ------------- | ----------------------------------- | ------------------------------------------------- |
| Authorization | `Bearer {accessToken}`              | On all non-authorize calls                        |
| Content-Type  | `application/json`                  | On JSON request bodies (startflow, update fields) |
| Content-Type  | `application/x-www-form-urlencoded` | On the authorise call (credentials)               |

### 2.3 Authentication [REQUIRED]

> The connector is registered with `authType: 'username-password'` and two credential fields (`username`, `password`) — matching Flowingly's token-exchange model: the admin/user supplies a Flowingly username + password, which the backend exchanges for a bearer access token.

- **Auth method:** Custom token exchange — POST username/password to the authorise endpoint, receive a bearer access token, then send `Authorization: Bearer {accessToken}` on subsequent calls. Resembles OAuth2 Resource Owner Password but is **not** a standard OAuth2 endpoint (no token_type/grant_type negotiation documented). [DOCUMENTED]
- **Auth location:** Header (`Authorization`) for resource calls; credentials in body/query for authorise. [DOCUMENTED]
- **Auth header format:**

```
Authorization: Bearer {accessToken}
```

**Token exchange (authorise):**

- **Endpoint:** `POST https://publicapi.flowingly.net/public/authorise` [DOCUMENTED]
- **Credentials:** `username` (a Flowingly **Business Administrator** email) and `password` (account password). Documented as query parameters with `Content-Type: application/x-www-form-urlencoded`. **Whether these go in query string vs. form body needs verification.** [DOCUMENTED — placement needs verification]
- **Response body:** [DOCUMENTED]

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": null,
  "idToken": "",
  "tokenType": "Bearer",
  "expiresIn": 0
}
```

- **Token lifetime:** `expiresIn` is present but the example shows `0`; real value and unit (seconds?) are **unknown**. [UNKNOWN]
- **Refresh token behavior:** `refreshToken` is present in the schema but shown as `null` in the example — **refresh may not be supported / not issued**. Most likely the integration must re-authorise with username/password to get a fresh token. [INFERRED — needs verification]
- **Scopes / permissions model:** None documented. Access is presumably scoped to what the authenticating Business Administrator can do in Flowingly. [UNKNOWN]
- **Account requirement:** The authenticating user must be a **Business Administrator** in Flowingly for the Public API to work. [DOCUMENTED]
- **PKCE / state:** N/A — not an OAuth redirect flow [DOCUMENTED]

> **Storage note for connector:** Because this is `username-password` authType, the admin supplies username + password once; the backend performs the token exchange and stores/refreshes the bearer token. Given `refreshToken` is likely null, the backend should be prepared to **re-run the authorise call** whenever the access token expires (catch 401 → re-authorise → retry once).

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> ⚠️ **GATE NOT PASSED.** No live call was made — no credentials available. The block below is the **documented expected** request/response, not a verified result.

**Expected first call (authorise):**

```http
POST /public/authorise HTTP/1.1
Host: publicapi.flowingly.net
Content-Type: application/x-www-form-urlencoded

username=admin@company.com&password=********
```

**Expected response (per docs):**

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": null,
  "idToken": "",
  "tokenType": "Bearer",
  "expiresIn": 0
}
```

- **HTTP status code:** Presumably 200 [INFERRED]
- **Response headers of note:** Unknown [UNKNOWN]
- **Time to first successful call:** Unknown — depends on obtaining a Business Administrator account [UNKNOWN]
- **Gotchas:** username/password placement (query vs. form body) unverified; `expiresIn`/`refreshToken` semantics unclear.

- [ ] **GATE CHECK: First successful API call NOT completed — discovery with live credentials required before generating any build artifacts.**

---

## Phase 3: Domain Model & Behavior

> Flowingly's Public API is **narrow and action-oriented**: it exposes starting flow instances and reading/writing the fields of a specific step. It does **not** appear to expose list/browse endpoints for workflow definitions, flow instances, actors, or teams. The entities below are inferred from the request/response payloads of the documented endpoints.

### 3.1 Core Entities [REQUIRED]

#### Entity: Flow (instance)

- **API resource name / endpoint path:** Created via `POST /public/startflow`; addressed via `/public/flow/{flowIdentifier}/...`
- **Description:** A running instance of a workflow, started from a published flow model (template). Identified by `flowIdentifier` like `FLOW-604`.
- **CRUD support:** Create (start). No documented list/get/delete of flow instances. [DOCUMENTED for create; UNKNOWN for read/delete]

**Fields (from Start Flow request/response):**

| Field                | Type           | Required? | Writable?     | Description                                             | Example Value                   |
| -------------------- | -------------- | --------- | ------------- | ------------------------------------------------------- | ------------------------------- |
| Name                 | string         | yes       | yes (create)  | Flow **model** (template) name to instantiate           | `"New Customer Onboarding"`     |
| Subject              | string         | yes       | yes (create)  | Subject/title of this flow instance                     | `"Acme Ltd onboarding"`         |
| ActorsToStartFlowFor | array          | yes       | yes (create)  | Who the flow is started for (`UserEmail` and/or `Team`) | `[{"UserEmail":"jo@acme.com"}]` |
| CCActors             | array          | no        | yes (create)  | CC actors (`UserEmail` and/or `Team`)                   | `[{"Team":"Finance"}]`          |
| AssignedActor        | string (email) | no        | yes (create)  | Email to assign the first step to                       | `"manager@acme.com"`            |
| FlowInitiator        | string (email) | yes       | yes (create)  | Email of the flow initiator                             | `"system@acme.com"`             |
| flowIdentifier       | string         | n/a       | no (response) | System-assigned instance ID                             | `"FLOW-604"`                    |
| stepIdentifier       | string         | n/a       | no (response) | Name/ID of the first/current step                       | `"New Customer (Debtor) Form"`  |

> **Required-field caveat:** Required/optional flags above are [INFERRED] from the documented examples. Only live validation-error mining will confirm which fields are truly mandatory. [INFERRED]

#### Entity: WorkflowDefinition / Flow Model (template)

- **API resource name / endpoint path:** Not directly exposed by the Public API. Referenced **by name** via the `Name` field of Start Flow.
- **Description:** The reusable workflow template designed in the Flowingly modeller. Contains the step/field definitions.
- **CRUD support:** None via Public API. Authored in the Flowingly web app (modeller). **No documented endpoint to list available flow models or their exact names** — the integrator must know the model name out-of-band. [INFERRED / UNKNOWN]

#### Entity: Step

- **API resource name / endpoint path:** `/public/flow/{flowIdentifier}/step/{stepIdentifier}` (GET fields, POST update fields)
- **Description:** A single step within a flow instance, containing form fields. `stepIdentifier` appears to be the step's display name.
- **CRUD support:** Read fields (GET), Update fields (POST). No create/delete (steps are defined by the model). [DOCUMENTED]

#### Entity: Field (step form field)

- **API resource name / endpoint path:** Embedded in GET/POST of a step.
- **Description:** A form field on a step. The unit the Public API reads/writes.
- **CRUD support:** Read + Update (value). Definitions (name/type/order) are model-defined. [DOCUMENTED]

**Fields:**

| Field      | Type          | Required? | Writable?    | Description                              | Example Value       |
| ---------- | ------------- | --------- | ------------ | ---------------------------------------- | ------------------- |
| name       | string        | yes       | no           | Field display name                       | `"Customer Name"`   |
| type       | string (enum) | yes       | no           | Field type (see enum in 3.6)             | `"Text"`            |
| order      | integer       | yes       | no           | Display order within the step            | `1`                 |
| identifier | string        | yes       | no (key)     | Stable field ID `fieldXXXXXXXXXX`        | `"field4938201746"` |
| value      | string/object | n/a       | yes (update) | The field value to set                   | `"Acme Ltd"`        |
| options    | array/null    | no        | no           | Choices for list-type fields (else null) | `null`              |

#### Entity: Actor

- **API resource name / endpoint path:** Not a standalone resource — referenced inline as `UserEmail` or `Team` within Start Flow.
- **Description:** A participant in a flow — either an individual user (by email) or a Team (by name).
- **CRUD support:** None via Public API. [DOCUMENTED — inline only]

**Shape:**

```json
{ "UserEmail": "jo@acme.com" }   // individual actor
{ "Team": "Finance" }            // team actor
```

### 3.2 Entity Relationships [IMPORTANT]

```
┌─────────────────────┐  instantiates  ┌────────────────────┐
│ WorkflowDefinition  │───────────────>│   Flow (instance)  │
│  (Flow Model)       │   (by Name)    │   flowIdentifier   │
└─────────────────────┘                └────────────────────┘
        │ 1:N (template)                          │ 1:N
        ▼                                         ▼
┌─────────────────────┐                ┌────────────────────┐
│      Step (def)     │                │    Step (instance) │
└─────────────────────┘                │   stepIdentifier   │
        │ 1:N                          └────────────────────┘
        ▼                                         │ 1:N
┌─────────────────────┐                           ▼
│     Field (def)     │                ┌────────────────────┐
└─────────────────────┘                │  Field (value)     │
                                       │   identifier/value │
                                       └────────────────────┘

  Actors (UserEmail | Team) are attached to a Flow instance at start time
  (ActorsToStartFlowFor, CCActors, AssignedActor, FlowInitiator).
```

[INFERRED from payload structures — no relationship metadata is exposed by the API.]

### 3.3 State Machines [IMPORTANT]

#### State Machine: Flow instance

```
[not started] --POST /startflow--> [Active @ Step 1] --(step completed in-app or via field update)--> [Active @ Step N] --> [Completed]
```

The Public API can **start** a flow and **update fields** of the current step, but the documented surface does not expose step transition / approval / completion actions, nor a way to read flow status. Step progression appears to be driven inside the Flowingly app (or by completing the step's form). [INFERRED]

| From State         | Action/Trigger           | To State           | Reversible? | Side Effects                            |
| ------------------ | ------------------------ | ------------------ | ----------- | --------------------------------------- |
| not started        | POST /startflow          | Active @ Step 1    | No          | Returns flowIdentifier + stepIdentifier |
| Active @ Step      | (in-app step completion) | Active @ next step | No          | Not exposed via Public API [UNKNOWN]    |
| Active @ last step | (completion)             | Completed          | No          | Not exposed via Public API [UNKNOWN]    |

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- A flow **model** must already exist and be published in Flowingly before `startflow` can instantiate it by `Name`. [INFERRED]
- Field updates target a specific `flowIdentifier` + `stepIdentifier` that must currently exist/be active. [INFERRED]

**Field-level rules:**

- Field values are validated against modeller-configured rules on update; custom error messages (configured in the modeller) are returned, otherwise default validation errors apply. [DOCUMENTED]
- The authenticating user must be a Business Administrator. [DOCUMENTED]

**Cascading effects:**

- Starting a flow notifies/assigns the configured actors (email assignment). [INFERRED]

**Computed / read-only fields:**

- `flowIdentifier`, `stepIdentifier` are system-assigned. [DOCUMENTED]
- Field `name`, `type`, `order`, `identifier` are model-defined (read-only via API); only `value` is writable. [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format   | Pattern            | Example                      | Notes                                                  |
| -------- | ------------------ | ---------------------------- | ------------------------------------------------------ |
| Flow ID  | `FLOW-<number>`    | `FLOW-604`                   | String, human-readable [DOCUMENTED]                    |
| Field ID | `field<digits>`    | `field4938201746`            | Stable per-field key [DOCUMENTED]                      |
| Step ID  | step display name  | `New Customer (Debtor) Form` | URL-encoded in path; spaces/parens appear [DOCUMENTED] |
| Actor    | email or team name | `jo@acme.com` / `Finance`    | UserEmail or Team [DOCUMENTED]                         |
| Date     | unknown            | unknown                      | Date/Datetime field types exist; format [UNKNOWN]      |
| Currency | unknown            | unknown                      | Currency field type exists; format [UNKNOWN]           |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity | Field | Allowed Values                                                                                                                        | Notes                                                        |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Field  | type  | `Text`, `TextArea`, `SelectList`, `MultiSelectList`, `RadioButtonList`, `CheckBox`, `Email`, `Date`, `Datetime`, `Currency`, `Number` | [DOCUMENTED] — exact casing per docs; list may be incomplete |

> The `value` representation per type (e.g. how a Date or MultiSelectList value is encoded) is **not documented** and must be discovered. [UNKNOWN]

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: POST /public/authorise

- **Purpose:** Exchange username/password for a bearer access token
- **Authentication required:** no (this IS the auth call)
- **Idempotent:** yes (re-issuing a token has no destructive side effect) [INFERRED]
- **Status:** [DOCUMENTED — not live-tested]

**Request:**

```http
POST /public/authorise HTTP/1.1
Host: publicapi.flowingly.net
Content-Type: application/x-www-form-urlencoded

username=admin@company.com&password=********
```

**Success response:**

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": null,
  "idToken": "",
  "tokenType": "Bearer",
  "expiresIn": 0
}
```

**Error responses:** Not documented [UNKNOWN] — expect 400/401 for bad credentials.

#### Endpoint: POST /public/startflow

- **Purpose:** Start a new flow instance from a published flow model
- **Authentication required:** yes (`Authorization: Bearer {accessToken}`)
- **Idempotent:** no — each call starts a new flow instance [INFERRED]
- **Status:** [DOCUMENTED — not live-tested]

**Request:**

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

**Success response:**

```json
{
  "success": true,
  "errorCode": null,
  "errorMessage": null,
  "dataModel": [{ "flowIdentifier": "FLOW-604", "stepIdentifier": "New Customer (Debtor) Form" }]
}
```

**Error responses:** Envelope returns `success: false` with `errorCode` / `errorMessage`. The HTTP status code on failure and the `errorCode` catalogue are **not documented**. [DOCUMENTED envelope / UNKNOWN codes]

#### Endpoint: GET /public/flow/{flowIdentifier}/step/{stepIdentifier}

- **Purpose:** Read all fields (definitions + current values) for a step in a flow instance
- **Authentication required:** yes
- **Idempotent:** yes
- **Status:** [DOCUMENTED — not live-tested]

**Path parameters:**

| Parameter      | Type   | Required | Description                                                      |
| -------------- | ------ | -------- | ---------------------------------------------------------------- |
| flowIdentifier | string | yes      | e.g. `FLOW-604`                                                  |
| stepIdentifier | string | yes      | Step name, URL-encoded (e.g. `New%20Customer%20(Debtor)%20Form`) |

**Request:**

```http
GET /public/flow/FLOW-604/step/New%20Customer%20(Debtor)%20Form HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
```

**Success response (array of fields):**

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

[Response shape INFERRED from the symmetric Update Step Fields body; exact wrapper (raw array vs. enveloped) is UNKNOWN.]

#### Endpoint: POST /public/flow/{flowIdentifier}/step/{stepIdentifier}

- **Purpose:** Save/update field values for a step in a flow instance
- **Authentication required:** yes
- **Idempotent:** yes (re-sending same values is safe) [INFERRED]
- **Status:** [DOCUMENTED — not live-tested]

**Request (array of fields with values):**

```json
[
  {
    "name": "Customer Name",
    "type": "Text",
    "order": 1,
    "identifier": "field4938201746",
    "value": "Acme Ltd",
    "options": null
  },
  {
    "name": "Email",
    "type": "Email",
    "order": 2,
    "identifier": "field4938201747",
    "value": "jo@acme.com",
    "options": null
  }
]
```

**Success response:** Not explicitly documented. Likely the same `success`/`errorCode`/`errorMessage` envelope as Start Flow, or 200 with updated fields. [INFERRED / UNKNOWN]

**Validation:** Field values validated against modeller-configured rules; custom or default validation errors returned. [DOCUMENTED]

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path                                                | Purpose                  | Auth? | Paginated? | Confidence |
| ------ | --------------------------------------------------- | ------------------------ | ----- | ---------- | ---------- |
| POST   | /public/authorise                                   | Get bearer access token  | No    | No         | DOCUMENTED |
| POST   | /public/startflow                                   | Start a flow instance    | Yes   | No         | DOCUMENTED |
| GET    | /public/flow/{flowIdentifier}/step/{stepIdentifier} | Read step fields         | Yes   | No         | DOCUMENTED |
| POST   | /public/flow/{flowIdentifier}/step/{stepIdentifier} | Update step field values | Yes   | No         | DOCUMENTED |

> This is the **entire documented surface**. There may be additional undocumented endpoints (list flows, list models, complete step, comments, attachments) — none were found in public docs. **Discovery against a live instance / Swagger probe is required to know the true catalogue.** [UNKNOWN]

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

None — no GraphQL/WebSocket surface found. [UNKNOWN]

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?   | Syntax | Notes                                            |
| ------------------------------- | ------------ | ------ | ------------------------------------------------ |
| Filter by field value           | No / Unknown | -      | No list endpoints documented [UNKNOWN]           |
| Filter by date range            | No / Unknown | -      | [UNKNOWN]                                        |
| Full-text search                | No / Unknown | -      | [UNKNOWN]                                        |
| Sort by field                   | No / Unknown | -      | [UNKNOWN]                                        |
| Field selection / sparse fields | No           | -      | GET step returns the full field array [INFERRED] |
| Include related records         | No           | -      | [INFERRED]                                       |
| Aggregate / count               | No           | -      | [UNKNOWN]                                        |
| Logical / comparison operators  | No           | -      | [UNKNOWN]                                        |

> The Public API is **not a query API**. It targets a specific flow + step by identifier. There is no documented way to list or filter flows, models, steps, or actors. [INFERRED]

### 5.2 Filter Syntax [REQUIRED]

Not applicable — no filterable list endpoints are documented. To act on a flow you must already hold its `flowIdentifier` (e.g. captured from the Start Flow response, or from a webhook payload). [INFERRED]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: Start a flow, then read the first step's fields**

```http
POST /public/startflow            → dataModel[0].flowIdentifier = "FLOW-604", stepIdentifier = "..."
GET  /public/flow/FLOW-604/step/{stepIdentifier}
```

**Pattern 2: Populate a step from an external system**

```http
GET  /public/flow/FLOW-604/step/{stepIdentifier}     (discover field identifiers)
POST /public/flow/FLOW-604/step/{stepIdentifier}     (write values)
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** None / not applicable. No list endpoints are documented; the only multi-item response (GET step fields) returns a complete array with no paging. [INFERRED]
- **Default / max page size:** N/A [UNKNOWN]
- **Total count available:** N/A [UNKNOWN]

### 6.2 Pagination Worked Example [REQUIRED]

N/A — no paginated endpoints.

### 6.3 Bulk Operations [IMPORTANT]

- **Bulk field update:** The Update Step Fields call accepts an **array of fields**, so multiple field values are updated in one request (per step). This is the only bulk-like operation. [DOCUMENTED]
- **Bulk start flow / bulk read:** Not documented [UNKNOWN]
- **Partial failure handling:** Unknown — if one field in the array fails validation, whether the whole request is rejected or partially applied is undocumented. [UNKNOWN]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported?     | Notes                                                             |
| ------------------------ | -------------- | ----------------------------------------------------------------- |
| Webhooks                 | Yes (outbound) | Configured as a **Webhook step** inside a flow model [DOCUMENTED] |
| WebSocket                | No             | [UNKNOWN/None]                                                    |
| Server-Sent Events (SSE) | No             | [UNKNOWN/None]                                                    |
| Long polling             | No             | [UNKNOWN/None]                                                    |
| Change feeds / streams   | No             | [UNKNOWN/None]                                                    |

### 7.2 Webhooks [IMPORTANT]

- **Direction:** Outbound only — Flowingly POSTs to an endpoint you configure. [DOCUMENTED]
- **Setup:** Added in the flow modeller as a "Webhook" step type with an **Endpoint URL**. Not configured via the Public API. [DOCUMENTED]
- **Trigger:** When the form/step containing the webhook is submitted, Flowingly sends a JSON payload to the endpoint. [DOCUMENTED]
- **Payload format:** JSON matching the form fields defined in the webhook step (short text, long text, option lists, date fields, etc.). Exact envelope/field naming not fully documented. [DOCUMENTED, partial]
- **Verification / signature:** No signature/HMAC or IP allowlist documented. **Treat inbound webhooks as unauthenticated unless verified otherwise** — a shared-secret query param or path token would have to be configured manually in the endpoint URL. [UNKNOWN — flag for security review]
- **Reliability (retries, ordering, dedup):** Not documented [UNKNOWN]

> The documented "flow-to-flow" pattern chains a Webhook step → middleware (e.g. Azure Logic Apps) → Public API `startflow` of another flow. This is the canonical integration shape. [DOCUMENTED]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** None ideal — there is no "list recently modified flows" endpoint. The only readable state is `GET /public/flow/{id}/step/{stepIdentifier}` for a **known** flow. [INFERRED]
- **Implication:** For event-driven Numa automations, **outbound webhooks (the Webhook step) are the only viable trigger source**; polling cannot discover new/changed flows. [INFERRED]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

- **Limits:** Not documented [UNKNOWN]
- **Rate limit headers:** Not documented [UNKNOWN]
- **429 response shape:** Not documented [UNKNOWN]
- **Backoff strategy:** Recommend conservative client-side throttling + exponential backoff on 429/5xx until limits are discovered. [INFERRED]

### 8.2 Error Handling [REQUIRED]

**Application-level error envelope (Start Flow, likely shared):** [DOCUMENTED]

```json
{
  "success": false,
  "errorCode": "SOME_CODE",
  "errorMessage": "Human readable reason",
  "dataModel": null
}
```

- **HTTP status codes:** Not documented per error. The envelope returns `success: false` rather than relying solely on HTTP codes. **It is unknown whether failures return HTTP 200 with `success:false` or a 4xx/5xx.** This must be discovered — it materially affects client error handling. [UNKNOWN]
- **`errorCode` catalogue:** Not documented [UNKNOWN]
- **Validation errors (step fields):** Modeller-configured custom messages, else default validation errors. Structure not documented. [DOCUMENTED, partial]

**Inferred status-code handling (until verified):**

| HTTP Status | Meaning (assumed)        | Retryable? | Recovery Action                         |
| ----------- | ------------------------ | ---------- | --------------------------------------- |
| 200         | OK — **check `success`** | n/a        | If `success:false`, read `errorMessage` |
| 400         | Bad request / validation | No         | Fix payload                             |
| 401         | Unauthorized / expired   | Yes        | Re-run /authorise, retry once           |
| 403         | Forbidden (not BizAdmin) | No         | Check account is Business Administrator |
| 404         | Flow/step not found      | No         | Verify flowIdentifier / stepIdentifier  |
| 429         | Rate limited (assumed)   | Yes        | Backoff                                 |
| 5xx         | Server error             | Yes        | Backoff + retry                         |

[All rows INFERRED — none confirmed.]

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** None documented [UNKNOWN]
- **Naturally idempotent:** GET step (yes), POST update-fields (yes — overwrites values), POST startflow (**no** — creates a new instance each call). [INFERRED]

### 8.5 File Handling [IMPORTANT]

No file upload/download endpoints documented in the Public API. (The flow modeller supports file/attachment field types in the app, but the Public API surface does not document file handling.) [UNKNOWN]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                     | Fits?   | Notes                                                           |
| -------------------------- | ----------------------------------------------- | ------- | --------------------------------------------------------------- |
| **Data Connector**         | API has browsable structured content            | No      | No list/browse endpoints; nothing to enumerate                  |
| **Data Connector (Files)** | API is primarily a file storage/document system | No      | No file operations                                              |
| **Direct API Only**        | API is action-oriented (no browsable content)   | **Yes** | Start flows, read/write step fields — pure actions on known IDs |
| **Hybrid**                 | Both browsable content AND actions              | No      | No browsable surface                                            |

**Selected integration path:** **Direct API via `connect_request`** (action-oriented, no Files/Data-Connector surface).

**Justification:** Flowingly's Public API is a small, action-oriented surface: authenticate, start a flow, and read/update the fields of a specific step. There are no list/search/browse endpoints, no file content, and nothing to enumerate in Files Remote — so the Data Connector (Files) pattern does not apply. The workspace agent should call Flowingly through the standard direct-API mechanism (`connect_request`), with the backend handling the username/password → bearer token exchange and re-authorising on 401. The connector is correctly registered as `authType: 'username-password'` with `username` + `password` credential fields. The most natural event-driven hook is Flowingly's **outbound Webhook step** (a Numa Automations trigger source), not API polling.

### 9.2 Connector Requirements [IMPORTANT]

Not a Files connector — the standard `list_files` / `download_file` mapping does **not** apply. Direct-API capabilities instead:

| Capability         | API Endpoint                             | Notes                                       |
| ------------------ | ---------------------------------------- | ------------------------------------------- |
| Authenticate       | POST /public/authorise                   | Backend exchanges username/password → token |
| Start flow         | POST /public/startflow                   | Requires model `Name` known out-of-band     |
| Read step fields   | GET /public/flow/{flowId}/step/{stepId}  | Discover field identifiers                  |
| Update step fields | POST /public/flow/{flowId}/step/{stepId} | Bulk array of field values                  |

**Auth type for connector:** username-password (token exchange) [matches registry]
**Connector category:** Workflow (BPM) [matches registry]
**Caching appropriate:** Minimal — step field reads could be briefly cached, but values change as users fill forms. Prefer no caching or very short TTL. [INFERRED]

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Start a flow instance from a known flow model name, assigning actors/CC/initiator. [DOCUMENTED capability]
2. Read the fields (and current values) of a specific step in a known flow. [DOCUMENTED capability]
3. Update/populate step field values from external/chat-provided data (bulk per step). [DOCUMENTED capability]

**CANNOT do (out of scope / not supported / dangerous):**

1. List/search flows, flow models, steps, actors, or teams — **no such endpoints documented**. The agent must be given identifiers/model names. [UNKNOWN/None]
2. Advance, approve, complete, reassign, or cancel a flow/step — not in the documented surface. [UNKNOWN/None]
3. Upload/download files/attachments — not supported. [UNKNOWN/None]
4. Configure webhooks or modify flow models — modeller-only, not via API. [DOCUMENTED — not available]

**Default parameters:**

| Parameter            | Default            | Reason                                             |
| -------------------- | ------------------ | -------------------------------------------------- |
| FlowInitiator        | authenticated user | Sensible default if the caller doesn't specify     |
| ActorsToStartFlowFor | explicit           | Must be supplied; no safe default — agent must ask |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK | Language | Quality | Maintained? | Worth Using? | Notes         |
| --- | -------- | ------- | ----------- | ------------ | ------------- |
| —   | —        | —       | —           | No           | No SDKs exist |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1: sources identified (sparse Help Center) and quality assessed (poor)
- [ ] Phase 2: auth documented but **NOT live-tested** — GATE NOT PASSED
- [~] Phase 3: 5 entities inferred from payloads; no entity metadata from API
- [x] Phase 4: 4 documented endpoints captured with request/response shapes
- [x] Phase 5: query/filter — confirmed N/A (action API)
- [x] Phase 6: pagination — confirmed N/A
- [x] Phase 7: webhooks (outbound, modeller-configured) assessed
- [~] Phase 8: error envelope documented; HTTP codes / rate limits UNKNOWN
- [x] Phase 9: integration path selected (Direct API via connect_request)

**Overall investigation confidence:** **low** — entirely from sparse public docs, zero live verification.

**Known gaps that will reduce output quality:**

1. **Base URL unverified** — `publicapi.flowingly.net` (docs) vs `api.flowingly.io` (brief). Must resolve before build.
2. **No live call** — auth placement (query vs form body), token lifetime, refresh behaviour all unverified.
3. **Error model** — whether failures are HTTP 4xx/5xx or HTTP 200 + `success:false`; no `errorCode` catalogue.
4. **No catalogue beyond 4 endpoints** — list/complete/approve operations may exist but are undocumented.
5. **Rate limits / pagination / file handling** entirely unknown.
6. **Webhook security** — no signature scheme documented (security review needed).

### 10.2 Generation Prompts [REQUIRED]

Generate downstream docs only after a **discovery pass with live credentials** confirms auth, base URL, and the error model. Until then, every generated artifact must carry the same [INFERRED]/[UNKNOWN] markers and a "discovery required" banner.

- **01-llm-api-rules.md** — from Phase 2 (auth), 4 (endpoints), 8 (errors), 9 (capabilities). Emphasise: this is an action API on known IDs; the agent must obtain model names / flow identifiers from the user or a webhook.
- **01a-domain-model-reference.md** — from Phase 3.
- **01b-query-patterns.md** — minimal; state there are no query/list endpoints.
- **01c-mutation-patterns.md** — from Phase 4 (startflow, update step fields) + Phase 3 business rules.
- **01d-event-and-error-handling.md** — from Phase 7 (outbound webhook step) + Phase 8 (error envelope).
- **02-api-spec-investigation.md** — condense all phases; lead with the base-URL warning.
- **03-connector-setup.md** — Direct API (`connect_request`), username-password token exchange, re-authorise on 401.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                                     |
| ---------------------------- | ------------- | ---------- | -------------------------------------------------------- |
| 01-llm-api-rules             | Partial       | Low        | Error model + base URL unverified                        |
| 01a-domain-model-reference   | Partial       | Low        | Entities inferred from payloads only                     |
| 01b-query-patterns           | Yes (trivial) | Medium     | Confirmed no query surface                               |
| 01c-mutation-patterns        | Partial       | Low        | Write responses + validation shapes undocumented         |
| 01d-event-and-error-handling | Partial       | Low        | Webhook payload/signature + error codes unknown          |
| 02-api-spec-investigation    | Partial       | Low        | Only 4 endpoints; catalogue likely incomplete            |
| 03-connector-setup           | Yes           | Medium     | Auth flow clear enough to build; needs live verification |

---

## Appendix: Discovery Checklist (do this first, with live credentials)

1. **Resolve the host.** Hit `https://publicapi.flowingly.net/public/authorise` AND `https://api.flowingly.io/...`. Determine which serves the Public API. Probe `…/swagger`, `…/swagger/v1/swagger.json`, `…/openapi.json`.
2. **Confirm auth.** username/password in query string vs form body; capture real `expiresIn` (and unit), and whether `refreshToken` is ever non-null.
3. **Confirm the error model.** Send a bad model name and bad credentials; record HTTP status vs `success:false` envelope and any `errorCode` values.
4. **Map the real catalogue.** Try `GET /public/flows`, list-models, complete-step, approve, comments, attachments — record 404s vs hits (mirror the Fergus "confirmed NOT working" approach).
5. **Confirm step-field round-trip.** GET fields → POST updated values → GET again; record the write response shape and per-type `value` encodings (Date, Currency, MultiSelectList, CheckBox).
6. **Webhook step.** Stand up a receiver, submit a flow with a Webhook step, capture the exact payload envelope and any signature/secret mechanism.
7. **Rate limits.** Burst requests; capture any 429 and headers.

> **Mark results [CONFIRMED] only after they are observed against the live API.**
