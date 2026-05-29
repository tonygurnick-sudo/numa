---
api_name: 'PMO365'
api_slug: 'pmo365'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# PMO365 -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. PMO365 has no API of its own — all of this
> describes the **Microsoft Dataverse Web API** (OData v4) that backs it. Covers the
> (lack of a) Numa event receiver and the `modifiedon` polling fallback, the Dataverse
> error body, service-protection limits, the mandatory `Retry-After` backoff, and a
> full recovery-by-status playbook.
>
> **Discovery-first reminder:** PMO365's custom table/column names (`pmo_*`) are
> proprietary and undocumented. Every example below that names a `pmo_*` table or
> field is **[INFERRED] illustrative only** — resolve the real names at runtime via
> the discovery queries in `01-llm-api-rules.md` / `01c` (solutions →
> solutioncomponents → EntityDefinitions) or `$metadata`. Never present a `pmo_*`
> name as confirmed.

---

## Event-Driven Capabilities

| Mechanism                | Supported              | Notes                                                                                                                                                               |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhooks                 | platform-yes / Numa-no | Dataverse supports webhooks via the plug-in/Service Endpoint registration. **No Numa receiver wired up yet** — see below.                                           |
| WebSocket                | no                     | Dataverse Web API does not expose WebSocket.                                                                                                                        |
| Server-Sent Events (SSE) | no                     | Not offered.                                                                                                                                                        |
| Long polling             | no                     | No long-poll endpoint. Use interval polling on `modifiedon` instead.                                                                                                |
| Change feeds / streams   | platform-yes / Numa-no | Dataverse "change tracking" (`Prefer: odata.track-changes` + delta links) and Power Automate triggers exist, but Numa does not consume them for this connector yet. |

---

## Webhooks

> **Numa status: NOT AVAILABLE.** The PMO365 connector does **not** register webhooks,
> Service Endpoints, or Power Automate flows on behalf of users, and Numa has **no
> public HTTPS receiver** wired up for this connector. If the user asks about
> real-time alerts ("notify me when a project status changes"), tell them it's
> **polling-only** for now (see Polling Fallback below). The section below documents
> what we'd build _if_ push notifications get prioritised — it is not live.

### Setup (future, not implemented)

- **Registration method:** Dataverse webhooks are registered as **Service Endpoints**
  via the Plug-in Registration Tool, the SDK, or `POST /serviceendpoints` on the Web
  API. They are **not** registered with a simple `POST .../watch` like most SaaS APIs —
  registration is a metadata/customisation operation, not a per-user API call.
- **URL requirements:** HTTPS public endpoint. Dataverse does not ping the URL on
  registration; it POSTs on the registered table event (Create/Update/Delete).
- **Alternative:** a **Power Automate** "When a row is added, modified or deleted"
  trigger pointed at a Numa HTTPS action. Lower-code, but still needs a Numa receiver.

```http
POST /serviceendpoints
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
Content-Type: application/json

{
  "name": "Numa PMO365 change notifications",
  "contract": 8,                                   // WebHook
  "url": "https://{client}.numa.arcanum.ai/api/pmo365/webhook",
  "authtype": 4,                                   // HttpHeader
  "messageformat": 2                               // JSON
}
```

> A registered Service Endpoint still needs an SDK Message Processing Step ("step")
> bound to it for each table/message you want delivered — i.e. this is a multi-step
> customisation, not a one-shot subscribe call.

### Event Catalog (future)

| Event (message) | Trigger                           | Key payload fields                                        | Notes                                                   |
| --------------- | --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `Create`        | Row created in a registered table | `PrimaryEntityName`, `PrimaryEntityId`, `InputParameters` | Bind a step per table (e.g. `pmo_project` [INFERRED]).  |
| `Update`        | Row updated                       | same + changed attributes in `InputParameters`            | Filter attributes at step registration to reduce noise. |
| `Delete`        | Row deleted                       | `PrimaryEntityName`, `PrimaryEntityId`                    |                                                         |

