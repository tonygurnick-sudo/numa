---
name: ops
description: Manage Numa Ops boards — create and search tickets, manage teams (called "boards" in the UI), customers, suppliers, and projects. Supports full CRUD operations with user-scoped access control.
---

# Numa Ops Skill

Manage work items on the Numa Ops kanban boards. Create tickets, search and filter, manage teams, track customers and suppliers, and more.

> **Naming note:** The UI calls them "Boards" but the API uses "teams" / `team_id`. When talking to users, say "board". When calling the API, use `team_id`.

## Available MCP Tool

| Tool                       | Purpose                                                                       | Approval            |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| `mcp__numa__numa_ops_tool` | Perform any Numa Ops operation (tickets, teams, customers, suppliers, config) | Required for writes |

---

## How It Works

The `numa_ops_tool` accepts an `operation` string and a `params` JSON string. The operation determines what action is taken and which parameters are required.

```
mcp__numa__numa_ops_tool(
    operation="list_tickets",
    params='{"team_id": "team-abc123"}',
    description="List all tickets for the Engineering board"
)
```

---

## Operations Reference

### Configuration

| Operation        | Description                                                      | Approval |
| ---------------- | ---------------------------------------------------------------- | -------- |
| `get_config`     | Load all config: ticket types, statuses, fields, staff, projects | No       |
| `list_projects`  | List all projects                                                | No       |
| `create_project` | Create a new project                                             | Yes      |
| `update_project` | Update an existing project                                       | Yes      |
| `delete_project` | Delete a project (admin-only)                                    | Yes      |

#### get_config

Returns ticket types, statuses, custom fields, staff members, projects, CRM config, and supplier config in a single call. **Always call this first** to understand the board structure before creating or updating tickets.

```
mcp__numa__numa_ops_tool(
    operation="get_config",
    params='{}',
    description="Load Numa Ops configuration"
)
```

#### create_project

| Parameter     | Type   | Required | Description                                |
| ------------- | ------ | -------- | ------------------------------------------ |
| `name`        | string | Yes      | Project name                               |
| `description` | string | No       | Project description                        |
| `color`       | string | No       | Hex color code                             |
| `status`      | string | No       | Status: active, planned, on_hold, complete |
| `owner_id`    | string | No       | Owner user sub (from get_config staff)     |
| `owner_name`  | string | No       | Owner display name                         |

#### update_project

| Parameter     | Type    | Required | Description                                |
| ------------- | ------- | -------- | ------------------------------------------ |
| `project_id`  | string  | Yes      | Project ID                                 |
| `name`        | string  | No       | New project name                           |
| `description` | string  | No       | New description                            |
| `color`       | string  | No       | New color                                  |
| `is_active`   | boolean | No       | Set false to deactivate, true to restore   |
| `status`      | string  | No       | Status: active, planned, on_hold, complete |
| `owner_id`    | string  | No       | Owner user sub                             |
| `owner_name`  | string  | No       | Owner display name                         |

#### delete_project

Admin-only operation. Permanently deletes a project.

| Parameter    | Type   | Required | Description |
| ------------ | ------ | -------- | ----------- |
| `project_id` | string | Yes      | Project ID  |

---

### Teams (Boards)

| Operation       | Description                                   | Approval |
| --------------- | --------------------------------------------- | -------- |
| `list_teams`    | List all boards the user can access           | No       |
| `get_team`      | Get a single board by ID                      | No       |
| `create_team`   | Create a new board                            | Yes      |
| `update_team`   | Update an existing board (owner-only)         | Yes      |
| `update_zones`  | Update zones on a board (owner-only)          | Yes      |
| `update_stages` | Update stages/columns on a board (owner-only) | Yes      |

#### list_teams

No parameters required. Returns all boards accessible to the current user.

#### get_team

Returns the board with its zones and stages. Use this to get valid `stage_id` values for ticket creation.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `team_id` | string | Yes      | Board ID    |

#### create_team

| Parameter              | Type   | Required | Description                                                                                          |
| ---------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `name`                 | string | Yes      | Board name                                                                                           |
| `description`          | string | No       | Board description                                                                                    |
| `color`                | string | No       | Hex color code                                                                                       |
| `preset`               | string | No       | Board preset (e.g., "standard")                                                                      |
| `ticket_type_id`       | string | No       | Default ticket type ID                                                                               |
| `allowed_ticket_types` | array  | No       | List of allowed ticket type IDs                                                                      |
| `field_overrides`      | object | No       | Custom field overrides per board `{fieldId: {required: true, hidden: false}}`                        |
| `added_fields`         | object | No       | Additional fields per ticket type `{ticketTypeId: [fieldId, ...]}`                                   |
| `access_control`       | object | No       | `{"mode": "all"\|"specific", "users": ["sub1", "sub2"], "owners": ["sub3"]}` -- owners are co-owners |
| `announcement`         | string | No       | Board announcement text (shown at top of board)                                                      |
| `zones`                | array  | No       | Custom zone definitions                                                                              |

