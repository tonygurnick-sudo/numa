#!/usr/bin/env python3
"""
Numa Ops — MCP Tool Reference
===============================

Manage Numa Ops (tickets, boards, customers, suppliers, projects) via the
mcp__numa__numa_ops_tool MCP tool.  Load the `ops` skill for the full
interactive workflow and detailed guidance.

Tool name:  mcp__numa__numa_ops_tool

TIP: Pass NAMES instead of IDs whenever possible. The bridge resolves
boardName, stageName, assigneeName, customerName, projectName,
workUnitName, lifecycleStageName, and ticketTypeName to their IDs
automatically. Skip the get_board / get_config / list_* lookup dance
unless you actually need to display data to the user. Never invent IDs.

All examples below are mcp__numa__numa_ops_tool calls.


Operations
----------

  Tickets:
    list_tickets     List tickets (filter by board, stage, assignee, status type, priority)
    get_ticket       Get ticket details by ID or display ID
    search_tickets   Search tickets by query string
    create_ticket    Create a new ticket (requires board_id, stage_id, title)
    update_ticket    Update an existing ticket
    delete_ticket    Delete a ticket (requires board_id)
    add_comment      Add a comment to a ticket
    list_comments    List comments on a ticket

  Boards:
    list_boards       List all boards
    get_board         Get board details by ID (includes zones and stages)
    create_board      Create a new board
    update_board      Update an existing board

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
  params       (required)  board_id (required), optional: stage_id, status_type,
                           assignee_id, customer_id, work_unit_id, priority,
                           include_archived, limit, cursor

Examples:

  # List all tickets for a board
  mcp__numa__numa_ops_tool(
    operation="list_tickets",
    params='{"board_id": "board-uuid-here"}',
    description="List tickets for board"
  )

  # Filter by status type and priority
  mcp__numa__numa_ops_tool(
    operation="list_tickets",
    params='{"board_id": "board-uuid", "status_type": "active", "priority": "high"}',
    description="List high priority active tickets"
  )


Get Ticket
----------

Parameters:
  operation    (required)  "get_ticket"
  params       (required)  ticket_id + board_id, OR display_id

Examples:

  # Get by ticket ID (requires board_id)
  mcp__numa__numa_ops_tool(
    operation="get_ticket",
    params='{"ticket_id": "ticket-uuid-here", "board_id": "board-uuid"}',
    description="Get ticket details"
  )

  # Get by display ID (e.g. "DEV-123") — no board_id needed
  mcp__numa__numa_ops_tool(
    operation="get_ticket",
    params='{"display_id": "DEV-123"}',
    description="Get ticket DEV-123"
  )


Search Tickets
--------------

Parameters:
  operation    (required)  "search_tickets"
  params       (required)  query (search term), optionally board_id

Examples:

  mcp__numa__numa_ops_tool(
    operation="search_tickets",
    params='{"query": "login bug", "board_id": "board-uuid"}',
    description="Search for login bug tickets"
  )


Create Ticket
-------------

IMPORTANT: Call get_config first to get ticket types and staff.
           Call get_board to get valid stage IDs for the board.

Parameters:
  operation    (required)  "create_ticket"
  params       (required)  board_id, stage_id, title
                           optional: description, ticket_type_id, priority
                           (lowest/low/medium/high/highest), assignee_id,
                           assignee_name, reporter_id, reporter_name, due_date,
                           customer_id, customer_name, supplier_id,
                           supplier_name, work_unit_id, tags, fields,
                           effort_points

Examples:

  mcp__numa__numa_ops_tool(
    operation="create_ticket",
    params='{"board_id": "board-uuid", "stage_id": "stage-uuid", "title": "Fix login page", "description": "Users cannot log in", "priority": "high"}',
    description="Create ticket: Fix login page\\nPriority: high\\nDescription: Users cannot log in"
  )


Update Ticket
-------------

Parameters:
  operation    (required)  "update_ticket"
  params       (required)  ticket_id, board_id
                           optional: stage_id (move to different stage),
                           zone_id, priority, assignee_id, assignee_name,
                           due_date, customer_id, supplier_id, work_unit_id,
                           tags, fields, effort_points, order, version,
                           archived, title, description

Examples:

  mcp__numa__numa_ops_tool(
    operation="update_ticket",
    params='{"ticket_id": "ticket-uuid", "board_id": "board-uuid", "stage_id": "stage-done-uuid"}',
    description="Update ticket: move to Done stage"
  )


Delete Ticket
-------------

Parameters:
  operation    (required)  "delete_ticket"
  params       (required)  ticket_id, board_id

Examples:

  mcp__numa__numa_ops_tool(
    operation="delete_ticket",
    params='{"ticket_id": "ticket-uuid", "board_id": "board-uuid"}',
    description="Delete ticket"
  )


Add Comment
-----------

Parameters:
  operation    (required)  "add_comment"
  params       (required)  ticket_id, content; optional: board_id, display_id

Examples:

  mcp__numa__numa_ops_tool(
    operation="add_comment",
    params='{"ticket_id": "ticket-uuid", "content": "Fixed in latest deployment"}',
    description="Add comment to ticket: Fixed in latest deployment"
  )


List Boards
-------------------

  mcp__numa__numa_ops_tool(
    operation="list_boards",
    description="List all boards"
  )


Get Board
----------------

Returns the board with its zones and stages. Use this to get valid stage_id
values for ticket creation.

  mcp__numa__numa_ops_tool(
    operation="get_board",
    params='{"board_id": "board-uuid"}',
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
  params       (required)  board_ids (comma-separated) OR board_id (single)

Examples:

  mcp__numa__numa_ops_tool(
    operation="get_metrics",
    params='{"board_ids": "board-uuid1,board-uuid2"}',
    description="Get metrics for boards"
  )


Approval Model
--------------

Safe (auto-approved):    list_*, get_*, search_*, get_config, list_projects, get_metrics
Unsafe (needs approval): create_*, update_*, delete_*, add_comment, upload_attachment

The default mode is "non_destructive" — read operations are auto-approved,
write operations require user approval.
"""