### Payload Format (future)

Dataverse delivers a serialised **`RemoteExecutionContext`**, not a tidy record. It
contains the message name, the primary entity logical name + id, and `InputParameters`
/ `PreEntityImages` / `PostEntityImages` (only the images you registered). It does
**not** contain a full hydrated row by default — you re-fetch via `GET /{entityset}({id})`.

```json
{
  "MessageName": "Update",
  "PrimaryEntityName": "pmo_project",
  "PrimaryEntityId": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "InputParameters": [
    {
      "key": "Target",
      "value": {
        "LogicalName": "pmo_project",
        "Id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        "Attributes": [{ "key": "statuscode", "value": { "Value": 2 } }]
      }
    }
  ],
  "OperationCreatedOn": "/Date(1748505600000)/"
}
```

> `pmo_project` above is **[INFERRED] illustrative** — the real table name comes from
> discovery. `OperationCreatedOn` uses the legacy `/Date(ms)/` serialisation, not ISO-8601.

### Verification / Security (future)

- **Signature:** Dataverse webhooks do **not** HMAC-sign the body. With
  `authtype: HttpHeader` you register a **static secret header** (e.g.
  `x-numa-shared-secret`) that Dataverse echoes on every POST — verify that header
  matches your stored secret and reject otherwise. That is the only verification.
- **IP allowlist:** Dataverse egress IPs vary by region/Azure; not a reliable primary
  control. Rely on the shared-secret header + HTTPS.

### Reliability (future)

- **Retry policy:** Dataverse retries failed webhook deliveries with exponential
  backoff for up to ~24 hours, then drops (asynchronous step behaviour).
- **Ordering:** best-effort, not guaranteed. Build idempotent handlers keyed on
  `(PrimaryEntityName, PrimaryEntityId, MessageName)` + a monotonic field.
- **Duplicate delivery:** possible on retry — dedupe on your end.

---

## WebSocket / SSE

Not applicable — the Dataverse Web API exposes neither WebSocket nor SSE.

---

## Polling Fallback

**Numa's current default and only change-detection mechanism for PMO365.** Use this
whenever the user asks "what changed?", "any new projects since yesterday?", or we need
to detect updates without a push channel.

### Recommended Approach

Every Dataverse row carries a server-set `modifiedon` (ISO-8601 UTC) audit column.
Filter on it, order by it, and keep a high-water mark.

- **Endpoint (illustrative table):**

  ```http
  GET /pmo_projects?$select=pmo_projectid,pmo_name,statuscode,modifiedon
                   &$filter=modifiedon gt 2026-05-29T09:00:00Z
                   &$orderby=modifiedon asc
                   &$top=200
  OData-MaxVersion: 4.0
  OData-Version: 4.0
  Accept: application/json
  Prefer: odata.maxpagesize=200, odata.include-annotations="*"
  ```

  > `pmo_projects` (EntitySetName) / `pmo_projectid` / `pmo_name` are **[INFERRED]
  > illustrative**. Resolve the real EntitySetName + PrimaryIdAttribute +
  > PrimaryNameAttribute first via `GET /EntityDefinitions({metadataid})`.

- **Change detection field:** `modifiedon` (always server-set; never trust client clocks).
- **Recommended interval:** **>= 5 minutes** for active sync; 15–60 min for background.
  Do **not** poll tighter than the service-protection window warrants — see limits below.
- **Request budget for polling:** trivially within the 6,000-requests / 5-min budget.
  Cost is in _combined execution time_, so keep `$select` lean and page size sane.

### Polling Pattern

