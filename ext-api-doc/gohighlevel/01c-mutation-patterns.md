---
api_name: 'GoHighLevel'
api_slug: 'gohighlevel'
generated_from: '00-api-investigation (GoHighLevel, 2026-05-04) + official marketplace docs'
generated_date: '2026-06-10'
source_phases: ['Phase 5: Mutation Patterns']
---

# GoHighLevel -- Mutation Patterns Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs, **no Authorization header**
> (Numa injects the Bearer PIT), and an explicit `Version` header on EVERY call.
> Endpoint paths tagged [DOCS] are documented; body shapes are largely [UNVERIFIED] — the canonical
> safe pattern is **GET a real record first and mirror its field names**.

## Write Capabilities Summary

| Operation          | Supported | Method | Notes                                                                 |
| ------------------ | --------- | ------ | ---------------------------------------------------------------------- |
| Create contact     | Yes       | POST   | `/contacts/` — `locationId` in body [DOCS]                              |
| Upsert contact     | Yes       | POST   | `/contacts/upsert` — dedupe per location settings [DOCS]                |
| Update contact     | Yes       | PUT    | `/contacts/{contactId}` [DOCS]                                          |
| Delete contact     | Yes       | DELETE | `/contacts/{contactId}` — permanent [DOCS]; confirm with user           |
| Tag / untag contact| Yes       | POST/DELETE | `/contacts/{contactId}/tags` [DOCS]                                |
| Update opportunity | Yes       | PUT    | `/opportunities/{id}` — incl. stage moves, status [DOCS]                |
| Create opportunity | Likely    | POST   | SDK service supports CRUD; REST path [UNVERIFIED — probably `/opportunities/`] |
| Send message       | Yes       | POST   | `/conversations/messages` — REAL outbound SMS/email [DOCS]              |
| Create task / note | Likely    | POST   | Contact sub-resources documented as families; paths [UNVERIFIED]        |
| Invoices / blogs / email templates / social posts | Yes per docs | various | Families documented [DOCS]; bodies [UNVERIFIED] — read-first |
| Bulk writes        | Unknown   | —      | "Bulk" appears in contacts docs nav [DOCS]; shape [UNVERIFIED] — write one-at-a-time |
| File upload (Media)| Untested  | POST   | Media Storage family exists [DOCS]; binary through the connector is unvalidated — avoid |

Writes succeed only if the PIT carries the matching **Edit/write scope** — otherwise 403 [DOCS].

## General Rules (apply to every write)

1. **`Version` header on the write call too** — same requirement as reads [DOCS]. Use
   `{"Version": "2021-07-28"}`; the contacts family documents `2023-02-21`.
2. **`Content-Type: application/json`**, body is a **single JSON object** (no array wrapping) [DOCS].
3. **`locationId` belongs in the body** of most creates (contacts shown in docs) [DOCS].
4. **camelCase field names** (`firstName`, `pipelineId`) [DOCS].
5. **Mirror before you write.** Field lists are not pinned — GET an existing record of the same
   entity and copy its exact field names into your payload. Never invent fields.
6. **No idempotency keys are documented** [UNVERIFIED]. A retried POST may duplicate. For contacts,
   prefer **upsert** when re-running is possible; for everything else, read-before-retry (see 01d).
7. **400 vs 422:** both are documented on the contacts endpoints [DOCS] — 400 ≈ malformed request
   (missing Version/locationId/bad JSON), 422 ≈ field-level validation (bad phone, country value).
   The split is [UNVERIFIED]; either way, fix the payload, never retry unchanged.
8. **Capture returned ids.** Create responses appear entity-wrapped (`{"contact": {"id": ...}}` per
   SDK examples [UNVERIFIED for other entities]) — store the id for follow-ups and verification.
9. **Confirm destructive or outward-facing actions with the user first** — deletes, sending
   messages, anything that emails/texts a real human or fires automations.

## Create Patterns

### Pattern 1: Create a contact

