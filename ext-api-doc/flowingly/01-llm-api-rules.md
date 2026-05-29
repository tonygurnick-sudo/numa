---
api_name: 'Flowingly'
api_slug: 'flowingly'
version: 'unversioned (paths under /public/)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
confidence: 'LOW — documented from Flowingly Help Center, NOT live-tested. Discovery required.'
---

# Flowingly -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the Flowingly integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion files (01a-01d) contain the detailed reference material.
>
> ⚠️ **DISCOVERY-REQUIRED BANNER.** Everything here is [DOCUMENTED] (from the Flowingly Help
> Center) or [INFERRED]/[UNKNOWN]. **No live API call has been made.** There are NO [CONFIRMED]
> facts. Auth placement, token lifetime, error HTTP codes, and the full endpoint catalogue must
> be verified against a live instance before relying on them. Treat unexpected behaviour as a
> documentation gap, not an agent bug.

## Context

- **API:** Flowingly Public API (Business Process Management / workflow automation, NZ vendor)
- **Base URL:** `https://publicapi.flowingly.net/public/` [DOCUMENTED]
  - ⚠️ The connector brief named `api.flowingly.io` — **could NOT be confirmed**. Do not use it without verification. [UNKNOWN]
- **Auth:** username/password → bearer access token (custom token exchange, not standard OAuth2) [DOCUMENTED]
- **Integration path:** Direct API via `connect_request`. This is NOT a Files/Data-Connector — there is nothing to browse. [DOCUMENTED]
- **Rate limits:** None documented. Throttle conservatively + exponential backoff on 429/5xx. [UNKNOWN]
- **Field casing:** ⚠️ **INCONSISTENT.** Auth response = camelCase. Start Flow REQUEST = **PascalCase** (`Name`, `Subject`, `ActorsToStartFlowFor`). Start Flow RESPONSE + step-field bodies = camelCase. Preserve exactly per endpoint. [DOCUMENTED]
- **ID format:** `flowIdentifier` = `FLOW-<number>` (e.g. `FLOW-9042`). Field `identifier` = `field<digits>`. `stepIdentifier` = the step's display name (e.g. `Step 1`). [DOCUMENTED]

## Auth Structure

Custom token exchange. The connector is registered `authType: 'username-password'` with `username` +
`password` credential fields — the backend exchanges them for a bearer token, then sends:

```
Authorization: Bearer {accessToken}
```

**Token exchange (`POST /public/authorise`):** credentials go in the **QUERY STRING** with
`Content-Type: application/x-www-form-urlencoded`. [DOCUMENTED — verify query vs body on live]

```
POST /public/authorise?username=admin@company.com&password=******** HTTP/1.1
Host: publicapi.flowingly.net
Content-Type: application/x-www-form-urlencoded
```

Returns: `{ "accessToken": "...", "refreshToken": null, "idToken": "", "tokenType": "Bearer", "expiresIn": 0 }`

**Token lifecycle:**

- `expiresIn` shown as `0` in docs — real value/unit **unknown**. [UNKNOWN]
- `refreshToken` shown as `null` — refresh likely **not supported**. On 401, **re-run `/authorise` and retry once**. [INFERRED]
- The authenticating user MUST be a Flowingly **Business Administrator** or the API will not work. [DOCUMENTED]

## Capabilities

### CAN

1. Start a flow instance from a published flow **model name** (`POST /public/startflow`), assigning actors, CC, initiator. [DOCUMENTED]
2. Read the fields (definitions + current values) of a specific step in a known flow (`GET /public/flow/{flowId}/step/{stepId}`). [DOCUMENTED]
3. Update/populate step field values in bulk (array of fields) for a known flow + step (`POST /public/flow/{flowId}/step/{stepId}`). [DOCUMENTED]

### CANNOT

