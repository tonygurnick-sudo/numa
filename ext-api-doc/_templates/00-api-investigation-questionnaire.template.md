---
api_name: ''
api_slug: ''
vendor: ''
website: ''
investigation_started: ''
investigator: ''
investigation_status: 'not-started' # not-started | in-progress | blocked | complete
documentation_quality: '' # excellent | good | adequate | poor | nonexistent
api_types: [] # REST | GraphQL | SOAP | gRPC | WebSocket | SSE
overall_confidence: '' # high | medium | low
blockers: []
---

# API Investigation Questionnaire: {{api_name}}

> This questionnaire drives the entire API integration package generation process.
> Fill it out thoroughly — every downstream document is generated from the answers here.
>
> **Priority tags:**
>
> - `[REQUIRED]` — Must be answered before any output can be generated
> - `[IMPORTANT]` — Significantly improves output quality; skip only if truly undiscoverable
> - `[NICE-TO-HAVE]` — Enhances the package but not critical
>
> **Confidence markers** — tag every answer:
>
> - `[CONFIRMED]` — Verified by testing against live API
> - `[DOCUMENTED]` — Stated in official documentation
> - `[INFERRED]` — Deduced from examples, SDKs, or behavior
> - `[UNKNOWN]` — Could not determine; note what was tried

---

## Phase 1: Information Sources

> **Why:** Establishes the research foundation. Claude Code needs to know where to look and what's trustworthy.

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:**
- **API reference / endpoint catalog URL:**
- **Authentication guide URL:**
- **Changelog / release notes URL:**
- **Status page URL:**

> **Discovery tip:** Check `{domain}/developers`, `{domain}/api`, `docs.{domain}`, `developer.{domain}`. Look for links in page footers and navigation menus.

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL (if available):**
- **Postman collection URL:**
- **Official SDK repositories:**
  - Python:
  - Node.js:
  - Other:
- **Official blog / engineering blog:**
- **Community forums / Stack Overflow tag:**

> **Discovery tip:** Search GitHub for `{vendor} openapi`, `{vendor} swagger`, `{vendor} api client`. Check Postman public workspace search.

### 1.3 Documentation Quality Assessment [REQUIRED]

Rate each area (1-5, where 5 = comprehensive with examples):

| Area                      | Rating | Notes |
| ------------------------- | ------ | ----- |
| Authentication            |        |       |
| Endpoint reference        |        |       |
| Request/response examples |        |       |
| Error documentation       |        |       |
| Rate limit documentation  |        |       |
| Pagination documentation  |        |       |
| Webhook documentation     |        |       |
| SDKs / code examples      |        |       |
| Changelog / versioning    |        |       |

**Overall documentation quality:** (excellent / good / adequate / poor / nonexistent)

### 1.4 Discovery Status [REQUIRED]

- [ ] Found official API documentation
- [ ] Found or confirmed no OpenAPI/Swagger spec
- [ ] Identified authentication method
- [ ] Found at least one working example
- [ ] Identified rate limit information
- [ ] Identified pagination approach
- [ ] Checked for webhook/event support
- [ ] Checked for official SDKs

---

## Phase 2: API Fundamentals

> **Why:** These are the non-negotiable basics. Without clear auth and a working first call, nothing else matters.

### 2.1 API Identity [REQUIRED]

- **API name:**
- **Vendor / company:**
- **Current API version:**
- **Base URL(s):**
  - Production:
  - Sandbox / testing:
- **API type:** (REST / GraphQL / SOAP / gRPC / WebSocket / mixed)

> **For GraphQL APIs:** Also document the introspection endpoint and whether it's enabled in production.
>
> **For SOAP APIs:** Document the WSDL URL and whether the API also offers a REST interface.
>
> **For gRPC APIs:** Document the proto file location and whether there's a REST/JSON gateway.

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTP/1.1 / HTTP/2 / WebSocket / other
- **Data format:** JSON / XML / Protocol Buffers / other
- **Content-Type header(s):**
- **Character encoding:**
- **URL structure pattern:**