```
1. high_water = last_seen_modifiedon  (init: now() - lookback, ISO-8601 UTC)
2. Sleep {interval >= 5 min}
3. GET /{entityset}?$select=id,name,modifiedon&$filter=modifiedon gt {high_water}
                   &$orderby=modifiedon asc&$top=200
   (Prefer: odata.maxpagesize=200)
4. While @odata.nextLink present: follow it verbatim, accumulate rows.
5. For each changed row, fetch full detail only if needed.
6. high_water = MAX(modifiedon across returned rows)   // not now()
7. Goto 2
```

### Efficient Polling Tips

- **Advance the high-water mark from the data (`MAX(modifiedon)`), not `now()`** —
  avoids missing rows written during the request and avoids clock skew between Numa
  and the Dataverse server.
- **Use `$orderby=modifiedon asc`** so a truncated page still lets you resume from the
  last row's `modifiedon` safely.
- **Keep `$select` minimal** on the detection query (id + name + `modifiedon` +
  `statuscode`); the combined-execution-time limit is the real constraint, not request count.
- **Follow `@odata.nextLink` verbatim** for paging — never hand-roll `$skip`.
- **Use `>=` overlap guard if exactly-once matters:** poll `modifiedon gt {high_water}`
  but dedupe on the primary id, since two rows can share the same millisecond.
- **Deletes are invisible to `modifiedon` polling.** A deleted row simply stops
  appearing. If delete-detection matters, enable Dataverse **change tracking**
  (`Prefer: odata.track-changes` + delta links) on the table and follow the delta link
  instead — deleted rows come back as `@removed`. (Not currently wired in Numa.)

---

## Error Handling

### Standard Error Response Format

Dataverse returns a single nested `error` object. The `code` is a hex string, is
**not** the HTTP status, and is **frequently empty** — always read `message`.

```json
{
  "error": {
    "code": "0x80040217",
    "message": "pmo_project With Id = 3f2504e0-4f89-41d3-9a0c-0305e82c3301 Does Not Exist"
  }
}
```

**Error fields:**

