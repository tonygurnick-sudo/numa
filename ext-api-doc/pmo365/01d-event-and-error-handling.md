---
api_name: PMO365 (Microsoft Dataverse)
api_slug: pmo365
companion_to: 01-llm-api-rules.md
base_url: '{environment_url}/api/data/v9.2/'
call_surface: 'HTTP via connect_request (not file-browse)'
covers: 'Event model (no Numa receiver yet → modifiedon polling), Dataverse error body, service-protection limits, mandatory Retry-After backoff, recovery-by-status playbook, output formatting'
schema_confidence: 'All pmo_* names are ILLUSTRATIVE [INFERRED] — resolve at runtime via discovery (01 / 01a) or $metadata. Platform behaviour + service-protection limits + error-body format verified against Microsoft Dataverse docs (learn.microsoft.com, Jan 2026).'
---

# PMO365 — Event & Error Handling Reference

## Event-Driven Capabilities

| Mechanism              | Supported              | Notes                                                                                                                                                           |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhooks               | platform-yes / Numa-no | Dataverse supports webhooks via plug-in/Service Endpoint registration. **No Numa receiver wired up yet.**                                                       |
| WebSocket              | no                     | Dataverse Web API does not expose WebSocket.                                                                                                                    |
| Server-Sent Events     | no                     | not offered                                                                                                                                                     |
| Long polling           | no                     | use interval polling on `modifiedon`                                                                                                                            |
| Change feeds / streams | platform-yes / Numa-no | Dataverse change tracking (`Prefer: odata.track-changes` + delta links) and Power Automate triggers exist, but Numa doesn't consume them for this connector yet |

## Webhooks — NOT AVAILABLE in Numa

The PMO365 connector does **not** register webhooks, Service Endpoints, or Power Automate flows, and Numa has **no public HTTPS receiver** for this connector. If the user asks about real-time alerts ("notify me when a project status changes"), it's **polling-only** (see Polling Fallback). The rest of this section documents what we'd build _if_ push gets prioritised — it is not live.

### Setup (future, not implemented)

- **Registration:** Dataverse webhooks are registered as **Service Endpoints** via the Plug-in Registration Tool, the SDK, or `POST /serviceendpoints` — **not** a simple `POST .../watch`. It's a metadata/customisation operation, not a per-user API call.
- **URL:** HTTPS public endpoint. Dataverse doesn't ping on registration; it POSTs on the registered table event (Create/Update/Delete).
- **Alternative:** a Power Automate "When a row is added, modified or deleted" trigger pointed at a Numa HTTPS action — lower-code, still needs a Numa receiver.

```
POST /serviceendpoints
OData-MaxVersion: 4.0 | OData-Version: 4.0 | Content-Type: application/json
{"name":"Numa PMO365 change notifications","contract":8,"url":"https://{client}.numa.arcanum.ai/api/pmo365/webhook","authtype":4,"messageformat":2}
```

(`contract:8`=WebHook, `authtype:4`=HttpHeader, `messageformat:2`=JSON.) A registered Service Endpoint still needs an SDK Message Processing Step ("step") bound per table/message — a multi-step customisation, not a one-shot subscribe.

### Event Catalog (future)

| Event    | Trigger                           | Key payload fields                                        | Notes                                                  |
| -------- | --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `Create` | row created in a registered table | `PrimaryEntityName`, `PrimaryEntityId`, `InputParameters` | bind a step per table                                  |
| `Update` | row updated                       | same + changed attributes in `InputParameters`            | filter attributes at step registration to reduce noise |
| `Delete` | row deleted                       | `PrimaryEntityName`, `PrimaryEntityId`                    |                                                        |

### Payload Format (future)

Dataverse delivers a serialised **`RemoteExecutionContext`**, not a tidy record: message name, primary entity logical name + id, and `InputParameters` / `PreEntityImages` / `PostEntityImages` (only the images you registered). It does **not** include a full hydrated row by default — re-fetch via `GET /{entityset}({id})`.

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

`OperationCreatedOn` uses the legacy `/Date(ms)/` serialisation, not ISO-8601.

### Verification / Reliability (future)

- **Signature:** Dataverse webhooks do **not** HMAC-sign the body. With `authtype: HttpHeader` you register a **static secret header** (e.g. `x-numa-shared-secret`) Dataverse echoes on every POST — verify it matches and reject otherwise. That's the only verification.
- **IP allowlist:** Dataverse egress IPs vary by region/Azure; not reliable as a primary control. Rely on the shared-secret header + HTTPS.
- **Retry:** failed deliveries retry with exponential backoff for ~24h, then drop (async step behaviour).
- **Ordering:** best-effort, not guaranteed. Build idempotent handlers keyed on `(PrimaryEntityName, PrimaryEntityId, MessageName)` + a monotonic field. Duplicate delivery is possible on retry — dedupe.