```
Example: https://api.example.com/v2/{resource}/{id}
```

- **Versioning strategy:** URL path / header / query parameter / none
- **CORS policy:** (relevant for browser-based access)
- **Required headers (all requests):**

| Header | Value | Purpose |
| ------ | ----- | ------- |
|        |       |         |

### 2.3 Authentication [REQUIRED]

> **This is the single most important section.** If auth is wrong, nothing works.

- **Auth method:** (OAuth 2.0 / API key / Bearer token / Basic auth / HMAC / JWT / other)
- **Auth location:** (Header / Query parameter / Cookie / Request body)
- **Auth header format:**

```
Example: Authorization: Bearer {token}
```

**For OAuth 2.0:**

- **Grant type(s) supported:** (authorization_code / client_credentials / refresh_token / PKCE)
- **Authorization URL:**
- **Token URL:**
- **Revocation URL:**
- **Required scopes (list all, mark which are needed for integration):**

| Scope | Purpose | Required? |
| ----- | ------- | --------- |
|       |         |           |

- **Token lifetime:**
- **Refresh token behavior:** (automatic / manual / not supported)
- **PKCE required?** (yes / no)
- **State parameter required?** (yes / no)
- **Redirect URI restrictions:**

**For API Key auth:**

- **How to obtain:**
- **Key format / pattern:**
- **Rate limits per key:**
- **Key rotation procedure:**

**For token-based auth:**

- **How to generate tokens:**
- **Token lifetime:**
- **Token refresh mechanism:**
- **Scopes or permissions model:**

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> **This is a hard gate.** Do not proceed past Phase 2 until you have made at least one successful API call and can document the exact request and response.

**Endpoint used for first call:**

```http
GET /example/endpoint HTTP/1.1
Host: api.example.com
Authorization: Bearer xxx
```

**Response received:**

```json
{
  "example": "response"
}
```

- **HTTP status code:**
- **Response headers of note:**
- **Time to first successful call:** (how long did it take to get auth working?)
- **Gotchas encountered during setup:**

- [ ] **GATE CHECK: First successful API call completed and documented above**

---

## Phase 3: Domain Model & Behavior

> **Why:** Claude Code needs to understand the entities, their relationships, and the business rules that govern them. This is what makes the LLM prompt actually useful vs. generic.

### 3.1 Core Entities [REQUIRED]

> List every primary entity the API exposes. For each, document:

#### Entity: {{entity_name}}

- **API resource name / endpoint path:**
- **Description:**
- **CRUD support:** Create / Read / Update / Delete (which are available?)

**Fields:**

| Field | Type | Required? | Writable? | Description | Example Value |
| ----- | ---- | --------- | --------- | ----------- | ------------- |
|       |      |           |           |             |               |

**Relationships:**

| Related Entity | Relationship Type | How Expressed                        | Notes |
| -------------- | ----------------- | ------------------------------------ | ----- |
|                | one-to-many       | nested / ID reference / sub-resource |       |

> **Discovery tip:** If docs are sparse, make a GET request to the list endpoint and examine the response structure. Look for `_links`, `_embedded`, or ID fields that reference other entities.

_Copy this block for each entity._

### 3.2 Entity Relationships [IMPORTANT]

> Draw the entity relationship map. ASCII diagram preferred.

```
┌──────────┐     1:N     ┌──────────┐
│ Entity A │────────────>│ Entity B │
└──────────┘             └──────────┘
      │                        │
      │ 1:1                    │ N:M
      ▼                        ▼
┌──────────┐             ┌──────────┐
│ Entity C │             │ Entity D │
└──────────┘             └──────────┘
```

### 3.3 State Machines [IMPORTANT]

> Many entities have lifecycle states (e.g., draft -> active -> closed). Document each.

#### State Machine: {{entity_name}}

```
[state_a] --action--> [state_b] --action--> [state_c]
                                     \
                                      --action--> [state_d]
```

