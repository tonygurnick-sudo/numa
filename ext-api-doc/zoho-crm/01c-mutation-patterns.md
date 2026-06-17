---
api_name: Zoho CRM
api_slug: zoho-crm
doc: mutation patterns — create, update, upsert, delete, Lead conversion, per-record partial-failure
base_url: https://{api_domain}/crm/v8 (region-pinned; see 01)
call_surface: HTTP via `numa integrations request`
body_wrapper: every create/update/upsert uses {"data":[…]}, even one record; max 100/call
confidence: verified 2026-04-23 unless tagged
companion_of: 01-llm-api-rules.md
---

# Zoho CRM — Mutation Patterns

## Write Capabilities

| Operation        | Method | Endpoint                                      | Max batch  | Notes                                           |
| ---------------- | ------ | --------------------------------------------- | ---------- | ----------------------------------------------- |
| Create           | POST   | `/crm/v8/{Module}`                            | 100        | `{"data":[…]}` wrapper required                 |
| Partial update   | PUT    | `/crm/v8/{Module}/{id}` or `/crm/v8/{Module}` | 100        | only included fields change                     |
| Full replace     | —      | —                                             | —          | no "replace" — PUT is always partial            |
| Delete (soft)    | DELETE | `/crm/v8/{Module}?ids=...` or `/{id}`         | 100        | goes to Recycle Bin                             |
| Hard delete      | DELETE | `/crm/v8/{Module}/deleted`                    | —          | empties Recycle Bin, NOT individual hard delete |
| Upsert           | POST   | `/crm/v8/{Module}/upsert`                     | 100        | `duplicate_check_fields` controls match         |
| Async bulk       | POST   | `/crm/bulk/v8/write`                          | 25000/file | CSV in pre-signed URL                           |
| State transition | PUT    | update `Stage`/`Status`/`Lead_Status`         |            | no dedicated transition endpoint                |
| Lead conversion  | POST   | `/crm/v8/Leads/{id}/actions/convert`          | 1          | 5 credits; creates downstream records           |
| File upload      | POST   | `/crm/v8/{Module}/{id}/Attachments`           |            | multipart/form-data; NOT callable from chat yet |

Bulk create/update return 207 on partial success.

## Patterns

### Create

Single or batch — always wrap in `{"data":[…]}`.
`POST /crm/v8/Leads` `{"data":[{"Last_Name":"Smith","First_Name":"Jane","Company":"Acme","Email":"jane@acme.example","Lead_Source":"Web Form"}],"trigger":["workflow"]}`
→ 200: `{"data":[{"code":"SUCCESS","details":{"id":"410405000002264200","Created_Time":"2026-04-23T10:00:00+10:00"},"message":"record added","status":"success"}]}`

Required fields per module (admins can mark more required — confirm via `GET /crm/v8/settings/fields?module={M}`):
| Module | Required |
| --- | --- |
| Leads | `Last_Name`,`Company` (+ `Layout.id` if multi-layout) |
| Contacts | `Last_Name` |
| Accounts | `Account_Name` |
| Deals | `Deal_Name`,`Stage`,`Closing_Date` |
| Tasks | `Subject` |
| Notes | `Parent_Id`,`se_module`, one of `Note_Title`/`Note_Content` |

Server-generated: `id`,`Created_By`,`Created_Time`,`Modified_By`,`Modified_Time`.

`trigger` array controls automations:
| Value | Effect |
| --- | --- |
| `workflow` | fire workflow rules |
| `approval` | route through approvals |
| `blueprint` | enforce blueprint transitions |
| `pathfinder` | fire journey builder |
| `orchestration` | fire orchestration flows |
| _(omitted)_ | fire ALL |
| `[]` | fire NONE |

Numa default `["workflow"]` (keeps workflows, skips approvals/blueprints). POST is NOT idempotent — retrying a create on a duplicate → per-record `DUPLICATE_DATA`; use `/upsert` when retries possible.

### Update (partial)

Single: `PUT /crm/v8/Leads/410405000002264200` `{"data":[{"Lead_Status":"Contacted","Phone":"+61 3 9001 0000"}]}`
Multiple (include `id` per record): `PUT /crm/v8/Leads` `{"data":[{"id":"410405000002264200","Lead_Status":"Contacted"},{"id":"410405000002264201","Lead_Status":"Junk"}]}`
→ 200/207: `{"data":[{"code":"SUCCESS","details":{"id":"410405000002264200","Modified_Time":"2026-04-23T10:05:00+10:00"},"message":"record updated","status":"success"}]}`
Behaviour: only included fields modified; `null` clears a field (except required → `MANDATORY_NOT_FOUND`); `Modified_Time` server-set every write.