```
connectors(name="request", params={"connector": "gohighlevel", "method": "POST",
  "url": "/contacts/", "headers": {"Version": "2021-07-28"},
  "body": {
    "locationId": "ve9EPM428h8vShlRW1KT",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane.smith@acme.co.nz",
    "phone": "+6495551234",
    "tags": ["numa-created"]
  }})
```

- `POST /contacts/` is documented [DOCS]; required-field set beyond `locationId` is [UNVERIFIED] —
  an email or phone is the practical minimum for a useful CRM record.
- Phone in **E.164** [UNVERIFIED — community best practice]; bad formats are a likely 422 source.
- `country`, if sent, must come from the restricted list (docs/other/country) [DOCS].
- Duplicate handling on plain create depends on the location's "Allow Duplicate Contact" setting
  [DOCS] — when in doubt, use upsert (Pattern 2).

### Pattern 2: Upsert a contact (the safe re-runnable write)

```
connectors(name="request", params={"connector": "gohighlevel", "method": "POST",
  "url": "/contacts/upsert", "headers": {"Version": "2021-07-28"},
  "body": {
    "locationId": "ve9EPM428h8vShlRW1KT",
    "email": "jane.smith@acme.co.nz",
    "phone": "+6495551234",
    "firstName": "Jane",
    "lastName": "Smith"
  }})
```

- Documented endpoint [DOCS]. Creates if no match, updates if matched.
- **Dedupe subtlety** [DOCS]: matching follows the location's configured duplicate settings — if the
  email matches contact A and the phone matches contact B, the location's field-priority decides
  which one is updated. After an upsert, GET the returned id and sanity-check it's the record the
  user meant.
- This is the preferred write for "make sure this person exists" and for retry-after-timeout cases.

### Pattern 3: Add / remove tags

```
connectors(name="request", params={"connector": "gohighlevel", "method": "POST",
  "url": "/contacts/{contactId}/tags", "headers": {"Version": "2021-07-28"},
  "body": {"tags": ["vip", "newsletter"]}})

connectors(name="request", params={"connector": "gohighlevel", "method": "DELETE",
  "url": "/contacts/{contactId}/tags", "headers": {"Version": "2021-07-28"},
  "body": {"tags": ["newsletter"]}})
```

Endpoints documented (MCP exposes add/remove tags) [DOCS]; the `{"tags": [...]}` body shape is
[UNVERIFIED] — if rejected, GET the contact and fall back to PUT with the full merged `tags` array.

**⚠️ Tags can fire workflows.** Location automations commonly trigger on tag-added — adding a tag
may send emails/SMS to the contact. Mention this when tagging in bulk. [UNVERIFIED — platform
behaviour, not API-documented]

### Pattern 4: Send a message into a conversation

```
connectors(name="request", params={"connector": "gohighlevel", "method": "POST",
  "url": "/conversations/messages", "headers": {"Version": "2021-07-28"},
  "body": {
    "type": "SMS",
    "contactId": "{contactId}",
    "message": "Hi Jane — confirming Thursday 2pm."
  }})
```

- Endpoint documented [DOCS]; body field names ([UNVERIFIED] — `type`/`contactId`/`message` is the
  common community shape) — expect the 400/422 message to name what's missing.
- **This texts/emails a real person.** ALWAYS show the user the exact message text and recipient and
  get an explicit yes before sending. Never bulk-send without per-batch confirmation.
- SMS delivery also depends on the location's phone/LC-Email setup — a 200 may not equal delivery
  [UNVERIFIED].

### Pattern 5: Create an opportunity ([UNVERIFIED path])

The SDK's `opportunities` service supports CRUD [DOCS], but only search/get/update paths were pinned.
Probe `POST /opportunities/` with a mirror-built body:

```
# 1. GET /opportunities/pipelines?locationId={loc}   → pick pipelineId + stageId
# 2. GET one existing opportunity                    → copy its field names
# 3. POST /opportunities/  [UNVERIFIED]
connectors(name="request", params={"connector": "gohighlevel", "method": "POST",
  "url": "/opportunities/", "headers": {"Version": "2021-07-28"},
  "body": {"locationId": "{loc}", "pipelineId": "{pid}", "pipelineStageId": "{sid}",
           "contactId": "{contactId}", "name": "Acme renewal", "status": "open"}})
```