#### update_team

Only board owners (creator or co-owners) and admins can update team settings.

| Parameter              | Type   | Required | Description                                                                        |
| ---------------------- | ------ | -------- | ---------------------------------------------------------------------------------- |
| `team_id`              | string | Yes      | Board ID                                                                           |
| `name`                 | string | No       | New board name                                                                     |
| `description`          | string | No       | New description                                                                    |
| `color`                | string | No       | New color                                                                          |
| `allowed_ticket_types` | array  | No       | List of allowed ticket type IDs                                                    |
| `field_overrides`      | object | No       | Custom field overrides `{fieldId: {required, hidden}}`                             |
| `added_fields`         | object | No       | Additional fields per ticket type `{ticketTypeId: [fieldId, ...]}`                 |
| `access_control`       | object | No       | `{"mode": "all"\|"specific", "users": [...], "owners": [...]}` -- manage ownership |
| `work_unit_series`     | object | No       | Work unit (sprint) configuration                                                   |
| `announcement`         | string | No       | Board announcement text                                                            |

#### update_zones

Update zones on a board. Only board owners and admins can modify zones.

| Parameter | Type   | Required | Description                                                                             |
| --------- | ------ | -------- | --------------------------------------------------------------------------------------- |
| `team_id` | string | Yes      | Board ID                                                                                |
| `zones`   | array  | Yes      | Array of zone objects: `[{"id": "...", "name": "...", "zoneType": "board"\|"backlog"}]` |

#### update_stages

Update stages (kanban columns) on a board. Only board owners and admins can modify stages.

| Parameter | Type   | Required | Description                                                                                       |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------------- |
| `team_id` | string | Yes      | Board ID                                                                                          |
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

| Parameter          | Type   | Required | Description                                                      |
| ------------------ | ------ | -------- | ---------------------------------------------------------------- |
| `team_id`          | string | Yes      | Board ID to list tickets for                                     |
| `stage_id`         | string | No       | Filter by stage ID                                               |
| `status_type`      | string | No       | Filter by status type (backlog, queued, active, completed, etc.) |
| `assignee_id`      | string | No       | Filter by assignee (user sub)                                    |
| `customer_id`      | string | No       | Filter by linked customer                                        |
| `work_unit_id`     | string | No       | Filter by sprint/work unit                                       |
| `project_id`       | string | No       | Filter by project                                                |
| `priority`         | string | No       | Filter by priority (lowest, low, medium, high, highest)          |
| `include_archived` | string | No       | Set to "true" to include archived tickets                        |
| `limit`            | string | No       | Pagination limit                                                 |
| `cursor`           | string | No       | Pagination cursor from previous response                         |

#### get_ticket

| Parameter    | Type   | Required    | Description                                               |
| ------------ | ------ | ----------- | --------------------------------------------------------- |
| `ticket_id`  | string | Conditional | Internal ticket ID (use one of ticket_id or display_id)   |
| `team_id`    | string | Conditional | Required when using ticket_id (not needed for display_id) |
| `display_id` | string | Conditional | Human-readable display ID like "ENG-42"                   |

#### search_tickets

| Parameter | Type   | Required | Description                              |
| --------- | ------ | -------- | ---------------------------------------- |
| `query`   | string | Yes      | Search text (matches title, description) |
| `team_id` | string | No       | Limit search to a specific board         |

#### create_ticket

**IMPORTANT:** Call `get_config` first to get valid ticket types and staff. Call `get_team` to get valid stage IDs for the board.