### Upsert

Preferred for retryable workflows or when a real-world identifier (email) is the source of truth.
`POST /crm/v8/Leads/upsert` `{"data":[{"Last_Name":"Patricia","First_Name":"Jane","Company":"Zoho","Email":"patricia@zoho.com"}],"duplicate_check_fields":["Email"],"trigger":["workflow"]}`
Behaviour: match on `Email` → UPDATE; else CREATE. Per-record status `SUCCESS` with `action` in details (`"insert"`|`"update"`). If `duplicate_check_fields` omitted, Zoho uses the module's default dedupe field (Email on Leads/Contacts, Account_Name on Accounts) + admin-configured unique fields in order. Max 100/call.

### Delete (soft)

Single: `DELETE /crm/v8/Leads/410405000002264200`
Multiple: `DELETE /crm/v8/Leads?ids=410405000002264200,410405000002264201&wf_trigger=true`
→ 200/207: `{"data":[{"code":"SUCCESS","details":{"id":"410405000002264200"},"message":"record deleted","status":"success"}]}`
Behaviour: soft delete, restorable from Recycle Bin 60 days (read via `GET /{Module}/deleted?type=recycle`); subforms deleted alongside; `wf_trigger=false` skips workflows (default `true`); does NOT cascade to notes/tasks — they orphan (Parent_Id stays set but parent 404s).

### State transition

No dedicated endpoint — update the picklist field:
`PUT /crm/v8/Deals/410405000002264100` `{"data":[{"Stage":"Closed Won"}]}`
If a Blueprint is configured + user in a restricted role: illegal transition → `INVALID_DATA` with a blueprint-specific message; required transition fields (Blueprint can demand mandatory data) must be in the same PUT. Valid transitions: see 01a state machines.

### Nested / related records