If 404/405, tell the user opportunity creation isn't available through this connector yet rather
than guessing further paths.

### Pattern 6: Create a task on a contact ([UNVERIFIED path])

Tasks are a documented contact sub-resource (`GET /contacts/{id}/tasks` is pinned [DOCS]); the
create is the natural REST sibling:

```
connectors(name="request", params={"connector": "gohighlevel", "method": "POST",
  "url": "/contacts/{contactId}/tasks", "headers": {"Version": "2021-07-28"},
  "body": {"title": "Call about renewal", "dueDate": "2026-06-12T09:00:00Z", "completed": false}})
```

Body field names ([UNVERIFIED] — `title`/`dueDate`/`completed` is the common shape) — GET the
contact's existing tasks first and mirror. Low-risk write: tasks don't message anyone.

### Pattern 7: Create a note on a contact ([UNVERIFIED path])

```
connectors(name="request", params={"connector": "gohighlevel", "method": "POST",
  "url": "/contacts/{contactId}/notes", "headers": {"Version": "2021-07-28"},
  "body": {"body": "Spoke with Jane — wants the proposal by Friday."}})
```

Notes family is in the contacts docs nav [DOCS]; path and body [UNVERIFIED]. Another low-risk write
— ideal as the FIRST mutation in a new session to validate the write path cheaply before anything
consequential.

## Update Patterns

### Pattern 8: Update a contact

```
# Read first — mirror field names, and know what you're changing
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/{contactId}", "headers": {"Version": "2021-07-28"}})

connectors(name="request", params={"connector": "gohighlevel", "method": "PUT",
  "url": "/contacts/{contactId}", "headers": {"Version": "2021-07-28"},
  "body": {"firstName": "Jane", "phone": "+6421555123"}})
```

- `PUT /contacts/{contactId}` documented [DOCS].
- **PUT semantics (partial vs full replace) are [UNVERIFIED].** Until proven otherwise, treat it as
  potentially destructive: send only the fields you intend to change on the first attempt; if the
  response shows other fields blanked, switch to full-payload PUTs built from the GET.
- Do not send `locationId` changes — contacts don't move between locations via update [UNVERIFIED].

### Pattern 9: Update an opportunity / move pipeline stage

```
# Stage ids come from /opportunities/pipelines (cache them)
connectors(name="request", params={"connector": "gohighlevel", "method": "PUT",
  "url": "/opportunities/{opportunityId}", "headers": {"Version": "2021-07-28"},
  "body": {"pipelineStageId": "{newStageId}"}})

# Mark won / lost
connectors(name="request", params={"connector": "gohighlevel", "method": "PUT",
  "url": "/opportunities/{opportunityId}", "headers": {"Version": "2021-07-28"},
  "body": {"status": "won"}})
```

- `PUT /opportunities/{id}` documented [DOCS]; body field names (`pipelineStageId` vs `stageId`,
  status enum values) are [UNVERIFIED] — GET the opportunity first and mirror its keys exactly.
- Stage moves and status changes can fire location automations (notifications, workflows)
  [UNVERIFIED] — mention it for bulk moves.

## Delete Patterns

```
connectors(name="request", params={"connector": "gohighlevel", "method": "DELETE",
  "url": "/contacts/{contactId}", "headers": {"Version": "2021-07-28"}})
```

- `DELETE /contacts/{contactId}` documented [DOCS]. No restore/trash endpoint found [UNVERIFIED] —
  treat as **permanent**, and deleting a contact likely cascades visibility of their conversations,
  opportunities, and appointments [UNVERIFIED].
- **Protocol:** quote the contact (name + email) back to the user, get an explicit yes, then delete.
  Never bulk-delete from a fuzzy match.
- Other entities: no DELETE paths were pinned — assume not deletable through this connector until a
  documented path is found. Offer status changes (e.g. opportunity `lost`) instead.

## Bulk Write Etiquette