| Parameter         | Type   | Required | Description                                                                     |
| ----------------- | ------ | -------- | ------------------------------------------------------------------------------- |
| `team_id`         | string | Yes      | Board to create the ticket in                                                   |
| `stage_id`        | string | Yes      | Stage ID (from get_team response zones/stages)                                  |
| `title`           | string | Yes      | Ticket title                                                                    |
| `ticket_type_id`  | string | No       | Ticket type ID (from get_config ticketTypes)                                    |
| `description`     | string | No       | Ticket description (use HTML for rich text, e.g. `<p>`, `<strong>`, `<ul><li>`) |
| `priority`        | string | No       | Priority: lowest, low, medium, high, highest                                    |
| `assignee_id`     | string | No       | Assignee user sub (from get_config staff)                                       |
| `assignee_name`   | string | No       | Assignee display name                                                           |
| `reporter_id`     | string | No       | Reporter user sub (defaults to current user)                                    |
| `reporter_name`   | string | No       | Reporter display name                                                           |
| `due_date`        | string | No       | Due date in ISO 8601 format                                                     |
| `customer_id`     | string | No       | Link to a customer                                                              |
| `customer_name`   | string | No       | Customer display name                                                           |
| `supplier_id`     | string | No       | Link to a supplier                                                              |
| `supplier_name`   | string | No       | Supplier display name                                                           |
| `work_unit_id`    | string | No       | Link to a sprint/work unit                                                      |
| `project_id`      | string | No       | Link to a project                                                               |
| `tags`            | array  | No       | List of tag strings                                                             |
| `fields`          | object | No       | Custom field values (field_id → value)                                          |
| `effort_points`   | number | No       | Effort/story points                                                             |
| `source_type`     | string | No       | Origin of ticket: app, chat, agent, manual                                      |
| `source_id`       | string | No       | Source record ID (e.g., conversation ID, app run ID)                            |
| `source_app_type` | string | No       | Source application type identifier                                              |

#### update_ticket

| Parameter         | Type    | Required | Description                                        |
| ----------------- | ------- | -------- | -------------------------------------------------- |
| `ticket_id`       | string  | Yes      | Ticket ID to update                                |
| `team_id`         | string  | Yes      | Board the ticket belongs to                        |
| `current_team_id` | string  | No       | Current board (for cross-board moves)              |
| `title`           | string  | No       | New title                                          |
| `description`     | string  | No       | New description                                    |
| `stage_id`        | string  | No       | Move to different stage (auto-updates status type) |
| `zone_id`         | string  | No       | Move to different zone                             |
| `priority`        | string  | No       | New priority                                       |
| `assignee_id`     | string  | No       | New assignee                                       |
| `assignee_name`   | string  | No       | Assignee display name                              |
| `due_date`        | string  | No       | New due date                                       |
| `customer_id`     | string  | No       | Link to customer                                   |
| `supplier_id`     | string  | No       | Link to supplier                                   |
| `work_unit_id`    | string  | No       | Link to sprint/work unit                           |
| `project_id`      | string  | No       | Link to project                                    |
| `tags`            | array   | No       | Updated tags                                       |
| `fields`          | object  | No       | Updated custom field values                        |
| `effort_points`   | number  | No       | Updated effort points                              |
| `order`           | number  | No       | Position order within stage                        |
| `version`         | number  | No       | Optimistic locking (prevents concurrent edits)     |
| `archived`        | boolean | No       | Set true to archive, false to unarchive            |

#### delete_ticket

| Parameter   | Type   | Required | Description                 |
| ----------- | ------ | -------- | --------------------------- |
| `ticket_id` | string | Yes      | Ticket ID to delete         |
| `team_id`   | string | Yes      | Board the ticket belongs to |

#### bulk_update_tickets

Update multiple tickets at once (e.g., move all to a new stage, reassign).

| Parameter    | Type   | Required | Description                                                                                                           |
| ------------ | ------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `ticket_ids` | array  | Yes      | Array of ticket IDs to update                                                                                         |
| `changes`    | object | Yes      | Fields to apply to all tickets. Must include `team_id`. Supports: `stage_id`, `assignee_id`, `priority`, `tags`, etc. |

#### add_comment

| Parameter   | Type   | Required | Description                                                               |
| ----------- | ------ | -------- | ------------------------------------------------------------------------- |
| `ticket_id` | string | Yes      | Ticket to comment on                                                      |
| `content`   | string | Yes      | Comment text (use HTML for rich text, e.g. `<p>`, `<strong>`, `<ul><li>`) |
| `team_id`   | string | No       | Board ID (helps with comment count update)                                |

#### list_comments

| Parameter   | Type   | Required | Description                 |
| ----------- | ------ | -------- | --------------------------- |
| `ticket_id` | string | Yes      | Ticket to list comments for |

#### get_audit

Get the audit trail (change history) for a ticket. Returns entries in reverse chronological order.

| Parameter   | Type   | Required | Description             |
| ----------- | ------ | -------- | ----------------------- |
| `ticket_id` | string | Yes      | Ticket to get audit for |

---

### Work Units (Sprints)

