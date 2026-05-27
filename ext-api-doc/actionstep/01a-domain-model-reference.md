---
api_name: 'Actionstep'
api_slug: 'actionstep'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-27'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Actionstep — Domain Model Reference

> Companion to `01-llm-api-rules.md`. Entity catalog, relationships and business rules.
>
> **Vocabulary:** a _matter_/case in Actionstep is an **Action**. A _contact_ is a
> **Participant**. Keep this mapping in mind — the resource names follow Actionstep's terms.
>
> ⚠️ Field tables below are **[INFERRED] / 🔬 SANDBOX-CONFIRM** unless marked otherwise.
> Download the per-endpoint OpenAPI YAML from a live org to lock down exact field names,
> types, and required flags before relying on writes.

---

## Entity Catalog

### Action (Matter)

**Resource path:** `/api/rest/actions`
**Description:** The central case/matter record. Everything (time, notes, tasks, bills,
documents, participants) hangs off an Action.
**CRUD:** GET (list/single), POST, PUT, DELETE

| Field            | Type     | Required | Writable | Description                  | Example           |
| ---------------- | -------- | -------- | -------- | ---------------------------- | ----------------- |
| id               | number   | -        | no       | Unique identifier            | `123`             |
| name             | string   | yes      | yes      | Matter name/title            | `"Smith v Jones"` |
| reference        | string   | no       | yes      | Matter reference/file number | `"2026/0042"`     |
| status           | string   | no       | yes      | Matter status                | `"Active"`        |
| actionType       | ref      | yes      | yes      | Link to `actiontypes`        | `7`               |
| createdTimestamp | datetime | -        | no       | Server-set creation time     | `"2026-05-01..."` |

**Relationships:**

| Related Entity | Type | Expression                                   | Notes                          |
| -------------- | ---- | -------------------------------------------- | ------------------------------ |
| Participant    | N:M  | `linked.participants` + `actionparticipants` | Parties on the matter          |
| TimeEntry      | 1:N  | `timeentries?action={id}`                    | Time logged against the matter |
| FileNote       | 1:N  | `filenotes?action={id}`                      | Notes on the matter            |
| Task           | 1:N  | `tasks?action={id}`                          | Matter tasks                   |
| Bill           | 1:N  | `bills?action={id}`                          | Matter bills                   |
| ActionType     | N:1  | `actionType` ref                             | Matter category/config         |
| Step           | N:1  | `StepChanged` event / step field             | Workflow stage                 |

---

### Participant (Contact)

**Resource path:** `/api/rest/participants`
**Description:** People and organisations — clients, other parties, third parties.
**CRUD:** GET, POST, PUT, DELETE

| Field       | Type   | Required | Writable | Description            | Example        |
| ----------- | ------ | -------- | -------- | ---------------------- | -------------- |
| id          | number | -        | no       | Unique identifier      | `9`            |
| displayName | string | yes      | yes      | Display name           | `"Jane Smith"` |
| isCompany   | bool   | no       | yes      | Organisation vs person | `false`        |
| email       | string | no       | yes      | Primary email          | `"j@x.com"`    |
| phone       | string | no       | yes      | Phone                  | `"+64..."`     |

**Relationships:** linked to Actions via `actionparticipants` (N:M); has participant types
(`participanttypes`) and custom data field values.

---

### TimeEntry

**Resource path:** `/api/rest/timeentries` (scope name: `timerecords`)
**CRUD:** GET, POST, PUT, DELETE

| Field   | Type   | Required | Writable | Description                    | Example        |
| ------- | ------ | -------- | -------- | ------------------------------ | -------------- |
| id      | number | -        | no       | Unique identifier              | `555`          |
| action  | ref    | yes      | yes      | Matter the time belongs to     | `123`          |
| minutes | number | yes      | yes      | Duration in minutes (or units) | `30`           |
| note    | string | no       | yes      | Narrative                      | `"..."`        |
| date    | date   | no       | yes      | Date of work                   | `"2026-05-27"` |

> 🔬 Confirm whether duration is `minutes`, `units`, or `hours`, and whether `date`/`rate`
> are required — this drives billing correctness.

---

### FileNote

**Resource path:** `/api/rest/filenotes`
**CRUD:** GET, POST, PUT, DELETE

