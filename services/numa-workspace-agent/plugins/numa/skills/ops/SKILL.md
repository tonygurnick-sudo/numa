---
name: ops
description: Manage Numa Ops boards -- create and search tickets, manage boards, customers, suppliers, and projects. Supports full CRUD operations with user-scoped access control.
---

# Numa Ops Skill

Manage work items on the Numa Ops kanban boards. Create tickets, search and filter, manage boards, track customers and suppliers, and more.

> **Parameter convention:** All parameters use camelCase (matching the JSON API convention), e.g. `boardId`, `stageId`, `ticketTypeId`. snake_case is accepted as a fallback but camelCase is preferred.

> **Use names, not IDs.** Pass human-readable names (e.g. `stageName: "Funnel"`, `customerName: "Acme Corp"`, `assigneeName: "Tom Wiltshire"`) and the bridge will resolve them to IDs automatically. You only need to call `get_board` / `get_config` / `list_*` first if you need to _show_ the data to the user, or if a name lookup fails and you need to disambiguate. **Never invent IDs** -- if you don't already know the ID, pass the name and let the bridge resolve it. See [Name-based parameters](#name-based-parameters) below.

## Available Command

| Command                | Purpose                                                                        | Approval            |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------- |
| `numa ops <operation>` | Perform any Numa Ops operation (tickets, boards, customers, suppliers, config) | Required for writes |

---

## How It Works

The `numa ops` command accepts an `operation` and a `--params` JSON string. The operation determines what action is taken and which parameters are required.

```
Bash("numa ops list_tickets --params '{\"boardName\": \"Engineering\"}' --json -m 'List all tickets for the Engineering board'")
```

You can pass either an ID (`boardId`) or the human-readable name (`boardName`) -- the bridge resolves names to IDs automatically.

---

## Name-based parameters

Anywhere an operation accepts an entity ID, you can pass the entity's name instead and the bridge will resolve it for you. This is the preferred way to call ops operations -- skip the get*board / get_config / list*\* dance unless you actually need to display the data to the user.