1. **List / search / browse** flows, flow models, steps, actors, or teams — **no such endpoints documented**. The agent must already hold the model name and `flowIdentifier`. [UNKNOWN/None]
2. Advance, approve, complete, reassign, or cancel a flow/step — not in the documented surface. [UNKNOWN/None]
3. Upload or download files/attachments — no file endpoints. [UNKNOWN/None]
4. Configure webhooks or edit flow models — modeller (web UI) only, not via API. [DOCUMENTED — unavailable]

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Start Flow request body is PascalCase.** `Name`, `Subject`, `ActorsToStartFlowFor`, `CCActors`, `AssignedActor`, `FlowInitiator`. Step-field bodies are camelCase. Mixing casing will fail validation. [DOCUMENTED]
2. **`Name` is the flow MODEL name, not the instance subject.** `Name` = the published template's unique name; `Subject` = the title of this new instance. The model must already exist and be published. There is no API to discover model names — get it from the user. [DOCUMENTED]
3. **Credentials go in the query string of `/authorise`**, even though Content-Type is form-urlencoded. (Verify on live — body may also work.) [DOCUMENTED]
4. **`stepIdentifier` is the step's display NAME and must be URL-encoded** in the path (spaces, parens). E.g. `New%20Customer%20(Debtor)%20Form`. [DOCUMENTED]
5. **`AssignedActor` is conditionally required:** only when the flow's first step requires an approver to be selected. Otherwise optional. [DOCUMENTED]
6. **Errors may arrive as HTTP 200 with `success:false`.** Always inspect `success` / `errorCode` / `errorMessage` in the body, not just the HTTP status. (Whether failures are 200 or 4xx is unverified.) [DOCUMENTED envelope / UNKNOWN codes]
7. **You must GET a step before you POST it.** Field `identifier` values (`fieldXXXXXXXXXX`) are model-assigned — read them first, then write values back into the same array shape. [DOCUMENTED]
8. **`startflow` is NOT idempotent** — each call starts a new flow instance. Never blind-retry it; on ambiguous failure, confirm with the user before re-calling. [INFERRED]

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter            | Default                 | Reason                                                     |
| -------------------- | ----------------------- | ---------------------------------------------------------- |
| FlowInitiator        | the authenticated user  | Sensible default if the caller doesn't name an initiator   |
| ActorsToStartFlowFor | (no default — must ask) | No safe default; the agent must obtain who the flow is for |
| AssignedActor        | omit                    | Only set when the first step needs an approver selected    |
| CCActors             | omit                    | Optional                                                   |

## Working Examples

### Example 1: Get an access token

```http
POST /public/authorise?username=admin@acme.com&password=******** HTTP/1.1
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

### Example 2: Start a flow instance

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

```json
{
  "success": true,
  "errorCode": null,
  "errorMessage": null,
  "dataModel": [{ "flowIdentifier": "FLOW-9042", "stepIdentifier": "Step 1" }]
}
```

### Example 3: Read a step's fields (discover identifiers)

```http
GET /public/flow/FLOW-9042/step/New%20Customer%20(Debtor)%20Form HTTP/1.1
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

### Example 4: Update step field values (write back the same array)

```http
POST /public/flow/FLOW-9042/step/New%20Customer%20(Debtor)%20Form HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
Content-Type: application/json

[
  { "name": "Customer Name", "type": "Text",  "order": 1, "identifier": "field4938201746", "value": "Acme Ltd",   "options": null },
  { "name": "Email",         "type": "Email", "order": 2, "identifier": "field4938201747", "value": "jo@acme.com", "options": null }
]
```

```json
{ "success": true, "errorCode": null, "errorMessage": null }
```

> Update response shape is [INFERRED] (mirrors the Start Flow envelope). Verify on live — it may instead echo the updated field array or return a bare 200. [UNKNOWN]

## Proxy API Operations

> The entire documented surface. There may be undocumented endpoints (list flows, complete step, comments, attachments) — none found in public docs; discovery required. [UNKNOWN]

