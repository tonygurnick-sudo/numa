---
api_name: 'Zoho CRM'
api_slug: 'zoho-crm'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-04-23'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Zoho CRM -- Mutation Patterns Reference

> Create / update / upsert / delete / Lead conversion. Per-record partial-failure handling.
> Companion to `01-llm-api-rules.md`.

---

## Write Capabilities Summary

| Operation          | Supported | Method | Endpoint                                      | Max batch  | Notes                                           |
| ------------------ | --------- | ------ | --------------------------------------------- | ---------- | ----------------------------------------------- |
| Create             | yes       | POST   | `/crm/v8/{Module}`                            | 100        | `{"data":[{…}]}` wrapper required               |
| Partial update     | yes       | PUT    | `/crm/v8/{Module}/{id}` or `/crm/v8/{Module}` | 100        | Only included fields change                     |
| Full replace       | no        | —      | —                                             | —          | Zoho has no "replace" — PUT is partial          |
| Delete             | yes       | DELETE | `/crm/v8/{Module}?ids=...` or `/{id}`         | 100        | Soft delete; goes to Recycle Bin                |
| Soft delete        | yes       | DELETE | same                                          |            | Default behaviour; restore via UI               |
| Hard delete        | partial   | DELETE | `/crm/v8/{Module}/deleted`                    | —          | Empty Recycle Bin, not individual hard delete   |
| Upsert             | yes       | POST   | `/crm/v8/{Module}/upsert`                     | 100        | `duplicate_check_fields` controls match         |
| Bulk create/update | yes       | same   | same as above                                 | 100        | Returns 207 on partial success                  |
| Async bulk         | yes       | POST   | `/crm/bulk/v8/write`                          | 25000/file | CSV in pre-signed URL                           |
| State transitions  | implicit  | PUT    | update `Stage` / `Status` / `Lead_Status`     |            | No dedicated transition endpoint                |
| Lead conversion    | yes       | POST   | `/crm/v8/Leads/{id}/actions/convert`          | 1          | 5 credits; creates downstream records           |
| File upload        | yes       | POST   | `/crm/v8/{Module}/{id}/Attachments`           |            | multipart/form-data; NOT callable from chat yet |

---

## Common Patterns

### Pattern 1: Create

Single record or a batch — always wrap in `{"data": [ … ]}`.

```http
POST /crm/v8/Leads
Authorization: Zoho-oauthtoken {access_token}
Content-Type: application/json

{
  "data": [
    { "Last_Name": "Smith", "First_Name": "Jane", "Company": "Acme", "Email": "jane@acme.example", "Lead_Source": "Web Form" }
  ],
  "trigger": ["workflow"]
}
```

**Response (200 SUCCESS):**

```json
{
  "data": [
    {
      "code": "SUCCESS",
      "details": { "id": "410405000002264200", "Created_Time": "2026-04-23T10:00:00+10:00" },
      "message": "record added",
      "status": "success"
    }
  ]
}
```

**Required fields per module:**

| Module   | Required                                                 | Notes                       |
| -------- | -------------------------------------------------------- | --------------------------- |
| Leads    | `Last_Name`, `Company`                                   | `Layout.id` if multi-layout |
| Contacts | `Last_Name`                                              |                             |
| Accounts | `Account_Name`                                           |                             |
| Deals    | `Deal_Name`, `Stage`, `Closing_Date`                     |                             |
| Tasks    | `Subject`                                                |                             |
| Notes    | `Parent_Id`, `se_module`, one of Note_Title/Note_Content |                             |

Always confirm per-tenant via `GET /crm/v8/settings/fields?module={Module}` — admins can mark additional fields as required.

**Server-generated fields:** `id`, `Created_By`, `Created_Time`, `Modified_By`, `Modified_Time`.

**`trigger` array controls automations:**

| Value           | Effect                           |
| --------------- | -------------------------------- |
| `workflow`      | Fire workflow rules              |
| `approval`      | Route through approval processes |
| `blueprint`     | Enforce blueprint transitions    |
| `pathfinder`    | Fire journey builder             |
| `orchestration` | Fire orchestration flows         |
| _(omitted)_     | Fire ALL by default              |
| `[]`            | Fire NONE                        |

Default in Numa: `["workflow"]`. Keeps automations but skips approvals/blueprints the user may not want.

