#!/usr/bin/env python3
"""
Numa Agent Management — MCP Tool Reference
============================================

Manage Numa agents (list, get, create, update, duplicate) via the
mcp__numa__numa_tool MCP tool.  Load the `agents` skill for the full
interactive creation workflow and detailed guidance.

Tool name (passed as `name`):  agents

All examples below are mcp__numa__numa_tool calls.


Operations
----------

  list       List agents (owned, public, or all)
  get        Get agent details by ID
  create     Create a new agent
  update     Update an existing agent
  duplicate  Copy an agent to your personal library


List Operation
--------------

Parameters:
  operation    (required)  "list"
  scope        (optional)  "owned" (default), "public", or "all"
  agent_type   (optional)  Filter by agent type (e.g. "task")

Examples:

  # List your personal agents
  mcp__numa__numa_tool(
    name="agents",
    description="List my agents",
    params={"operation": "list", "scope": "owned"}
  )

  # List all public/company agents
  mcp__numa__numa_tool(
    name="agents",
    description="List public agents",
    params={"operation": "list", "scope": "public"}
  )


Get Operation
-------------

Parameters:
  operation    (required)  "get"
  agent_id     (required)  Agent ID to retrieve

Example:

  mcp__numa__numa_tool(
    name="agents",
    description="Get agent details",
    params={"operation": "get", "agent_id": "agt_abc123"}
  )


Create Operation
----------------

Parameters:
  operation                   (required)  "create"
  title                       (required)  Agent display name
  systemPrompt                (required)  Core instructions
  visibility                  (optional)  "personal" (default) or "public"
  description                 (optional)  One-line description
  agentType                   (optional)  Agent type label (default: "task")
  userWelcomeMessage          (optional)  Greeting shown when agent starts
  estimatedTimeSavedMinutes   (optional)  Estimated time saved in minutes
  toolsConfig                 (optional)  Tools configuration object
  attach_files                (optional)  Array of workspace file paths (max 5)

Examples:

  # Create a personal agent
  mcp__numa__numa_tool(
    name="agents",
    description="Create customer support agent",
    params={
      "operation": "create",
      "title": "Customer Support Agent",
      "systemPrompt": "You are a helpful customer support assistant...",
      "description": "Handles customer enquiries"
    }
  )

  # Create a public agent with file attachments
  mcp__numa__numa_tool(
    name="agents",
    description="Create policy expert agent",
    params={
      "operation": "create",
      "title": "Policy Expert",
      "systemPrompt": "You help answer questions about company policies.",
      "visibility": "public",
      "attach_files": ["/workdir/uploads/handbook.pdf", "/workdir/uploads/policies.docx"]
    }
  )

  # Create with tools configuration
  mcp__numa__numa_tool(
    name="agents",
    description="Create research agent",
    params={
      "operation": "create",
      "title": "Research Agent",
      "systemPrompt": "You help with research tasks.",
      "toolsConfig": {"webSearchEnabled": true, "allowedKnowledgeBases": ["company"]}
    }
  )

Tools Configuration Options:
  {
    "autoToolsEnabled": true,         # Enable automatic tool selection
    "webSearchEnabled": true,         # Allow web search
    "allowedKnowledgeBases": [...]    # null=all, []=none, ["id"]=specific
  }


Update Operation
----------------

Parameters:
  operation    (required)  "update"
  agent_id     (required)  Agent ID to update
  title, systemPrompt, visibility, description, agentType,
  userWelcomeMessage, estimatedTimeSavedMinutes, toolsConfig,
  attach_files — all optional, only provide fields to change.

Examples:

  # Update agent title
  mcp__numa__numa_tool(
    name="agents",
    description="Update agent title",
    params={"operation": "update", "agent_id": "agt_abc123", "title": "New Title"}
  )

  # Attach files to an existing agent
  mcp__numa__numa_tool(
    name="agents",
    description="Attach file to agent",
    params={
      "operation": "update",
      "agent_id": "agt_abc123",
      "attach_files": ["/workdir/uploads/new_document.pdf"]
    }
  )


Duplicate Operation
-------------------

Parameters:
  operation    (required)  "duplicate"
  agent_id     (required)  Agent ID to duplicate

Example:

  mcp__numa__numa_tool(
    name="agents",
    description="Duplicate company agent",
    params={"operation": "duplicate", "agent_id": "agt_company123"}
  )

The duplicate is always created as a personal agent with "(Copy)" appended.


File Attachments
----------------

- Files must exist in workspace before attaching
- Supported locations: /workdir/uploads/, /workdir/outputs/, /workdir/chat-workflows/
- Maximum 5 reference files per agent
- Files are copied to permanent agent storage (originals remain)


Permissions
-----------

- You can update your own personal agents
- You can update company agents you created
- Admins can update any company agent
- Admin policy may restrict creation: off, personal_only, or full
"""

import sys

print(
    "This file is documentation only. "
    "Use the mcp__numa__numa_tool MCP tool with name='agents' instead."
)
sys.exit(1)