| Pass this name                                | Resolves to                             | Notes                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boardName`                                   | `boardId`                               | Case-insensitive match against the user's accessible boards.                                                                                                                                                                 |
| `stageName`                                   | `stageId`                               | Requires `boardId` or `boardName`. Add `zoneName` if the same stage name appears in multiple zones.                                                                                                                          |
| `zoneName`                                    | `zoneId`                                | Requires `boardId` or `boardName`.                                                                                                                                                                                           |
| `workUnitName` / `sprintName`                 | `workUnitId`                            | Requires `boardId` or `boardName`. Active sprint wins on tie.                                                                                                                                                                |
| `targetZoneName`                              | `targetZoneId`                          | Sprint activation only. Requires `boardId` or `boardName`. Resolves to the named board zone the sprint runs in.                                                                                                              |
| `projectName`                                 | `projectId`                             | Case-insensitive match.                                                                                                                                                                                                      |
| `ticketTypeName`                              | `ticketTypeId`                          | Matches name (e.g. "Bug") or prefix (e.g. "BUG").                                                                                                                                                                            |
| `assigneeName` / `reporterName` / `ownerName` | `assigneeId` / `reporterId` / `ownerId` | Matches the staff member's full name; falls back to substring match against name and email.                                                                                                                                  |
| `customerName`                                | `customerId`                            | Used to _link_ a ticket / activity to a customer. (For `create_customer` / `update_customer` itself, use `companyName` -- that's the actual field for the customer's name.)                                                  |
| `supplierName`                                | `supplierId`                            | Same pattern as `customerName`.                                                                                                                                                                                              |
| `lifecycleStageName`                          | `lifecycleStage` (customer)             | Used on customers and on `list_customers` filters.                                                                                                                                                                           |
| `supplierLifecycleStageName`                  | `lifecycleStage` (supplier)             | Use this on supplier operations to disambiguate from the customer config. (For `list_suppliers`, `update_supplier`, etc., a plain `lifecycleStageName` will also work -- the bridge knows the operation is supplier-scoped.) |

**Rules:**

- **ID wins.** If you pass both an ID and a name (e.g. `stageId` and `stageName`), the ID is used and the name is ignored.
- **Errors are surfaced cleanly.** If a name doesn't match (or matches multiple entities), the bridge returns a structured error listing the available options. Pass that information back to the user and ask for clarification.
- **Display names are canonicalized.** When you pass `assigneeName: "tom"` and the bridge resolves to "Tom Wiltshire", the canonical name is what gets stored on the ticket. You don't need to look up the canonical spelling first.
- **bulk_update_tickets:** name-based fields work inside the `changes` dict too.

---

## Operations Reference

### Configuration

| Operation                | Description                                                                     | Approval |
| ------------------------ | ------------------------------------------------------------------------------- | -------- |
| `get_config`             | Load all config: ticket types, statuses, fields, staff, projects, CRM config    | No       |
| `list_projects`          | List projects accessible to the current user                                    | No       |
| `create_project`         | Create a new project                                                            | Yes      |
| `update_project`         | Update an existing project                                                      | Yes      |
| `delete_project`         | Delete a project (admin-only)                                                   | Yes      |
| `create_field`           | Create a custom field (ticket category or CRM-category) — admin-only            | Yes      |
| `update_field`           | Update an existing custom field — admin-only                                    | Yes      |
| `delete_field`           | Delete a custom field — admin-only (refused if still used in CRM layout)        | Yes      |
| `create_ticket_type`     | Create a new ticket type — admin-only                                           | Yes      |
| `update_ticket_type`     | Update a ticket type — admin-only (prefix is immutable)                         | Yes      |
| `delete_ticket_type`     | Delete a ticket type — admin-only                                               | Yes      |
| `create_status`          | Create a status — admin-only (statuses are deprecated; prefer stage management) | Yes      |
| `update_status`          | Update a status — admin-only                                                    | Yes      |
| `update_crm_config`      | Update CRM config (lifecycle stages, customer record layout, industries, etc.)  | Yes      |
| `update_supplier_config` | Update supplier config (lifecycle stages, flags, document types)                | Yes      |

#### get_config

Returns ticket types, statuses, custom fields, staff members, projects, CRM config, and supplier config in a single call. **Always call this first** to understand the board structure before creating or updating tickets or mutating config.

```
Bash("numa ops get_config --params '{}' --json -m 'Load Numa Ops configuration'")
```

#### create_project

| Parameter     | Type     | Required | Description                                        |
| ------------- | -------- | -------- | -------------------------------------------------- |
| `name`        | string   | Yes      | Project name                                       |
| `description` | string   | No       | Brief project description                          |
| `color`       | string   | No       | Hex color code                                     |
| `status`      | string   | No       | Status: active, planned, on_hold, complete         |
| `ownerId`     | string   | No       | Owner user sub (from get_config staff)             |
| `ownerName`   | string   | No       | Owner display name                                 |
| `goals`       | string   | No       | Project goals/objectives (HTML rich text)          |
| `startDate`   | string   | No       | Project start date (ISO format, e.g. 2026-04-01)   |
| `endDate`     | string   | No       | Project end date (ISO format)                      |
| `boardIds`    | string[] | No       | Board IDs this project is visible on (empty = all) |

#### update_project

| Parameter     | Type     | Required | Description                                        |
| ------------- | -------- | -------- | -------------------------------------------------- |
| `projectId`   | string   | Yes      | Project ID                                         |
| `name`        | string   | No       | New project name                                   |
| `description` | string   | No       | New description                                    |
| `color`       | string   | No       | New color                                          |
| `isActive`    | boolean  | No       | Set false to deactivate, true to restore           |
| `status`      | string   | No       | Status: active, planned, on_hold, complete         |
| `ownerId`     | string   | No       | Owner user sub                                     |
| `ownerName`   | string   | No       | Owner display name                                 |
| `goals`       | string   | No       | Project goals/objectives (HTML rich text)          |
| `startDate`   | string   | No       | Project start date (ISO format)                    |
| `endDate`     | string   | No       | Project end date (ISO format)                      |
| `boardIds`    | string[] | No       | Board IDs this project is visible on (empty = all) |

#### delete_project

Admin-only operation. Permanently deletes a project.

| Parameter   | Type   | Required | Description |
| ----------- | ------ | -------- | ----------- |
| `projectId` | string | Yes      | Project ID  |

---

### Boards

| Operation       | Description                                   | Approval |
| --------------- | --------------------------------------------- | -------- |
| `list_boards`   | List all boards the user can access           | No       |
| `get_board`     | Get a single board by ID                      | No       |
| `create_board`  | Create a new board                            | Yes      |
| `update_board`  | Update an existing board (owner-only)         | Yes      |
| `update_zones`  | Update zones on a board (owner-only)          | Yes      |
| `update_stages` | Update stages/columns on a board (owner-only) | Yes      |

#### list_boards

No parameters required. Returns all boards accessible to the current user.

#### get_board

Returns the board with its zones and stages. Use this to get valid `stageId` values for ticket creation.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `boardId` | string | Yes      | Board ID    |

#### create_board

| Parameter            | Type   | Required | Description                                                                                          |
| -------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `name`               | string | Yes      | Board name                                                                                           |
| `description`        | string | No       | Board description                                                                                    |
| `color`              | string | No       | Hex color code                                                                                       |
| `preset`             | string | No       | Board preset (e.g., "standard")                                                                      |
| `ticketTypeId`       | string | No       | Default ticket type ID                                                                               |
| `allowedTicketTypes` | array  | No       | List of allowed ticket type IDs                                                                      |
| `fieldOverrides`     | object | No       | Custom field overrides per board `{fieldId: {required: true, hidden: false}}`                        |
| `addedFields`        | object | No       | Additional fields per ticket type `{ticketTypeId: [fieldId, ...]}`                                   |
| `accessControl`      | object | No       | `{"mode": "all"\|"specific", "users": ["sub1", "sub2"], "owners": ["sub3"]}` -- owners are co-owners |
| `announcement`       | string | No       | Board announcement text (shown at top of board)                                                      |
| `zones`              | array  | No       | Custom zone definitions                                                                              |

#### update_board

Only board owners (creator or co-owners) and admins can update board settings.

| Parameter            | Type   | Required | Description                                                                        |
| -------------------- | ------ | -------- | ---------------------------------------------------------------------------------- |
| `boardId`            | string | Yes      | Board ID                                                                           |
| `name`               | string | No       | New board name                                                                     |
| `description`        | string | No       | New description                                                                    |
| `color`              | string | No       | New color                                                                          |
| `allowedTicketTypes` | array  | No       | List of allowed ticket type IDs                                                    |
| `fieldOverrides`     | object | No       | Custom field overrides `{fieldId: {required, hidden}}`                             |
| `addedFields`        | object | No       | Additional fields per ticket type `{ticketTypeId: [fieldId, ...]}`                 |
| `accessControl`      | object | No       | `{"mode": "all"\|"specific", "users": [...], "owners": [...]}` -- manage ownership |
| `workUnitSeries`     | object | No       | Work unit (sprint) configuration                                                   |
| `announcement`       | string | No       | Board announcement text                                                            |

#### update_zones

Update zones on a board. Only board owners and admins can modify zones.

| Parameter | Type   | Required | Description                                                                             |
| --------- | ------ | -------- | --------------------------------------------------------------------------------------- |
| `boardId` | string | Yes      | Board ID                                                                                |
| `zones`   | array  | Yes      | Array of zone objects: `[{"id": "...", "name": "...", "zoneType": "board"\|"backlog"}]` |

#### update_stages

Update stages (kanban columns) on a board. Only board owners and admins can modify stages.

| Parameter | Type   | Required | Description                                                                                       |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------------- |
| `boardId` | string | Yes      | Board ID                                                                                          |
| `stages`  | array  | Yes      | Array of stage objects: `[{"id": "...", "zoneId": "...", "name": "...", "statusType": "active"}]` |

Valid `statusType` values per zone type:

- **backlog zones:** backlog, scoped, queued
- **board zones:** queued, active, completed, ended, deleted

---

### Tickets

| Operation             | Description                                      | Approval |
| --------------------- | ------------------------------------------------ | -------- |
| `list_tickets`        | List tickets for a board (with optional filters) | No       |
| `get_ticket`          | Get a single ticket by ID or display ID          | No       |
| `search_tickets`      | Search tickets by text query                     | No       |
| `create_ticket`       | Create a new ticket                              | Yes      |
| `update_ticket`       | Update an existing ticket                        | Yes      |
| `delete_ticket`       | Delete a ticket                                  | Yes      |
| `bulk_update_tickets` | Bulk update multiple tickets at once             | Yes      |
| `add_comment`         | Add a comment to a ticket                        | Yes      |
| `list_comments`       | List comments on a ticket                        | No       |
| `get_audit`           | Get audit trail (change history) for a ticket    | No       |

#### list_tickets

| Parameter         | Type   | Required | Description                                                      |
| ----------------- | ------ | -------- | ---------------------------------------------------------------- |
| `boardId`         | string | Yes      | Board ID to list tickets for                                     |
| `stageId`         | string | No       | Filter by stage ID                                               |
| `statusType`      | string | No       | Filter by status type (backlog, queued, active, completed, etc.) |
| `assigneeId`      | string | No       | Filter by assignee (user sub)                                    |
| `customerId`      | string | No       | Filter by linked customer                                        |
| `workUnitId`      | string | No       | Filter by sprint/work unit                                       |
| `projectId`       | string | No       | Filter by project                                                |
| `priority`        | string | No       | Filter by priority (lowest, low, medium, high, highest)          |
| `includeArchived` | string | No       | Set to "true" to include archived tickets                        |
| `limit`           | string | No       | Pagination limit                                                 |
| `cursor`          | string | No       | Pagination cursor from previous response                         |

#### get_ticket

| Parameter   | Type   | Required    | Description                                             |
| ----------- | ------ | ----------- | ------------------------------------------------------- |
| `ticketId`  | string | Conditional | Internal ticket ID (use one of ticketId or displayId)   |
| `boardId`   | string | Conditional | Required when using ticketId (not needed for displayId) |
| `displayId` | string | Conditional | Human-readable display ID like "ENG-42"                 |

#### search_tickets

> **`boardId` is required — do not attempt the call without it.** Search is scoped per-board; there is no cross-board search. If the user hasn't told you which board they mean, call `list_boards` first and either pick the obvious one from context or ask them. Don't try `search_tickets` "to see what happens" — it just 400s and wastes a turn.

| Parameter | Type   | Required | Description                                                                                                                                                                  |
| --------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`   | string | Yes      | Search text. Matches `displayId` (e.g. `FEAT-010` or prefix like `FEAT`), `title`, or `description`. Multi-word queries use AND across words in any order, case-insensitive. |
| `boardId` | string | Yes      | Board to search within. If you don't already have it, run `list_boards` first.                                                                                               |