**Idempotency:** POST is NOT idempotent. Retrying a create on a duplicate will fail with per-record `DUPLICATE_DATA`. Use `/upsert` when retries are possible.

---

### Pattern 2: Update (Partial)

Single record:

```http
PUT /crm/v8/Leads/410405000002264200
Content-Type: application/json

{ "data": [ { "Lead_Status": "Contacted", "Phone": "+61 3 9001 0000" } ] }
```

Multiple records (include `id` per record):

```http
PUT /crm/v8/Leads
Content-Type: application/json

{ "data": [
  { "id": "410405000002264200", "Lead_Status": "Contacted" },
  { "id": "410405000002264201", "Lead_Status": "Junk" }
] }
```

**Response (200 or 207):**

```json
{
  "data": [
    {
      "code": "SUCCESS",
      "details": { "id": "410405000002264200", "Modified_Time": "2026-04-23T10:05:00+10:00" },
      "message": "record updated",
      "status": "success"
    }
  ]
}
```

**Behaviour:**

- Only included fields are modified — omitted fields are untouched.
- Sending `null` clears a field (except required fields — clearing required returns `MANDATORY_NOT_FOUND`).
- `Modified_Time` is server-set on every write.

---

### Pattern 3: Upsert

Preferred for any workflow that might be retried or that treats a real-world identifier (email) as the source of truth.

```http
POST /crm/v8/Leads/upsert
Content-Type: application/json

{
  "data": [
    { "Last_Name": "Patricia", "First_Name": "Jane", "Company": "Zoho", "Email": "patricia@zoho.com" }
  ],
  "duplicate_check_fields": ["Email"],
  "trigger": ["workflow"]
}
```

**Behaviour:**

- If a record exists with matching `Email`, it's UPDATED.
- Otherwise, a new record is CREATED.
- Per-record status is `SUCCESS` with `action` in details (`"insert"` | `"update"`).

**If `duplicate_check_fields` is omitted**, Zoho uses the module's default dedupe field (Email on Leads/Contacts, Account_Name on Accounts) plus any admin-configured unique fields in order.

**Max per call:** 100 records.

---

### Pattern 4: Delete

Soft delete (goes to Recycle Bin; restore via UI or read via `GET /{Module}/deleted?type=recycle`).

Single record:

```http
DELETE /crm/v8/Leads/410405000002264200
```

Multiple records:

```http
DELETE /crm/v8/Leads?ids=410405000002264200,410405000002264201&wf_trigger=true
```

**Response (200 or 207):**

```json
{
  "data": [
    { "code": "SUCCESS", "details": { "id": "410405000002264200" }, "message": "record deleted", "status": "success" }
  ]
}
```

**Behaviour:**

- Soft delete — restorable from Recycle Bin for 60 days.
- Subforms (line items, nested records) are deleted alongside.
- `wf_trigger=false` skips workflow rules (default `true`).
- Cascades to notes/tasks? No — they become orphans (Parent_Id still set but parent 404s).

---

### Pattern 5: State Transition

Zoho has no dedicated "transition" endpoint — state lives in a picklist field that you update:

```http
PUT /crm/v8/Deals/410405000002264100
Content-Type: application/json

{ "data": [ { "Stage": "Closed Won" } ] }
```

**If a Blueprint is configured for the module and the user is in a restricted role:**

