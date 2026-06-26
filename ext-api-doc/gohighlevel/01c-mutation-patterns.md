---
api_name: GoHighLevel
api_slug: gohighlevel
base_url: https://services.leadconnectorhq.com
path_version_segment: none (version is the Version header, never a path)
auth: Bearer PIT (backend-injected); NEVER set Authorization
required_on_every_write: Version header — BACKEND-INJECTED (2021-07-28 via static_headers; override to 2023-02-21 only for newest contacts schema) + Content-Type application/json (added by the request op) + locationId in body of most creates
field_casing: camelCase; body = single JSON object (no arrays)
call_surface: HTTP via `numa integrations request gohighlevel <METHOD> <URL> --body '{...}'` (Version is backend-injected; add `--headers '{"Version":"2023-02-21"}'` only to override). NOT a file-store connector.
confidence: docs-derived [DOCS], NOT live-validated. Endpoint paths documented; body shapes largely [UNVERIFIED] — canonical safe pattern is GET a real record first and mirror its field names. Markers [UNVERIFIED]/[INFERRED] inline.
companions: 01=api-rules, 01a=domain-model, 01b=query-patterns, 01d=events+errors
---

# GoHighLevel — Mutation Patterns

## Write capabilities

| Operation                                   | Supported    | Method      | Notes                                                                 |
| ------------------------------------------- | ------------ | ----------- | --------------------------------------------------------------------- |
| Create contact                              | Yes          | POST        | /contacts/ — locationId in body                                       |
| Upsert contact                              | Yes          | POST        | /contacts/upsert — dedupe per location settings                       |
| Update contact                              | Yes          | PUT         | /contacts/{contactId}                                                 |
| Delete contact                              | Yes          | DELETE      | /contacts/{contactId} — permanent; confirm with user                  |
| Tag/untag contact                           | Yes          | POST/DELETE | /contacts/{contactId}/tags                                            |
| Update opportunity                          | Yes          | PUT         | /opportunities/{id} — incl. stage moves, status                       |
| Create opportunity                          | Likely       | POST        | SDK supports CRUD; REST path [UNVERIFIED — probably /opportunities/]  |
| Send message                                | Yes          | POST        | /conversations/messages — REAL outbound SMS/email                     |
| Create task/note                            | Likely       | POST        | contact sub-resources documented as families; paths [UNVERIFIED]      |
| Invoices/blogs/email templates/social posts | Yes per docs | various     | families documented; bodies [UNVERIFIED] — read-first                 |
| Bulk writes                                 | Unknown      | —           | "Bulk" in contacts docs nav; shape [UNVERIFIED] — write one-at-a-time |
| File upload (Media)                         | Untested     | POST        | Media Storage exists; binary through connector unvalidated — avoid    |

Writes succeed only if the PIT carries the matching Edit/write scope — else 403.

## General rules (every write)

1. **Version header** on the write call too; `2021-07-28` (contacts family documents `2023-02-21`).
2. **Content-Type application/json**, body = single JSON object (no array wrapping).
3. **locationId in the body** of most creates (contacts shown in docs).
4. **camelCase** field names (`firstName`, `pipelineId`).
5. **Mirror before you write** — GET an existing record of the same entity and copy its exact field names. Never invent fields.
6. **No idempotency keys** [UNVERIFIED]. A retried POST may duplicate. For contacts prefer **upsert** when re-running is possible; else read-before-retry (01d).
7. **400 vs 422:** both documented on contacts — 400 ≈ malformed (missing Version/locationId/bad JSON), 422 ≈ field-level validation (bad phone, country value). Split [UNVERIFIED]; either way fix the payload, never retry unchanged.
8. **Capture returned ids.** Create responses appear entity-wrapped (`{"contact":{"id":...}}` per SDK [UNVERIFIED for other entities]) — store the id for follow-ups.
9. **Confirm destructive/outward-facing actions first** — deletes, sending messages, anything that emails/texts a real human or fires automations.

## Create

### 1: Create a contact

```
numa integrations request gohighlevel POST /contacts/ --body '{"locationId":"ve9EPM428h8vShlRW1KT","firstName":"Jane","lastName":"Smith","email":"jane.smith@acme.co.nz","phone":"+6495551234","tags":["numa-created"]}' -m "create contact"
```

- `POST /contacts/` documented; required-field set beyond `locationId` [UNVERIFIED] — email or phone is the practical minimum.
- Phone E.164 [UNVERIFIED]; bad formats are a likely 422.
- `country`, if sent, from the restricted list (docs/other/country).
- Duplicate handling on plain create depends on the location's "Allow Duplicate Contact" setting — when in doubt, upsert (Pattern 2).

