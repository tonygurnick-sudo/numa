#!/usr/bin/env python3
"""
Numa Ops — MCP Tool Reference
===============================

Manage Numa Ops (tickets, boards/teams, customers, suppliers, projects) via the
mcp__numa__numa_ops_tool MCP tool.  Load the `ops` skill for the full
interactive workflow and detailed guidance.

Tool name:  mcp__numa__numa_ops_tool

NOTE: The UI calls them "Boards" but the API uses "teams" / team_id.
When talking to users, say "board". When calling the API, use team_id.

All examples below are mcp__numa__numa_ops_tool calls.


Operations
----------

  Tickets:
    list_tickets     List tickets (filter by team, stage, assignee, status type, priority)
    get_ticket       Get ticket details by ID or display ID
    search_tickets   Search tickets by query string
    create_ticket    Create a new ticket (requires team_id, stage_id, title)
    update_ticket    Update an existing ticket
    delete_ticket    Delete a ticket (requires team_id)
    add_comment      Add a comment to a ticket
    list_comments    List comments on a ticket

  Teams (Boards):
    list_teams       List all boards
    get_team         Get board details by ID (includes zones and stages)
    create_team      Create a new board
    update_team      Update an existing board

  Customers:
    list_customers   List customers (search, filter by stage, owner, territory, etc.)
    get_customer     Get customer details by ID
    create_customer  Create a new customer (requires company_name)
    update_customer  Update an existing customer
    delete_customer  Delete a customer

  Suppliers:
    list_suppliers   List suppliers (search, filter by stage, owner, territory, etc.)
    get_supplier     Get supplier details by ID
    create_supplier  Create a new supplier (requires company_name)
    update_supplier  Update an existing supplier
    delete_supplier  Delete a supplier

  Config:
    get_config       Get ops configuration (ticket types, statuses, fields, staff)

  Projects:
    list_projects    List all projects
    create_project   Create a new project
    update_project   Update an existing project

  Uploads:
    upload_attachment  Get a presigned URL for file upload

  Metrics:
    get_metrics      Get ticket counts by status type for one or more boards


List Tickets
------------

Parameters:
  operation    (required)  "list_tickets"
  params       (required)  team_id (required), optional: stage_id, status_type,
                           assignee_id, customer_id, work_unit_id, priority,
                           include_archived, limit, cursor

Examples:

  # List all tickets for a board
  mcp__numa__numa_ops_tool(
    operation="list_tickets",
    params='{"team_id": "team-uuid-here"}',
    description="List tickets for board"
  )

  # Filter by status type and priority
  mcp__numa__numa_ops_tool(
    operation="list_tickets",
    params='{"team_id": "team-uuid", "status_type": "active", "priority": "high"}',
    description="List high priority active tickets"
  )


Get Ticket
----------

Parameters:
  operation    (required)  "get_ticket"
  params       (required)  ticket_id + team_id, OR display_id

Examples:

  # Get by ticket ID (requires team_id)
  mcp__numa__numa_ops_tool(
    operation="get_ticket",
    params='{"ticket_id": "ticket-uuid-here", "team_id": "team-uuid"}',
    description="Get ticket details"
  )

  # Get by display ID (e.g. "DEV-123") — no team_id needed
  mcp__numa__numa_ops_tool(
    operation="get_ticket",
    params='{"display_id": "DEV-123"}',
    description="Get ticket DEV-123"
  )


Search Tickets
--------------

Parameters:
  operation    (required)  "search_tickets"
  params       (required)  query (search term), optionally team_id

Examples:

  mcp__numa__numa_ops_tool(
    operation="search_tickets",
    params='{"query": "login bug", "team_id": "team-uuid"}',
    description="Search for login bug tickets"
  )


Create Ticket
-------------

IMPORTANT: Call get_config first to get ticket types and staff.
           Call get_team to get valid stage IDs for the board.

Parameters:
  operation    (required)  "create_ticket"
  params       (required)  team_id, stage_id, title
                           optional: description, ticket_type_id, priority
                           (lowest/low/medium/high/highest), assignee_id,
                           assignee_name, reporter_id, reporter_name, due_date,
                           customer_id, customer_name, supplier_id,
                           supplier_name, work_unit_id, tags, fields,
                           effort_points

Examples:

  mcp__numa__numa_ops_tool(
    operation="create_ticket",
    params='{"team_id": "team-uuid", "stage_id": "stage-uuid", "title": "Fix login page", "description": "Users cannot log in", "priority": "high"}',
    description="Create ticket: Fix login page\\nPriority: high\\nDescription: Users cannot log in"
  )


Update Ticket
-------------

Parameters:
  operation    (required)  "update_ticket"
  params       (required)  ticket_id, team_id
                           optional: stage_id (move to different stage),
                           zone_id, priority, assignee_id, assignee_name,
                           due_date, customer_id, supplier_id, work_unit_id,
                           tags, fields, effort_points, order, version,
                           archived, title, description

Examples:

  mcp__numa__numa_ops_tool(
    operation="update_ticket",
    params='{"ticket_id": "ticket-uuid", "team_id": "team-uuid", "stage_id": "stage-done-uuid"}',
    description="Update ticket: move to Done stage"
  )


Delete Ticket
-------------

Parameters:
  operation    (required)  "delete_ticket"
  params       (required)  ticket_id, team_id

Examples:

  mcp__numa__numa_ops_tool(
    operation="delete_ticket",
    params='{"ticket_id": "ticket-uuid", "team_id": "team-uuid"}',
    description="Delete ticket"
  )


Add Comment
-----------

Parameters:
  operation    (required)  "add_comment"
  params       (required)  ticket_id, content; optional: team_id, display_id

Examples:

  mcp__numa__numa_ops_tool(
    operation="add_comment",
    params='{"ticket_id": "ticket-uuid", "content": "Fixed in latest deployment"}',
    description="Add comment to ticket: Fixed in latest deployment"
  )


List Teams (Boards)
-------------------

  mcp__numa__numa_ops_tool(
    operation="list_teams",
    description="List all boards"
  )


Get Team (Board)
----------------

Returns the board with its zones and stages. Use this to get valid stage_id
values for ticket creation.

  mcp__numa__numa_ops_tool(
    operation="get_team",
    params='{"team_id": "team-uuid"}',
    description="Get board details with stages"
  )


Get Config
----------

Returns ticket types, statuses, custom fields, staff members, and projects.
Always call this first to get valid IDs for creating/updating tickets.

  mcp__numa__numa_ops_tool(
    operation="get_config",
    description="Get ops configuration"
  )


Create Customer
---------------

Parameters:
  operation    (required)  "create_customer"
  params       (required)  company_name
                           optional: industry, lifecycle_stage, owner_id,
                           owner_name, company_size, website, territory,
                           flags, source, contract_start_date, contract_term,
                           renewal_date, contract_value, products,
                           product_notes, notes, contacts

Examples:

  mcp__numa__numa_ops_tool(
    operation="create_customer",
    params='{"company_name": "Acme Corp", "industry": "Technology"}',
    description="Create customer: Acme Corp"
  )


Create Supplier
---------------

Parameters:
  operation    (required)  "create_supplier"
  params       (required)  company_name
                           optional: industry, lifecycle_stage, owner_id,
                           owner_name, company_size, website, territory,
                           flags, source, annual_spend, payment_terms,
                           notes, contacts

Examples:

  mcp__numa__numa_ops_tool(
    operation="create_supplier",
    params='{"company_name": "Parts Inc", "annual_spend": 50000}',
    description="Create supplier: Parts Inc"
  )


Get Metrics
-----------

Parameters:
  operation    (required)  "get_metrics"
  params       (required)  team_ids (comma-separated) OR team_id (single)

Examples:

  mcp__numa__numa_ops_tool(
    operation="get_metrics",
    params='{"team_ids": "team-uuid1,team-uuid2"}',
    description="Get metrics for boards"
  )


Approval Model
--------------

Safe (auto-approved):    list_*, get_*, search_*, get_config, list_projects, get_metrics
Unsafe (needs approval): create_*, update_*, delete_*, add_comment, upload_attachment

The default mode is "non_destructive" — read operations are auto-approved,
write operations require user approval.
"""