- Illegal transition returns `INVALID_DATA` with a blueprint-specific message.
- Required transition fields (Zoho's Blueprint can demand mandatory data on transition) must be supplied in the same PUT.

**Valid transitions:** see `01a-domain-model-reference.md` state machine diagrams.

---

### Pattern 6: Nested / Related Record Operations

Notes, Attachments, Tasks, Calls are created as standalone records with a polymorphic parent reference.

**Create a note on a Deal:**

```http
POST /crm/v8/Notes

{ "data": [ { "Note_Title": "Call summary", "Note_Content": "User wants to expand to EMEA in Q3.", "Parent_Id": "410405000002264100", "se_module": "Deals" } ] }
```

**Create a task linked to a Contact (the "Who") and a Deal (the "What"):**

```http
POST /crm/v8/Tasks

{ "data": [ { "Subject": "Prep proposal", "Due_Date": "2026-04-30", "Priority": "High", "Who_Id": "410405000002264050", "What_Id": "410405000002264100", "$se_module": "Deals" } ] }
```

Note the `$se_module` field (dollar-prefixed, unlike Notes' bare `se_module`). Required when `What_Id` is set.

**Nested object updates:** Zoho supports updating lookup references inline:

```http
PUT /crm/v8/Deals/410405000002264100

{ "data": [ { "Account_Name": { "id": "410405000002264060" } } ] }
```

Only `{id: …}` is read on writes; `name` is ignored (server-fills on next read).

---

## Field Validation Rules

| Entity  | Field          | Rule                                             | Error if violated                      |
| ------- | -------------- | ------------------------------------------------ | -------------------------------------- |
| Lead    | `Last_Name`    | Required, non-empty                              | `MANDATORY_NOT_FOUND`                  |
| Lead    | `Company`      | Required, non-empty                              | `MANDATORY_NOT_FOUND`                  |
| Lead    | `Email`        | Unique per module by default; valid email format | `DUPLICATE_DATA` / `INVALID_DATA`      |
| Contact | `Last_Name`    | Required                                         | `MANDATORY_NOT_FOUND`                  |
| Deal    | `Stage`        | Must be a picklist value configured for the org  | `INVALID_DATA`                         |
| Deal    | `Closing_Date` | Required; `YYYY-MM-DD`                           | `MANDATORY_NOT_FOUND` / `INVALID_DATA` |
| Task    | `Due_Date`     | `YYYY-MM-DD` if set                              | `INVALID_DATA`                         |
| any     | `Owner`        | Must be a valid user id in the org               | `INVALID_DATA`                         |
| any     | `Layout.id`    | Required if module has >1 layout                 | `MANDATORY_NOT_FOUND`                  |
| any     | picklist       | Values case-sensitive and tenant-configured      | `INVALID_DATA`                         |
| any     | datetime       | ISO 8601 with offset; `Z` accepted               | `INVALID_DATA`                         |

**Common validation patterns:**

- **Required fields:** discover via `GET /settings/fields?module={Module}` — look at `required: true` on each field definition.
- **Max lengths:** per field; check `length` in settings/fields response.
- **Numeric ranges:** check `min` / `max` in field spec; for currency fields, `decimal_place` tells you the precision.
- **Regex patterns:** not exposed via the API — only validated server-side with a generic `INVALID_DATA` error.

---

## Server-Side Defaults

| Entity | Field              | Default value                      | When applied      |
| ------ | ------------------ | ---------------------------------- | ----------------- |
| any    | `id`               | auto-generated                     | create            |
| any    | `Created_By`       | current user                       | create            |
| any    | `Created_Time`     | current timestamp                  | create            |
| any    | `Modified_By`      | current user                       | create, update    |
| any    | `Modified_Time`    | current timestamp                  | create, update    |
| any    | `Owner`            | creating user                      | create (if unset) |
| Lead   | `Converted`        | `false`                            | create            |
| Lead   | `Lead_Status`      | `"Not Contacted"` (or org default) | create (if unset) |
| Task   | `Status`           | `"Not Started"`                    | create (if unset) |
| Deal   | `Probability`      | derived from `Stage`               | create, update    |
| Deal   | `Expected_Revenue` | `Amount × Probability / 100`       | create, update    |

---

## Worked Examples

### Example 1: Create a Lead with the minimum viable body

```http
POST /crm/v8/Leads
Content-Type: application/json

{ "data": [ { "Last_Name": "Smith", "Company": "Acme" } ] }
```

**Response (200):**

```json
{
  "data": [
    {
      "code": "SUCCESS",
      "details": { "id": "410405000002264200", "Created_Time": "2026-04-23T10:00:00+10:00" },
      "message": "record added",
      "status": "success"
    }
  ]
}
```

**Notes:**

- `trigger` omitted → all automations fire.
- No Email → no dedupe conflict possible.
- Lead_Status and Owner default server-side.

---

### Example 2: Bulk create with one record missing a required field (partial 207)

```http
POST /crm/v8/Contacts
Content-Type: application/json

{ "data": [
  { "Last_Name": "Smith", "Email": "smith@acme.example" },
  { "First_Name": "Jane", "Email": "jane@acme.example" }
] }
```

**Response (207 Multi-Status):**

```json
{
  "data": [
    {
      "code": "SUCCESS",
      "details": { "id": "410405000002264050", "Created_Time": "2026-04-23T10:00:00+10:00" },
      "message": "record added",
      "status": "success"
    },
    {
      "code": "MANDATORY_NOT_FOUND",
      "details": { "api_name": "Last_Name", "json_path": "$.data[1].Last_Name" },
      "message": "required field not found",
      "status": "error"
    }
  ]
}
```

**Notes:**

- First record created (success). Second failed on missing `Last_Name`.
- Must iterate `data[i].status`. Report the single error to the user; offer to retry just the failed one with the missing field populated.

---

### Example 3: Convert a Lead to Contact + Account + Deal

```http
POST /crm/v8/Leads/410405000002264200/actions/convert
Content-Type: application/json

{
  "data": [
    {
      "overwrite": false,
      "notify_lead_owner": true,
      "notify_new_entity_owner": true,
      "Accounts": "410405000002264060",
      "Deals": {
        "Deal_Name": "Acme – new opportunity",
        "Stage": "Qualification",
        "Amount": 25000,
        "Closing_Date": "2026-07-31"
      }
    }
  ]
}
```

**Response (200):**

```json
{ "data": [{ "Contacts": "410405000002264050", "Accounts": "410405000002264060", "Deals": "410405000002264100" }] }
```

**Notes:**

- `Accounts` can be an existing ID (reuse) or omitted (creates new from Lead's `Company`).
- `Deals` is optional — if included, creates a deal; if omitted, just Contact+Account.
- Costs **5 credits** (vs 1 for normal create). Warn the user this is irreversible via API — they'd undo manually in Zoho UI.
- Lead is NOT deleted — it's marked `Converted: true`.

---

## Gotchas & Counter-Exceptions

1. **Always wrap in `{"data": [...]}`.** Even a single record. Sending `{Last_Name: "…"}` directly returns 400 `INVALID_DATA`.
2. **`trigger: []` skips ALL automations, not just some.** Most scripts want `["workflow"]` — keeps workflow rules firing but doesn't run approvals or blueprint transitions.
3. **Null semantics: `null` clears a field, `""` does NOT.** Sending `"Email": ""` creates/updates with an empty-string email, which may violate format validation. Send `null` or omit the field.
4. **Polymorphic children — dollar-prefix inconsistency.** Notes use `se_module`, Tasks use `$se_module`. Yes, really.
5. **Upsert match order matters.** If `duplicate_check_fields: ["Email", "Phone"]`, Zoho checks Email first; if matched, it updates even if Phone is different. If you want BOTH to match, you need a custom unique field, not two dedupe fields.
6. **Blueprint-gated transitions eat the PUT body.** If the blueprint demands additional fields on transition, you'll get `INVALID_DATA` and your PUT won't persist any of the other fields — not a partial save.
7. **`Layout` field is not discoverable via `/settings/fields`** — it's on `/settings/layouts?module={Module}`. Pull layouts during setup; cache the default.
8. **Partial HTTP 200 vs 207 is inconsistent.** Some batch operations return 200 with per-record errors inside `data[]`; some return 207. Always inspect `data[i].status` regardless of outer status code.

---

## Dangerous Operations

> Operations that are destructive, irreversible via API, or have significant side effects.
> Confirm with the user before executing.

| Operation                             | Why dangerous                                                                              | Safeguard                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Lead conversion                       | Creates 2–3 new records (Contact + Account + Deal); 5 credits; reversible only via Zoho UI | Confirm with user; show the Contact/Account/Deal preview                 |
| Delete (single or bulk)               | Soft-delete — restorable for 60 days, then gone                                            | Confirm count and show sample; check if user meant "mark closed" instead |
| Merge records (`/actions/merge`)      | 50 credits per merge; combines records; reversible only via UI                             | NOT exposed from chat in this iteration — admin tool only                |
| Empty Recycle Bin (`DELETE /deleted`) | Permanent deletion of previously soft-deleted records                                      | NOT exposed from chat; admin-only                                        |
| Blueprint-restricted transitions      | May fire approval/orchestration chains affecting many records                              | Read the blueprint definition first and show user what will happen       |
| `trigger: []` on bulk writes          | Silently skips compliance/legal workflows                                                  | Only use when user explicitly says "skip automations"                    |

---

_Generated from `00-api-investigation-questionnaire.md` Phases 3 and 4._