| From State | Action/Trigger | To State | Reversible? | Side Effects |
| ---------- | -------------- | -------- | ----------- | ------------ |
|            |                |          |             |              |

**Per-state capabilities:**

| State | Can Update? | Can Delete? | Available Actions | Notes |
| ----- | ----------- | ----------- | ----------------- | ----- |
|       |             |             |                   |       |

### 3.4 Business Rules [IMPORTANT]

> Document the non-obvious rules that the API enforces.

**Ordering / dependency rules:**

- (e.g., "Must create a Project before creating a Task")

**Field-level rules:**

- (e.g., "email field must be unique per organization")
- (e.g., "start_date must be before end_date")

**Cascading effects:**

- (e.g., "Deleting a Project archives all its Tasks")

**Uniqueness constraints:**

- (e.g., "name must be unique within parent_id scope")

**Computed / read-only fields:**

- (e.g., "total_amount is computed from line items")

### 3.5 Field Format Reference [IMPORTANT]

| Format      | Pattern | Example | Notes                              |
| ----------- | ------- | ------- | ---------------------------------- |
| Date        |         |         |                                    |
| DateTime    |         |         |                                    |
| Currency    |         |         |                                    |
| Phone       |         |         |                                    |
| ID format   |         |         |                                    |
| Enum values |         |         | List all enums with allowed values |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

> List every enum/picklist field and its allowed values.

| Entity | Field | Allowed Values | Default | Notes |
| ------ | ----- | -------------- | ------- | ----- |
|        |       |                |         |       |

---

## Phase 4: Endpoint Catalog

> **Why:** This becomes the core of the API spec document and feeds directly into the LLM prompt examples.

### 4.1 Critical Endpoints [REQUIRED]

> Document the 5-10 most important endpoints. These will be used as worked examples.

#### Endpoint: {{method}} {{path}}

- **Purpose:**
- **Authentication required:** yes / no
- **Rate limit:** (if different from global)
- **Idempotent:** yes / no

**Path parameters:**

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
|           |      |          |             |

**Query parameters:**

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
|           |      |          |         |             |

**Request body:**

```json
{
  "example": "request"
}
```

**Success response (with status code):**

```json
{
  "example": "response"
}
```

**Error responses:**

| Status | Error Code | Meaning | Recovery |
| ------ | ---------- | ------- | -------- |
|        |            |         |          |

> **Discovery tip:** Use the live API to capture real request/response pairs. Sanitize any credentials or PII before recording.

_Copy this block for each critical endpoint._

### 4.2 Full Endpoint Index [IMPORTANT]

> Quick reference table of ALL endpoints, even those not documented in detail above.

| Method | Path | Purpose | Auth? | Pagination? | Notes |
| ------ | ---- | ------- | ----- | ----------- | ----- |
|        |      |         |       |             |       |

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

> **For GraphQL APIs:**

```graphql
# Key queries
query {
  example {
    field1
    field2
  }
}

# Key mutations
mutation {
  createExample(input: { field1: "value" }) {
    id
  }
}
```

> **For WebSocket APIs:**

| Event Name | Direction                       | Payload | Purpose |
| ---------- | ------------------------------- | ------- | ------- |
|            | client->server / server->client |         |         |

---

## Phase 5: Query & Filter Capabilities

> **Why:** Users will ask "show me all X where Y" — Claude Code needs to know exactly what's possible.

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                          | Supported? | Syntax | Notes |
| ----------------------------------- | ---------- | ------ | ----- |
| Filter by field value               |            |        |       |
| Filter by date range                |            |        |       |
| Full-text search                    |            |        |       |
| Sort by field                       |            |        |       |
| Sort direction (asc/desc)           |            |        |       |
| Field selection / sparse fields     |            |        |       |
| Include related records             |            |        |       |
| Aggregate / count                   |            |        |       |
| Logical operators (AND/OR)          |            |        |       |
| Comparison operators (gt, lt, etc.) |            |        |       |
| Null checks                         |            |        |       |
| Regex / pattern matching            |            |        |       |