## Polling Fallback

**Numa's current default and only change-detection mechanism.** Use whenever the user asks "what changed?", "any new projects since yesterday?", or we need to detect updates without a push channel.

Every Dataverse row carries a server-set `modifiedon` (ISO-8601 UTC). Filter on it, order by it, keep a high-water mark:

```
GET /pmo_projects?$select=pmo_projectid,pmo_name,statuscode,modifiedon&$filter=modifiedon gt 2026-05-29T09:00:00Z&$orderby=modifiedon asc&$top=200
OData-MaxVersion: 4.0 | OData-Version: 4.0 | Accept: application/json
Prefer: odata.maxpagesize=200, odata.include-annotations="*"
```

- **Change-detection field:** `modifiedon` (always server-set; never trust client clocks).
- **Interval:** **≥5 minutes** for active sync; 15–60 min background. Don't poll tighter than the service-protection window warrants. Request budget is trivially within the 6,000-requests/5-min budget; cost is in _combined execution time_ — keep `$select` lean.

Pattern:

```
1. high_water = last_seen_modifiedon  (init: now() - lookback, ISO-8601 UTC)
2. Sleep {interval >= 5 min}
3. GET /{entityset}?$select=id,name,modifiedon&$filter=modifiedon gt {high_water}&$orderby=modifiedon asc&$top=200  (Prefer: odata.maxpagesize=200)
4. While @odata.nextLink present: follow it verbatim, accumulate rows.
5. For each changed row, fetch full detail only if needed.
6. high_water = MAX(modifiedon across returned rows)   // not now()
7. Goto 2
```

- **Advance high-water from the data (`MAX(modifiedon)`), not `now()`** — avoids missing rows written during the request and clock skew.
- **`$orderby=modifiedon asc`** so a truncated page still lets you resume from the last row's `modifiedon`.
- **Follow `@odata.nextLink` verbatim** — never hand-roll `$skip`.
- **Overlap guard:** poll `modifiedon gt {high_water}` but dedupe on the primary id, since two rows can share the same millisecond.
- **Deletes are invisible to `modifiedon` polling** — a deleted row simply stops appearing. If delete-detection matters, enable Dataverse **change tracking** (`Prefer: odata.track-changes` + delta links); deleted rows come back as `@removed`. (Not currently wired in Numa.)

## Error Handling

### Standard error body

Single nested `error` object. `code` is a **hex string, NOT the HTTP status, and frequently empty** — always read `message` and surface it verbatim.

```json
{
  "error": {
    "code": "0x80040217",
    "message": "pmo_project With Id = 3f2504e0-4f89-41d3-9a0c-0305e82c3301 Does Not Exist"
  }
}
```

| Field                                       | Type   | Always present?       | Description                                                                                                       |
| ------------------------------------------- | ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `error`                                     | object | yes                   | wrapper                                                                                                           |
| `error.code`                                | string | yes (may be `""`)     | hex Dataverse error code; unrelated to HTTP status; often empty                                                   |
| `error.message`                             | string | yes                   | human-readable; the field to surface/parse                                                                        |
| `error.@Microsoft.PowerApps...` annotations | object | only with annotations | `Prefer: odata.include-annotations="*"` adds debug keys (`ApiExceptionSourceKey`, `ApiStepKey`, …) and a help URL |

**Validation errors:** no structured field-by-field list — the offending property is named **inline in `message`**:

```json
{
  "error": {
    "code": "0x0",
    "message": "An error occurred while validating input parameters: ... 'pmo_budget' value 'high' is not a valid Edm.Decimal."
  }
}
```

So "validation" parsing = string-matching the attribute name out of `message`. Confirm the attribute's real type via `GET /EntityDefinitions({id})/Attributes` or `$metadata` before retrying.

### Recovery Playbook