### 2: Upsert a contact (the safe re-runnable write)

```
numa integrations request gohighlevel POST /contacts/upsert --body '{"locationId":"ve9EPM428h8vShlRW1KT","email":"jane.smith@acme.co.nz","phone":"+6495551234","firstName":"Jane","lastName":"Smith"}' -m "upsert contact"
```

- Documented. Creates if no match, updates if matched.
- **Dedupe subtlety:** matching follows the location's duplicate settings — if email matches contact A and phone matches contact B, the location's field-priority decides which is updated. After upsert, GET the returned id and sanity-check it's the right record.
- Preferred write for "make sure this person exists" and retry-after-timeout.

### 3: Add / remove tags

```
numa integrations request gohighlevel POST /contacts/{contactId}/tags --body '{"tags":["vip","newsletter"]}' -m "add tags"
numa integrations request gohighlevel DELETE /contacts/{contactId}/tags --body '{"tags":["newsletter"]}' -m "remove tag"
```

Endpoints documented (MCP exposes add/remove); `{"tags":[...]}` body shape [UNVERIFIED] — if rejected, GET the contact and fall back to PUT with the full merged `tags` array.
**⚠️ Tags can fire workflows.** Location automations commonly trigger on tag-added — adding a tag may send emails/SMS to the contact. Mention this when tagging in bulk [UNVERIFIED — platform behaviour, not API-documented].

### 4: Send a message into a conversation

```
numa integrations request gohighlevel POST /conversations/messages --body '{"type":"SMS","contactId":"{contactId}","message":"Hi Jane — confirming Thursday 2pm."}' -m "send SMS"
```

- Endpoint documented; body field names [UNVERIFIED] — `type`/`contactId`/`message` is the common community shape; expect the 400/422 to name what's missing.
- **This texts/emails a real person.** ALWAYS show the user exact message text + recipient and get an explicit yes before sending. Never bulk-send without per-batch confirmation.
- SMS delivery also depends on the location's phone/LC-Email setup — a 200 may not equal delivery [UNVERIFIED].

### 5: Create an opportunity ([UNVERIFIED path])

SDK's `opportunities` service supports CRUD, but only search/get/update paths were pinned. Probe `POST /opportunities/` with a mirror-built body:

```
# 1. GET /opportunities/pipelines?locationId={loc}  → pick pipelineId + stageId
# 2. GET one existing opportunity                   → copy its field names
numa integrations request gohighlevel POST /opportunities/ --body '{"locationId":"{loc}","pipelineId":"{pid}","pipelineStageId":"{sid}","contactId":"{contactId}","name":"Acme renewal","status":"open"}' -m "create opportunity"
```

If 404/405, tell the user opportunity creation isn't available through this connector yet rather than guessing further paths.

### 6: Create a task on a contact ([UNVERIFIED path])

Tasks are a documented contact sub-resource (`GET /contacts/{id}/tasks` pinned); create is the natural REST sibling:

```
numa integrations request gohighlevel POST /contacts/{contactId}/tasks --body '{"title":"Call about renewal","dueDate":"2026-06-12T09:00:00Z","completed":false}' -m "create task"
```

Body names [UNVERIFIED] — `title`/`dueDate`/`completed` is the common shape; GET the contact's existing tasks first and mirror. Low-risk write: tasks don't message anyone.

### 7: Create a note on a contact ([UNVERIFIED path])

```
numa integrations request gohighlevel POST /contacts/{contactId}/notes --body '{"body":"Spoke with Jane — wants the proposal by Friday."}' -m "create note"
```

Notes family in the contacts docs nav; path and body [UNVERIFIED]. Low-risk — ideal as the FIRST mutation in a new session to validate the write path cheaply before anything consequential.

## Update

### 8: Update a contact

```
# Read first — mirror field names, know what you're changing
numa integrations request gohighlevel GET /contacts/{contactId} -m "get contact"
numa integrations request gohighlevel PUT /contacts/{contactId} --body '{"firstName":"Jane","phone":"+6421555123"}' -m "update contact"
```

- `PUT /contacts/{contactId}` documented.
- **PUT semantics (partial vs full replace) [UNVERIFIED].** Until proven otherwise, treat as potentially destructive: send only the fields you intend to change first; if the response shows other fields blanked, switch to full-payload PUTs built from the GET.
- Don't send `locationId` changes — contacts don't move between locations via update [UNVERIFIED].

### 9: Update an opportunity / move pipeline stage

