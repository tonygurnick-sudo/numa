---
api_name: Actionstep
api_slug: actionstep
companion_to: 01-llm-api-rules.md
role: domain model — entity catalog, relationships, state machine, business rules
vocabulary: matter/case = Action (`/api/rest/actions`); contact = Participant (`/api/rest/participants`); time entry resource `timeentries` (scope name `timerecords`)
id_format: integer FK (e.g. `"action": 123`)
confidence: doc-based 2026-05-27. Field tables are [INFERRED] / 🔬 SANDBOX-CONFIRM unless marked otherwise — download the per-endpoint OpenAPI YAML from a live org to lock exact field names/types/required-flags before relying on writes.
---

# Actionstep — Domain Model Reference

Everything (time, notes, tasks, bills, documents, participants) hangs off an **Action** (matter).

## Action (Matter)

Path `/api/rest/actions`. CRUD: GET (list/single), POST, PUT, DELETE.

| Field            | Type     | Req | Writable | Description                         | Example           |
| ---------------- | -------- | --- | -------- | ----------------------------------- | ----------------- |
| id               | number   | -   | no       | Unique id                           | `123`             |
| name             | string   | yes | yes      | Matter name/title                   | `"Smith v Jones"` |
| reference        | string   | no  | yes      | File/reference number               | `"2026/0042"`     |
| status           | string   | no  | yes      | Matter status (org-configurable 🔬) | `"Active"`        |
| actionType       | ref      | yes | yes      | Link to `actiontypes`               | `7`               |
| createdTimestamp | datetime | -   | no       | Server-set                          | `"2026-05-01..."` |

Relationships: Participant (N:M, `linked.participants` + `actionparticipants`); 1:N children: TimeEntry (`timeentries?action={id}`), FileNote (`filenotes?action={id}`), Task (`tasks?action={id}`), Bill (`bills?action={id}`), ActionDocument (`actiondocuments?action={id}`); ActionType (N:1, `actionType` ref — matter category/config); Step (N:1, matter step field / `StepChanged` event — workflow stage).

## Participant (Contact)

Path `/api/rest/participants`. People + organisations (clients, other/third parties). CRUD: GET, POST, PUT, DELETE.

| Field       | Type   | Req | Writable | Description   | Example        |
| ----------- | ------ | --- | -------- | ------------- | -------------- |
| id          | number | -   | no       | Unique id     | `9`            |
| displayName | string | yes | yes      | Display name  | `"Jane Smith"` |
| isCompany   | bool   | no  | yes      | Org vs person | `false`        |
| email       | string | no  | yes      | Primary email | `"j@x.com"`    |
| phone       | string | no  | yes      | Phone         | `"+64..."`     |

Linked to Actions via `actionparticipants` (N:M); has participant types (`participanttypes`) and custom data field values.

## TimeEntry

Path `/api/rest/timeentries` (scope name `timerecords`). CRUD: GET, POST, PUT, DELETE.

| Field   | Type   | Req | Writable | Description                 | Example        |
| ------- | ------ | --- | -------- | --------------------------- | -------------- |
| id      | number | -   | no       | Unique id                   | `555`          |
| action  | ref    | yes | yes      | Matter the time belongs to  | `123`          |
| minutes | number | yes | yes      | Duration (minutes or units) | `30`           |
| note    | string | no  | yes      | Narrative                   | `"..."`        |
| date    | date   | no  | yes      | Date of work                | `"2026-05-27"` |

🔬 Confirm whether duration is `minutes`/`units`/`hours`, and whether `date`/`rate` are required — drives billing correctness.

## FileNote

Path `/api/rest/filenotes`. CRUD: GET, POST, PUT, DELETE.

| Field            | Type     | Req | Writable | Description           |
| ---------------- | -------- | --- | -------- | --------------------- |
| id               | number   | -   | no       | Unique id             |
| action           | ref      | yes | yes      | Matter the note is on |
| text             | string   | yes | yes      | Note body             |
| enteredTimestamp | datetime | -   | no       | Server-set            |

## Task

Path `/api/rest/tasks`. CRUD: GET, POST, PUT, DELETE.

| Field    | Type   | Req | Writable | Description                                      |
| -------- | ------ | --- | -------- | ------------------------------------------------ |
| id       | number | -   | no       | Unique id                                        |
| action   | ref    | no  | yes      | Matter (optional)                                |
| name     | string | yes | yes      | Task name                                        |
| dueDate  | date   | no  | yes      | Due date                                         |
| assignee | ref    | no  | yes      | Assigned participant                             |
| status   | string | no  | yes      | open / closed (typical; 🔬 confirm exact tokens) |

## Other entities (field detail 🔬)

| Entity         | Resource                                                                           | Purpose                              |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| Bill           | `/api/rest/bills`                                                                  | Billing records against a matter     |
| ActionDocument | `/api/rest/actiondocuments`                                                        | Documents stored against a matter    |
| ActionType     | `/api/rest/actiontypes`                                                            | Matter category/config (read mostly) |
| Step           | matter field; `StepChanged` event                                                  | Workflow stage of a matter           |
| DataCollection | `/api/rest/datacollections`, `datacollectionrecords`, `datacollectionrecordvalues` | Custom data fields                   |
| RestHook       | `/api/rest/resthooks`                                                              | Webhook subscriptions (see 01d)      |

Relationship summary: Action is the hub — N:1 ActionType, N:M Participant, 1:N each of TimeEntry / FileNote / Task / Bill / ActionDocument (per-entity expressions listed above).

## State Machine — Action (Matter) steps

Matters advance linearly through configurable **Steps** (`[Step A] → [Step B] → [Step C / Closed]`) defined by their ActionType; step changes raise the `StepChanged` RestHook event. Step definitions are config-driven per ActionType, so valid transitions differ per matter type. 🔬 Read `actiontypes` for an org to learn its step graph before attempting programmatic step changes.

## Business Rules

- An **Action must exist** before logging TimeEntries, FileNotes, Tasks or Bills against it.
- A matter's available **Steps come from its ActionType** — you cannot set an arbitrary step.
- Time entries require an `action` + a duration (🔬 confirm unit).
- Validation failures return per-resource codes (see 01d): `A01–A02` (actions), `P01–P03` (participants), `T01–T11` (tasks), `TR01–TR05` (time records).
- `id` and `*Timestamp` fields are server-set (read-only).

## Field Formats

| Format    | Pattern      | Example                | Notes               |
| --------- | ------------ | ---------------------- | ------------------- |
| ID        | integer      | `123`                  | Numeric, not opaque |
| Date      | `YYYY-MM-DD` | `2026-05-27`           | 🔬 confirm          |
| DateTime  | ISO-8601     | `2026-05-27T03:30:00Z` | 🔬 confirm tz       |
| Reference | integer FK   | `"action": 123`        | Related-record id   |

## Enums

| Entity | Field  | Allowed Values          | Notes                   |
| ------ | ------ | ----------------------- | ----------------------- |
| Action | status | org-configurable        | 🔬 read from org config |
| Task   | status | open / closed (typical) | 🔬 confirm exact tokens |