### 5.2 Filter Syntax [REQUIRED]

**General pattern:**

```
GET /resource?filter[field]=value&filter[field2]=value2
```

OR

```
GET /resource?field=value&field2=value2
```

OR other (document exact syntax):

**Operator syntax:**

```
Example: ?filter[created_at][gte]=2024-01-01
Example: ?status=active,pending (comma-separated OR)
```

**Combining filters:**

- Multiple filters: AND / OR / configurable
- Nesting: supported / not supported

### 5.3 Sort Syntax [IMPORTANT]

```
Example: ?sort=created_at
Example: ?sort=-created_at (descending)
Example: ?sort=status,created_at
```

### 5.4 Field Selection [NICE-TO-HAVE]

```
Example: ?fields=id,name,email
Example: ?fields[contacts]=id,name&fields[companies]=id,name
```

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:**
- **Per-resource search:**
- **Search syntax:**
- **Searchable fields:**
- **Fuzzy matching:** supported / not supported
- **Minimum query length:**

### 5.6 Common Query Patterns [REQUIRED]

> Document 3-5 query patterns that users are most likely to need.

**Pattern 1: {{description}}**

```http
GET /resource?param=value
```

**Pattern 2: {{description}}**

```http
GET /resource?param=value
```

_Add more as needed._

---

## Phase 6: Pagination & Bulk Operations

> **Why:** Getting pagination wrong means missing data or infinite loops. Bulk operations are critical for efficiency.

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** offset / cursor / page-number / keyset / link-header / none
- **Default page size:**
- **Maximum page size:**
- **Total count available:** yes / no (and how)

**Request parameters:**

| Parameter | Type | Default | Description |
| --------- | ---- | ------- | ----------- |
|           |      |         |             |

**Response structure:**

```json
{
  "data": [],
  "pagination": {
    "example": "structure"
  }
}
```

**How to detect last page:**