| HTTP | Hex code(s)                                        | Meaning                                   | Retryable? | Recovery                                                                                                                                                                                                        | Max retries |
| ---- | -------------------------------------------------- | ----------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 200  | —                                                  | success (GET/function)                    | —          | —                                                                                                                                                                                                               |             |
| 201  | —                                                  | created (`Prefer: return=representation`) | —          | body is the new row                                                                                                                                                                                             |             |
| 204  | —                                                  | success, no body (Create/Update/Delete)   | —          | read `OData-EntityId` header for the new/affected row URL                                                                                                                                                       |             |
| 400  | `0x80060888`, `0x0`, malformed `$filter`/`$select` | bad request / bad OData query             | No         | fix query/body per `message`; verify property names against `$metadata`/`EntityDefinitions`                                                                                                                     | 0           |
| 401  | `0x80048306`                                       | unauthorized (token expired/invalid)      | Yes        | backend refreshes via `organizations` token URL + retries **once**; 2nd 401 → user reconnects                                                                                                                   | 1           |
| 403  | `0x80040220`                                       | forbidden — missing privilege             | No         | Application User's security role lacks read/write on this table — admin grants the role                                                                                                                         | 0           |
| 404  | `0x80040217`, bad resource path                    | not found                                 | No         | verify **EntitySetName** (plural, from `EntityDefinitions`) + record GUID; re-run discovery                                                                                                                     | 0           |
| 412  | `0x80060889`                                       | precondition failed                       | Maybe      | ETag concurrency: `If-None-Match: *` create-only where row **exists**, or `If-Match: W/"<etag>"` tag mismatch. Re-fetch, decide create vs update. (An `If-Match: *` PATCH on a **missing** row → 404, not 412.) | 1           |
| 413  | —                                                  | payload too large                         | No         | split a `$batch` / large body into smaller chunks                                                                                                                                                               | 0           |
| 429  | `0x80072322` / `0x80072321` / `0x80072326`         | **service protection limit**              | Yes        | **Honour `Retry-After` (seconds) — mandatory.** Sleep exactly that long, then retry                                                                                                                             | 3           |
| 500  | `0x80040216`                                       | internal server error                     | Yes        | exponential backoff + retry                                                                                                                                                                                     | 3           |
| 502  | —                                                  | bad gateway                               | Yes        | retry after ~5s with backoff                                                                                                                                                                                    | 3           |
| 503  | —                                                  | service unavailable / maintenance         | Yes        | honour `Retry-After` if present, else backoff                                                                                                                                                                   | 3           |

### Service-protection limits

Dataverse calls these **service protection API limits** (not "rate limits"), enforced **per user, per web server**, over a **5-minute (300s) sliding window**, across **three facets** (429 when any one trips):
| Facet (per user, per web server) | Default limit (300s window) | Hex on breach | Notes |
| --- | --- | --- | --- |
| Number of requests | **6,000** requests | `0x80072322` | cumulative request count |
| Combined execution time | **1,200,000 ms (20 min)** | `0x80072321` | sum of server-side processing time; heavy `$filter`/`$expand`/`$apply` add up |
| Concurrent requests | **52** (may be higher) | `0x80072326` | a **concurrency** cap (NOT 52 seconds); trips **immediately**, no overshoot grace. Don't fan out parallel calls. |

Defaults can vary by environment — treat as guidance, let `Retry-After` govern.

