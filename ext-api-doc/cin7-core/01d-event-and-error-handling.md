---
api_name: Cin7 Core
api_slug: cin7-core
base_url: https://inventory.dearsystems.com/externalapi/v2
call_surface: HTTP via `numa integrations request cin7-core <METHOD> <relative-url>`; pass flat relative paths. Backend injects api-auth-accountid + api-auth-applicationkey and expands relative URLs against base_url. Never set auth headers; never use an absolute URL.
role: on-demand reference — webhook subscription model, event catalog, polling fallback, error handling, recovery playbooks
rate_limit: 60/min per Application Key → 429. Pace ~1 req/sec.
auth_failure_code: 403 (NOT 401) = bad/revoked credentials
confidence: every fact from the official Cin7 Core Apiary blueprint, captured live 2026-05-22; NOT validated through the Numa connector. Inline [UNVERIFIED] = inferred, confirm before relying. Companion to 01-llm-api-rules.md.
---

# Cin7 Core — Event & Error Handling Reference

## Event-driven capabilities

| Mechanism                      | Supported    | Notes                                                     |
| ------------------------------ | ------------ | --------------------------------------------------------- |
| Outbound webhooks              | Yes          | 31 event types; requires the **Automation module add-on** |
| Webhook management API         | Yes          | Full CRUD on `/webhooks`                                  |
| WebSocket / SSE / change feeds | No           | Not in the blueprint                                      |
| In-chat change detection       | Polling only | **Numa has no webhook receiver** — see Polling section    |

**Critical framing:** Cin7 Core webhooks push to the **customer's own endpoint** (`ExternalURL`). Numa cannot receive them — no Numa-side receiver exists for this connector. In chat, `/webhooks` is for **managing and health-checking the customer's existing automations**, not for getting events into the conversation. For in-chat change detection, poll (below and `01b`).

## Webhooks — subscription model

- **Endpoint:** `/webhooks` (lowercase) — GET (list), POST (create), PUT (update), DELETE (remove).
- **Prerequisite:** the customer's plan must include the **Automation module add-on** — not on all plans. If webhook calls fail unexpectedly on an otherwise-working connection, ask whether the module is enabled [UNVERIFIED failure mode — exact status/body without the module unknown].
- **Limit:** max **5 webhooks of the same event type** simultaneously.
- **Subscription fields:** `ID` (GUID, server-generated; required for PUT/DELETE), `Type` (event type string), `IsActive` (boolean), `ExternalURL`, `ExternalAuthorizationType` (`noauth` | `basicauth` | `bearerauth`), `ExternalUserName`/`ExternalPassword` (basicauth), `ExternalBearerToken` (bearerauth), `ExternalHeaders` (extra key/value headers). Create/update/delete request shapes: see `01c` Patterns 3, 6, 8.

### Delivery & retry

- Delivered as **HTTP POST** to the `ExternalURL`, authenticated as configured. Content-Type `application/json` [UNVERIFIED].
- **Retry on failure:** 6 attempts — 1 min after the event, then 5, 10, 15, 20, 25 minutes between successive attempts.
- **After 6 consecutive failures the webhook is auto-deactivated** (`IsActive:false`) — **silently**. No notification; the only way to notice is `GET /webhooks`.
- Duplicate delivery possible [UNVERIFIED] — receivers should dedup on entity ID + `EventType`.

### Event catalog — 31 event types

| Category            | Events                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sale                | `Sale/Created`, `Sale/QuoteAuthorised`, `Sale/OrderAuthorised`, `Sale/Voided`, `Sale/Backordered`, `Sale/ShipmentAuthorised`, `Sale/InvoiceAuthorised`, `Sale/PickAuthorised`, `Sale/PackAuthorised`, `Sale/CreditNoteAuthorised`, `Sale/Undo`, `Sale/PartialPaymentReceived`, `Sale/FullPaymentReceived`, `Sale/AttachmentAdded`, `Sale/AdditionalAttributesChanged`, `Sale/ShipmentTrackingNumberChanged` |
| Purchase            | `Purchase/OrderAuthorised`, `Purchase/InvoiceAuthorised`, `Purchase/StockReceivedAuthorised`, `Purchase/CreditNoteAuthorised`, `Purchase/Updated`                                                                                                                                                                                                                                                           |
| Customer / Supplier | `Customer/Updated`, `Supplier/Updated`                                                                                                                                                                                                                                                                                                                                                                      |
| Product / Stock     | `Product/Updated`, `Stock/AvailableStockLevelChanged`                                                                                                                                                                                                                                                                                                                                                       |
| CRM                 | `Lead/Updated`, `Lead/Converted`, `Opportunity/Authorized`, `Opportunity/AttachmentAdded`, `Opportunity/Voided`, `Opportunity/Converted`, `Task/Overdue`                                                                                                                                                                                                                                                    |