No documented batch endpoints were pinned ("bulk" appears in the contacts docs nav [DOCS], shape
[UNVERIFIED]) — bulk work through this connector means a loop of single writes:

1. **Pace ~1 write/sec, strictly sequential** — rate limits are unknown; the first 429 sets your
   real ceiling (see 01d).
2. **Do one, verify, then proceed.** Run the first record end-to-end (write + GET back) before
   committing to the remaining N-1 — this catches field-shape errors at cost 1, not cost N.
3. **Track progress in a workspace file** (`/workdir/ghl-write-log.json`: input row → returned id /
   error) so an interrupted run can resume without duplicating.
4. **Use upsert for contact loads** — it makes the whole run safely re-runnable [DOCS].
5. **Per-batch confirmation for outward-facing bulk** (messages, tags that may fire workflows) —
   never let a loop text 500 people off one early "yes".

## Verification Reads

Because nothing here is live-validated, verification is part of the write, not optional polish:

| After…                    | Verify with…                                            |
| ------------------------- | -------------------------------------------------------- |
| Contact create/upsert     | `GET /contacts/{returnedId}` — right person, right fields |
| Tag add/remove            | GET the contact — `tags` array contains/lacks the value  |
| Opportunity stage move    | `GET /opportunities/{id}` — stage id changed; map to name via pipelines |
| Message send              | `GET /conversations/{id}/messages` — message appears with `direction: outbound` [UNVERIFIED field] |
| Delete                    | GET returns 404                                          |

Skip verification only for bulk middles (verify first + spot-check); always verify the records the
user will act on.

## Dangerous Operations

| Operation                        | Risk                                                | Mitigation                                                      |
| -------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /conversations/messages`   | Sends a real SMS/email to a human                    | Show exact text + recipient; explicit per-send confirmation       |
| `DELETE /contacts/{id}`          | Permanent; likely cascades                           | Quote record back; explicit yes; never bulk                      |
| Tag adds (esp. bulk)             | Can trigger location workflows → outbound messages   | Warn the user; tag a single test contact first                   |
| Opportunity stage/status changes | Can trigger automations and skew reporting           | Confirm bulk moves; do one, verify, then proceed                  |
| Upsert with both email + phone   | May update a different contact than intended (dedupe priority) | GET the returned id and verify it's the right person   |
| Plain create on duplicate data   | Duplicate contacts if location allows them           | Prefer upsert; search first                                       |
| Retrying a timed-out POST        | Duplicate records (no idempotency keys [UNVERIFIED]) | Read-before-retry (01d); use upsert where it exists               |
| Contact create/upsert itself     | New-contact automations may fire (welcome emails etc.) [UNVERIFIED] | Mention when importing in bulk; test one record first |
| Writes under the wrong `Version` | Schema mismatch → silent field drops [UNVERIFIED]    | Pin one Version value per session; don't mix across calls          |
| PUT with a sparse body           | Unknown partial-vs-replace semantics [UNVERIFIED]    | First write minimal; verify with a GET; escalate to full payloads |

## Safe Mutation Workflow

1. **Resolve `locationId`** (once per session) and confirm you're in the right sub-account.
2. **Read before write** — GET the record (or a sibling) to mirror field names and capture current state.
3. **Confirm intent** — destructive/outward-facing actions get an explicit user yes, with the
   payload restated in plain language.
4. **Write** — single JSON object, camelCase, `Version` header, `locationId` where required.
5. **Check the response** — 2xx + capture the returned id; on 400/422 read the body verbatim and fix;
   on 403 name the missing scope; never claim success without a 2xx.
6. **Verify if it matters** — GET the record back after high-stakes writes; nothing in this file is
   live-validated, so verification is how the first sessions build trust.
7. **Record discrepancies** — when the API contradicts this doc (field names, envelopes, paths),
   surface it and prefer reality.

---

_Generated 2026-06-10 from the 2026-05-04 docs investigation. Companion to `01-llm-api-rules.md`.
See `01a-domain-model-reference.md` for entities/scopes and `01d-event-and-error-handling.md` for
error recovery and safe write retries._