| Operation          | Method | Path                                                | Key Parameters                                             | Notes                                        |
| ------------------ | ------ | --------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| Authorise          | POST   | /public/authorise                                   | username, password (query string)                          | No auth. Returns bearer token [DOCUMENTED]   |
| Start flow         | POST   | /public/startflow                                   | Name (model), Subject, ActorsToStartFlowFor, FlowInitiator | PascalCase body. NOT idempotent [DOCUMENTED] |
| Read step fields   | GET    | /public/flow/{flowIdentifier}/step/{stepIdentifier} | path: flowIdentifier, stepIdentifier (URL-encoded name)    | Returns array of fields [DOCUMENTED]         |
| Update step fields | POST   | /public/flow/{flowIdentifier}/step/{stepIdentifier} | body: array of field objects with `value` set              | Bulk per step. camelCase body [DOCUMENTED]   |

## Pagination

- **Type:** None / not applicable. No list endpoints exist. The only multi-item response (GET step fields) returns a complete array with no paging. [INFERRED]
- **Default / max page size:** N/A
- **How to paginate:** N/A — there is nothing to page through. To act on a flow you must already hold its `flowIdentifier` (from a Start Flow response or an inbound webhook).

## Webhooks / Events

**Supported events:**

| Event               | Trigger                                              | Key Payload Fields                           |
| ------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Webhook step submit | A "Webhook - Form" step in a flow model is submitted | JSON of that step's form fields [DOCUMENTED] |

**Setup:** Outbound only, configured in the flow modeller (web UI) — NOT via the API. You set an
Endpoint URL on a Webhook step; Flowingly POSTs the form JSON when that step is submitted. There is
**no documented signature/HMAC or secret** — treat inbound webhooks as unauthenticated unless a
shared-secret is added manually to the URL. Flag for security review. [DOCUMENTED / signature UNKNOWN]

> Webhooks are the **only viable event trigger** — polling cannot discover new/changed flows (no list endpoint). The canonical pattern is: Webhook step → middleware → Public API `startflow` of another flow.

## Error Handling

**Standard error envelope (Start Flow; likely shared by update):** [DOCUMENTED]

```json
{ "success": false, "errorCode": "SOME_CODE", "errorMessage": "Human readable reason", "dataModel": null }
```

⚠️ It is **unknown** whether failures return HTTP 200 + `success:false` or a 4xx/5xx. Check both the
HTTP status AND the `success` field. The `errorCode` catalogue is undocumented. [UNKNOWN]

**Recovery by status (all INFERRED — none confirmed):**

| Status | Meaning                  | Action                                          |
| ------ | ------------------------ | ----------------------------------------------- |
| 200    | OK — **check `success`** | If `success:false`, surface `errorMessage`      |
| 400    | Bad request / validation | Fix payload (casing, required fields)           |
| 401    | Unauthorized / expired   | Re-run `/authorise`, retry once                 |
| 403    | Forbidden                | Confirm the account is a Business Administrator |
| 404    | Flow/step not found      | Verify `flowIdentifier` + URL-encoded step name |
| 429    | Rate limited (assumed)   | Backoff + retry                                 |
| 5xx    | Server error             | Exponential backoff, max 3 retries              |

## Known Limitations

1. **No browse/list surface** — cannot enumerate flows, models, steps, actors, or teams. Caller must supply identifiers/model names. [UNKNOWN]
2. **No step-progression API** — cannot advance/approve/complete/cancel flows or steps. [UNKNOWN]
3. **No file handling** in the Public API. [UNKNOWN]
4. **Webhooks are modeller-configured and outbound-only**; no API to manage them; no documented signature. [DOCUMENTED]
5. **Base URL, auth placement, token lifetime, refresh, and error HTTP codes are all UNVERIFIED.** Run the discovery checklist (see 00-questionnaire appendix) before production use. [UNKNOWN]
6. **`startflow` is not idempotent** and there is no idempotency-key support — duplicate flows on retry are a real risk. [INFERRED]

---

_Generated from investigation questionnaire (2026-05-29). LOW confidence — documented, not live-tested._
_See companion files for detailed reference:_

- _01a-domain-model-reference.md — Entity catalog, relationships, state machines_
- _01b-query-patterns.md — Read patterns (minimal; no query surface)_
- _01c-mutation-patterns.md — Start flow, update step fields, business rules_
- _01d-event-and-error-handling.md — Webhook step, error envelope, recovery_