| Operation          | Description                        | Approval |
| ------------------ | ---------------------------------- | -------- |
| `list_work_units`  | List sprints for a board           | No       |
| `create_work_unit` | Create a new sprint                | Yes      |
| `update_work_unit` | Update an existing sprint          | Yes      |
| `delete_work_unit` | Delete a sprint (admin/owner only) | Yes      |

#### list_work_units

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `team_id` | string | Yes      | Board ID    |

#### create_work_unit

| Parameter    | Type   | Required | Description                         |
| ------------ | ------ | -------- | ----------------------------------- |
| `team_id`    | string | Yes      | Board ID                            |
| `name`       | string | Yes      | Sprint name                         |
| `goal`       | string | No       | Sprint goal/objective               |
| `start_date` | string | No       | Start date (ISO 8601)               |
| `end_date`   | string | No       | End date (ISO 8601)                 |
| `status`     | string | No       | Status: planning, active, completed |
| `capacity`   | number | No       | Sprint capacity (story points)      |

#### update_work_unit

| Parameter      | Type   | Required | Description    |
| -------------- | ------ | -------- | -------------- |
| `team_id`      | string | Yes      | Board ID       |
| `work_unit_id` | string | Yes      | Work unit ID   |
| `name`         | string | No       | New name       |
| `goal`         | string | No       | New goal       |
| `start_date`   | string | No       | New start date |
| `end_date`     | string | No       | New end date   |
| `status`       | string | No       | New status     |
| `capacity`     | number | No       | New capacity   |

#### delete_work_unit

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `team_id`      | string | Yes      | Board ID     |
| `work_unit_id` | string | Yes      | Work unit ID |

---

### Ticket Links

| Operation     | Description                           | Approval |
| ------------- | ------------------------------------- | -------- |
| `create_link` | Create a dependency/relationship link | Yes      |
| `delete_link` | Remove a link between two tickets     | Yes      |

#### create_link

| Parameter                  | Type   | Required | Description                                      |
| -------------------------- | ------ | -------- | ------------------------------------------------ |
| `ticket_id`                | string | Yes      | Source ticket ID                                 |
| `linked_ticket_id`         | string | Yes      | Target ticket ID                                 |
| `linked_ticket_display_id` | string | Yes      | Target ticket display ID (e.g., "ENG-42")        |
| `linked_ticket_title`      | string | No       | Target ticket title                              |
| `link_type`                | string | Yes      | Link type: depends_on, blocks, related_to        |
| `team_id`                  | string | No       | Source ticket's board ID                         |
| `linked_team_id`           | string | No       | Target ticket's board ID (for cross-board links) |

#### delete_link

| Parameter          | Type   | Required | Description      |
| ------------------ | ------ | -------- | ---------------- |
| `ticket_id`        | string | Yes      | Source ticket ID |
| `link_type`        | string | Yes      | Link type        |
| `linked_ticket_id` | string | Yes      | Target ticket ID |

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
| `owner_id`  | string | No       | Filter by owner (user sub)               |
| `territory` | string | No       | Filter by territory                      |
| `industry`  | string | No       | Filter by industry                       |
| `flags`     | string | No       | Filter by flags (comma-separated)        |
| `limit`     | string | No       | Pagination limit                         |
| `cursor`    | string | No       | Pagination cursor from previous response |

#### create_customer

| Parameter             | Type   | Required | Description                                                 |
| --------------------- | ------ | -------- | ----------------------------------------------------------- |
| `company_name`        | string | Yes      | Company name                                                |
| `industry`            | string | No       | Industry sector                                             |
| `lifecycle_stage`     | string | No       | Lifecycle stage ID (e.g., "stage-prospect") from CRM config |
| `owner_id`            | string | No       | Owner user sub                                              |
| `owner_name`          | string | No       | Owner display name                                          |
| `company_size`        | string | No       | Company size                                                |
| `website`             | string | No       | Company website                                             |
| `territory`           | string | No       | Territory                                                   |
| `flags`               | array  | No       | Flag IDs                                                    |
| `source`              | string | No       | Lead source                                                 |
| `contract_start_date` | string | No       | Contract start (ISO 8601)                                   |
| `contract_term`       | string | No       | Contract term                                               |
| `renewal_date`        | string | No       | Renewal date (ISO 8601)                                     |
| `contract_value`      | number | No       | Contract value                                              |
| `products`            | array  | No       | Product list                                                |
| `product_notes`       | string | No       | Product notes                                               |
| `notes`               | string | No       | General notes                                               |
| `contacts`            | array  | No       | Contact objects                                             |

#### update_customer

| Parameter                        | Type   | Required | Description      |
| -------------------------------- | ------ | -------- | ---------------- |
| `customer_id`                    | string | Yes      | Customer ID      |
| (same fields as create_customer) |        | No       | Fields to update |

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