Note American `Opportunity/Authorized` vs British `…Authorised` everywhere else — copy event type strings exactly.

### Payload structure — thin notifications

Payloads carry **IDs and a few display fields, not full entities** — the receiver must call back into the API for full data. Documented examples:

`Sale/Created` (richest observed): `{"SaleID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","SaleOrderNumber":"SO-00044","CustomerName":"Customer name","CustomerContactName":"Sheree Bond","CustomerContactEmail":"accountstest@gmail.com","SaleRepEmail":"accountstest@diisr.govt","SaleOrderDate":"2025-10-27","TaskTypeSign":"0","IsServiceOnly":"0","DownloadLink":null,"EventType":"Sale/Created"}`

`Sale/QuoteAuthorised` / `Sale/OrderAuthorised` (minimal): `{"SaleID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","SaleOrderNumber":"SO-00044","EventType":"Sale/QuoteAuthorised"}`

`Sale/ShipmentAuthorised` — ⚠️ different key names: `{"SaleTaskID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","TenantID":"1A783F0D-810C-43C4-B61B-FA7CC293D8A0","OrderNumber":"SO-00044","CustomerName":"DIISR - Small Business Services","EventType":"Sale/ShipmentAuthorised"}`

Payload gotchas:

- **Key names inconsistent across events** — `SaleID` vs `SaleTaskID`, `SaleOrderNumber` vs `OrderNumber`. Parse per event type; `EventType` is the only reliable common field.
- Boolean-ish flags arrive as **strings** `"0"`/`"1"` (`TaskTypeSign`, `IsServiceOnly`).
- Payload dates are bare `yyyy-MM-dd`, unlike the API's `yyyy-MM-ddTHH:mm:ss.fff`.
- Payload shapes for the other ~27 event types were not captured [UNVERIFIED] — assume thin ID + `EventType` at minimum.

### If the customer builds a receiver

When asked to help wire Core webhooks into the customer's own system, advise:

1. Respond 200 fast; queue heavy work async — slow responses count as failed deliveries and march the webhook toward silent auto-deactivation.
2. Verify the configured auth (`bearerauth` → check the `Authorization: Bearer` header).
3. Treat the payload as a pointer: fetch the full entity via the API using the GUID.
4. Dedup on entity ID + `EventType`.
5. Periodically check `GET /webhooks` for `IsActive:false`, reactivate via PUT after fixing the root cause (see `01c` Pattern 6).

### In-chat webhook health check

`numa integrations request cin7-core GET /webhooks -m "check webhooks"` → any subscription with `IsActive:false` was auto-deactivated after 6 failed deliveries — report it with its `Type` and `ExternalURL`, offer to reactivate once the customer's endpoint is fixed.

## Polling — the in-chat event pattern

No events reach Numa, so change detection inside a conversation is polling (full strategy in `01b`). Map the webhook event you _wish_ you had to a polling read:
| Wanted event | Poll instead | Detection field |
| --- | --- | --- |
| `Sale/*` stage changes | `/SaleList?page=1&limit=100` | row `Status`/order number; re-GET `/Sale?SaleID=` for stage detail |
| `Purchase/*` | `/PurchaseList?page=1&limit=100` | row status |
| `Stock/AvailableStockLevelChanged` | `/ProductAvailability` | compare quantities client-side |
| `Customer/Updated`, `Supplier/Updated` | `/Customer`, `/Supplier` (full payloads) | `LastModifiedOn` watermark |
| `Product/Updated` | `/Product?page&limit` | diff against earlier fetch |

- Budget within **60 req/min**: a per-minute loop over 3–4 list endpoints is comfortable; leave headroom for the user's interactive requests.
- Watermark format for any date comparison/parameter: `yyyy-MM-ddTHH:mm:ss.fff`, no `Z`.
- Date-range filter parameter names on list endpoints [UNVERIFIED] — probe once (e.g. a `CreatedSince`-style param) and fall back to client-side diffing if results don't change.

## Error handling

### HTTP status codes

| Status | Meaning                                                                  | Action                                                                                                |
| ------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 200    | OK                                                                       | **Check the body for an `Errors` array** — partial success hides here                                 |
| 204    | No Content                                                               | Success; empty body — don't JSON-parse                                                                |
| 400    | Validation / malformed request                                           | Read the message, fix the payload; never retry as-is                                                  |
| 401    | (Rare) auth variant                                                      | Treat exactly like 403                                                                                |
| 403    | **Authentication failure** — wrong/revoked Account ID or Application Key | Tell the user to reconnect via the chat credential card; do NOT retry                                 |
| 404    | Endpoint doesn't exist                                                   | Check exact singular TitleCase spelling (`/Product`, not `/Products`) — almost never a missing record |
| 405    | Method not allowed                                                       | Endpoint is read-only (e.g. `…List` endpoints, GET-only `/Transactions`)                              |
| 429    | Rate limit — 60/min per Application Key                                  | Back off and retry (ladder below)                                                                     |
| 500    | Server error / unparseable request object                                | Check your payload format first; retry once with backoff                                              |