| Field                                       | Type   | Always present?       | Description                                                                                                                                   |
| ------------------------------------------- | ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`                                     | object | yes                   | Wrapper.                                                                                                                                      |
| `error.code`                                | string | yes (may be `""`)     | Hex Dataverse error code (e.g. `0x80040217`). Unrelated to the HTTP status; often empty.                                                      |
| `error.message`                             | string | yes                   | Human-readable description. This is the field to surface/parse.                                                                               |
| `error.@Microsoft.PowerApps...` annotations | object | only with annotations | When `Prefer: odata.include-annotations="*"` is set, extra debug keys (`ApiExceptionSourceKey`, `ApiStepKey`, etc.) and a help URL are added. |

### Validation Error Format

Dataverse does not return a structured field-by-field list — bad-attribute errors come
back as a 400 with the offending property named **inline in `message`**.

```json
{
  "error": {
    "code": "0x0",
    "message": "An error occurred while validating input parameters: ... 'pmo_budget' value 'high' is not a valid Edm.Decimal."
  }
}
```

> So "validation" parsing means string-matching the attribute name out of `message`.
> Confirm the attribute's real type via `GET /EntityDefinitions({id})/Attributes` or
> `$metadata` before retrying — don't guess at the `pmo_*` type.

### Recovery Playbook

| HTTP | Hex / error code(s)                                | Meaning                                          | Retryable? | Recovery action                                                                                                                                                                                                                                                                | Max retries |
| ---- | -------------------------------------------------- | ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 200  | —                                                  | Success (GET / function)                         | —          | —                                                                                                                                                                                                                                                                              |             |
| 201  | —                                                  | Created (with `Prefer: return=representation`)   | —          | Body is the new row.                                                                                                                                                                                                                                                           |             |
| 204  | —                                                  | Success, no body (Create/Update/Delete)          | —          | Read `OData-EntityId` response header for the new/affected row URL.                                                                                                                                                                                                            |             |
| 400  | `0x80060888`, `0x0`, malformed `$filter`/`$select` | Bad request / bad OData query                    | No         | Fix the query or body per `message`. Verify property names against `$metadata` / `EntityDefinitions`.                                                                                                                                                                          | 0           |
| 401  | `0x80048306` (token expired/invalid)               | Unauthorized                                     | Yes        | Backend refreshes via `organizations` token URL and retries **once**. Second 401 → user must reconnect.                                                                                                                                                                        | 1           |
| 403  | `0x80040220` (privilege check failed)              | Forbidden — missing privilege                    | No         | The Dataverse **Application User**'s security role lacks read/write on this table. Admin grants the role.                                                                                                                                                                      | 0           |
| 404  | `0x80040217` (does not exist), bad resource path   | Not found                                        | No         | Verify the **EntitySetName** (plural, from `EntityDefinitions`) and the record GUID. Re-run discovery if unsure.                                                                                                                                                               | 0           |
| 412  | `0x80060889` (precondition failed)                 | `If-Match` / `If-None-Match` precondition failed | Maybe      | ETag concurrency conflict: either an `If-None-Match: *` create-only where the row **already exists**, or an `If-Match: W/"<etag>"` optimistic-concurrency tag mismatch. Re-fetch, decide create vs update. (An `If-Match: *` PATCH on a **missing** row returns 404, not 412.) | 1           |
| 413  | —                                                  | Payload too large                                | No         | Split a `$batch` / large body into smaller chunks.                                                                                                                                                                                                                             | 0           |
| 429  | `0x80072322` / `0x80072321` / `0x80072326`         | **Service protection limit**                     | Yes        | **Honour `Retry-After` (seconds) — mandatory.** Sleep exactly that long, then retry. See Backoff below.                                                                                                                                                                        | 3           |
| 500  | `0x80040216` (generic server error)                | Internal server error                            | Yes        | Exponential backoff + retry.                                                                                                                                                                                                                                                   | 3           |
| 502  | —                                                  | Bad gateway                                      | Yes        | Retry after ~5s with backoff.                                                                                                                                                                                                                                                  | 3           |
| 503  | —                                                  | Service unavailable / maintenance                | Yes        | Honour `Retry-After` if present, else backoff.                                                                                                                                                                                                                                 | 3           |

### Rate Limit Details

Dataverse calls these **service protection API limits**, not "rate limits". They are
enforced **per user, per web server**, over a **5-minute (300-second) sliding window**,
across **three facets** (you hit a 429 when any one trips):

| Facet (per user, per web server) | Default limit (300s window) | Hex code on breach | Notes                                                                          |
| -------------------------------- | --------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| Number of requests               | **6,000** requests          | `0x80072322`       | Cumulative request count.                                                      |
| Combined execution time          | **1,200,000 ms (20 min)**   | `0x80072321`       | Sum of server-side processing time. Heavy `$filter`/`$expand`/`$apply` add up. |
| Concurrent requests              | **52** (may be higher)      | `0x80072326`       | Trips **immediately** (no overshoot grace). Don't fan out parallel calls.      |

> The brief's "~52s combined execution / concurrency cap" framing maps to two distinct
> facets above: combined execution time is **20 minutes**, and **52** is the
> **concurrent-request** cap (confirmed against Microsoft Dataverse docs, Jan 2026).
> Defaults can vary by environment — treat them as guidance, let `Retry-After` govern.

**Debug-only response headers** (do NOT throttle pre-emptively off these — Microsoft
says they're for debugging and reset across servers):

| Header                                        | Meaning                                                   | Example |
| --------------------------------------------- | --------------------------------------------------------- | ------- |
| `x-ms-ratelimit-burst-remaining-xrm-requests` | Remaining requests for this connection                    | `5832`  |
| `x-ms-ratelimit-time-remaining-xrm-requests`  | Remaining combined execution time (seconds) for this user | `1187`  |
| `Retry-After`                                 | **On 429 only** — seconds to wait before resubmitting     | `12`    |

**Rate-limit (429) exceeded response:**

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
Content-Type: application/json
```