```
# stage ids come from /opportunities/pipelines (cache them)
numa integrations request gohighlevel PUT /opportunities/{opportunityId} --body '{"pipelineStageId":"{newStageId}"}' -m "move stage"
numa integrations request gohighlevel PUT /opportunities/{opportunityId} --body '{"status":"won"}' -m "mark won"
```

- `PUT /opportunities/{id}` documented; body names (`pipelineStageId` vs `stageId`, status enum values) [UNVERIFIED] — GET the opportunity first and mirror its keys exactly.
- Stage/status moves can fire location automations (notifications, workflows) [UNVERIFIED] — mention it for bulk moves.

## Delete

```
numa integrations request gohighlevel DELETE /contacts/{contactId} -m "delete contact"
```

- `DELETE /contacts/{contactId}` documented. No restore/trash endpoint found [UNVERIFIED] — treat as **permanent**; deleting a contact likely cascades visibility of their conversations, opportunities, appointments [UNVERIFIED].
- **Protocol:** quote the contact (name + email) back, get an explicit yes, then delete. Never bulk-delete from a fuzzy match.
- Other entities: no DELETE paths pinned — assume not deletable through this connector until a documented path is found. Offer status changes (e.g. opportunity `lost`) instead.

## Bulk write etiquette

No documented batch endpoints pinned ("bulk" in contacts docs nav [DOCS], shape [UNVERIFIED]) — bulk = a loop of single writes:

1. **Pace ~1 write/sec, strictly sequential** — the first 429 sets your real ceiling (01d).
2. **Do one, verify, then proceed** — run the first record end-to-end (write + GET back) before the remaining N-1; catches field-shape errors at cost 1, not N.
3. **Track progress in a workspace file** (`/workdir/ghl-write-log.json`: input row → returned id / error) so an interrupted run resumes without duplicating.
4. **Use upsert for contact loads** — makes the run safely re-runnable.
5. **Per-batch confirmation for outward-facing bulk** (messages, tags that may fire workflows) — never let a loop text 500 people off one early "yes".

## Verification reads (part of the write, not optional)

| After…                 | Verify with…                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Contact create/upsert  | `GET /contacts/{returnedId}` — right person, right fields                                          |
| Tag add/remove         | GET the contact — `tags` array contains/lacks the value                                            |
| Opportunity stage move | `GET /opportunities/{id}` — stage id changed; map to name via pipelines                            |
| Message send           | `GET /conversations/{id}/messages` — message appears with `direction: outbound` [UNVERIFIED field] |
| Delete                 | GET returns 404                                                                                    |

Skip verification only for bulk middles (verify first + spot-check); always verify records the user will act on.

## Dangerous operations

| Operation                        | Risk                                                                | Mitigation                                                        |
| -------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /conversations/messages`   | sends a real SMS/email to a human                                   | show exact text + recipient; explicit per-send confirmation       |
| `DELETE /contacts/{id}`          | permanent; likely cascades                                          | quote record back; explicit yes; never bulk                       |
| Tag adds (esp. bulk)             | can trigger location workflows → outbound messages                  | warn the user; tag a single test contact first                    |
| Opportunity stage/status changes | can trigger automations and skew reporting                          | confirm bulk moves; do one, verify, then proceed                  |
| Upsert with both email + phone   | may update a different contact than intended (dedupe priority)      | GET the returned id and verify                                    |
| Plain create on duplicate data   | duplicate contacts if location allows them                          | prefer upsert; search first                                       |
| Retrying a timed-out POST        | duplicate records (no idempotency keys [UNVERIFIED])                | read-before-retry (01d); use upsert where it exists               |
| Contact create/upsert itself     | new-contact automations may fire (welcome emails etc.) [UNVERIFIED] | mention when importing in bulk; test one record first             |
| Writes under the wrong `Version` | schema mismatch → silent field drops [UNVERIFIED]                   | pin one Version value per session; don't mix                      |
| PUT with a sparse body           | unknown partial-vs-replace semantics [UNVERIFIED]                   | first write minimal; verify with a GET; escalate to full payloads |

## Safe mutation workflow

1. **Resolve locationId** (once per session) and confirm the right sub-account.
2. **Read before write** — GET the record (or a sibling) to mirror field names and capture current state.
3. **Confirm intent** — destructive/outward-facing actions get an explicit yes, payload restated in plain language.
4. **Write** — single JSON object, camelCase, Version header, locationId where required.
5. **Check the response** — 2xx + capture the returned id; on 400/422 read the body verbatim and fix; on 403 name the missing scope; never claim success without a 2xx.
6. **Verify if it matters** — GET the record back after high-stakes writes.
7. **Record discrepancies** — when the API contradicts this doc (field names, envelopes, paths), surface it and prefer reality.
