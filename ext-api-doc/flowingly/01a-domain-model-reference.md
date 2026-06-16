---
api_name: Flowingly
api_slug: flowingly
companion_to: 01-llm-api-rules.md
source_phase: Phase 3 (domain model & behavior)
confidence: every entity is [INFERRED] from the 4 documented endpoint payloads (the API exposes NO entity metadata) unless tagged [DOCUMENTED]/[UNKNOWN]. NOT live-tested. Run the 00-questionnaire discovery checklist to confirm required/optional flags, value encodings, and the enum list.
---

# Flowingly — Domain Model Reference

Narrow, action-oriented API: 4 operations (authenticate, start a flow instance, read a step's fields, write a step's fields). No browsable graph; no list/get/delete for any entity. Entities below are reconstructed from those payloads.

Mental model: a **Flow Model** (template, authored in the modeller UI; defines Steps + Fields) is instantiated **by name** via `POST /public/startflow` into a running **Flow (instance)`. A Flow has **Steps**; the current Step has **Fields** you read/write. **Actors\*\* (user email or team name) attach to the instance at start time.

---

## Entity Catalog

### Flow (instance)

Path: created via `POST /public/startflow`; addressed via `/public/flow/{flowIdentifier}/...`. A running instance of a Flow Model, identified by `flowIdentifier` (e.g. `FLOW-9042`). CRUD: create (start) only — no documented list/get/update/delete [DOCUMENTED create; UNKNOWN read/delete].

| Field                | Type           | Required     | Writable | Description                                           | Example                         |
| -------------------- | -------------- | ------------ | -------- | ----------------------------------------------------- | ------------------------------- |
| Name                 | string         | yes          | create   | **Flow MODEL name** to instantiate (NOT the instance) | `"New Customer Onboarding"`     |
| Subject              | string         | yes          | create   | Subject/title of this instance                        | `"Acme Ltd onboarding"`         |
| ActorsToStartFlowFor | array<Actor>   | yes          | create   | Who the flow is started for                           | `[{"UserEmail":"jo@acme.com"}]` |
| CCActors             | array<Actor>   | no           | create   | CC actors                                             | `[{"Team":"Finance"}]`          |
| AssignedActor        | string (email) | conditional¹ | create   | Assignee of the first step                            | `"manager@acme.com"`            |
| FlowInitiator        | string (email) | yes          | create   | Email of the flow initiator                           | `"system@acme.com"`             |
| flowIdentifier       | string         | response     | no       | System-assigned instance ID                           | `"FLOW-9042"`                   |
| stepIdentifier       | string         | response     | no       | Name of the first/current step                        | `"Step 1"`                      |

¹ `AssignedActor` required only when the flow's first step requires an approver to be selected; else optional [DOCUMENTED].

Casing: REQUEST fields PascalCase; RESPONSE (`success`,`errorCode`,`errorMessage`,`dataModel`,`flowIdentifier`,`stepIdentifier`) camelCase. Required/optional flags are [INFERRED] from prose — only live validation-error mining confirms the truly-mandatory set.

Relationships: Flow Model N:1 via `Name` string match on startflow [DOCUMENTED] · Step (instance) 1:N via `/public/flow/{flowIdentifier}/step/{stepIdentifier}` [DOCUMENTED] · Actor 1:N inline in `ActorsToStartFlowFor`/`CCActors`/etc., attached at start time [DOCUMENTED].

### Flow Model (WorkflowDefinition / template)

**NOT exposed by the Public API.** Referenced only by name via the `Name` field of startflow. The reusable template authored in the modeller — defines steps, fields, validation, actors, webhook steps. CRUD: none via API. **No endpoint to list models or discover their names** — agent must know the model name out-of-band [INFERRED/UNKNOWN]. If the user asks "what flows can I start?", ask them for the exact model name or point to the Flowingly UI.

### Step

Path: `/public/flow/{flowIdentifier}/step/{stepIdentifier}`. A single step in a flow instance, containing form fields. `stepIdentifier` = the step's display name (e.g. `"Step 1"`, `"New Customer (Debtor) Form"`), URL-encoded in the path. CRUD: read fields (GET), update fields (POST); no create/delete (model-defined); **no documented complete/advance/approve action** — progression happens in the Flowingly app [INFERRED].
Relationships: Flow instance N:1 via path `{flowIdentifier}` · Field 1:N (read/written as a batch — the GET/POST step array).

### Field (step form field)

Embedded in the GET/POST step array body. The unit the API reads/writes. Only `value` is writable; `name`/`type`/`order`/`identifier` are model-defined. CRUD: read + update (`value`).

| Field      | Type                       | Required       | Writable | Description                                            | Example                  |
| ---------- | -------------------------- | -------------- | -------- | ------------------------------------------------------ | ------------------------ |
| name       | string                     | yes            | no       | Field display name                                     | `"Customer Name"`        |
| type       | string (enum)              | yes            | no       | Field type (see Enum Reference)                        | `"Text"`                 |
| order      | integer                    | yes            | no       | Display order within the step                          | `1`                      |
| identifier | string                     | yes            | no (key) | Stable per-field key `field<digits>`                   | `"field4938201746"`      |
| value      | string/object/array/number | response/write | **yes**  | Value to set — **encoding varies by type** (see 01/02) | `"Acme Ltd"`             |
| options    | array / null               | no             | no       | Choices for list-type fields, else `null` (GET only)   | `["Standard","Premium"]` |

Write protocol: GET the step to obtain the field array (with `identifier`s), set `value` on the fields to change, POST the array back. Preserve `name`/`type`/`order`/`identifier` exactly. Per-type `value` encoding is documented in 01/02 (Date `dd/MM/yyyy`, CheckBox string `"true"`/`"false"`, SelectList option object, etc.).

### Actor

Not a standalone resource — inline within startflow. Either an individual (`{"UserEmail":"jo@acme.com"}`) or a Team (`{"Team":"Finance"}`). Supply one or the other per actor; whether both can coexist is unverified [INFERRED]. CRUD: none via API.

---

## Entity Relationship Diagram

```
Flow Model (modeller-only, NOT API-exposed) ──instantiates by Name (string)──> Flow instance (flowIdentifier = FLOW-9042)
   │ 1:N (template)                                                                │ 1:N
   ▼                                                                               ▼