- **Supplier-specific:** `annual_spend` (number), `payment_terms` (string)
- **Customer-only (not on suppliers):** `contract_start_date`, `contract_term`, `renewal_date`, `contract_value`, `products`, `product_notes`

---

### Uploads

| Operation           | Description                                                 | Approval |
| ------------------- | ----------------------------------------------------------- | -------- |
| `upload_attachment` | Get a presigned URL to upload a file attachment to a ticket | Yes      |

| Parameter             | Type   | Required | Description                                                         |
| --------------------- | ------ | -------- | ------------------------------------------------------------------- |
| `file_name`           | string | Yes      | Name of the file to upload                                          |
| `content_type`        | string | Yes      | MIME type (e.g., "application/pdf")                                 |
| `ticket_id`           | string | No       | Associate with a specific ticket                                    |
| `workspace_file_path` | string | No       | Pass absolute workspace path (e.g., `/workdir/foo`) to auto-upload. |

---

### Metrics

| Operation     | Description                              | Approval |
| ------------- | ---------------------------------------- | -------- |
| `get_metrics` | Get ticket counts by status for board(s) | No       |

| Parameter  | Type   | Required | Description                                 |
| ---------- | ------ | -------- | ------------------------------------------- |
| `team_ids` | string | Yes      | Comma-separated board IDs                   |
| `team_id`  | string | Yes      | Single board ID (alternative to `team_ids`) |

---

## Approval Model

- **Safe operations** (auto-approved): All `list_*`, `get_*`, `search_*`, `get_config`, `list_projects`, `get_metrics`
- **Unsafe operations** (require user approval): All `create_*`, `update_*`, `delete_*`, `add_comment`, `upload_attachment`

The user can configure their approval preference in chat settings:

- **Approve All** — all operations auto-approved
- **Approve Safe Only** (default) — reads auto-approve, writes need manual approval
- **Manual Approval** — everything requires manual approval

---

## Workflow Examples

### Create a ticket

```
# 1. Load config to get ticket types, statuses, staff
mcp__numa__numa_ops_tool(operation="get_config", params='{}', description="Load ops config")

# 2. List boards to find the right one
mcp__numa__numa_ops_tool(operation="list_teams", params='{}', description="List all boards")

# 3. Get the board to find valid stage IDs
mcp__numa__numa_ops_tool(operation="get_team", params='{"team_id":"team-abc"}', description="Get board details with stages")

# 4. Create the ticket with a valid stage_id
mcp__numa__numa_ops_tool(
    operation="create_ticket",
    params='{"team_id":"team-abc","stage_id":"stage-xyz","title":"Fix login bug","ticket_type_id":"tt-bug123","priority":"high","description":"<p>Users report <strong>500 errors</strong> on the login page.</p><ul><li>Affects all browsers</li><li>Started after last deploy</li></ul>"}',
    description="Create ticket: Fix login bug (high priority) in Engineering board"
)
```

### Search and update

```
# Search for tickets
mcp__numa__numa_ops_tool(
    operation="search_tickets",
    params='{"query":"login bug","team_id":"team-abc"}',
    description="Search for login bug tickets"
)

# Move ticket to a different stage
mcp__numa__numa_ops_tool(
    operation="update_ticket",
    params='{"ticket_id":"ticket-xyz","team_id":"team-abc","stage_id":"stage-inprogress"}',
    description="Move ticket to In Progress stage"
)
```

---

## Best Practices

1. **Always call `get_config` first** — you need ticket types, statuses, and staff IDs before creating tickets
2. **Call `get_team` to get stage IDs** — `stage_id` is required for ticket creation; stages are returned in the board's zones
3. **Use display IDs when referencing tickets to users** — e.g., "ENG-42" is friendlier than "ticket-abc123"
4. **Include full content in approval descriptions** — for write operations, describe exactly what will be created/changed
5. **Respect team scoping** — users can only see boards they have access to
6. **Use search before creating** — check if a similar ticket already exists
7. **Use HTML for rich text** — ticket descriptions and comments render HTML, not markdown. Use `<p>`, `<strong>`, `<em>`, `<ul><li>`, `<ol><li>`, `<a href="...">`, `<h3>`, etc. Plain text is also fine but will not be formatted. Do NOT use markdown syntax (e.g., `**bold**`, `- list`) as it will render as literal text
8. **Board owner operations** — `update_team`, `update_zones`, `update_stages` require board owner or admin access. Use `get_team` to check the current user's permissions