```
Example: next_cursor is null
Example: data array is empty
Example: page * per_page >= total_count
```

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /resource?limit=50
Page 2: GET /resource?limit=50&cursor=abc123
Page 3: GET /resource?limit=50&cursor=def456
Last:   (cursor is null or data is empty)
```

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint | Max Batch Size | Notes |
| --------------------- | -------- | -------------- | ----- |
| Bulk create           |          |                |       |
| Bulk update           |          |                |       |
| Bulk delete           |          |                |       |
| Bulk read / batch get |          |                |       |

**Bulk request format:**

```json
{
  "example": "bulk request"
}
```

**Partial failure handling:**

- Does the API support partial success? (some items succeed, others fail)
- How are individual errors reported?

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- **Export endpoint:**
- **Export format(s):** CSV / JSON / other
- **Async export:** yes / no
- **Export size limits:**
- **How to poll for completion:**

---

## Phase 7: Real-Time & Event-Driven

> **Why:** Webhooks and real-time events enable proactive behavior. Without them, the only option is polling.

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes |
| ------------------------ | ---------- | ----- |
| Webhooks                 |            |       |
| WebSocket                |            |       |
| Server-Sent Events (SSE) |            |       |
| Long polling             |            |       |
| Change feeds / streams   |            |       |

### 7.2 Webhooks [IMPORTANT] (if supported)

**Setup:**

- **Registration method:** API / UI / both
- **Registration endpoint:**
- **Webhook URL requirements:** (HTTPS only? Verification required?)

**Event Catalog:**

| Event Name | Trigger | Payload Summary |
| ---------- | ------- | --------------- |
|            |         |                 |

**Payload format:**

```json
{
  "example": "webhook payload"
}
```

**Verification / security:**

- **Signature header:**
- **Signature algorithm:**
- **Verification process:**
- **IP allowlist available:**

**Reliability:**

- **Retry policy:**
- **Retry schedule:**
- **Dead letter / failure notification:**
- **Event ordering guarantee:**
- **Duplicate delivery possible:**

### 7.3 WebSocket / SSE [NICE-TO-HAVE] (if applicable)

- **Connection URL:**
- **Authentication for connection:**
- **Heartbeat / keep-alive:**
- **Reconnection strategy:**
- **Message format:**

### 7.4 Polling Fallback [IMPORTANT]

> If no push mechanism exists, document the recommended polling approach.

- **Recommended polling endpoint:**
- **Recommended polling interval:**
- **"Modified since" filter available:**
- **Change detection field(s):** (updated_at, version, etag)
- **Rate limit implications of polling:**

---

## Phase 8: Operational Concerns

> **Why:** These are the things that cause production incidents when you get them wrong.

### 8.1 Rate Limits [REQUIRED]

| Scope        | Limit | Window | Notes |
| ------------ | ----- | ------ | ----- |
| Global       |       |        |       |
| Per-endpoint |       |        |       |
| Per-user     |       |        |       |

- **Rate limit headers:**

| Header | Meaning | Example Value |
| ------ | ------- | ------------- |
|        |         |               |

- **Rate limit exceeded response:**

```json
{
  "example": "429 response"
}
```

- **Retry-After header:** present / absent
- **Backoff strategy:** (recommended approach)

### 8.2 Error Handling [REQUIRED]

**Standard error response format:**

```json
{
  "example": "error response"
}
```

**Error codes reference:**

| HTTP Status | Error Code | Meaning | Retryable? | Recovery Action |
| ----------- | ---------- | ------- | ---------- | --------------- |
| 400         |            |         | No         |                 |
| 401         |            |         | Yes        | Refresh token   |
| 403         |            |         | No         |                 |
| 404         |            |         | No         |                 |
| 409         |            |         | Depends    |                 |
| 422         |            |         | No         |                 |
| 429         |            |         | Yes        | Backoff + retry |
| 500         |            |         | Yes        | Retry           |
| 502         |            |         | Yes        | Retry           |
| 503         |            |         | Yes        | Retry           |

**Validation error format:**

```json
{
  "example": "validation error with field-level details"
}
```

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** yes / no
- **Idempotency key header:**
- **Idempotency key lifetime:**
- **Which methods are naturally idempotent:**
  - GET: yes
  - PUT: yes / no
  - DELETE: yes / no
  - POST: no (unless idempotency key used)
  - PATCH: depends

### 8.4 Async Operations [IMPORTANT] (if applicable)

- **Which operations are async:**
- **How to poll for completion:**
- **Callback / webhook on completion:**
- **Timeout / TTL for async operations:**

**Async response pattern:**

```json
{
  "id": "operation_123",
  "status": "pending",
  "status_url": "/operations/operation_123"
}
```

### 8.5 File Handling [IMPORTANT] (if applicable)

- **Upload endpoint(s):**
- **Upload method:** multipart/form-data / binary body / pre-signed URL
- **Max file size:**
- **Allowed file types:**
- **Download endpoint(s):**
- **Download method:** direct binary / pre-signed URL / base64 in JSON

**Upload example:**

```http
POST /files
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="file"; filename="example.pdf"
Content-Type: application/pdf

