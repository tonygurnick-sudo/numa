---
api_name: ''
api_slug: ''
base_url: ''
version: ''
spec_format: '' # OpenAPI 3.x | Swagger 2.0 | custom | none
spec_url: ''
docs_url: ''
date_researched: ''
---

# {{api_name}} -- API Specification & Investigation

> Clean developer reference for the {{api_name}} API. This document is the condensed
> output of the investigation questionnaire -- everything a developer needs to integrate
> with this API, in one place.

---

## Overview

- **Vendor:** {{vendor}}
- **API version:** {{version}}
- **Base URL:** `{{base_url}}`
- **Sandbox URL:** `{{sandbox_url}}`
- **API type:** {{REST / GraphQL / SOAP / gRPC / mixed}}
- **Data format:** {{JSON / XML / other}}
- **Documentation:** [{{docs_url}}]({{docs_url}})
- **API reference:** [{{ref_url}}]({{ref_url}})
- **OpenAPI spec:** {{spec_url or "Not available"}}
- **Status page:** [{{status_url}}]({{status_url}})

**Summary:** {{1-2 sentence description of what this API does and who uses it}}

---

## Authentication

### Method: {{auth_type}}

{{auth_description}}

**Header format:**

```
{{auth_header_example}}
```

**For OAuth 2.0:**

| Parameter         | Value             |
| ----------------- | ----------------- |
| Grant type        | {{grant_type}}    |
| Authorization URL | `{{auth_url}}`    |
| Token URL         | `{{token_url}}`   |
| Revocation URL    | `{{revoke_url}}`  |
| Token lifetime    | {{lifetime}}      |
| Refresh mechanism | {{refresh_notes}} |
| PKCE required     | {{yes/no}}        |

**Required scopes:**

| Scope     | Purpose     | Required for Integration? |
| --------- | ----------- | ------------------------- |
| {{scope}} | {{purpose}} | {{yes/no}}                |

---

## Endpoint Catalog

### {{Resource Name}}

| Method | Path             | Purpose                 | Auth | Paginated | Idempotent |
| ------ | ---------------- | ----------------------- | ---- | --------- | ---------- |
| GET    | `/{{path}}`      | List {{resources}}      | Yes  | Yes       | Yes        |
| GET    | `/{{path}}/{id}` | Get single {{resource}} | Yes  | No        | Yes        |
| POST   | `/{{path}}`      | Create {{resource}}     | Yes  | No        | No         |
| PATCH  | `/{{path}}/{id}` | Update {{resource}}     | Yes  | No        | No         |
| DELETE | `/{{path}}/{id}` | Delete {{resource}}     | Yes  | No        | Yes        |

_Repeat for each resource._

### Full Endpoint Index

| #   | Method     | Path       | Purpose     | Notes     |
| --- | ---------- | ---------- | ----------- | --------- |
| 1   | {{method}} | `{{path}}` | {{purpose}} | {{notes}} |

---

## Data Models

### {{Model Name}}

| Field     | Type     | Required   | Writable   | Description       |
| --------- | -------- | ---------- | ---------- | ----------------- |
| id        | string   | -          | no         | Unique identifier |
| {{field}} | {{type}} | {{yes/no}} | {{yes/no}} | {{description}}   |

**Relationships:**

- {{relationship_description}}

_Repeat for each model._

---

## Pagination

- **Type:** {{offset / cursor / page-number / keyset / link-header}}
- **Default page size:** {{size}}
- **Max page size:** {{max}}
- **Total count:** {{available / not available}}

**Parameters:**

| Parameter | Type     | Default     | Description |
| --------- | -------- | ----------- | ----------- |
| {{param}} | {{type}} | {{default}} | {{desc}}    |

**Response structure:**

```json
{{pagination_response_example}}
```

**Last page detection:** {{mechanism}}

---

## Rate Limits

| Scope     | Limit     | Window     |
| --------- | --------- | ---------- |
| {{scope}} | {{limit}} | {{window}} |

**Headers:**

| Header     | Meaning     |
| ---------- | ----------- |
| {{header}} | {{meaning}} |

**When exceeded:** {{429 response with Retry-After header / custom behavior}}

**Recommended strategy:** {{backoff_approach}}

---

## Error Handling

**Standard error format:**

```json
{{error_response_example}}
```

**Status codes:**

| Status | Meaning          | Retryable | Recovery      |
| ------ | ---------------- | --------- | ------------- |
| 400    | Bad request      | No        | Fix request   |
| 401    | Unauthorized     | Yes       | Refresh token |
| 403    | Forbidden        | No        | Check scopes  |
| 404    | Not found        | No        | Verify ID     |
| 409    | Conflict         | Maybe     | {{notes}}     |
| 422    | Validation error | No        | Fix fields    |
| 429    | Rate limited     | Yes       | Wait + retry  |
| 5xx    | Server error     | Yes       | Retry         |

---

## Webhooks / Events

{{#if supported}}

**Registration:** `POST /{{webhook_endpoint}}`

**Events:**

| Event     | Trigger     | Payload Summary |
| --------- | ----------- | --------------- |
| {{event}} | {{trigger}} | {{summary}}     |

**Verification:** {{signature_method}}

**Retry policy:** {{retry_info}}

{{/if}}

{{#if not_supported}}

No webhook support. Use polling with `{{modified_since_field}}` filter.

{{/if}}

---

## Known Limitations

1. {{limitation}}
2. {{limitation}}
3. {{limitation}}

---

## SDKs & Tooling

| SDK     | Language | Repository   | Quality            | Notes     |
| ------- | -------- | ------------ | ------------------ | --------- |
| {{sdk}} | {{lang}} | {{repo_url}} | {{good/fair/poor}} | {{notes}} |

**Postman collection:** {{url or "Not available"}}
**OpenAPI spec:** {{url or "Not available"}}

---

## Integration Path Assessment

**Recommended path:** {{Data Connector / Data Connector (Files) / Direct API Only / Hybrid}}

**Justification:** {{why_this_path}}

**Connector compatibility:**

| Connector Method  | API Endpoint | Feasibility           |
| ----------------- | ------------ | --------------------- |
| list_files        | {{endpoint}} | {{good/partial/none}} |
| download_file     | {{endpoint}} | {{good/partial/none}} |
| search_files      | {{endpoint}} | {{good/partial/none}} |
| get_file_metadata | {{endpoint}} | {{good/partial/none}} |

---

_Researched on {{date_researched}}. Source: Investigation questionnaire._
