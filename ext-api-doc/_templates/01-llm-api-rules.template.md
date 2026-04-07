---
api_name: ''
api_slug: ''
version: ''
generated_from: '00-api-investigation-questionnaire'
generated_date: ''
line_count_target: '< 300 lines'
---

# {{api_name}} -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the {{api_name}} integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion files (01a-01d) contain the detailed reference material.

## Context

- **API:** {{api_name}} {{version}}
- **Base URL:** `{{base_url}}`
- **Auth:** {{auth_summary}}
- **Integration path:** {{integration_path}} (Data Connector / Direct API / Hybrid)
- **Rate limits:** {{rate_limit_summary}}

## Auth Structure

{{auth_type}} authentication via {{auth_location}}.

```
{{auth_header_example}}
```

**Token lifecycle:**

- {{token_lifetime_notes}}
- {{refresh_behavior}}

## Capabilities

### CAN

1. {{capability_1}}
2. {{capability_2}}
3. {{capability_3}}

### CANNOT

1. {{limitation_1}}
2. {{limitation_2}}
3. {{limitation_3}}

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **{{gotcha_1_title}}:** {{gotcha_1_detail}}
2. **{{gotcha_2_title}}:** {{gotcha_2_detail}}
3. **{{gotcha_3_title}}:** {{gotcha_3_detail}}

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter | Default     | Reason     |
| --------- | ----------- | ---------- |
| {{param}} | {{default}} | {{reason}} |

## Working Examples

### Example 1: {{example_1_title}}

```http
{{example_1_request}}
```

```json
{{example_1_response}}
```

### Example 2: {{example_2_title}}

```http
{{example_2_request}}
```

```json
{{example_2_response}}
```

### Example 3: {{example_3_title}}

```http
{{example_3_request}}
```

```json
{{example_3_response}}
```

## Proxy API Operations

> Quick reference for all supported operations.

| Operation | Method     | Path     | Key Parameters | Notes     |
| --------- | ---------- | -------- | -------------- | --------- |
| {{op}}    | {{method}} | {{path}} | {{params}}     | {{notes}} |

## Pagination

- **Type:** {{pagination_type}}
- **Default page size:** {{default_page_size}}
- **Max page size:** {{max_page_size}}
- **How to paginate:**

```http
{{pagination_example}}
```

- **Last page detection:** {{last_page_detection}}

## Webhooks / Events

{{#if webhooks_supported}}
**Supported events:**

| Event     | Trigger     | Key Payload Fields |
| --------- | ----------- | ------------------ |
| {{event}} | {{trigger}} | {{fields}}         |

**Setup:** {{webhook_setup_notes}}
{{/if}}

{{#if no_webhooks}}
No webhook support. Use polling with `{{polling_endpoint}}` and `{{modified_since_param}}` parameter.
Recommended interval: {{polling_interval}}.
{{/if}}

## Error Handling

**Standard error format:**

```json
{{error_format_example}}
```

**Recovery by status:**

| Status | Meaning          | Action                          |
| ------ | ---------------- | ------------------------------- |
| 400    | Bad request      | Fix request parameters          |
| 401    | Unauthorized     | Refresh token and retry         |
| 403    | Forbidden        | Check scopes / permissions      |
| 404    | Not found        | Verify resource ID              |
| 409    | Conflict         | {{conflict_recovery}}           |
| 422    | Validation error | Check field-level errors        |
| 429    | Rate limited     | Wait {{retry_after}} then retry |
| 5xx    | Server error     | Retry with exponential backoff  |

## Known Limitations

1. {{limitation_1}}
2. {{limitation_2}}
3. {{limitation_3}}

---

_Generated from investigation questionnaire. See companion files for detailed reference:_

- _01a-domain-model-reference.md — Entity catalog, relationships, state machines_
- _01b-query-patterns.md — Filtering, search, pagination examples_
- _01c-mutation-patterns.md — Create, update, delete patterns_
- _01d-event-and-error-handling.md — Events, webhooks, error recovery_