<binary data>
--boundary--
```

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** (etag / version field / timestamp)
- **Conflict resolution:**
- **Eventual consistency warnings:**

---

## Phase 9: Platform Integration Assessment

> **Why:** Determines which Numa integration path to use and what needs to be built.

### 9.1 Integration Path Decision [REQUIRED]

Based on the API's capabilities, select the primary integration path:

| Path                       | When to Use                                            | Fits? | Notes |
| -------------------------- | ------------------------------------------------------ | ----- | ----- |
| **Data Connector**         | API has file-like content to browse/search/download    |       |       |
| **Data Connector (Files)** | API is primarily a file storage/document system        |       |       |
| **Direct API Only**        | API is action-oriented (no browsable content)          |       |       |
| **Hybrid**                 | API has both browsable content AND action capabilities |       |       |

**Selected integration path:**

**Justification:**

### 9.2 Connector Requirements [IMPORTANT] (if Data Connector path)

> Map API capabilities to the standard connector interface.

| Connector Method         | API Endpoint | Notes |
| ------------------------ | ------------ | ----- |
| `list_files`             |              |       |
| `download_file`          |              |       |
| `search_files`           |              |       |
| `get_file_metadata`      |              |       |
| `upload_file` (optional) |              |       |
| `delete_file` (optional) |              |       |

**Auth type for connector:** OAuth 2.0 / Token / API Key
**Connector category:** cloud-storage / email / project-management / crm / other
**Caching appropriate:** yes / no (and why)
**Caching policy:** (if yes)

### 9.3 Workspace Agent Capabilities [REQUIRED]

> What should the workspace agent be able to do with this API?

**CAN do (in scope):**

1.
2.
3.

**CANNOT do (out of scope or dangerous):**

1.
2.
3.

**Default parameters:** (sensible defaults the agent should use)

| Parameter | Default | Reason |
| --------- | ------- | ------ |
|           |         |        |

### 9.4 SDK Assessment [NICE-TO-HAVE]

> Evaluate official SDKs for potential use.

| SDK | Language | Quality | Maintained? | Worth Using? | Notes |
| --- | -------- | ------- | ----------- | ------------ | ----- |
|     |          |         |             |              |       |

---

## Phase 10: Generation Instructions

> **Why:** This phase converts the questionnaire into actionable generation tasks.

### 10.1 Readiness Checklist [REQUIRED]

Before generating any output, confirm:

- [ ] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 complete: auth working, first call documented
- [ ] Phase 3 complete: at least core entities with fields documented
- [ ] Phase 4 complete: at least 5 critical endpoints documented with request/response
- [ ] Phase 5 complete: query and filter patterns documented
- [ ] Phase 6 complete: pagination model documented with worked example
- [ ] Phase 7 complete: event-driven capabilities assessed
- [ ] Phase 8 complete: rate limits and error format documented
- [ ] Phase 9 complete: integration path selected

**Overall investigation confidence:** (high / medium / low)

**Known gaps that will reduce output quality:**

1.
2.
3.

### 10.2 Generation Prompts [REQUIRED]

> Use these prompts to generate each output document from the completed questionnaire.

**Output Set 1: LLM Knowledge Pack**

Generate the following documents from the completed questionnaire:

1. **01-llm-api-rules.md** — Use template `01-llm-api-rules.template.md`
   - Source: Phases 2 (auth), 4 (critical endpoints), 8 (errors), 9 (capabilities)
   - Constraint: Must stay under 300 lines total

2. **01a-domain-model-reference.md** — Use template `01a-domain-model-reference.template.md`
   - Source: Phase 3 (entities, relationships, state machines, business rules)

3. **01b-query-patterns.md** — Use template `01b-query-patterns.template.md`
   - Source: Phase 5 (queries, filters, search), Phase 6 (pagination)

4. **01c-mutation-patterns.md** — Use template `01c-mutation-patterns.template.md`
   - Source: Phase 3 (business rules), Phase 4 (write endpoints)

5. **01d-event-and-error-handling.md** — Use template `01d-event-and-error-handling.template.md`
   - Source: Phase 7 (events), Phase 8 (errors, rate limits)

**Output Set 2: Developer Reference**

6. **02-api-spec-investigation.md** — Use template `02-api-spec-investigation.template.md`
   - Source: All phases, condensed into clean reference format

**Output Set 3: Build Instructions**

7. **03-connector-setup.md** — Use template `03-connector-setup.template.md`
   - Source: Phase 9 (integration path), Phase 2 (auth), Phase 3 (entities)
   - Only generate if integration path includes "Data Connector"

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps |
| ---------------------------- | ------------- | ---------- | ---- |
| 01-llm-api-rules             |               |            |      |
| 01a-domain-model-reference   |               |            |      |
| 01b-query-patterns           |               |            |      |
| 01c-mutation-patterns        |               |            |      |
| 01d-event-and-error-handling |               |            |      |
| 02-api-spec-investigation    |               |            |      |
| 03-connector-setup           |               |            |      |

---

## Appendix A: Discovery Playbook for Undocumented APIs

> Use this when official docs are absent, incomplete, or inaccurate.

### A.1 Automated Discovery

1. **Check for OpenAPI/Swagger UI:**

   ```
   GET /swagger.json
   GET /openapi.json
   GET /api-docs
   GET /swagger-ui.html
   GET /v1/swagger.json
   GET /v2/swagger.json
   GET /v3/api-docs
   ```

2. **Check for GraphQL introspection:**

   ```graphql
   {
     __schema {
       types {
         name
         kind
         description
         fields {
           name
           type {
             name
             kind
           }
         }
       }
     }
   }
   ```

3. **Examine official SDKs:**
   - Clone the SDK repo
   - Search for endpoint definitions, route constants, method signatures
   - SDKs often document behavior that the API docs omit

4. **Browser network inspection:**
   - Open the vendor's web app
   - Open DevTools > Network tab
   - Perform actions and observe API calls
   - Note: these may be internal APIs that are not stable or supported

### A.2 Endpoint Discovery Patterns

5. **Try standard REST conventions:**

   ```
   GET /api/v1/{resources}          (list)
   GET /api/v1/{resources}/{id}     (get one)
   POST /api/v1/{resources}         (create)
   PUT /api/v1/{resources}/{id}     (replace)
   PATCH /api/v1/{resources}/{id}   (partial update)
   DELETE /api/v1/{resources}/{id}  (delete)
   ```

6. **Check for HATEOAS / links:**

   ```json
   { "_links": { "self": "/api/v1/things/123", "related": "/api/v1/things/123/children" } }
   ```

7. **Try OPTIONS requests:**
   ```
   OPTIONS /api/v1/{resource}
   ```
   May return allowed methods and CORS info.

### A.3 Auth Discovery

8. **Common auth patterns to try:**

   ```
   Authorization: Bearer {token}
   Authorization: Basic {base64}
   X-API-Key: {key}
   ?api_key={key}
   ?token={key}
   ```

9. **OAuth endpoint discovery:**
   ```
   GET /.well-known/openid-configuration
   GET /.well-known/oauth-authorization-server
   ```

### A.4 Error Message Mining

10. **Intentionally trigger errors** to learn about the API:
    - Send a request with no auth (reveals auth requirements)
    - Send a POST with empty body (reveals required fields)
    - Send invalid field values (reveals validation rules)
    - Request a non-existent ID (reveals 404 format)
    - Send too many requests quickly (reveals rate limit format)

### A.5 Community Intelligence

11. **Search for unofficial documentation:**
    - GitHub issues on SDK repos
    - Stack Overflow questions tagged with the API name
    - Blog posts about integrating with the API
    - Postman public collections
    - API changelog or migration guides (often more detailed than reference docs)

---

## Appendix B: Quick Reference -- What Claude Code Needs per Output

| Output                    | Critical Inputs                                                           | Minimum to Generate                                              |
| ------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **01-llm-api-rules**      | Auth, 3-5 endpoint examples, error format, rate limits, capabilities list | Auth method + 3 working endpoint examples                        |
| **01a-domain-model**      | Entity fields, relationships, state machines, business rules              | At least 3 entities with fields and relationships                |
| **01b-query-patterns**    | Filter syntax, sort syntax, search, pagination                            | Filter syntax + pagination model + 2 worked examples             |
| **01c-mutation-patterns** | Create/update endpoints, validation rules, required fields                | 3 write endpoint examples with request bodies                    |
| **01d-event-error**       | Webhook catalog, error format, status codes, retry guidance               | Error format + status code table + retry guidance                |
| **02-api-spec**           | All endpoints, data models, auth, pagination, limits                      | All of the above in condensed form                               |
| **03-connector-setup**    | Integration path, auth type, entity-to-connector mapping                  | Integration path decision + auth type + connector method mapping |
