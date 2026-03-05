---
name: ops
description: Manage Numa Ops boards — create and search tickets, manage teams, customers, suppliers, and projects. Supports full CRUD operations with user-scoped access control.
---

# Numa Ops Skill

Manage work items on the Numa Ops kanban boards. Create tickets, search and filter, manage teams, track customers and suppliers, and more.

## Available MCP Tool

| Tool | Purpose | Approval |
|------|---------|----------|
| `mcp__numa_ops__numa_ops_tool` | Perform any Numa Ops operation (tickets, teams, customers, suppliers, config) | Required for writes |

---

## How It Works

The `numa_ops_tool` accepts an `operation` string and a `params` JSON string. The operation determines what action is taken and which parameters are required.

```
mcp__numa_ops__numa_ops_tool(
    operation="list_tickets",
    params='{"team_id": "team-abc123"}',
    description="List all tickets for the Engineering team"
)
```

---

## Operations Reference

### Configuration

| Operation | Description | Approval |
|-----------|-------------|----------|
| `get_config` | Load all config: ticket types, statuses, fields, staff, projects | No |
| `list_projects` | List all projects | No |
| `create_project` | Create a new project | Yes |
| `update_project` | Update an existing project | Yes |

#### get_config

Returns ticket types, statuses, custom fields, staff members, projects, CRM config, and supplier config in a single call. **Always call this first** to understand the board structure before creating or updating tickets.

```
mcp__numa_ops__numa_ops_tool(
    operation="get_config",
    params='{}',
    description="Load Numa Ops configuration"
)
```

#### create_project

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Project name |
| `description` | string | No | Project description |
| `color` | string | No | Hex color code |

---

### Teams

| Operation | Description | Approval |
|-----------|-------------|----------|
| `list_teams` | List all teams the user can access | No |
| `get_team` | Get a single team by ID | No |
| `create_team` | Create a new team | Yes |
| `update_team` | Update an existing team | Yes |

#### list_teams

No parameters required. Returns all teams accessible to the current user.

#### get_team

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `team_id` | string | Yes | Team ID |

#### create_team

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Team name |
| `description` | string | No | Team description |

#### update_team

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `team_id` | string | Yes | Team ID |
| `name` | string | No | New team name |
| `description` | string | No | New description |

---

### Tickets

| Operation | Description | Approval |
|-----------|-------------|----------|
| `list_tickets` | List tickets for a team (with optional filters) | No |
| `get_ticket` | Get a single ticket by ID or display ID | No |
| `search_tickets` | Search tickets by text query | No |
| `create_ticket` | Create a new ticket | Yes |
| `update_ticket` | Update an existing ticket | Yes |
| `delete_ticket` | Delete a ticket | Yes |
| `add_comment` | Add a comment to a ticket | Yes |
| `list_comments` | List comments on a ticket | No |

#### list_tickets

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `team_id` | string | Yes | Team ID to list tickets for |
| `status` | string | No | Filter by status |
| `assignee` | string | No | Filter by assignee (user sub) |
| `priority` | string | No | Filter by priority (low, medium, high, critical) |
| `zone` | string | No | Filter by zone (backlog, active, done, archive) |

#### get_ticket

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ticket_id` | string | Conditional | Internal ticket ID (use one of ticket_id or display_id) |
| `display_id` | string | Conditional | Human-readable display ID like "ENG-42" |

#### search_tickets

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search text (matches title, description) |
| `team_id` | string | No | Limit search to a specific team |

#### create_ticket

**IMPORTANT:** Call `get_config` first to get valid ticket types, statuses, and staff for assignment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `team_id` | string | Yes | Team to create the ticket in |
| `title` | string | Yes | Ticket title |
| `ticket_type_id` | string | Yes | Ticket type ID (from get_config ticketTypes) |
| `description` | string | No | Ticket description (supports markdown) |
| `status_id` | string | No | Initial status ID (defaults to first status) |
| `priority` | string | No | Priority: low, medium, high, critical |
| `assignee_id` | string | No | Assignee user sub (from get_config staff) |
| `due_date` | string | No | Due date in ISO 8601 format |
| `project_id` | string | No | Link to a project |
| `customer_id` | string | No | Link to a customer |
| `supplier_id` | string | No | Link to a supplier |
| `custom_fields` | object | No | Custom field values (field_id → value) |

#### update_ticket

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ticket_id` | string | Yes | Ticket ID to update |
| `team_id` | string | Yes | Team the ticket belongs to |
| `title` | string | No | New title |
| `description` | string | No | New description |
| `status_id` | string | No | New status ID |
| `priority` | string | No | New priority |
| `assignee_id` | string | No | New assignee |
| `due_date` | string | No | New due date |
| `project_id` | string | No | Link to project |
| `customer_id` | string | No | Link to customer |
| `supplier_id` | string | No | Link to supplier |
| `custom_fields` | object | No | Updated custom field values |