Step (def) ──1:N──> Field (def)                              Step instance (stepIdentifier = "Step 1") ──1:N──> Field value (identifier / value)

Actors (UserEmail | Team) attach to a Flow instance at start time via ActorsToStartFlowFor, CCActors, AssignedActor, FlowInitiator.
```

[INFERRED from payload structures — the API exposes no relationship metadata.]

---

## State Machine — Flow instance lifecycle

```
[not started] ──POST /public/startflow──> [Active @ Step 1] ──(step submitted in-app)──> [Active @ Step N] ──> [Completed]
```

| From               | Action / Trigger         | To                 | Reversible | Side Effects                                                                    |
| ------------------ | ------------------------ | ------------------ | ---------- | ------------------------------------------------------------------------------- |
| not started        | `POST /public/startflow` | Active @ Step 1    | No         | returns `flowIdentifier`+`stepIdentifier`; notifies/assigns actors [DOCUMENTED] |
| Active @ Step      | step completion (in-app) | Active @ next step | No         | **not exposed via Public API** [UNKNOWN]                                        |
| Active @ last step | completion (in-app)      | Completed          | No         | **not exposed via Public API** [UNKNOWN]                                        |

Per-state capabilities via the API: Active @ Step → read fields (GET) yes, write fields (POST) yes, advance step **no (API)** — can only populate the current step's values. Completed → reading is unverified, write/advance no. The API can **start** + **populate**; it cannot drive transitions/approvals/completion (those occur in Flowingly) [INFERRED].

---

## Business Rules

- A Flow Model must exist + be **published** in Flowingly before startflow can instantiate it by `Name` [INFERRED].
- Field updates target a `flowIdentifier`+`stepIdentifier` that must currently exist and be the active step [INFERRED].
- **GET a step before POSTing it** — field `identifier`s are model-assigned and required in the write body [DOCUMENTED].
- Field values are validated against **modeller-configured rules** on update; custom (modeller-set) error messages are returned, else default validation errors [DOCUMENTED].
- The authenticating user must be a **Business Administrator** [DOCUMENTED].
- `AssignedActor` required only when the first step needs an approver selected [DOCUMENTED].
- Starting a flow notifies/assigns the configured actors (email assignment) [INFERRED].
- Read-only/computed: `flowIdentifier`, `stepIdentifier` system-assigned [DOCUMENTED]; field `name`/`type`/`order`/`identifier` model-defined, only `value` writable [DOCUMENTED].
- A Flow Model's `Name` uniquely identifies a model [DOCUMENTED]. `startflow` is **not idempotent** — no natural key or idempotency token, so repeated calls create duplicate instances [INFERRED].

---

## Field Format Reference

| Format   | Pattern            | Example                                | Notes                                                 |
| -------- | ------------------ | -------------------------------------- | ----------------------------------------------------- |
| Flow ID  | `FLOW-<number>`    | `FLOW-9042`                            | string, human-readable [DOCUMENTED]                   |
| Field ID | `field<digits>`    | `field4938201746`                      | stable per-field key [DOCUMENTED]                     |
| Step ID  | step display name  | `Step 1`, `New Customer (Debtor) Form` | URL-encode in path; spaces/parens appear [DOCUMENTED] |
| Actor    | email or team name | `jo@acme.com` / `Finance`              | `UserEmail` or `Team` [DOCUMENTED]                    |
| Token    | JWT (`eyJ...`)     | `eyJhbGciOiJSUzI1NiI...`               | Bearer access token from `/authorise` [DOCUMENTED]    |

## Enum Reference — Field `type`

`Text`, `TextArea`, `SelectList`, `MultiSelectList`, `RadioButtonList`, `CheckBox`, `Email`, `Date`, `Datetime`, `Currency`, `Number` [DOCUMENTED — casing per docs; list may be incomplete, confirm on live]. Also exist but NOT API-writable: `Instruction`, `FileUpload`, `Signature`. Per-type `value` encoding: see the Field-types table in 01/02.

---

## Discovery Notes (resolve against a live instance)

1. Probe for list/get endpoints beyond the four (`GET /public/flows`, `/public/flowmodels`, etc.).
2. Confirm `value` encodings per type — round-trip GET→POST→GET.
3. Confirm whether `UserEmail` + `Team` can coexist in one actor object.
4. Confirm the true required-field set for `startflow` (send minimal bodies, mine validation errors).
5. Confirm the complete `Field.type` enum (documented list is likely partial).
