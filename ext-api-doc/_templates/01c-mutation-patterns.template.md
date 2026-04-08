---
api_name: ''
api_slug: ''
generated_from: '00-api-investigation-questionnaire'
generated_date: ''
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# {{api_name}} -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all write operation patterns including
> create, update, delete, state transitions, and nested record operations.

---

## Write Capabilities Summary

| Operation         | Supported  | Method     | Notes     |
| ----------------- | ---------- | ---------- | --------- |
| Create            | {{yes/no}} | POST       | {{notes}} |
| Full replace      | {{yes/no}} | PUT        | {{notes}} |
| Partial update    | {{yes/no}} | PATCH      | {{notes}} |
| Delete            | {{yes/no}} | DELETE     | {{notes}} |
| Soft delete       | {{yes/no}} | {{method}} | {{notes}} |
| Bulk create       | {{yes/no}} | {{method}} | {{notes}} |
| Bulk update       | {{yes/no}} | {{method}} | {{notes}} |
| Bulk delete       | {{yes/no}} | {{method}} | {{notes}} |
| State transitions | {{yes/no}} | {{method}} | {{notes}} |
| File upload       | {{yes/no}} | {{method}} | {{notes}} |

---

## Common Patterns

### Pattern 1: Create

```http
POST /{{resource}}
Content-Type: application/json
Authorization: {{auth}}

{
  "{{required_field_1}}": "{{value}}",
  "{{required_field_2}}": "{{value}}",
  "{{optional_field}}": "{{value}}"
}
```

**Response (201 Created):**

```json
{
  "id": "{{new_id}}",
  "{{field}}": "{{value}}",
  "created_at": "{{timestamp}}"
}
```

**Required fields:** {{required_field_list}}
**Server-generated fields:** {{server_field_list}}
**Idempotency:** {{idempotency_notes}}

---

### Pattern 2: Update (Partial)

```http
PATCH /{{resource}}/{{id}}
Content-Type: application/json
Authorization: {{auth}}

{
  "{{field_to_update}}": "{{new_value}}"
}
```

**Response (200 OK):**

```json
{
  "id": "{{id}}",
  "{{field_to_update}}": "{{new_value}}",
  "updated_at": "{{timestamp}}"
}
```

**Behavior:**

- Only included fields are modified; omitted fields are untouched.
- {{null_behavior}}: Sending `null` for a field {{clears it / is ignored / returns error}}.

---

### Pattern 3: Update (Full Replace)

> Only document this if the API uses PUT for full replacement (not all APIs do).

```http
PUT /{{resource}}/{{id}}
Content-Type: application/json
Authorization: {{auth}}

{
  "{{all_required_fields}}": "{{values}}"
}
```

**Behavior:**

- All fields must be provided. Omitted fields are {{set to null / set to default / rejected}}.

---

### Pattern 4: Delete

```http
DELETE /{{resource}}/{{id}}
Authorization: {{auth}}
```

**Response:** {{status_code}} {{response_body_or_empty}}

**Behavior:**

- {{hard_or_soft_delete}}
- {{cascading_effects}}
- {{can_undo}}

---

### Pattern 5: State Transition

> For APIs where state changes are explicit actions rather than field updates.

**Option A: Dedicated action endpoint**

```http
POST /{{resource}}/{{id}}/{{action}}
Authorization: {{auth}}

{
  "{{action_params}}": "{{values}}"
}
```

**Option B: Status field update**

```http
PATCH /{{resource}}/{{id}}
Authorization: {{auth}}

{
  "status": "{{new_status}}"
}
```

**Valid transitions:** See state machine in `01a-domain-model-reference.md`.

---

### Pattern 6: Nested / Related Record Operations

**Create child record:**

```http
POST /{{parent_resource}}/{{parent_id}}/{{child_resource}}
Authorization: {{auth}}

{
  "{{child_fields}}": "{{values}}"
}
```

**Update with nested objects (if supported):**

```http
PATCH /{{resource}}/{{id}}
Authorization: {{auth}}

{
  "{{nested_field}}": {
    "{{sub_field}}": "{{value}}"
  }
}
```

**Behavior:**

- {{nested_create_or_update_semantics}}
- {{partial_nested_update_support}}

---

## Field Validation Rules

> Rules the API enforces on write operations.

| Entity     | Field     | Rule                 | Error if Violated |
| ---------- | --------- | -------------------- | ----------------- |
| {{entity}} | {{field}} | {{rule_description}} | {{error_message}} |

**Common validation patterns:**

- **Required fields:** {{list}}
- **Max lengths:** {{field: length, ...}}
- **Numeric ranges:** {{field: min-max, ...}}
- **Regex patterns:** {{field: pattern, ...}}
- **Enum restrictions:** See `01a-domain-model-reference.md` Enum Value Reference

---

## Server-Side Defaults

> Fields the server populates automatically on create/update.

| Entity     | Field      | Default Value     | When Applied   |
| ---------- | ---------- | ----------------- | -------------- |
| {{entity}} | id         | auto-generated    | create         |
| {{entity}} | created_at | current timestamp | create         |
| {{entity}} | updated_at | current timestamp | create, update |
| {{entity}} | {{field}}  | {{default}}       | {{when}}       |

---

## Worked Examples

### Example 1: {{title}}

> {{description}}

```http
{{full_http_request_with_body}}
```

**Response ({{status}}):**

```json
{{response_body}}
```

**Notes:**

- {{key_observation}}

---

### Example 2: {{title}}

> {{description}}

```http
{{full_http_request_with_body}}
```

**Response ({{status}}):**

```json
{{response_body}}
```

**Notes:**

- {{key_observation}}

---

### Example 3: {{title}}

> {{description}}

```http
{{full_http_request_with_body}}
```

**Response ({{status}}):**

```json
{{response_body}}
```

**Notes:**

- {{key_observation}}

---

## Gotchas & Counter-Exceptions

1. **{{gotcha_title}}:** {{details}}
2. **{{gotcha_title}}:** {{details}}
3. **{{gotcha_title}}:** {{details}}

---

## Dangerous Operations

> Operations that are destructive, irreversible, or have significant side effects.
> The workspace agent should confirm with the user before executing these.

| Operation     | Why Dangerous | Safeguard                                     |
| ------------- | ------------- | --------------------------------------------- |
| {{operation}} | {{reason}}    | {{confirm_with_user / check_condition / etc}} |

---

_Generated from the investigation questionnaire, Phases 3-4._
