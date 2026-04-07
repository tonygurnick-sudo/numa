---
api_name: ''
api_slug: ''
generated_from: '00-api-investigation-questionnaire'
generated_date: ''
source_phases: ['Phase 3: Domain Model & Behavior']
---

# {{api_name}} -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Contains the full entity catalog, relationships,
> state machines, and business rules that the workspace agent references when working
> with {{api_name}} data.

---

## Entity Catalog

### {{Entity Name}}

**Resource path:** `/{{resource_path}}`
**Description:** {{description}}
**CRUD:** {{supported_operations}}

| Field     | Type     | Required | Writable  | Description       | Example       |
| --------- | -------- | -------- | --------- | ----------------- | ------------- |
| id        | string   | -        | no        | Unique identifier | `"abc_123"`   |
| {{field}} | {{type}} | {{req}}  | {{write}} | {{desc}}          | `{{example}}` |

**Relationships:**

| Related Entity | Type                      | Expression                         | Notes     |
| -------------- | ------------------------- | ---------------------------------- | --------- |
| {{entity}}     | {{1:N / N:1 / N:M / 1:1}} | {{nested / ID ref / sub-resource}} | {{notes}} |

---

_Repeat the block above for each entity._

---

## Entity Relationship Diagram

```
┌───────────────┐       1:N       ┌───────────────┐
│               │────────────────>│               │
│  {{Entity A}} │                 │  {{Entity B}} │
│               │<────────────────│               │
└───────────────┘       N:1       └───────────────┘
        │                                │
        │ 1:1                            │ N:M
        ▼                                ▼
┌───────────────┐                 ┌───────────────┐
│  {{Entity C}} │                 │  {{Entity D}} │
└───────────────┘                 └───────────────┘
```

> Replace with the actual entity relationship diagram for this API.

---

## State Machines

### {{Entity Name}} Lifecycle

```
[{{state_a}}] ──{{action}}──> [{{state_b}}] ──{{action}}──> [{{state_c}}]
                                      │
                                      └──{{action}}──> [{{state_d}}]
```

**Transitions:**

| From     | Action / Trigger | To     | Reversible? | Side Effects |
| -------- | ---------------- | ------ | ----------- | ------------ |
| {{from}} | {{action}}       | {{to}} | {{yes/no}}  | {{effects}}  |

**Per-State Capabilities:**

| State     | Can Update? | Can Delete? | Available Actions | Notes     |
| --------- | ----------- | ----------- | ----------------- | --------- |
| {{state}} | {{yes/no}}  | {{yes/no}}  | {{actions}}       | {{notes}} |

---

_Repeat for each entity that has a lifecycle / state machine._

---

## Business Rules

### Ordering / Dependency Rules

- {{rule}}: e.g., "Must create a Workspace before creating a Project"
- {{rule}}: e.g., "Cannot assign a Task to a User not in the Project"

### Field-Level Rules

- {{rule}}: e.g., "`email` must be unique per organization"
- {{rule}}: e.g., "`start_date` must be before `end_date`"
- {{rule}}: e.g., "`status` can only be set to `closed` if all child items are resolved"

### Cascading Effects

- {{rule}}: e.g., "Deleting a Project soft-deletes all Tasks"
- {{rule}}: e.g., "Changing an Organization's plan recalculates all seat limits"

### Uniqueness Constraints

- {{rule}}: e.g., "`name` must be unique within `parent_id` scope"
- {{rule}}: e.g., "`slug` must be globally unique"

### Computed / Read-Only Fields

- {{field}}: e.g., "`total_amount` is sum of line item amounts"
- {{field}}: e.g., "`updated_at` is set server-side on every write"

---

## Field Format Reference

| Format   | Pattern     | Example       | Notes     |
| -------- | ----------- | ------------- | --------- |
| Date     | {{pattern}} | `{{example}}` | {{notes}} |
| DateTime | {{pattern}} | `{{example}}` | {{notes}} |
| Currency | {{pattern}} | `{{example}}` | {{notes}} |
| ID       | {{pattern}} | `{{example}}` | {{notes}} |
| Phone    | {{pattern}} | `{{example}}` | {{notes}} |

---

## Enum Value Reference

| Entity     | Field     | Allowed Values                     | Default       | Notes     |
| ---------- | --------- | ---------------------------------- | ------------- | --------- |
| {{entity}} | {{field}} | `{{val1}}`, `{{val2}}`, `{{val3}}` | `{{default}}` | {{notes}} |

---

_Generated from the investigation questionnaire, Phase 3._