| Field            | Type     | Required | Writable | Description           |
| ---------------- | -------- | -------- | -------- | --------------------- |
| id               | number   | -        | no       | Unique identifier     |
| action           | ref      | yes      | yes      | Matter the note is on |
| text             | string   | yes      | yes      | Note body             |
| enteredTimestamp | datetime | -        | no       | Server-set            |

---

### Task

**Resource path:** `/api/rest/tasks` · **CRUD:** GET, POST, PUT, DELETE

| Field    | Type   | Required | Writable | Description          |
| -------- | ------ | -------- | -------- | -------------------- |
| id       | number | -        | no       | Unique identifier    |
| action   | ref    | no       | yes      | Matter (optional)    |
| name     | string | yes      | yes      | Task name            |
| dueDate  | date   | no       | yes      | Due date             |
| assignee | ref    | no       | yes      | Assigned participant |
| status   | string | no       | yes      | Open/closed          |

---

### Bill, ActionDocument, ActionType, Step, DataCollection (summary)

| Entity         | Resource                                                                           | Purpose                                     |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| Bill           | `/api/rest/bills`                                                                  | Billing records against a matter            |
| ActionDocument | `/api/rest/actiondocuments`                                                        | Documents stored against a matter           |
| ActionType     | `/api/rest/actiontypes`                                                            | Matter category/configuration (read mostly) |
| Step           | (matter field; `StepChanged` event)                                                | Workflow stage of a matter                  |
| DataCollection | `/api/rest/datacollections`, `datacollectionrecords`, `datacollectionrecordvalues` | Custom data fields                          |
| RestHook       | `/api/rest/resthooks`                                                              | Webhook subscriptions (see 01d)             |

> 🔬 Field detail for these is sandbox-confirm.

---

## Entity Relationship Diagram

```
                         ┌──────────────┐
            ┌──────N:1──>│  ActionType  │
            │            └──────────────┘
   ┌────────┴─────┐  N:M   ┌──────────────┐
   │              │<──────>│ Participant  │
   │    Action    │        └──────────────┘
   │   (Matter)   │  1:N   ┌──────────────┐
   │              │───────>│  TimeEntry   │
   └──┬───┬───┬───┘        └──────────────┘
      │   │   │ 1:N  ┌──────────┐ ┌────────┐ ┌──────┐ ┌──────────────┐
      └───┴───┴─────>│ FileNote │ │  Task  │ │ Bill │ │ActionDocument│
                     └──────────┘ └────────┘ └──────┘ └──────────────┘
```

---

## State Machines

### Action (Matter) — workflow steps

Actionstep matters move through configurable **Steps** defined by their ActionType. Step
changes raise the `StepChanged` RestHook event.

```
[Step A] ──advance──> [Step B] ──advance──> [Step C / Closed]
```

**Per-State Capabilities:** step definitions are configuration-driven per ActionType, so the
valid transitions differ per matter type. 🔬 Read `actiontypes` for a given org to learn the
step graph before attempting programmatic step changes.

---

## Business Rules

### Ordering / Dependency Rules

- An **Action (matter) must exist** before logging TimeEntries, FileNotes, Tasks or Bills against it.
- A matter's available **Steps come from its ActionType** — you cannot set an arbitrary step.

### Field-Level Rules

- Time entries require an `action` and a duration. 🔬 Confirm duration unit.
- Validation failures return per-resource codes (see 01d): `A01–A02` (actions),
  `P01–P03` (participants), `T01–T11` (tasks), `TR01–TR05` (time records).

### Computed / Read-Only Fields

- `id` and `*Timestamp` fields are server-set.

---

## Field Format Reference

| Format    | Pattern      | Example                | Notes               |
| --------- | ------------ | ---------------------- | ------------------- |
| ID        | integer      | `123`                  | Numeric, not opaque |
| Date      | `YYYY-MM-DD` | `2026-05-27`           | 🔬 confirm          |
| DateTime  | ISO-8601     | `2026-05-27T03:30:00Z` | 🔬 confirm tz       |
| Reference | integer FK   | `"action": 123`        | Related-record id   |

---

## Enum Value Reference

| Entity | Field  | Allowed Values          | Notes                   |
| ------ | ------ | ----------------------- | ----------------------- |
| Action | status | org-configurable        | 🔬 read from org config |
| Task   | status | open / closed (typical) | 🔬 confirm exact tokens |

---

_Generated from the investigation questionnaire, Phase 3._