```json
{
  "error": {
    "code": "0x80072322",
    "message": "Number of requests exceeded the limit of 6000 over time window of 300 seconds."
  }
}
```

**Backoff strategy (the `Retry-After` honour is mandatory):**

1. **On 429, read the `Retry-After` header (integer seconds) and sleep exactly that
   long. This is mandatory — Dataverse extends the penalty window if you keep hammering.**
   Do **not** retry sooner, and do **not** ignore it.
2. If (rarely) `Retry-After` is absent on a 429, fall back to exponential backoff:
   start at 2s, double each attempt (2 → 4 → 8 …), cap at 60s.
3. Add jitter (±50%) so concurrent users don't retry in lockstep.
4. **Never fan out concurrent requests to "go faster"** — the concurrency facet
   (`0x80072326`) trips instantly and only digs the hole deeper. Poll/serialise instead.
5. After 3 honoured retries still failing, surface to the user with the `message`.

### Error Code Reference

> Dataverse hex error codes (the `error.code` field). These are **not** HTTP statuses.
> See Microsoft's "Web service error codes" reference for the full list; the common ones:

| Hex code     | HTTP | Meaning                                   | Common cause                                                                                                   | Fix                                                                                                 |
| ------------ | ---- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `0x80040217` | 404  | Record (or referenced row) does not exist | Stale GUID; wrong EntitySetName; deleted row                                                                   | Re-fetch; verify GUID + EntitySetName via `EntityDefinitions`.                                      |
| `0x80048306` | 401  | Auth token invalid/expired                | Access token hit ~1h lifetime                                                                                  | Refresh via `organizations` token URL; second 401 → reconnect.                                      |
| `0x80040220` | 403  | Privilege check failed                    | App User's security role lacks table read/write                                                                | Admin grants the security role on the PMO365 tables.                                                |
| `0x80060888` | 400  | Invalid OData query                       | Bad `$filter` operator; unknown `$select` property                                                             | Validate property names against `$metadata`; check operator syntax.                                 |
| `0x80060889` | 412  | Precondition (ETag) failed                | `If-None-Match: *` create-only when the row already exists, or `If-Match: W/"<etag>"` concurrency tag mismatch | Re-fetch; decide create (POST) vs update (PATCH). (Missing-row `If-Match: *` PATCH → 404, not 412.) |
| `0x80072322` | 429  | Request-count limit (6,000 / 5 min)       | Tight polling / bulk loop                                                                                      | Honour `Retry-After`; slow the cadence.                                                             |
| `0x80072321` | 429  | Execution-time limit (20 min / 5 min)     | Heavy queries (`$expand`, `$apply`, large pages)                                                               | Honour `Retry-After`; trim `$select`/`$expand`; smaller pages.                                      |
| `0x80072326` | 429  | Concurrency limit (52)                    | Parallel request fan-out                                                                                       | Honour `Retry-After`; serialise calls — do not parallelise.                                         |
| `0x80040216` | 500  | Generic server error                      | Transient platform fault                                                                                       | Exponential backoff + retry.                                                                        |

---

## Counter-Exceptions

> Dataverse behaviours that differ from standard HTTP/REST expectations.

1. **`error.code` is a hex string, not the HTTP status — and is often empty.**
   - Standard behaviour: error code mirrors/encodes the HTTP status.
   - Actual: e.g. `0x80040217` with HTTP 404, or `code: ""`. Always branch on the
     **HTTP status** + parse `error.message`; treat `error.code` as a hint only.