**Debug-only response headers** (do NOT throttle pre-emptively off these — Microsoft says they're for debugging and reset across servers):
| Header | Meaning | Example |
| --- | --- | --- |
| `x-ms-ratelimit-burst-remaining-xrm-requests` | remaining requests for this connection | `5832` |
| `x-ms-ratelimit-time-remaining-xrm-requests` | remaining combined exec time (seconds) for this user | `1187` |
| `Retry-After` | **on 429 only** — seconds to wait before resubmitting | `12` |

429 response:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 12
```

```json
{
  "error": {
    "code": "0x80072322",
    "message": "Number of requests exceeded the limit of 6000 over time window of 300 seconds."
  }
}
```

**Backoff (the `Retry-After` honour is mandatory):**

1. On 429, read `Retry-After` (integer seconds) and sleep exactly that long. Mandatory — Dataverse **extends** the penalty window if you keep hammering. Don't retry sooner, don't ignore it.
2. If (rarely) `Retry-After` is absent on a 429, fall back to exponential backoff: start 2s, double each attempt (2→4→8…), cap 60s.
3. Add jitter (±50%) so concurrent users don't retry in lockstep.
4. **Never fan out concurrent requests to "go faster"** — the concurrency facet (`0x80072326`) trips instantly. Poll/serialise instead.
5. After 3 honoured retries still failing, surface to the user with `message`.

### Error Code Reference

> Dataverse hex error codes (`error.code`) — **not** HTTP statuses. Common ones:
> | Hex code | HTTP | Meaning | Common cause | Fix |
> | --- | --- | --- | --- | --- |
> | `0x80040217` | 404 | record (or referenced row) does not exist | stale GUID; wrong EntitySetName; deleted row | re-fetch; verify GUID + EntitySetName via `EntityDefinitions` |
> | `0x80048306` | 401 | auth token invalid/expired | access token hit ~1h lifetime | refresh via `organizations` token URL; 2nd 401 → reconnect |
> | `0x80040220` | 403 | privilege check failed | App User's security role lacks table read/write | admin grants the security role on the PMO365 tables |
> | `0x80060888` | 400 | invalid OData query | bad `$filter` operator; unknown `$select` property | validate property names against `$metadata`; check operator syntax |
> | `0x80060889` | 412 | precondition (ETag) failed | `If-None-Match: *` create-only when the row already exists, or `If-Match: W/"<etag>"` concurrency tag mismatch | re-fetch; decide create (POST) vs update (PATCH). (Missing-row `If-Match: *` PATCH → 404, not 412.) |
> | `0x80072322` | 429 | request-count limit (6,000 / 5 min) | tight polling / bulk loop | honour `Retry-After`; slow cadence |
> | `0x80072321` | 429 | execution-time limit (20 min / 5 min) | heavy queries (`$expand`, `$apply`, large pages) | honour `Retry-After`; trim `$select`/`$expand`; smaller pages |
> | `0x80072326` | 429 | concurrency limit (52) | parallel request fan-out | honour `Retry-After`; serialise calls — do not parallelise |
> | `0x80040216` | 500 | generic server error | transient platform fault | exponential backoff + retry |
> | `0x80040265` | 400 | plug-in / business error | required field missing; custom business rule | read `message`; fix per the named field/rule |

## Counter-Exceptions

> Dataverse behaviours that differ from standard HTTP/REST expectations.

1. **`error.code` is a hex string, not the HTTP status — and is often empty.** Standard: error code mirrors the HTTP status. Actual: e.g. `0x80040217` with HTTP 404, or `code: ""`. Branch on the **HTTP status** + parse `error.message`; treat `error.code` as a hint.
2. **PATCH is an UPSERT — silently creates a row if the id is absent.** Standard: PATCH updates, 404 if missing. Actual: `PATCH /{entityset}({id})` with an unknown GUID **creates** that row. Send **`If-Match: *`** for update-only (412 on conflict instead of a stray create; missing row → 404).
3. **Create returns 204 with no body; new id in a header.** Standard: 201 + new resource in body. Actual: `POST /{entityset}` → **204 No Content**, new row URL in the **`OData-EntityId`** response header. Add `Prefer: return=representation` for 201 + body.
4. **Pagination is server-driven via `@odata.nextLink`, not `$skip`.** Standard: client controls offset. Actual: Dataverse caps pages (default 5,000) and hands back `@odata.nextLink` — follow it **verbatim**; hand-rolled `$skip` on large sets is unsupported/unreliable.
5. **Lookups are exposed as `_{logicalname}_value`; labels need an opt-in header.** Standard: related object inlined or a friendly FK. Actual: the raw GUID column is `_pmo_projectmanager_value`; the readable name only appears with `Prefer: odata.include-annotations="*"` (or `$expand` the nav property).
6. **`Retry-After` is mandatory and self-worsening if ignored.** Standard: advisory. Actual: Dataverse **extends** the penalty if you keep sending demanding requests inside the window.
7. **Deletes don't show up in `modifiedon` polling.** Standard: a change feed includes deletions. Actual: a deleted row just stops appearing — use change-tracking delta links for `@removed` if delete-detection matters.

## Output Formatting Guide

> How to present Dataverse/PMO365 responses to the user.
> | Data Type | Format | Example |
> | --- | --- | --- |
> | Single record | key-value summary | "**Project: Harbour Bridge Upgrade** — Status: In Progress, Budget: $2,400,000, Modified: May 29, 2026" |
| Record list | markdown table | columns `Name`, `Status`, `Owner`, `Modified` |
| Long text fields | quoted block | > Description / notes content |
| Dates | human-readable | "May 29, 2026 at 9:00 AM (UTC)" — `modifiedon`/`createdon` are ISO-8601 UTC; convert for display |
| Currency | localised + code | "$2,400,000 NZD" (currency from the row's transaction currency lookup) |
| Option sets | label, not int | "In Progress" — resolve via `Prefer: odata.include-annotations="*"`, never show raw `2` |
| Lookups | name, not GUID | "Owner: Jane Smith" — `$expand`or annotations to get the name behind`\_...\_value` |
> | Errors | clear message | "Dataverse couldn't find that project (does not exist). Verify the record ID and try again." |

**Truncation:**

- **Lists:** show first **10** rows, note the total. `@odata.count` is **capped at 5,000** (standard) / 500 (elastic) regardless of page size — not the true total beyond that cap. Detect truncation via the `Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded` annotation (paired with `totalrecordcount`); for an exact uncapped total use `RetrieveTotalRecordCount` or the `/$count` segment. Don't claim a count you didn't fetch.
- **Long fields:** truncate at **500** chars with "…" and offer to show more.
- **Nested records:** expand **1** level deep (one `$expand`); don't recursively walk related lists unless asked.
- **Never surface raw `pmo_*` schema names** to end users — map to the table/field **DisplayName** from `EntityDefinitions`.
