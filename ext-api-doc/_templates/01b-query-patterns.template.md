---
api_name: ''
api_slug: ''
generated_from: '00-api-investigation-questionnaire'
generated_date: ''
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# {{api_name}} -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all read operation patterns including
> filtering, searching, sorting, pagination, and bulk reads.

---

## Query Capabilities Summary

| Capability                 | Supported  | Syntax     | Notes     |
| -------------------------- | ---------- | ---------- | --------- |
| Filter by field value      | {{yes/no}} | {{syntax}} | {{notes}} |
| Filter by date range       | {{yes/no}} | {{syntax}} | {{notes}} |
| Full-text search           | {{yes/no}} | {{syntax}} | {{notes}} |
| Sort by field              | {{yes/no}} | {{syntax}} | {{notes}} |
| Sort direction             | {{yes/no}} | {{syntax}} | {{notes}} |
| Field selection            | {{yes/no}} | {{syntax}} | {{notes}} |
| Include related records    | {{yes/no}} | {{syntax}} | {{notes}} |
| Aggregation / count        | {{yes/no}} | {{syntax}} | {{notes}} |
| Logical operators (AND/OR) | {{yes/no}} | {{syntax}} | {{notes}} |
| Comparison operators       | {{yes/no}} | {{syntax}} | {{notes}} |
| Null checks                | {{yes/no}} | {{syntax}} | {{notes}} |

---

## Common Patterns

### Pattern 1: List & Filter

> Get a filtered list of resources.

**Syntax:**

```http
GET /{{resource}}?{{filter_param}}={{value}}&{{filter_param2}}={{value2}}
```

**Filter operators (if supported):**

```
{{operator_syntax_examples}}
```

**Combining filters:**

- Multiple filters are combined with: {{AND / OR / configurable}}
- Nested conditions: {{supported / not supported}}

---

### Pattern 2: Search

> Full-text or field-specific search.

**Global search:**

```http
GET /{{search_endpoint}}?q={{query}}
```

**Per-resource search:**

```http
GET /{{resource}}?{{search_param}}={{query}}
```

- **Searchable fields:** {{field_list}}
- **Fuzzy matching:** {{yes/no}}
- **Minimum query length:** {{min_length}}
- **Result ranking:** {{relevance / recency / none}}

---

### Pattern 3: Get by ID

> Retrieve a single resource by its identifier.

```http
GET /{{resource}}/{{id}}
```

**Include related data (if supported):**

```http
GET /{{resource}}/{{id}}?{{include_param}}={{related_entity}}
```

---

### Pattern 4: Get Related Records

> Fetch child or associated records.

**Sub-resource pattern:**

```http
GET /{{parent_resource}}/{{parent_id}}/{{child_resource}}
```

**Filter by parent (alternative):**

```http
GET /{{child_resource}}?{{parent_id_param}}={{parent_id}}
```

---

### Pattern 5: Date Range Query

```http
GET /{{resource}}?{{date_field}}[gte]={{start_date}}&{{date_field}}[lte]={{end_date}}
```

**Date format:** `{{date_format}}` (e.g., `2024-01-15T00:00:00Z`)

**Common date fields:** {{field_list}}

---

### Pattern 6: Aggregation / Count

> Get summary data without full records.

```http
GET /{{resource}}?{{count_param}}
```

OR

```http
GET /{{resource}}/count?{{filter_params}}
```

---

## Pagination Handling

### Model

- **Type:** {{offset / cursor / page-number / keyset / link-header}}
- **Default page size:** {{default}}
- **Max page size:** {{max}}
- **Total count available:** {{yes/no}} — via {{mechanism}}

### Request Parameters

| Parameter | Type     | Default     | Description     |
| --------- | -------- | ----------- | --------------- |
| {{param}} | {{type}} | {{default}} | {{description}} |

### Response Structure

```json
{{pagination_response_example}}
```

### Last Page Detection

{{how_to_detect_last_page}}

### Full Pagination Loop

```
Request 1: GET /{{resource}}?{{page_param}}={{initial}}&{{size_param}}={{size}}
Response 1: { "data": [...], "{{next_indicator}}": "{{next_value}}" }

Request 2: GET /{{resource}}?{{page_param}}={{next_value}}&{{size_param}}={{size}}
Response 2: { "data": [...], "{{next_indicator}}": "{{next_value_2}}" }

...

Last Page: GET /{{resource}}?{{page_param}}={{last_value}}&{{size_param}}={{size}}
Response:  { "data": [...], "{{next_indicator}}": null }
           ← null/empty/absent means done
```

---

## Worked Examples

### Example 1: {{title}}

> {{description_of_what_this_retrieves}}

```http
{{full_http_request}}
```

```json
{{abbreviated_response}}
```

**Key points:**

- {{observation_1}}
- {{observation_2}}

---

### Example 2: {{title}}

> {{description_of_what_this_retrieves}}

```http
{{full_http_request}}
```

```json
{{abbreviated_response}}
```

**Key points:**

- {{observation_1}}
- {{observation_2}}

---

### Example 3: {{title}}

> {{description_of_what_this_retrieves}}

```http
{{full_http_request}}
```

```json
{{abbreviated_response}}
```

**Key points:**

- {{observation_1}}
- {{observation_2}}

---

## Gotchas & Counter-Exceptions

> Things that behave differently from what you would expect.

1. **{{gotcha_title}}:** {{details}}
2. **{{gotcha_title}}:** {{details}}
3. **{{gotcha_title}}:** {{details}}

---

_Generated from the investigation questionnaire, Phases 5-6._
