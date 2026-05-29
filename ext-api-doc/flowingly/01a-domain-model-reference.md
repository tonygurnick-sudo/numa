---
api_name: 'Flowingly'
api_slug: 'flowingly'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
confidence: 'LOW — entities inferred from documented request/response payloads only; no entity metadata is exposed by the API and nothing is live-tested.'
---

# Flowingly -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Contains the entity catalog, relationships, state machine,
> and business rules the workspace agent references when working with Flowingly data.
>
> ⚠️ **DISCOVERY-REQUIRED.** The Public API exposes **no entity metadata** — every entity below is
> [INFERRED] from the shapes of the four documented endpoints. Required/optional flags, value
> encodings, and the enum list are NOT live-verified. Run the discovery checklist (00-questionnaire
> appendix) to confirm.

---

## Domain Overview

Flowingly's Public API is **narrow and action-oriented**. It does not model a browsable graph — it
exposes four operations: authenticate, start a flow instance, read a step's fields, write a step's
fields. The entities below are reconstructed from those payloads. There are no list/get/delete
endpoints for any of them.

The mental model:

- A **Flow Model** (template) is authored in the Flowingly modeller (web UI). It defines Steps and Fields.
- `POST /public/startflow` instantiates a model **by name** into a running **Flow (instance)**.
- A Flow instance has **Steps**; the current Step has **Fields** you can read and write.
- **Actors** (a user email or a team name) are attached to the instance at start time.

---

## Entity Catalog

### Flow (instance)

**Resource path:** created via `POST /public/startflow`; addressed via `/public/flow/{flowIdentifier}/...`
**Description:** A running instance of a Flow Model. Identified by a human-readable `flowIdentifier` like `FLOW-9042`.
**CRUD:** Create (start) only. **No documented list / get / update / delete of flow instances.** [DOCUMENTED create; UNKNOWN read/delete]

| Field                | Type           | Required       | Writable | Description                                       | Example                         |
| -------------------- | -------------- | -------------- | -------- | ------------------------------------------------- | ------------------------------- |
| Name                 | string         | yes            | create   | **Flow MODEL name** to instantiate (not instance) | `"New Customer Onboarding"`     |
| Subject              | string         | yes            | create   | Subject/title of this instance                    | `"Acme Ltd onboarding"`         |
| ActorsToStartFlowFor | array<Actor>   | yes            | create   | Who the flow is started for                       | `[{"UserEmail":"jo@acme.com"}]` |
| CCActors             | array<Actor>   | no             | create   | CC actors                                         | `[{"Team":"Finance"}]`          |
| AssignedActor        | string (email) | conditional¹   | create   | Assignee of the first step                        | `"manager@acme.com"`            |
| FlowInitiator        | string (email) | yes            | create   | Email of the flow initiator                       | `"system@acme.com"`             |
| flowIdentifier       | string         | n/a (response) | no       | System-assigned instance ID                       | `"FLOW-9042"`                   |
| stepIdentifier       | string         | n/a (response) | no       | Name of the first/current step                    | `"Step 1"`                      |

¹ `AssignedActor` is only required when the flow's first step requires an approver to be selected; otherwise optional. [DOCUMENTED]

> **Casing:** Start Flow REQUEST fields are **PascalCase**. The RESPONSE (`success`, `errorCode`,
> `errorMessage`, `dataModel`, `flowIdentifier`, `stepIdentifier`) is **camelCase**. [DOCUMENTED]
>
> **Required/optional flags** for create are [INFERRED] from docs prose; only live validation-error
> mining will confirm which are truly mandatory. [INFERRED]

**Relationships:**

| Related Entity  | Type | Expression                                            | Notes                                         |
| --------------- | ---- | ----------------------------------------------------- | --------------------------------------------- |
| Flow Model      | N:1  | `Name` (string match) on Start Flow                   | Instance is created from a model [DOCUMENTED] |
| Step (instance) | 1:N  | `/public/flow/{flowIdentifier}/step/{stepIdentifier}` | Steps belong to the instance [DOCUMENTED]     |
| Actor           | 1:N  | inline in `ActorsToStartFlowFor` / `CCActors` etc.    | Attached at start time [DOCUMENTED]           |

---

### Flow Model (Workflow Definition / template)

**Resource path:** **NOT exposed by the Public API.** Referenced only **by name** via the `Name` field of Start Flow.
**Description:** The reusable workflow template designed in the Flowingly modeller. Defines steps, fields, validation, actors, and webhook steps.
**CRUD:** None via API. Authored in the web app. **There is no documented endpoint to list models or discover their exact names** — the integrator/agent must know the model name out-of-band (from the user). [INFERRED / UNKNOWN]