#### delete_ticket

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ticket_id` | string | Yes | Ticket ID to delete |
| `team_id` | string | Yes | Team the ticket belongs to |

#### add_comment

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ticket_id` | string | Yes | Ticket to comment on |
| `content` | string | Yes | Comment text (supports markdown) |
| `team_id` | string | No | Team ID (helps with comment count update) |

#### list_comments

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ticket_id` | string | Yes | Ticket to list comments for |

---

### Customers

| Operation | Description | Approval |
|-----------|-------------|----------|
| `list_customers` | List all customers | No |
| `get_customer` | Get a single customer by ID | No |
| `create_customer` | Create a new customer | Yes |
| `update_customer` | Update an existing customer | Yes |
| `delete_customer` | Delete a customer | Yes |

#### create_customer

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `company_name` | string | Yes | Company name |
| `contact_name` | string | No | Primary contact name |
| `contact_email` | string | No | Primary contact email |
| `phone` | string | No | Phone number |
| `notes` | string | No | Notes about the customer |

#### update_customer

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customer_id` | string | Yes | Customer ID |
| (same fields as create_customer) | | No | Fields to update |

---

### Suppliers

| Operation | Description | Approval |
|-----------|-------------|----------|
| `list_suppliers` | List all suppliers | No |
| `get_supplier` | Get a single supplier by ID | No |
| `create_supplier` | Create a new supplier | Yes |
| `update_supplier` | Update an existing supplier | Yes |
| `delete_supplier` | Delete a supplier | Yes |

Supplier fields are identical to customer fields.

---

### Uploads

| Operation | Description | Approval |
|-----------|-------------|----------|
| `upload_attachment` | Get a presigned URL to upload a file attachment to a ticket | Yes |

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_name` | string | Yes | Name of the file to upload |
| `content_type` | string | Yes | MIME type (e.g., "application/pdf") |
| `ticket_id` | string | No | Associate with a specific ticket |

---

## Approval Model

- **Safe operations** (auto-approved): All `list_*`, `get_*`, `search_*`, `get_config`, `list_projects`
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
mcp__numa_ops__numa_ops_tool(operation="get_config", params='{}', description="Load ops config")

# 2. List teams to find the right one
mcp__numa_ops__numa_ops_tool(operation="list_teams", params='{}', description="List all teams")

# 3. Create the ticket
mcp__numa_ops__numa_ops_tool(
    operation="create_ticket",
    params='{"team_id":"team-abc","title":"Fix login bug","ticket_type_id":"tt-bug123","priority":"high","description":"Users report 500 errors on login page"}',
    description="Create ticket: Fix login bug (high priority) in Engineering team"
)
```

### Search and update

```
# Search for tickets
mcp__numa_ops__numa_ops_tool(
    operation="search_tickets",
    params='{"query":"login bug","team_id":"team-abc"}',
    description="Search for login bug tickets"
)

# Update status
mcp__numa_ops__numa_ops_tool(
    operation="update_ticket",
    params='{"ticket_id":"ticket-xyz","team_id":"team-abc","status_id":"status-inprogress"}',
    description="Move ticket to In Progress"
)
```

---

## Best Practices

1. **Always call `get_config` first** — you need ticket types, statuses, and staff IDs before creating tickets
2. **Use display IDs when referencing tickets to users** — e.g., "ENG-42" is friendlier than "ticket-abc123"
3. **Include full content in approval descriptions** — for write operations, describe exactly what will be created/changed
4. **Respect team scoping** — users can only see teams they have access to
5. **Use search before creating** — check if a similar ticket already exists
