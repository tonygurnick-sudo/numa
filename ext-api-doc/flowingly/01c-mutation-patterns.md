---
api_name: Flowingly
api_slug: flowingly
companion_to: 01-llm-api-rules.md
source_phases: Phase 3 (domain model), Phase 4 (endpoint catalog)
confidence: write REQUEST shapes are [DOCUMENTED]; write RESPONSE shapes + validation behaviour are [INFERRED]/[UNKNOWN], NOT live-tested, NO [CONFIRMED] facts. Run a GET→POST→GET round-trip to confirm responses. Tags inline where not [DOCUMENTED].
---

# Flowingly — Mutation Patterns Reference

Covers writes: starting flows, updating step fields, the auth token exchange, business rules, dangerous operations.

## Write capabilities

| Operation              | Supported | Method | Path                                | Notes                                                   |
| ---------------------- | --------- | ------ | ----------------------------------- | ------------------------------------------------------- |
| Authenticate           | Yes       | POST   | /public/authorise                   | credentials in query string [DOCUMENTED]                |
| Start flow instance    | Yes       | POST   | /public/startflow                   | **PascalCase** body; NOT idempotent [DOCUMENTED]        |
| Update step fields     | Yes       | POST   | /public/flow/{flowId}/step/{stepId} | bulk array; camelCase body [DOCUMENTED]                 |
| Update single field    | via bulk  | POST   | /public/flow/{flowId}/step/{stepId} | send a one-element array (or the full array) [INFERRED] |
| Advance / approve step | No        | —      | —                                   | not in documented surface [UNKNOWN/None]                |
| Complete / cancel flow | No        | —      | —                                   | not in documented surface [UNKNOWN/None]                |
| Delete flow / step     | No        | —      | —                                   | not in documented surface [UNKNOWN/None]                |
| File upload            | No        | —      | —                                   | no file endpoints [UNKNOWN/None]                        |
| Bulk start flows       | No        | —      | —                                   | one instance per call [UNKNOWN]                         |

---

## Pattern 0: Token exchange (precondition for every write)

Every write needs a bearer token from `/public/authorise`. The backend handles this; the agent just calls operations. Credentials in the QUERY STRING, `Content-Type: application/x-www-form-urlencoded`.
`POST /public/authorise?username=admin@acme.com&password=********` → `{"accessToken":"eyJhbGci...","refreshToken":null,"idToken":"","tokenType":"Bearer","expiresIn":0}`
On 401 later: `refreshToken` is null → refresh likely unsupported → re-run `/authorise` with stored credentials, retry the original write once [INFERRED] (safe for GET/update, NOT for startflow).

---

## Pattern 1: Start a flow instance

Instantiate a published flow MODEL (by `Name`) into a new running instance. **Request body is PascalCase:**
`POST /public/startflow`, `Authorization: Bearer {accessToken}`, `Content-Type: application/json`
`{"Name":"New Customer Onboarding","Subject":"Acme Ltd onboarding","ActorsToStartFlowFor":[{"UserEmail":"jo@acme.com"}],"CCActors":[{"Team":"Finance"}],"AssignedActor":"manager@acme.com","FlowInitiator":"system@acme.com"}`
Success (camelCase envelope): `{"success":true,"errorCode":null,"errorMessage":null,"dataModel":[{"flowIdentifier":"FLOW-9042","stepIdentifier":"Step 1"}]}`

Field semantics [DOCUMENTED]:
| Field | Required | Meaning |
| --- | --- | --- |
| Name | yes | **Flow MODEL name** — uniquely identifies the published template. NOT the instance subject. |
| Subject | yes | Subject/title of the new instance. |
| ActorsToStartFlowFor | yes | Array of `{UserEmail}` and/or `{Team}` — who the flow is started for. |
| CCActors | no | Array of CC actors. |
| AssignedActor | conditional | Assignee email for the first step — **required only when the first step needs an approver**. |
| FlowInitiator | yes | Email of the initiating user. |

