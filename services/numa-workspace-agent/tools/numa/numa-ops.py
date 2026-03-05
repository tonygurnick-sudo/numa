#!/usr/bin/env python3
"""
Numa Ops — MCP Tool Reference
===============================

Manage Numa Ops (tickets, teams, customers, suppliers, projects) via the
mcp__numa__numa_ops_tool MCP tool.  Load the `ops` skill for the full
interactive workflow and detailed guidance.

Tool name:  mcp__numa__numa_ops_tool

All examples below are mcp__numa__numa_ops_tool calls.


Operations
----------

  Tickets:
    list_tickets     List tickets (optionally filter by team, status, assignee, priority)
    get_ticket       Get ticket details by ID or display ID
    search_tickets   Search tickets by query string
    create_ticket    Create a new ticket
    update_ticket    Update an existing ticket
    delete_ticket    Delete a ticket
    add_comment      Add a comment to a ticket
    list_comments    List comments on a ticket

  Teams:
    list_teams       List all teams (boards)
    get_team         Get team details by ID
    create_team      Create a new team
    update_team      Update an existing team

  Customers:
    list_customers   List customers (optionally search)
    get_customer     Get customer details by ID
    create_customer  Create a new customer
    update_customer  Update an existing customer
    delete_customer  Delete a customer

  Suppliers:
    list_suppliers   List suppliers (optionally search)
    get_supplier     Get supplier details by ID
    create_supplier  Create a new supplier
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


List Tickets
------------

Parameters:
  operation    (required)  "list_tickets"
  params       (optional)  Filters: team_id, status, assignee, priority, zone

Examples:

  # List all tickets
  mcp__numa__numa_ops_tool(
    operation="list_tickets",
    description="List all tickets"
  )

  # List tickets for a specific team
  mcp__numa__numa_ops_tool(
    operation="list_tickets",
    params='{"team_id": "team-uuid-here"}',
    description="List tickets for team"
  )

  # Filter by status and priority
  mcp__numa__numa_ops_tool(
    operation="list_tickets",
    params='{"team_id": "team-uuid", "status": "in_progress", "priority": "high"}',
    description="List high priority in-progress tickets"
  )


Get Ticket
----------

Parameters:
  operation    (required)  "get_ticket"
  params       (required)  ticket_id OR display_id

Examples:

  # Get by ticket ID
  mcp__numa__numa_ops_tool(
    operation="get_ticket",
    params='{"ticket_id": "ticket-uuid-here"}',
    description="Get ticket details"
  )

  # Get by display ID (e.g. "DEV-123")
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

Parameters:
  operation    (required)  "create_ticket"
  params       (required)  team_id, title; optional: description, ticket_type_id,
                           status_id, priority, assignee_id, due_date, project_id,
                           customer_id, supplier_id, custom_fields

Examples:

  mcp__numa__numa_ops_tool(
    operation="create_ticket",
    params='{"team_id": "team-uuid", "title": "Fix login page", "description": "Users cannot log in", "priority": "high"}',
    description="Create ticket: Fix login page\\nPriority: high\\nDescription: Users cannot log in"
  )


Update Ticket
-------------

Parameters:
  operation    (required)  "update_ticket"
  params       (required)  ticket_id plus fields to update (title, description,
                           status_id, priority, assignee_id, due_date, etc.)

Examples:

  mcp__numa__numa_ops_tool(
    operation="update_ticket",
    params='{"ticket_id": "ticket-uuid", "status_id": "done-status-uuid", "priority": "low"}',
    description="Update ticket: set status to Done, priority to low"
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


List Teams
----------

  mcp__numa__numa_ops_tool(
    operation="list_teams",
    description="List all teams"
  )


Get Config
----------

Returns ticket types, statuses, custom fields, staff members, and projects.
Always call this first to get valid IDs for creating/updating tickets.

  mcp__numa__numa_ops_tool(
    operation="get_config",
    description="Get ops configuration"
  )


Approval Model
--------------

Safe (auto-approved):    list_*, get_*, search_*, get_config, list_projects
Unsafe (needs approval): create_*, update_*, delete_*, add_comment, upload_attachment

The default mode is "non_destructive" — read operations are auto-approved,
write operations require user approval.
"""