### Error response body — OUTSTANDING UNKNOWN

**JSON shape of Core error bodies undocumented and not captured** [UNVERIFIED] — an explicit outstanding unknown. The vendor states only that the API returns "an appropriate HTML status code, and an error message", and you must read both. Exact structure (field names, string vs object, JSON vs plain text) [UNVERIFIED].

Parse defensively, always:

1. Branch on the **HTTP status code first** — the only reliable signal.
2. Attempt JSON parse of the body; on failure, treat the raw text as the error message (may be plain text or HTML).
3. If JSON, hunt for a message in likely fields (`Message`, `message`, `ErrorMessage`, `Exception`, an `Errors` array) — do not hardcode one shape.
4. Surface the extracted text to the user verbatim alongside your interpretation — never fabricate a structured error the API didn't return.
5. Once real errors are observed through the connector, record their shapes here — until then, assume nothing.

### Partial success inside HTTP 200

Task-like endpoints (Disassembly confirmed) return an `Errors` array in a **200** body when some lines failed:
`{"TaskID":"...","Status":"COMPLETED","Errors":["Could not allocate stock for line 2"]}`
After every mutation: check `Errors` before declaring success; report which lines failed; re-attempt only those (see `01c`).

### Recovery playbook

| Status                    | Retryable?             | Recovery                                                                                                       | Max retries |
| ------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| 200 + `Errors`            | Per-line               | Process successes; re-attempt failed lines individually                                                        | 1 per line  |
| 400                       | No                     | Fix payload per message — missing required field (e.g. Customer's 7), bad reference name, wrong date format    | 0           |
| 401/403                   | No                     | Reconnect via chat credential card — credentials wrong or revoked                                              | 0           |
| 404                       | No                     | Fix the endpoint spelling; verify against the endpoint table in `01`                                           | 0           |
| 405                       | No                     | Switch to the correct read/write endpoint                                                                      | 0           |
| 429                       | Yes                    | Backoff ladder below                                                                                           | 4           |
| 500                       | Once                   | Re-check request format; retry once after 5s; for mutations, **re-GET first** to confirm the write didn't land | 1           |
| Network failure / timeout | Mutations: check first | Reads: retry freely. Mutations: re-GET (list endpoint) before re-POSTing — blind retries create duplicates     | 2           |

### 429 backoff ladder

60 req/min per Application Key — pace ~1 req/sec to avoid hitting it at all. On 429:
`attempt 1: wait 1s → attempt 2: wait 5s → attempt 3: wait 30s → attempt 4: wait 2min → then stop and tell the user the rate limit is saturated`
No rate-limit response headers (`Retry-After`, `X-RateLimit-*`) documented for Core [UNVERIFIED] — check for `Retry-After` opportunistically but don't depend on it.

### Vendor guidance: assume the API goes down

> "Never assume the API is online at any time. Always queue requests to the API so that you can retry the request in the event of a network failure."

In-chat translation: treat transient failures as normal, retry reads freely, verify mutations before retrying them, report persistent unavailability honestly instead of hammering the endpoint.

## Counter-exceptions

1. **403 means bad credentials, not permissions** — the opposite of most APIs. Never retry-loop it; route the user to reconnect.
2. **404 means a misspelled endpoint, not a missing record.** Detail lookups with an unknown GUID may return 200 with an empty body instead [UNVERIFIED] — handle both.
3. **HTTP 200 is not business success** — check for `Errors`.
4. **204 has no body** — a JSON parse error here is your bug.
5. **Webhook auto-deactivation is silent** — no error surfaces anywhere; only `GET /webhooks` reveals `IsActive:false`.
6. **Webhook payload keys vary per event type** (`SaleID` vs `SaleTaskID`) — only `EventType` is dependable.
7. **Error body shape unknown** — any code assuming a specific error JSON structure is wrong until proven otherwise. Parse defensively (above).
8. **Webhook failures without the Automation module** are an expected configuration gap, not an API bug — ask about the customer's plan before debugging.

## Surfacing errors to the user

| Situation      | Say                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 403            | "Cin7 Core rejected the stored credentials — they may have been revoked. Please reconnect Cin7 Core when the credential card appears." |
| 400            | Quote the API's message verbatim + what you'll change (e.g. a missing required Customer field)                                         |
| 429            | "Hit Cin7 Core's 60-requests-per-minute limit — pausing briefly and continuing."                                                       |
| 200 + `Errors` | "The operation partially succeeded — lines X failed: <messages>." Never report plain success                                           |
| Persistent 5xx | "Cin7 Core appears to be unavailable right now" — offer to retry later; don't keep hammering                                           |