Behaviour: NOT idempotent — each POST starts a new instance, no idempotency-key support [INFERRED]. Model must exist + be published; no API to discover model names [INFERRED]. Capture `dataModel[0].flowIdentifier` + `stepIdentifier` to address the instance after. Required/optional flags are [INFERRED] from prose — confirm via validation-error mining.

---

## Pattern 2: Update step fields (bulk)

Save/populate a step's form field values. **GET the step first** to obtain field `identifier`s, set `value`s, POST the array back.
Step A — read (see 01b): `GET /public/flow/FLOW-9042/step/Step%201` → `[{"name":"Customer Name","type":"Text","order":1,"identifier":"field4938201746","value":"","options":null},{"name":"Email","type":"Email","order":2,"identifier":"field4938201747","value":"","options":null}]`
Step B — write back (camelCase array body): `POST /public/flow/FLOW-9042/step/Step%201`, `Content-Type: application/json`
`[{"name":"Customer Name","type":"Text","order":1,"identifier":"field4938201746","value":"Acme Ltd","options":null},{"name":"Email","type":"Email","order":2,"identifier":"field4938201747","value":"jo@acme.com","options":null}]`
Response (INFERRED — mirrors startflow envelope): `{"success":true,"errorCode":null,"errorMessage":null}`. May instead echo the updated field array or return a bare 200 — verify with a follow-up GET [INFERRED/UNKNOWN].

Rules: preserve `name`/`type`/`order`/`identifier` exactly as returned by GET — only mutate `value` [DOCUMENTED]. This is the **only bulk-like operation** (multiple field values per step in one request) [DOCUMENTED]. **Partial-failure behaviour unknown** — treat as all-or-nothing, re-GET to confirm [UNKNOWN]. Values validated against modeller-configured rules; custom (modeller) messages returned, else default validation errors [DOCUMENTED]. Per-type `value` encoding (Date `dd/MM/yyyy`, CheckBox string `"true"`/`"false"`, SelectList option object, etc.) — see Field-types table in 01/02.

---

## Pattern 3: Update a single field

No documented single-field endpoint. Either (1) POST a one-element array with just that field object (incl. its `identifier`), or (2) GET the full array, mutate the one field, POST the whole array back. Which form is accepted is unverified — **prefer option 2** (safest, avoids surprises if full-array overwrite is required) until confirmed [INFERRED].

---

## Field Validation Rules [DOCUMENTED]

| Entity | Field                | Rule                                                                       |
| ------ | -------------------- | -------------------------------------------------------------------------- |
| Flow   | Name                 | Must match an existing, published flow MODEL name                          |
| Flow   | Subject              | Required                                                                   |
| Flow   | ActorsToStartFlowFor | Required; each actor is `{UserEmail}` and/or `{Team}`                      |
| Flow   | FlowInitiator        | Required; valid user email                                                 |
| Flow   | AssignedActor        | Required only if the first step requires approver selection                |
| Field  | value                | Validated against modeller-configured rules; custom/default error returned |
| Auth   | username/password    | Account must be a **Business Administrator**                               |

Validation-error structure (per-field array vs single message) is undocumented. Expect the `success:false` + `errorCode`/`errorMessage` envelope, possibly with field detail in `errorMessage` [UNKNOWN].

## Server-Side / Computed Fields

`flowIdentifier` system-assigned on start (`FLOW-####`) · `stepIdentifier` system-assigned, name of current step · field `identifier` model-assigned `field<digits>`, read-only · field `name`/`type`/`order` model-defined, read-only [all DOCUMENTED].

---

## Worked Examples

### Example 1: start a flow and immediately populate its first step

End-to-end: authenticate → start → read field ids → write values.