> Critical for the agent: you **cannot enumerate available flow models**. If the user asks "what
> flows can I start?", you must ask them for the exact model name, or point them to the Flowingly UI.

---

### Step

**Resource path:** `/public/flow/{flowIdentifier}/step/{stepIdentifier}`
**Description:** A single step within a flow instance, containing form fields. `stepIdentifier` is the step's **display name** (e.g. `"Step 1"`, `"New Customer (Debtor) Form"`), URL-encoded in the path.
**CRUD:** Read fields (GET), Update fields (POST). No create/delete — steps are defined by the model. [DOCUMENTED]

> There is no documented way to **complete / advance / approve** a step via the API. Step progression
> happens inside the Flowingly app (or by submitting the step's form). [INFERRED]

**Relationships:**

| Related Entity | Type | Expression                  | Notes                              |
| -------------- | ---- | --------------------------- | ---------------------------------- |
| Flow instance  | N:1  | path `{flowIdentifier}`     | Step belongs to one flow instance  |
| Field          | 1:N  | array body of GET/POST step | Fields are read/written as a batch |

---

### Field (step form field)

**Resource path:** embedded in the GET/POST step array body.
**Description:** A form field on a step — the unit the Public API reads and writes. Only the `value` is writable; `name`/`type`/`order`/`identifier` are model-defined.
**CRUD:** Read + Update (`value`). [DOCUMENTED]

| Field      | Type            | Required | Writable | Description                                | Example                  |
| ---------- | --------------- | -------- | -------- | ------------------------------------------ | ------------------------ |
| name       | string          | yes      | no       | Field display name                         | `"Customer Name"`        |
| type       | string (enum)   | yes      | no       | Field type (see Enum Reference)            | `"Text"`                 |
| order      | integer         | yes      | no       | Display order within the step              | `1`                      |
| identifier | string          | yes      | no (key) | Stable per-field key `field<digits>`       | `"field4938201746"`      |
| value      | string / object | n/a      | **yes**  | The value to set (encoding varies by type) | `"Acme Ltd"`             |
| options    | array / null    | no       | no       | Choices for list-type fields, else `null`  | `["Standard","Premium"]` |

> **Write protocol:** GET the step to obtain the current field array (with `identifier`s), set
> `value` on the fields you want to change, and POST the array back. Preserve `name`/`type`/`order`/
> `identifier` exactly as returned. The per-type encoding of `value` (Date, Currency, MultiSelectList,
> CheckBox) is **undocumented** — discover it with a GET→POST→GET round-trip. [DOCUMENTED / encoding UNKNOWN]

---

### Actor

**Resource path:** not a standalone resource — referenced inline within Start Flow.
**Description:** A participant in a flow: either an individual user (by email) or a Team (by name).
**CRUD:** None via API. [DOCUMENTED — inline only]

**Shape:**

```json
{ "UserEmail": "jo@acme.com" }   // individual actor
{ "Team": "Finance" }            // team actor
```

> The Start Flow schema shows `UserEmail` and `Team` as two properties of the same actor object;
> in practice supply one or the other per actor. Whether both can coexist is unverified. [INFERRED]

---

## Entity Relationship Diagram

```
┌─────────────────────┐  instantiates   ┌────────────────────┐
│   Flow Model        │  (by Name str)  │   Flow (instance)  │
│  (modeller-only,    │────────────────>│   flowIdentifier   │
│   not API-exposed)  │                 │   = FLOW-9042      │
└─────────────────────┘                 └────────────────────┘
        │ 1:N (template)                          │ 1:N
        ▼                                         ▼
┌─────────────────────┐                 ┌────────────────────┐
│      Step (def)     │                 │   Step (instance)  │
└─────────────────────┘                 │   stepIdentifier   │
        │ 1:N                           │   = "Step 1"       │
        ▼                               └────────────────────┘
┌─────────────────────┐                          │ 1:N
│     Field (def)     │                          ▼
└─────────────────────┘                 ┌────────────────────┐
                                        │   Field (value)    │
                                        │ identifier / value │
                                        └────────────────────┘

  Actors (UserEmail | Team) attach to a Flow instance at start time via
  ActorsToStartFlowFor, CCActors, AssignedActor, FlowInitiator.
```

[INFERRED from payload structures — the API exposes no relationship metadata.]

---

## State Machines

### Flow instance lifecycle

```
[not started] ──POST /startflow──> [Active @ Step 1] ──(step submitted in-app)──> [Active @ Step N] ──> [Completed]
```

**Transitions:**

| From               | Action / Trigger         | To                 | Reversible? | Side Effects                                                                      |
| ------------------ | ------------------------ | ------------------ | ----------- | --------------------------------------------------------------------------------- |
| not started        | `POST /public/startflow` | Active @ Step 1    | No          | Returns `flowIdentifier` + `stepIdentifier`; notifies/assigns actors [DOCUMENTED] |
| Active @ Step      | step completion (in-app) | Active @ next step | No          | **Not exposed via Public API** [UNKNOWN]                                          |
| Active @ last step | completion (in-app)      | Completed          | No          | **Not exposed via Public API** [UNKNOWN]                                          |

**Per-State Capabilities (via Public API):**

| State         | Read fields? | Write fields? | Advance step? | Notes                                         |
| ------------- | ------------ | ------------- | ------------- | --------------------------------------------- |
| Active @ Step | Yes (GET)    | Yes (POST)    | **No (API)**  | Can populate the current step's form values   |
| Completed     | Unknown      | No            | No            | Reading a completed flow's step is unverified |

> The API can **start** a flow and **populate** the current step's fields, but cannot drive step
> transitions, approvals, or completion. Those occur inside Flowingly. [INFERRED]

---

## Business Rules

### Ordering / Dependency Rules

- A Flow Model must already **exist and be published** in Flowingly before `startflow` can instantiate it by `Name`. [INFERRED]
- Field updates target a `flowIdentifier` + `stepIdentifier` that must currently exist and be the active step. [INFERRED]
- You must **GET a step before POSTing it** — field `identifier`s are model-assigned and required in the write body. [DOCUMENTED]

### Field-Level Rules

- Field values are validated against **modeller-configured rules** on update. Custom error messages (configured in the modeller) are returned; otherwise default validation errors apply. [DOCUMENTED]
- The authenticating user must be a **Business Administrator**. [DOCUMENTED]
- `AssignedActor` is required only when the first step needs an approver selected. [DOCUMENTED]

### Cascading Effects

- Starting a flow notifies/assigns the configured actors (email assignment). [INFERRED]

### Computed / Read-Only Fields

- `flowIdentifier`, `stepIdentifier` are system-assigned. [DOCUMENTED]
- Field `name`, `type`, `order`, `identifier` are model-defined and read-only via the API; only `value` is writable. [DOCUMENTED]

### Uniqueness Constraints

- A Flow Model's `Name` is described as uniquely identifying a model. [DOCUMENTED]
- `startflow` is **not idempotent** — there is no natural key or idempotency token, so repeated calls create duplicate instances. [INFERRED]

---

## Field Format Reference

| Format   | Pattern            | Example                                | Notes                                                       |
| -------- | ------------------ | -------------------------------------- | ----------------------------------------------------------- |
| Flow ID  | `FLOW-<number>`    | `FLOW-9042`                            | String, human-readable [DOCUMENTED]                         |
| Field ID | `field<digits>`    | `field4938201746`                      | Stable per-field key [DOCUMENTED]                           |
| Step ID  | step display name  | `Step 1`, `New Customer (Debtor) Form` | URL-encode in path; spaces/parens appear [DOCUMENTED]       |
| Actor    | email or team name | `jo@acme.com` / `Finance`              | `UserEmail` or `Team` [DOCUMENTED]                          |
| Date     | unknown            | unknown                                | Date/Datetime field types exist; `value` encoding [UNKNOWN] |
| Currency | unknown            | unknown                                | Currency field type exists; `value` encoding [UNKNOWN]      |
| Token    | JWT (`eyJ...`)     | `eyJhbGciOiJSUzI1NiI...`               | Bearer access token from `/authorise` [DOCUMENTED]          |

---

## Enum Value Reference

| Entity | Field | Allowed Values                                                                                                                        | Notes                                                                   |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Field  | type  | `Text`, `TextArea`, `SelectList`, `MultiSelectList`, `RadioButtonList`, `CheckBox`, `Email`, `Date`, `Datetime`, `Currency`, `Number` | [DOCUMENTED — casing per docs; list may be incomplete; confirm on live] |

> The `value` representation per `type` (e.g. how a Date, MultiSelectList, or CheckBox value is
> encoded in the array body) is **not documented**. Discover it via a GET→POST→GET round-trip on a
> real step. [UNKNOWN]

---

## Discovery Notes (resolve these against a live instance)

1. Confirm which entities (if any) have list/get endpoints beyond the documented four — probe `GET /public/flows`, `GET /public/flowmodels`, etc.
2. Confirm `value` encodings per field `type` (Date, Currency, MultiSelectList, CheckBox).
3. Confirm whether `UserEmail` and `Team` can coexist in one actor object.
4. Confirm the true required-field set for `startflow` by sending minimal bodies and mining validation errors.
5. Confirm the complete `Field.type` enum (the documented list is likely partial).

---

_Generated from the investigation questionnaire, Phase 3 (2026-05-29). LOW confidence — inferred from payloads, not live-tested._