**Example flow** when the user says _"find tickets about SSO"_ and you don't already know the board:

```
1. Bash("numa ops list_boards --params '{}' --json -m 'List boards'")
2. (pick obvious board from chat context, or ask: "Which board?")
3. Bash("numa ops search_tickets --params '{\"query\":\"SSO\",\"boardId\":\"<id-or-name-from-step-2>\"}' --json -m 'Search for SSO tickets'")
```

#### create_ticket

**Preferred:** Pass `boardName`, `stageName`, `assigneeName`, `customerName`, etc. and the bridge resolves them to IDs (see [Name-based parameters](#name-based-parameters)). Only call `get_config` / `get_board` first if you need to _show_ the data to the user.

> **NEVER invent IDs.** If you don't already know the `stageId` for a stage, pass `stageName` and let the bridge resolve it. Hallucinated IDs (e.g. `custom-1234567890-abc123` patterns from previous tool results) will be rejected with a 400 error.

| Parameter       | Type   | Required | Description                                                                     |
| --------------- | ------ | -------- | ------------------------------------------------------------------------------- |
| `boardId`       | string | Yes      | Board to create the ticket in                                                   |
| `stageId`       | string | Yes      | Stage ID (from get_board response zones/stages)                                 |
| `title`         | string | Yes      | Ticket title                                                                    |
| `ticketTypeId`  | string | No       | Ticket type ID (from get_config ticketTypes)                                    |
| `description`   | string | No       | Ticket description (use HTML for rich text, e.g. `<p>`, `<strong>`, `<ul><li>`) |
| `priority`      | string | No       | Priority: lowest, low, medium, high, highest                                    |
| `assigneeId`    | string | No       | Assignee user sub (from get_config staff)                                       |
| `assigneeName`  | string | No       | Assignee display name                                                           |
| `reporterId`    | string | No       | Reporter user sub (defaults to current user)                                    |
| `reporterName`  | string | No       | Reporter display name                                                           |
| `dueDate`       | string | No       | Due date in ISO 8601 format                                                     |
| `customerId`    | string | No       | Link to a customer                                                              |
| `customerName`  | string | No       | Customer display name                                                           |
| `supplierId`    | string | No       | Link to a supplier                                                              |
| `supplierName`  | string | No       | Supplier display name                                                           |
| `workUnitId`    | string | No       | Link to a sprint/work unit                                                      |
| `projectId`     | string | No       | Link to a project                                                               |
| `tags`          | array  | No       | List of tag strings                                                             |
| `fields`        | object | No       | Custom field values (fieldId -> value)                                          |
| `effortPoints`  | number | No       | Effort/story points                                                             |
| `sourceType`    | string | No       | Origin of ticket: app, chat, agent, manual                                      |
| `sourceId`      | string | No       | Source record ID (e.g., conversation ID, app run ID)                            |
| `sourceAppType` | string | No       | Source application type identifier                                              |

#### update_ticket

You can identify the ticket by either `ticketId` (UUID) or `displayId` (e.g. "BUG-002"). If `displayId` is provided, the system will automatically resolve it to the internal UUID and board ID.

| Parameter        | Type    | Required | Description                                                   |
| ---------------- | ------- | -------- | ------------------------------------------------------------- |
| `ticketId`       | string  | Yes\*    | Ticket UUID (\* or provide `displayId` instead)               |
| `displayId`      | string  | No       | Display ID (e.g. "BUG-002") -- resolves automatically         |
| `boardId`        | string  | Yes\*    | Board the ticket belongs to (\* auto-resolved from displayId) |
| `currentBoardId` | string  | No       | Current board (for cross-board moves)                         |
| `title`          | string  | No       | New title                                                     |
| `description`    | string  | No       | New description                                               |
| `stageId`        | string  | No       | Move to different stage (auto-updates status type)            |
| `zoneId`         | string  | No       | Move to different zone                                        |
| `priority`       | string  | No       | New priority                                                  |
| `assigneeId`     | string  | No       | New assignee                                                  |
| `assigneeName`   | string  | No       | Assignee display name                                         |
| `dueDate`        | string  | No       | New due date                                                  |
| `customerId`     | string  | No       | Link to customer                                              |
| `supplierId`     | string  | No       | Link to supplier                                              |
| `workUnitId`     | string  | No       | Link to sprint/work unit                                      |
| `projectId`      | string  | No       | Link to project                                               |
| `tags`           | array   | No       | Updated tags                                                  |
| `fields`         | object  | No       | Updated custom field values                                   |
| `effortPoints`   | number  | No       | Updated effort points                                         |
| `order`          | number  | No       | Position order within stage                                   |
| `version`        | number  | No       | Optimistic locking (prevents concurrent edits)                |
| `archived`       | boolean | No       | Set true to archive, false to unarchive                       |

#### delete_ticket

You can identify the ticket by either `ticketId` (UUID) or `displayId` (e.g. "BUG-002"). If `displayId` is provided, the system will automatically resolve it to the internal UUID and board ID.

| Parameter   | Type   | Required | Description                                                   |
| ----------- | ------ | -------- | ------------------------------------------------------------- |
| `ticketId`  | string | Yes\*    | Ticket UUID (\* or provide `displayId` instead)               |
| `displayId` | string | No       | Display ID (e.g. "BUG-002") -- resolves automatically         |
| `boardId`   | string | Yes\*    | Board the ticket belongs to (\* auto-resolved from displayId) |

#### bulk_update_tickets

Update multiple tickets at once (e.g., move all to a new stage, reassign).

| Parameter   | Type   | Required | Description                                                                                                         |
| ----------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `ticketIds` | array  | Yes      | Array of ticket IDs to update                                                                                       |
| `changes`   | object | Yes      | Fields to apply to all tickets. Must include `boardId`. Supports: `stageId`, `assigneeId`, `priority`, `tags`, etc. |

#### add_comment

You can identify the ticket by either `ticketId` (UUID) or `displayId` (e.g. "BUG-002").

| Parameter   | Type   | Required | Description                                                               |
| ----------- | ------ | -------- | ------------------------------------------------------------------------- |
| `ticketId`  | string | Yes\*    | Ticket UUID (\* or provide `displayId` instead)                           |
| `displayId` | string | No       | Display ID (e.g. "BUG-002") -- resolves automatically                     |
| `content`   | string | Yes      | Comment text (use HTML for rich text, e.g. `<p>`, `<strong>`, `<ul><li>`) |
| `boardId`   | string | No       | Board ID (helps with comment count update)                                |

#### list_comments

You can identify the ticket by either `ticketId` (UUID) or `displayId` (e.g. "BUG-002").

| Parameter   | Type   | Required | Description                                           |
| ----------- | ------ | -------- | ----------------------------------------------------- |
| `ticketId`  | string | Yes\*    | Ticket UUID (\* or provide `displayId` instead)       |
| `displayId` | string | No       | Display ID (e.g. "BUG-002") -- resolves automatically |

#### get_audit

Get the audit trail (change history) for a ticket. You can identify the ticket by either `ticketId` (UUID) or `displayId` (e.g. "BUG-002").

| Parameter   | Type   | Required | Description                                           |
| ----------- | ------ | -------- | ----------------------------------------------------- |
| `ticketId`  | string | Yes\*    | Ticket UUID (\* or provide `displayId` instead)       |
| `displayId` | string | No       | Display ID (e.g. "BUG-002") -- resolves automatically |

---

### Work Units (Sprints)

**Sprint model:** a sprint runs inside exactly one board zone. While a sprint is active, every ticket sitting in its zone has `workUnitId` auto-derived from `zone.activeWorkUnitId` — you do not assign workUnitId on board-zone tickets manually; moving a ticket into the zone implicitly adds it to the active sprint, moving it out implicitly removes it. Multiple board zones can each run their own sprint in parallel.

A sprint's lifecycle is `planning -> active -> completed`. Activation requires a `targetZoneId` (or `targetZoneName`) — which board zone the sprint runs in. Completion supports rollover: pass `rolloverToWorkUnitId` to auto-activate a planning sprint into the same zone with all incomplete tickets keeping their stages.

| Operation          | Description                        | Approval |
| ------------------ | ---------------------------------- | -------- |
| `list_work_units`  | List sprints for a board           | No       |
| `create_work_unit` | Create a new sprint                | Yes      |
| `update_work_unit` | Update / start / complete a sprint | Yes      |
| `delete_work_unit` | Delete a sprint (admin/owner only) | Yes      |

#### list_work_units

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `boardId` | string | Yes      | Board ID    |

#### create_work_unit

| Parameter   | Type   | Required | Description                         |
| ----------- | ------ | -------- | ----------------------------------- |
| `boardId`   | string | Yes      | Board ID                            |
| `name`      | string | Yes      | Sprint name                         |
| `goal`      | string | No       | Sprint goal/objective               |
| `startDate` | string | No       | Start date (ISO 8601)               |
| `endDate`   | string | No       | End date (ISO 8601)                 |
| `status`    | string | No       | Status: planning, active, completed |
| `capacity`  | number | No       | Sprint capacity (story points)      |

#### update_work_unit

| Parameter              | Type   | Required                  | Description                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boardId`              | string | Yes                       | Board ID                                                                                                                                                                                                                                                                                                                        |
| `workUnitId`           | string | Yes                       | Work unit ID                                                                                                                                                                                                                                                                                                                    |
| `name`                 | string | No                        | New name                                                                                                                                                                                                                                                                                                                        |
| `goal`                 | string | No                        | New goal                                                                                                                                                                                                                                                                                                                        |
| `startDate`            | string | No                        | New start date                                                                                                                                                                                                                                                                                                                  |
| `endDate`              | string | No                        | New end date                                                                                                                                                                                                                                                                                                                    |
| `status`               | string | No                        | New status (planning / active / completed)                                                                                                                                                                                                                                                                                      |
| `capacity`             | number | No                        | New capacity                                                                                                                                                                                                                                                                                                                    |
| `targetZoneId`         | string | When activating           | Required when transitioning `planning -> active`. Which board zone the sprint runs in. Pass `targetZoneName` and the bridge resolves it.                                                                                                                                                                                        |
| `rolloverToWorkUnitId` | string | When completing, optional | On `active -> completed`, where to roll incomplete tickets. `'next'` auto-resolves to the next planning sprint by order. Omit (or pass `'backlog'`) to send incomplete tickets back to the backlog zone. When set to a planning sprint, that sprint auto-activates into the same zone and incomplete tickets keep their stages. |

**Sprint guidance for ticket operations:** Do NOT pass `workUnitId` on `update_ticket` or `create_ticket` when the destination is a board zone. The server derives it from the zone's active sprint. Explicit `workUnitId` on board-zone moves is ignored. `workUnitId` is only honoured when the ticket is being placed in a backlog zone (planning workflow).

#### delete_work_unit

| Parameter    | Type   | Required | Description  |
| ------------ | ------ | -------- | ------------ |
| `boardId`    | string | Yes      | Board ID     |
| `workUnitId` | string | Yes      | Work unit ID |

---

### Ticket Links

| Operation     | Description                           | Approval |
| ------------- | ------------------------------------- | -------- |
| `create_link` | Create a dependency/relationship link | Yes      |
| `delete_link` | Remove a link between two tickets     | Yes      |

#### create_link

| Parameter               | Type   | Required | Description                                      |
| ----------------------- | ------ | -------- | ------------------------------------------------ |
| `ticketId`              | string | Yes      | Source ticket ID                                 |
| `linkedTicketId`        | string | Yes      | Target ticket ID                                 |
| `linkedTicketDisplayId` | string | Yes      | Target ticket display ID (e.g., "ENG-42")        |
| `linkedTicketTitle`     | string | No       | Target ticket title                              |
| `linkType`              | string | Yes      | Link type: depends_on, blocks, related_to        |
| `boardId`               | string | No       | Source ticket's board ID                         |
| `linkedBoardId`         | string | No       | Target ticket's board ID (for cross-board links) |

#### delete_link

| Parameter        | Type   | Required | Description      |
| ---------------- | ------ | -------- | ---------------- |
| `ticketId`       | string | Yes      | Source ticket ID |
| `linkType`       | string | Yes      | Link type        |
| `linkedTicketId` | string | Yes      | Target ticket ID |

---

### Customers

| Operation         | Description                   | Approval |
| ----------------- | ----------------------------- | -------- |
| `list_customers`  | List customers (with filters) | No       |
| `get_customer`    | Get a single customer by ID   | No       |
| `create_customer` | Create a new customer         | Yes      |
| `update_customer` | Update an existing customer   | Yes      |
| `delete_customer` | Delete a customer             | Yes      |

#### list_customers

| Parameter   | Type   | Required | Description                              |
| ----------- | ------ | -------- | ---------------------------------------- |
| `search`    | string | No       | Search by company name or notes          |
| `stage`     | string | No       | Filter by lifecycle stage                |
| `ownerId`   | string | No       | Filter by owner (user sub)               |
| `territory` | string | No       | Filter by territory                      |
| `industry`  | string | No       | Filter by industry                       |
| `flags`     | string | No       | Filter by flags (comma-separated)        |
| `limit`     | string | No       | Pagination limit                         |
| `cursor`    | string | No       | Pagination cursor from previous response |

#### create_customer

| Parameter           | Type   | Required | Description                                                 |
| ------------------- | ------ | -------- | ----------------------------------------------------------- |
| `companyName`       | string | Yes      | Company name                                                |
| `industry`          | string | No       | Industry sector                                             |
| `lifecycleStage`    | string | No       | Lifecycle stage ID (e.g., "stage-prospect") from CRM config |
| `ownerId`           | string | No       | Owner user sub                                              |
| `ownerName`         | string | No       | Owner display name                                          |
| `companySize`       | string | No       | Company size                                                |
| `website`           | string | No       | Company website                                             |
| `territory`         | string | No       | Territory                                                   |
| `flags`             | array  | No       | Flag IDs                                                    |
| `source`            | string | No       | Lead source                                                 |
| `contractStartDate` | string | No       | Contract start (ISO 8601)                                   |
| `contractTerm`      | string | No       | Contract term                                               |
| `renewalDate`       | string | No       | Renewal date (ISO 8601)                                     |
| `contractValue`     | number | No       | Contract value                                              |
| `products`          | array  | No       | Product list                                                |
| `productNotes`      | string | No       | Product notes                                               |
| `notes`             | string | No       | General notes                                               |
| `contacts`          | array  | No       | Contact objects                                             |

#### update_customer

| Parameter                        | Type   | Required | Description      |
| -------------------------------- | ------ | -------- | ---------------- |
| `customerId`                     | string | Yes      | Customer ID      |
| (same fields as create_customer) |        | No       | Fields to update |

#### Customer Activities

Activities are structured interaction logs (calls, emails, meetings, notes) on a customer record. Activities are returned inline when calling `get_customer` -- no separate list operation needed.

| Operation                  | Description                          | Approval |
| -------------------------- | ------------------------------------ | -------- |
| `create_customer_activity` | Log an activity on a customer record | Yes      |
| `update_customer_activity` | Update an existing activity          | Yes      |
| `delete_customer_activity` | Delete an activity                   | Yes      |

##### create_customer_activity

| Parameter        | Type   | Required | Description                                               |
| ---------------- | ------ | -------- | --------------------------------------------------------- |
| `customerId`     | string | Yes      | Customer ID                                               |
| `type`           | string | Yes      | Activity type: `call`, `email`, `meeting`, `note`, `task` |
| `summary`        | string | Yes      | Description of the activity                               |
| `date`           | string | No       | ISO 8601 date (defaults to now)                           |
| `direction`      | string | No       | `inbound` or `outbound` (for calls/emails)                |
| `duration`       | number | No       | Duration in minutes                                       |
| `outcome`        | string | No       | Outcome or result of the activity                         |
| `nextActionDate` | string | No       | ISO 8601 date for follow-up                               |
| `nextActionType` | string | No       | Type of follow-up action                                  |

Creating an activity also updates `lastContactDate` on the customer record.

##### update_customer_activity

| Parameter                                 | Type   | Required | Description      |
| ----------------------------------------- | ------ | -------- | ---------------- |
| `customerId`                              | string | Yes      | Customer ID      |
| `activityId`                              | string | Yes      | Activity ID      |
| (same fields as create_customer_activity) |        | No       | Fields to update |

##### delete_customer_activity

| Parameter    | Type   | Required | Description |
| ------------ | ------ | -------- | ----------- |
| `customerId` | string | Yes      | Customer ID |
| `activityId` | string | Yes      | Activity ID |

---

### Suppliers

| Operation         | Description                   | Approval |
| ----------------- | ----------------------------- | -------- |
| `list_suppliers`  | List suppliers (with filters) | No       |
| `get_supplier`    | Get a single supplier by ID   | No       |
| `create_supplier` | Create a new supplier         | Yes      |
| `update_supplier` | Update an existing supplier   | Yes      |
| `delete_supplier` | Delete a supplier             | Yes      |

Supplier fields are similar to customer fields, with these differences:

- **Supplier-specific:** `annualSpend` (number), `paymentTerms` (string)
- **Customer-only (not on suppliers):** `contractStartDate`, `contractTerm`, `renewalDate`, `contractValue`, `products`, `productNotes`

#### Supplier Activities

Same as customer activities but scoped to suppliers. Activities are returned inline with `get_supplier`.

| Operation                  | Description                          | Approval |
| -------------------------- | ------------------------------------ | -------- |
| `create_supplier_activity` | Log an activity on a supplier record | Yes      |
| `update_supplier_activity` | Update an existing activity          | Yes      |
| `delete_supplier_activity` | Delete an activity                   | Yes      |

Parameters are identical to customer activity operations, but use `supplierId` instead of `customerId`.

---

### Uploads

| Operation           | Description                                                                | Approval |
| ------------------- | -------------------------------------------------------------------------- | -------- |
| `upload_attachment` | Upload a file from the workspace to a ticket as an attachment on a comment | Yes      |

The file at `workspaceFilePath` is PUT to S3 via a presigned URL, and a system comment is added to the ticket carrying the attachment record. The attachment shows up under the ticket's Attachments section in the UI and in `get_ticket` under `comments[].attachments`.

| Parameter           | Type   | Required | Description                                                                                                      |
| ------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `workspaceFilePath` | string | Yes      | Absolute workspace path (e.g. `/workdir/uploads/screenshot.png`). User-pasted files land in `/workdir/uploads/`. |
| `ticketId`          | string | Yes\*    | Ticket UUID (\* or provide `displayId` instead)                                                                  |
| `displayId`         | string | No       | Display ID (e.g. `BUG-064`) -- resolves automatically                                                            |
| `fileName`          | string | Yes      | Name to store the file as (typically the basename of `workspaceFilePath`).                                       |
| `contentType`       | string | Yes      | MIME type (e.g., `image/png`, `application/pdf`).                                                                |

---

### Metrics

| Operation     | Description                              | Approval |
| ------------- | ---------------------------------------- | -------- |
| `get_metrics` | Get ticket counts by status for board(s) | No       |

| Parameter  | Type   | Required | Description                                 |
| ---------- | ------ | -------- | ------------------------------------------- |
| `boardIds` | string | Yes      | Comma-separated board IDs                   |
| `boardId`  | string | Yes      | Single board ID (alternative to `boardIds`) |

---

## Approval Model

- **Safe operations** (auto-approved): All `list_*`, `get_*`, `search_*`, `get_config`, `list_projects`, `get_metrics`
- **Unsafe operations** (require user approval): All `create_*`, `update_*`, `delete_*`, `add_comment`, `upload_attachment`, activity operations

The user can configure their approval preference in chat settings:

- **Approve All** — all operations auto-approved
- **Approve Safe Only** (default) — reads auto-approve, writes need manual approval
- **Manual Approval** — everything requires manual approval

---

## Configuration Management (admin-only)

All operations in this section require the caller to be in the `admins` Cognito group. If the user is not an admin, the backend returns 403 — surface that cleanly and stop.

### Custom fields

Fields have two distinct uses depending on their `category`:

- Non-`crm` categories (`common`, `development`, `support`, `operations`, ...) — appear in ticket custom fields. Stored on `ticket.fields` as `{fieldId: value}`.
- `crm` category — available to place in the customer record layout. Stored on `customer.customFields` as `{fieldId: value}`.

**`create_field`**

| Parameter      | Type     | Required | Description                                                                                                                                                                                             |
| -------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | string   | Yes      | Field label shown in the UI                                                                                                                                                                             |
| `fieldType`    | string   | Yes      | One of: `text`, `textarea`, `number`, `currency`, `percentage`, `date`, `select`, `multi_select`, `boolean`, `url`, `email`, `phone`, `richtext`, `user`, `customer`, `supplier`, `project`, `workunit` |
| `category`     | string   | Yes      | `crm` for customer record fields; otherwise a ticket category like `common`, `development`, `support`, `operations`                                                                                     |
| `required`     | boolean  | No       | Whether the field is required globally                                                                                                                                                                  |
| `helpText`     | string   | No       | Hint shown to users when filling in                                                                                                                                                                     |
| `defaultValue` | any      | No       | Default value                                                                                                                                                                                           |
| `options`      | string[] | No       | Options for `select` / `multi_select` types                                                                                                                                                             |

Returns the created field with its `id` (e.g. `field-a1b2c3d4`). Store that id — you'll need it to reference the field from tickets (`fields: {<id>: value}`), customers (`customFields: {<id>: value}`), or the CRM layout (`customerRecord.sections[].fieldIds`).

**`update_field`** — same fields as `create_field` plus `fieldId`. All non-id fields are optional; only the provided keys change.

**`delete_field`** — `fieldId` (required). Refused with 409 if the field is still referenced by a CRM layout section or if it is a built-in system field. Remove from layout first via `update_crm_config`.

### Ticket types

**`create_ticket_type`**

| Parameter       | Type     | Required | Description                                                |
| --------------- | -------- | -------- | ---------------------------------------------------------- |
| `name`          | string   | Yes      | Display name (e.g. `Incident`)                             |
| `prefix`        | string   | Yes      | 2-6 uppercase alphanumeric characters used for display IDs |
| `color`         | string   | Yes      | Hex color                                                  |
| `icon`          | string   | No       | Bootstrap icon name (default `ticket`)                     |
| `defaultFields` | string[] | No       | Field IDs that appear on this ticket type by default       |

**`update_ticket_type`** — `ticketTypeId` (required) + optional `name`, `color`, `icon`, `defaultFields`. Prefix is immutable.

**`delete_ticket_type`** — `ticketTypeId` only.

### CRM configuration

The CRM config is a single document that the backend **shallow-merges** on PUT. Only send the top-level keys you want to change. Sub-objects (like `customerRecord`) are replaced whole, so if you're adding a field to one section, first `get_config`, modify the sections array, then pass the complete `customerRecord` back.

**`update_crm_config`**

| Parameter         | Type                                                                       | Required | Description                                                                           |
| ----------------- | -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `lifecycleStages` | `[{id, name, colorPosition?}]`                                             | No       | Full replacement list of customer lifecycle stages                                    |
| `customerFlags`   | `[{id, name, color, icon?}]`                                               | No       | Full replacement list of customer flags                                               |
| `documentTypes`   | `[{id, name}]`                                                             | No       | Full replacement list of document types                                               |
| `territories`     | `string[]`                                                                 | No       | Full replacement list of territory names                                              |
| `industries`      | `string[]`                                                                 | No       | Full replacement list of industry names                                               |
| `defaultStage`    | string                                                                     | No       | ID of the default lifecycle stage for new customers                                   |
| `customerRecord`  | `{sections: [{id, name, fieldIds, requiredFieldIds?}]}`                    | No       | Customer record layout — controls which fields appear in what order on customer cards |
| `layout`          | `{columnsPerSection?, density?, defaultSectionsExpanded?, labelPosition?}` | No       | Visual layout controls                                                                |

**`update_supplier_config`** — parallel to the above but for suppliers. Accepts `lifecycleStages`, `supplierFlags`, `documentTypes`, `defaultStage`.

### Workflow: add a new CRM field and place it on the customer record

```
# 1. Load config — capture current customerRecord.sections and field ids.
Bash("numa ops get_config --params '{}' --json -m 'Load config'")
# → note crmConfig.customerRecord.sections + existing fields

# 2. Create the new CRM field (category must be "crm").
Bash("numa ops create_field --params '{\"name\":\"Renewal Likelihood\",\"fieldType\":\"select\",\"category\":\"crm\",\"options\":[\"High\",\"Medium\",\"Low\"]}' --json -m 'Create Renewal Likelihood field'")
# → returns { id: "field-7f8a9b", ... }

# 3. Add the new field id to the desired section of customerRecord.
#    Send the FULL customerRecord (all sections) back — it's replaced whole.
Bash("numa ops update_crm_config --params '{\"customerRecord\":{\"sections\":[{\"id\":\"section-company-details\",\"name\":\"Company Details\",\"fieldIds\":[\"...original ids...\"]},{\"id\":\"section-contract\",\"name\":\"Contract\",\"fieldIds\":[\"...original ids...\",\"field-7f8a9b\"],\"requiredFieldIds\":[\"field-7f8a9b\"]}]}}' --json -m 'Add Renewal Likelihood to Contract section'")
```

### Custom fields on customer/supplier records

`create_customer` and `update_customer` accept a `customFields` parameter: `{fieldId: value}` keyed by CRM field ids. Same for `create_supplier` / `update_supplier`.

**Note:** Tickets use `fields` (no underscore suffix); customers and suppliers use `customFields` which maps to `customFields` on the persisted record. Don't confuse the two.

```
Bash("numa ops create_customer --params '{\"companyName\":\"Acme Corp\",\"lifecycleStage\":\"stage-prospect\",\"customFields\":{\"field-7f8a9b\":\"High\",\"field-deal-value\":50000}}' --json -m 'Create Acme Corp customer'")
```

---

## Workflow Examples

### Create a ticket (preferred -- names only)

```
# One call. The bridge resolves boardName, stageName, ticketTypeName, and
# assigneeName to IDs automatically.
Bash("numa ops create_ticket --params '{\"boardName\":\"Engineering\",\"stageName\":\"Triage\",\"title\":\"Fix login bug\",\"ticketTypeName\":\"Bug\",\"priority\":\"high\",\"assigneeName\":\"Tom Wiltshire\",\"description\":\"<p>Users report <strong>500 errors</strong> on the login page.</p><ul><li>Affects all browsers</li><li>Started after last deploy</li></ul>\"}' --json -m 'Create ticket: Fix login bug (high priority) in Engineering board, assigned to Tom Wiltshire'")
```

### Search and update

```
# Search for tickets by board name
Bash("numa ops search_tickets --params '{\"query\":\"login bug\",\"boardName\":\"Engineering\"}' --json -m 'Search for login bug tickets in Engineering board'")

# Move ticket to a different stage by name
Bash("numa ops update_ticket --params '{\"displayId\":\"BUG-081\",\"stageName\":\"In Progress\"}' --json -m 'Move BUG-081 to In Progress stage'")
```

### Move a customer through their lifecycle

```
Bash("numa ops update_customer --params '{\"customerName\":\"Acme Corp\",\"lifecycleStageName\":\"At Risk\"}' --json -m 'Move Acme Corp to At Risk lifecycle stage'")
```

### Bulk reassign by name

```
Bash("numa ops bulk_update_tickets --params '{\"ticketIds\":[\"t-1\",\"t-2\",\"t-3\"],\"changes\":{\"boardName\":\"Engineering\",\"assigneeName\":\"Tom Wiltshire\"}}' --json -m 'Reassign 3 tickets to Tom Wiltshire'")
```

---

## Best Practices

1. **Use names, not IDs.** Pass `boardName`, `stageName`, `assigneeName`, `customerName`, `lifecycleStageName`, etc. The bridge resolves them to IDs. Skip the lookup dance unless you need to show data to the user.
2. **Never invent IDs.** If you don't know an ID, pass the name -- the bridge resolves it. Don't pattern-match IDs from prior tool results into a guess.
3. **Trust the structured errors.** When a name doesn't match or matches multiple entities, the bridge returns the available options. Pass that back to the user; don't guess.
4. **Link tickets using ticketUrl** -- ticket responses include a `ticketUrl` field (e.g. `https://acme.numa.arcanum.ai/ops?ticket=ENG-42`). Always include this link when referencing tickets so users can click through.
5. **Include full content in approval descriptions** -- for write operations, describe exactly what will be created/changed.
6. **Respect board scoping** -- users can only see boards they have access to.
7. **Use search before creating** -- check if a similar ticket already exists.
8. **Use HTML for rich text** -- ticket descriptions and comments render HTML, not markdown. Use `<p>`, `<strong>`, `<em>`, `<ul><li>`, `<ol><li>`, `<a href="...">`, `<h3>`, etc. Plain text is also fine but will not be formatted. Do NOT use markdown syntax (e.g. `**bold**`, `- list`) as it will render as literal text.
9. **Board owner operations** -- `update_board`, `update_zones`, `update_stages` require board owner or admin access.