1. Authorise → store `accessToken` (backend).
2. `POST /public/startflow`: `{"Name":"Purchase Request","Subject":"Laptops for Eng team","ActorsToStartFlowFor":[{"UserEmail":"buyer@acme.com"}],"FlowInitiator":"system@acme.com"}` → `{"success":true,"dataModel":[{"flowIdentifier":"FLOW-9101","stepIdentifier":"Request Details"}]}`
3. `GET /public/flow/FLOW-9101/step/Request%20Details` → `[{"name":"Item","type":"Text","order":1,"identifier":"field880011","value":"","options":null},{"name":"Quantity","type":"Number","order":2,"identifier":"field880012","value":"","options":null}]`
4. `POST /public/flow/FLOW-9101/step/Request%20Details`: `[{"name":"Item","type":"Text","order":1,"identifier":"field880011","value":"MacBook Pro 14","options":null},{"name":"Quantity","type":"Number","order":2,"identifier":"field880012","value":"5","options":null}]` → `{"success":true,"errorCode":null,"errorMessage":null}` (response shape INFERRED — re-GET to confirm)

### Example 2: start a flow whose first step needs an approver

When the first step requires an approver, `AssignedActor` is required.
`POST /public/startflow`: `{"Name":"Leave Request","Subject":"Annual leave - July","ActorsToStartFlowFor":[{"UserEmail":"staff@acme.com"}],"AssignedActor":"lead@acme.com","FlowInitiator":"staff@acme.com"}` → `{"success":true,"dataModel":[{"flowIdentifier":"FLOW-9120","stepIdentifier":"Manager Approval"}]}`
Omitting `AssignedActor` here would likely return `success:false` with a required-approver validation error [DOCUMENTED conditionally required; exact error UNKNOWN].

### Example 3: team actor instead of individual

`POST /public/startflow`: `{"Name":"Incident Report","Subject":"Outage 2026-05-29","ActorsToStartFlowFor":[{"Team":"Operations"}],"CCActors":[{"UserEmail":"cto@acme.com"}],"FlowInitiator":"system@acme.com"}`
Actors can be a `Team` name or a `UserEmail`. Whether both can appear in one actor object is unverified — supply one per actor [INFERRED].

---

## Gotchas

1. **Request casing flips per endpoint.** startflow body = PascalCase; step-field body = camelCase; auth + startflow responses = camelCase [DOCUMENTED].
2. **`Name` = model, `Subject` = instance.** Common mistake: putting the instance title in `Name`. `Name` must exactly match a published model name [DOCUMENTED].
3. **Cannot discover model names via the API** — get the exact `Name` from the user or the Flowingly UI [INFERRED].
4. **GET before POST on step fields** — `identifier`s are required in the write body and not guessable [DOCUMENTED].
5. **`startflow` is not idempotent** — never blind-retry on ambiguous failure (may create duplicate flows); confirm with the user first [INFERRED].
6. **Errors may be HTTP 200 with `success:false`** — always read the envelope [DOCUMENTED envelope / UNKNOWN codes].
7. **Step name URL-encoded in the path** (spaces→`%20`, parens→`%28`/`%29`) [DOCUMENTED].
8. **No step-progression API** — can populate a step's fields but cannot submit/approve/advance it via API (happens in Flowingly); set expectations with the user [INFERRED].

---

## Dangerous Operations (confirm with the user before executing)

| Operation                        | Why Dangerous                                                                                                     | Safeguard                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `POST /public/startflow`         | Starts a **real workflow** — notifies/assigns people, kicks off approvals. NOT idempotent (retries duplicate it). | Confirm model `Name`, `Subject`, actors with the user before sending. Never auto-retry on ambiguous failure. |
| `POST /public/flow/.../step/...` | Overwrites live form values real users may act on; partial-failure behaviour unknown.                             | Re-GET after writing to verify; confirm before overwriting non-empty values.                                 |

Flowingly drives real business processes (onboarding, approvals, leave, purchasing) — writes have real-world side effects (emails, task assignments). Default to confirming intent before any write.
