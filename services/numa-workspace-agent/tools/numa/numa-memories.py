#!/usr/bin/env python3
"""
Numa Memory Management — MCP Tool Reference
=============================================

Manage user memories (list, add, update) via the mcp__numa__numa_tool
MCP tool.  Load the `memories` skill for detailed guidance on behavioral
rules, scoping, and workflows.

Tool name (passed as `name`):  memories

All examples below are mcp__numa__numa_tool calls.


Operations
----------

  list     List memories (optionally filtered by scope)
  add      Add a new memory
  update   Update an existing memory's content


List Operation
--------------

Parameters:
  operation   (required)  "list"
  scope       (optional)  Filter: "general", "integration:{slug}", or "agent:{agentId}"

Examples:

  # List all memories
  mcp__numa__numa_tool(
    name="memories",
    description="List all memories",
    params={"operation": "list"}
  )

  # List only general memories
  mcp__numa__numa_tool(
    name="memories",
    description="List general memories",
    params={"operation": "list", "scope": "general"}
  )

  # List Jira integration memories
  mcp__numa__numa_tool(
    name="memories",
    description="List Jira memories",
    params={"operation": "list", "scope": "integration:jira"}
  )

  # List memories for a specific agent
  mcp__numa__numa_tool(
    name="memories",
    description="List agent memories",
    params={"operation": "list", "scope": "agent:agt_abc123"}
  )


Add Operation
-------------

Parameters:
  operation   (required)  "add"
  content     (required)  Memory content (max 300 characters)
  scope       (optional)  "general" (default), "integration:{slug}", or "agent:{agentId}"

Examples:

  # Add a general preference
  mcp__numa__numa_tool(
    name="memories",
    description="Save user preference",
    params={"operation": "add", "content": "Prefers concise responses"}
  )

  # Add an integration-scoped memory
  mcp__numa__numa_tool(
    name="memories",
    description="Save Jira config",
    params={
      "operation": "add",
      "content": "Jira Cloud ID: abc123-def456",
      "scope": "integration:jira"
    }
  )

  # Add an agent-scoped memory
  mcp__numa__numa_tool(
    name="memories",
    description="Save agent preference",
    params={
      "operation": "add",
      "content": "User wants weekly summaries from this agent",
      "scope": "agent:agt_abc123"
    }
  )


Update Operation
----------------

Parameters:
  operation   (required)  "update"
  memory_id   (required)  Memory ID to update (e.g. "mem_abc123def456")
  content     (required)  New memory content (max 300 characters)

Example:

  mcp__numa__numa_tool(
    name="memories",
    description="Update preference",
    params={
      "operation": "update",
      "memory_id": "mem_abc123def456",
      "content": "Prefers concise bullet-point responses with code examples"
    }
  )


Scope Reference
---------------

  general              User preferences, facts, communication style
  integration:{slug}   Integration-specific operational details
  agent:{agentId}      Agent-specific user preferences

Common integration slugs:
  jira, slack, google_drive, gmail, notion, sharepoint,
  hubspot, xero, outlook, teams


Behavioral Rules
----------------

- ALWAYS ask the user before adding or updating a memory
- If a memory on the same topic already exists, update it instead of adding
- Maximum 50 memories per user, 300 characters each
- All AI-added memories are tagged with source: "ai"
- Deletion is not supported via tool — direct user to Profile page in Settings
"""

import sys

print(
    "This file is documentation only. "
    "Use the mcp__numa__numa_tool MCP tool with name='memories' instead."
)
sys.exit(1)