2. **PATCH is an UPSERT — it silently creates a row if the id is absent.**
   - Standard behaviour: PATCH updates an existing resource; 404 if missing.
   - Actual: `PATCH /{entityset}({id})` with an unknown GUID **creates** that row.
     Send **`If-Match: *`** to force update-only (you'll get 412 instead of a stray create).

3. **Create returns 204 with no body; the new id is in a header.**
   - Standard behaviour: 201 Created with the new resource in the body.
   - Actual: `POST /{entityset}` → **204 No Content**, new row URL in the
     **`OData-EntityId`** response header. Add `Prefer: return=representation` to get
     201 + body instead.

4. **Pagination is server-driven via `@odata.nextLink`, not `$skip`.**
   - Standard behaviour: client controls offset with `$skip`/`offset`.
   - Actual: Dataverse caps pages (default 5,000) and hands back `@odata.nextLink`.
     Follow it **verbatim**; hand-rolled `$skip` on large sets is unsupported/unreliable.

5. **Lookups are exposed as `_{logicalname}_value`, and labels need an opt-in header.**
   - Standard behaviour: related object inlined or a friendly foreign key.
   - Actual: the raw GUID column is `_pmo_projectmanager_value` [INFERRED]; the
     readable name only appears when you send `Prefer: odata.include-annotations="*"`
     (or `$expand` the navigation property).

6. **`Retry-After` is mandatory and self-worsening if ignored.**
   - Standard behaviour: `Retry-After` is advisory; early retry just fails again.
   - Actual: Dataverse **extends** the penalty duration if you keep sending demanding
     requests inside the window — ignoring `Retry-After` makes the outage longer.

7. **Deletes don't show up in `modifiedon` polling.**
   - Standard behaviour: a change feed includes deletions.
   - Actual: a deleted row just stops appearing. Use change-tracking delta links for
     `@removed` markers if delete-detection matters.

---

## Output Formatting Guide

> How to present Dataverse/PMO365 responses to the user in the workspace agent.

### Recommended Display Formats

| Data Type        | Format            | Example                                                                                                 |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| Single record    | Key-value summary | "**Project: Harbour Bridge Upgrade** — Status: In Progress, Budget: $2,400,000, Modified: May 29, 2026" |
| Record list      | Markdown table    | Table with `Name`, `Status`, `Owner`, `Modified` columns                                                |
| Long text fields | Quoted block      | > Description / notes content here                                                                      |
| Dates            | Human-readable    | "May 29, 2026 at 9:00 AM (UTC)" — `modifiedon`/`createdon` are ISO-8601 UTC; convert for display        |
| Currency         | Localised + code  | "$2,400,000 NZD" (currency from the row's transaction currency lookup)                                  |
| Option sets      | Label, not int    | "In Progress" — resolve the integer via `Prefer: odata.include-annotations="*"`, never show raw `2`     |
| Lookups          | Name, not GUID    | "Owner: Jane Smith" — `$expand` or annotations to get the name behind `_..._value`                      |
| Errors           | Clear message     | "Dataverse couldn't find that project (does not exist). Verify the record ID and try again."            |

### Truncation Rules

- **Lists:** show the first **10** rows, note the total. Be aware `@odata.count`
  (from `?$count=true`) is **capped at 5,000** for standard tables (500 for elastic),
  regardless of page size — it is **not** the true total beyond that cap. To detect
  truncation, request the `Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded`
  annotation (paired with `totalrecordcount`); for an exact uncapped total use the
  `RetrieveTotalRecordCount` function or the `/$count` path segment. Don't claim a
  count you didn't fetch.
- **Long fields:** truncate at **500** characters with "…" and offer to show more.
- **Nested records:** expand **1** level deep (one `$expand`); don't recursively walk
  related lists unless the user asks.
- **Never surface raw `pmo_*` schema names** to end users — map to the table/field
  **DisplayName** from `EntityDefinitions` for human-facing output.

---

_Generated from `00-api-investigation-questionnaire.md` Phases 7 and 8. Service-protection
limits and the error-body format verified against Microsoft Dataverse docs (learn.microsoft.com,
Jan 2026). All `pmo_\*`names are illustrative — resolve via discovery /`$metadata`.\_