Notes, Attachments, Tasks, Calls are standalone records with a polymorphic parent reference.
Note on a Deal: `POST /crm/v8/Notes` `{"data":[{"Note_Title":"Call summary","Note_Content":"User wants to expand to EMEA in Q3.","Parent_Id":"410405000002264100","se_module":"Deals"}]}`
Task linked to Contact (Who) + Deal (What): `POST /crm/v8/Tasks` `{"data":[{"Subject":"Prep proposal","Due_Date":"2026-04-30","Priority":"High","Who_Id":"410405000002264050","What_Id":"410405000002264100","$se_module":"Deals"}]}` — `$se_module` is dollar-prefixed (unlike Notes' bare `se_module`), required when `What_Id` set.
Inline lookup update: `PUT /crm/v8/Deals/410405000002264100` `{"data":[{"Account_Name":{"id":"410405000002264060"}}]}` — only `{id}` read on writes; `name` ignored (server-fills on next read).

## Field Validation

| Entity  | Field          | Rule                                      | Error                                |
| ------- | -------------- | ----------------------------------------- | ------------------------------------ |
| Lead    | `Last_Name`    | required, non-empty                       | `MANDATORY_NOT_FOUND`                |
| Lead    | `Company`      | required, non-empty                       | `MANDATORY_NOT_FOUND`                |
| Lead    | `Email`        | unique per module (default); valid email  | `DUPLICATE_DATA`/`INVALID_DATA`      |
| Contact | `Last_Name`    | required                                  | `MANDATORY_NOT_FOUND`                |
| Deal    | `Stage`        | picklist value configured for org         | `INVALID_DATA`                       |
| Deal    | `Closing_Date` | required; `YYYY-MM-DD`                    | `MANDATORY_NOT_FOUND`/`INVALID_DATA` |
| Task    | `Due_Date`     | `YYYY-MM-DD` if set                       | `INVALID_DATA`                       |
| any     | `Owner`        | valid user id in org                      | `INVALID_DATA`                       |
| any     | `Layout.id`    | required if module has >1 layout          | `MANDATORY_NOT_FOUND`                |
| any     | picklist       | values case-sensitive + tenant-configured | `INVALID_DATA`                       |
| any     | datetime       | ISO 8601 w/ offset; `Z` accepted          | `INVALID_DATA`                       |

Discover required fields, max lengths, numeric `min`/`max`, currency `decimal_place` via `GET /settings/fields?module={M}` (`required:true`, `length`, etc.). Regex patterns not exposed — validated server-side with generic `INVALID_DATA`.

## Server-Side Defaults

| Entity | Field                         | Default                            | When              |
| ------ | ----------------------------- | ---------------------------------- | ----------------- |
| any    | `id`                          | auto-generated                     | create            |
| any    | `Created_By`/`Created_Time`   | current user / timestamp           | create            |
| any    | `Modified_By`/`Modified_Time` | current user / timestamp           | create, update    |
| any    | `Owner`                       | creating user                      | create (if unset) |
| Lead   | `Converted`                   | `false`                            | create            |
| Lead   | `Lead_Status`                 | `"Not Contacted"` (or org default) | create (if unset) |
| Task   | `Status`                      | `"Not Started"`                    | create (if unset) |
| Deal   | `Probability`                 | derived from `Stage`               | create, update    |
| Deal   | `Expected_Revenue`            | `Amount × Probability / 100`       | create, update    |

## Worked Examples

### 1. Create a Lead, minimum body

`POST /crm/v8/Leads` `{"data":[{"Last_Name":"Smith","Company":"Acme"}]}`
→ 200: `{"data":[{"code":"SUCCESS","details":{"id":"410405000002264200","Created_Time":"2026-04-23T10:00:00+10:00"},"message":"record added","status":"success"}]}`
Notes: `trigger` omitted → all automations fire; no Email → no dedupe conflict; Lead_Status + Owner default server-side.

### 2. Bulk create, one record missing a required field (partial 207)

`POST /crm/v8/Contacts` `{"data":[{"Last_Name":"Smith","Email":"smith@acme.example"},{"First_Name":"Jane","Email":"jane@acme.example"}]}`
→ 207: `{"data":[{"code":"SUCCESS","details":{"id":"410405000002264050","Created_Time":"2026-04-23T10:00:00+10:00"},"message":"record added","status":"success"},{"code":"MANDATORY_NOT_FOUND","details":{"api_name":"Last_Name","json_path":"$.data[1].Last_Name"},"message":"required field not found","status":"error"}]}`
Notes: first created, second failed on missing `Last_Name`. Iterate `data[i].status`; report the error and offer to retry just the failed one with the field populated.

### 3. Convert a Lead → Contact + Account + Deal

`POST /crm/v8/Leads/410405000002264200/actions/convert` `{"data":[{"overwrite":false,"notify_lead_owner":true,"notify_new_entity_owner":true,"Accounts":"410405000002264060","Deals":{"Deal_Name":"Acme – new opportunity","Stage":"Qualification","Amount":25000,"Closing_Date":"2026-07-31"}}]}`
→ 200: `{"data":[{"Contacts":"410405000002264050","Accounts":"410405000002264060","Deals":"410405000002264100"}]}`
Notes: `Accounts` = existing ID (reuse) or omit (creates new from Lead's `Company`); `Deals` optional (omit → just Contact+Account). 5 credits (vs 1 for create), irreversible via API (user undoes manually in Zoho UI). Lead NOT deleted — marked `Converted:true`.

## Gotchas

1. Always wrap in `{"data":[...]}`, even one record. `{Last_Name:"…"}` directly → 400 `INVALID_DATA`.
2. `trigger:[]` skips ALL automations, not just some. Most want `["workflow"]`.
3. Null semantics: `null` clears a field; `""` does NOT (creates/updates empty-string, may fail format validation). Send `null` or omit.
4. Polymorphic children — dollar-prefix inconsistency: Notes use `se_module`, Tasks use `$se_module`.
5. Upsert match order: `duplicate_check_fields:["Email","Phone"]` checks Email first; if matched, updates even if Phone differs. To require BOTH, use a custom unique field, not two dedupe fields.
6. Blueprint-gated transitions eat the PUT body: if the blueprint demands extra fields on transition, you get `INVALID_DATA` and the PUT persists NOTHING (not a partial save).
7. `Layout` field is NOT in `/settings/fields` — it's on `/settings/layouts?module={M}`. Pull layouts at setup, cache the default.
8. Partial HTTP 200 vs 207 is inconsistent — some batch ops return 200 with per-record errors, some 207. Always inspect `data[i].status` regardless of outer status.

## Dangerous Operations (confirm with user first)

| Operation                             | Why dangerous                                                                 | Safeguard                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Lead conversion                       | creates 2–3 records (Contact+Account+Deal); 5 credits; reversible only via UI | confirm; show the Contact/Account/Deal preview              |
| Delete (single/bulk)                  | soft-delete — restorable 60 days then gone                                    | confirm count + sample; check if user meant "mark closed"   |
| Merge records (`/actions/merge`)      | 50 credits/merge; reversible only via UI                                      | NOT exposed from chat — admin tool only                     |
| Empty Recycle Bin (`DELETE /deleted`) | permanent deletion of soft-deleted records                                    | NOT exposed from chat — admin-only                          |
| Blueprint-restricted transitions      | may fire approval/orchestration chains affecting many records                 | read blueprint definition first; show user what will happen |
| `trigger:[]` on bulk writes           | silently skips compliance/legal workflows                                     | only when user explicitly says "skip automations"           |
