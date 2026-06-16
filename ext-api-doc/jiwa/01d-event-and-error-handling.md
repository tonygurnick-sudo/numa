---
api_name: Jiwa Financials
api_slug: jiwa
doc: event-and-error-handling-reference (companion to 01-llm-api-rules.md)
base_url: per-customer self-hosted instance; no shared host. call_surface: HTTP via `numa integrations request` (connector jiwa). Bearer key injected by backend.
confidence: spec/docs-derived, NOT live-validated. [SPEC]=OpenAPI, [DOCS]=Jiwa wiki, [UNVERIFIED]=inferred. Single live observation: unauthenticated `GET https://api.jiwa.com.au/Debtors` → 401 with EMPTY body (Cloudflare-fronted hosted instance).
---

# Jiwa Financials — Event & Error Handling

Webhooks, polling, error handling, status codes, rate limiting, recovery. Call form: `METHOD /path` via `numa integrations request` (connector jiwa).

## Event-driven capabilities

| Mechanism              | Supported | Notes                                                                          |
| ---------------------- | --------- | ------------------------------------------------------------------------------ |
| Webhooks               | Yes       | Built in — 18 ops under the Webhooks tag [SPEC]; subscriber/subscription model |
| WebSocket              | No        | Not in spec                                                                    |
| Server-Sent Events     | No        | Not in spec                                                                    |
| Long polling           | No        | Not available                                                                  |
| Change feeds / streams | No        | Use `LastSavedDateTimeGreaterThan` polling instead                             |

## Webhooks

> Require server-side config on the customer's Jiwa instance: the `URLBase` system setting must be set ("Required for webhooks or caching to function") [DOCS], and the instance must reach your receiver. Availability is per-customer. A future Numa Automations trigger source could be built on this — nothing wired today.

**Model: Subscribers → Subscriptions → Request Headers** [SPEC] — a Subscriber is a named consumer (`Name`, `IsEnabled`); each holds Subscriptions (one `EventName` + destination `URL`); each subscription can carry custom **RequestHeaders** (`Name`/`Value`) sent with every delivery — this is the auth mechanism: **no documented signature scheme**, so set a shared-secret header and verify it at the receiver [SPEC][UNVERIFIED beyond spec shape].

**Routes** [SPEC]:

```
GET    /Webhooks/Events/                      # discover available event names (Name, Description)
GET    /Webhooks/Subscribers/                 # list subscribers
POST   /Webhooks/Subscribers/                 # create subscriber  {"Name":"...","IsEnabled":true}
GET    /Webhooks/Subscribers/{SubscriberID}
PATCH  /Webhooks/Subscribers/{SubscriberID}/  # e.g. disable: {"IsEnabled":false}
DELETE /Webhooks/Subscribers/{SubscriberID}/
GET    /Webhooks/Subscribers/{SubscriberID}/Subscriptions/
POST   /Webhooks/Subscribers/{SubscriberID}/Subscriptions/  {"EventName":"...","URL":"https://receiver..."}
PATCH  /Webhooks/Subscribers/{SubscriberID}/Subscriptions/{SubscriptionID}/
DELETE /Webhooks/Subscribers/{SubscriberID}/Subscriptions/{SubscriptionID}/
PUT    /Webhooks/Subscribers/{SubscriberID}/Subscriptions/{SubscriptionID}/RequestHeaders/  {"RequestHeaders":[{"Name":"X-Numa-Secret","Value":"..."}]}
DELETE .../RequestHeaders/{SubscriptionRequestHeaderID}/
GET    /Webhooks/Subscribers/{SubscriberID}/Messages            # delivery log
GET    /Webhooks/Subscribers/{SubscriberID}/Messages/Responses  # receiver responses log
DELETE .../Subscriptions/{SubscriptionID}/Messages/{MessageID}
POST   /Webhooks/Test/                        # vendor-provided echo target for testing subscriptions
```

Like queries, subscriber/subscription POSTs accept the DTO as URL params or JSON body [SPEC]. `POST /Webhooks/Events/` is for Jiwa's own clients to raise events — "Not intended to be invoked externally" [SPEC].

**Event catalog:** no static list in spec — names discoverable at runtime via `GET /Webhooks/Events/` (returns `Name` + `Description`) [SPEC]. Enumerate per instance; don't assume names across versions.

**Retry/backoff system settings** [DOCS]:

| Setting                                       | Meaning                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `WebhooksRetryInterval`                       | Base seconds before retrying a failed delivery — backoff is **`10^(RetryNo × interval)`** |
| `WebhooksMaxRetries`                          | Max retry attempts per message                                                            |
| `WebhooksMessagesRetentionDays`               | Days to keep sent/permanently-failed messages + responses (`SY_WebhookMessage`)           |
| `WebhooksEventLogRetentionDays`               | Days to keep `SY_WebhookEventLog` entries — default 8                                     |
| `WebhooksClientKey`                           | Internal Jiwa-client key; auto-generated at service start when blank                      |
| `WebhooksHostName` / `WebhooksHostRetrierURL` | Nominate a dedicated retry-handler host when running multiple API hosts                   |

The exponential `10^(RetryNo × interval)` curve grows brutally fast — with interval 1: 10s, 100s, 1000s… A receiver down for an hour may not see another attempt for a long time, and after `WebhooksMaxRetries` the message **permanently fails** (kept only for the retention window). Each subscription exposes `LastMessageResponseHTTPCode` and `RetryAfterDateTime` [SPEC] — poll the Messages/Responses routes to detect a dying subscription.

**Worked example — subscribe to an event** (SPEC-derived; UNVERIFIED live — exercise against `POST /Webhooks/Test/` first):

```
1. GET  /Webhooks/Events/                 → [{"Name":"...","Description":"..."}, ...]  # pick EventName
2. POST /Webhooks/Subscribers/            {"Name":"numa-automations","IsEnabled":true}  → capture SubscriberID
3. POST /Webhooks/Subscribers/{SubscriberID}/Subscriptions/  {"EventName":"<from step 1>","URL":"https://receiver.example.com/jiwa-hook"}  → capture SubscriptionID
4. PUT  /Webhooks/Subscribers/{SubscriberID}/Subscriptions/{SubscriptionID}/RequestHeaders/  {"RequestHeaders":[{"Name":"X-Numa-Secret","Value":"<random secret>"}]}
```

Delivery **payload shape is [UNVERIFIED]** — the spec defines plumbing, not the message body. The event-raise DTO (`WebhooksEventPOSTRequest`) carries `EventName`, `Body`, `SourceDTOType`, `SourceDTOID`, `OriginalDTO` [SPEC] — suggesting deliveries identify the source entity — but always re-fetch the entity by ID rather than trust the payload.

**Receiver checklist:** (1) respond 2xx fast, process async (timeout thresholds [UNVERIFIED]); (2) verify your shared-secret RequestHeader on every delivery — no signature; (3) de-duplicate — delivery/ordering guarantees undocumented [UNVERIFIED]; key on message/entity ID and re-fetch current state through the API; (4) reconcile periodically — list `Messages` + check `LastMessageResponseHTTPCode` to catch permanently-failed deliveries inside the retention window.

## Polling fallback (the dependable option today)

Every table carries `LastSavedDateTime` [SPEC]; the wiki's own example is exactly this ("web-enabled customers changed within the last day") [DOCS]:
`GET /Queries/DebtorList?LastSavedDateTimeGreaterThan=2026-06-09T22:00:00.000&Fields=DebtorID,AccountNo,Name,LastSavedDateTime&OrderBy=LastSavedDateTime&Include=Total&Take=100`

**Pattern:** (1) store high-water mark = max(`LastSavedDateTime`) seen (server-local time, no timezone); (2) wait interval (5–15 min is plenty for ERP data); (3) `GET /Queries/{view}?LastSavedDateTimeGreaterThanOrEqualTo={mark}&OrderBy=LastSavedDateTime&Take=100&Include=Total`; (4) page with `Skip` until done; de-dup by RecID; advance the mark.

**Tips:** Overlap the window slightly (`GreaterThanOrEqualTo` + de-dup) — clock skew and same-second saves otherwise drop records. Timestamps have no timezone [DOCS-implied, UNVERIFIED] — always compare against values the server returned, never your local clock. **Deletes don't appear in changed-since polls** — if delete detection matters, reconcile full RecID lists periodically or use webhooks. Use the view-backed list queries (`DebtorList`, `SalesOrderList`, `InventoryItemList`) with tight `Fields` lists — cheap, denormalized, made for this.

**Webhooks vs polling:**

| Factor      | Webhooks                                          | `LastSavedDateTime` polling         |
| ----------- | ------------------------------------------------- | ----------------------------------- |
| Setup       | Jiwa-side config (`URLBase`), receiver, secret    | Nothing — works on any instance     |
| Latency     | Near-real-time                                    | Poll interval                       |
| Reliability | Steep retry curve; permanent failure possible     | Self-healing — next poll catches up |
| Deletes     | Possible (if delete events exist on the instance) | Invisible                           |
| Verified?   | [UNVERIFIED] — plumbing only from spec            | Pattern shown in vendor docs [DOCS] |

**Recommendation:** polling is the safe default until webhooks are exercised live; if webhooks are used, keep a reconciliation poll as backstop.

## Error handling

### Status code reference [DOCS]

| Status | Meaning                                                                                 | Retryable? | Recovery action                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | Success (GET / PATCH / Process)                                                         | —          | —                                                                                                                                                                                  |
| 201    | Created (POST) — body is the full DTO with new IDs                                      | —          | Capture generated RecIDs from the body                                                                                                                                             |
| 204    | No Content — successful DELETE, **or a GET that matched nothing**                       | —          | For GET: report "no data", not an error. Body empty — do not JSON-parse                                                                                                            |
| 401    | Not authenticated — bad/expired/revoked API key                                         | No         | **Empty body observed on hosted instance.** Surface "Jiwa API key invalid or revoked" → user re-enters their Staff API key (vault). Do NOT blind-retry                             |
| 403    | Authenticated, but the route is denied                                                  | No         | The Jiwa User Group's REST-API route permission blocks it. A Jiwa admin must allow the route in User Group Maintenance ("Disallow anywhere wins; Undefined = deny unless allowed") |
| 404    | Invalid route OR resource doesn't exist                                                 | No         | Verify the RecID (not AccountNo/InvoiceNo!) and the path spelling — both faults share this code                                                                                    |
| 409    | Business logic refused: referenced record on DELETE, or optimistic-concurrency conflict | Maybe      | Read body text. Reference conflict → don't work around it. Concurrency → re-read the record, re-apply, retry once                                                                  |
| 429    | Only if the optional Rate Limit plugin is enabled                                       | Yes        | Honor any `Retry-After` if present [UNVERIFIED]; else back off 30s+                                                                                                                |
| 5xx    | Server fault (self-hosted Windows service)                                              | Cautiously | Retry GETs with backoff (max 2–3). NEVER blind-retry writes — check whether the write landed first                                                                                 |

### Error body shape

Jiwa returns "the response body text describing the problem (e.g. 'product not found')" [DOCS]. Structured form (when present) is the ServiceStack `ResponseStatus` DTO [SPEC]:
`{"ResponseStatus":{"ErrorCode":"...","Message":"Product not found","StackTrace":null,"Errors":[{"ErrorCode":"...","FieldName":"...","Message":"..."}]}}`

- `StackTrace` populated only when the customer's `DebugMode` system setting is on [DOCS] — if you see stack traces, tell the admin to turn DebugMode off in production.
- `Errors[]` carries field-level details (`FieldName`) when applicable [SPEC]; how consistently it's populated is [UNVERIFIED].

**Parse defensively** (shapes [UNVERIFIED] beyond the above): (1) check status code first — 204 and the observed 401 have **empty bodies**; (2) try JSON, look for `ResponseStatus.Message`, fall back to raw body text; (3) browsers/missing Accept headers get HTML razor views [DOCS] — through Numa you should always get JSON, but treat an HTML body as "wrong content type, show status code only".

### 401 vs 403 — different fixes, don't conflate

- **401** = the key itself: missing, expired (keys can carry an expiry date), or revoked (key marked not Enabled) [DOCS]. Fix: the user generates/re-pastes their Staff API key.
- **403** = the key works; the staff member's **User Group route permissions** deny this specific route [DOCS]. Fix: a Jiwa admin grants the route (User Group Maintenance → Default REST API Permission / explicit per-route permissions importable from `/RestPaths`). Tell the user exactly which route+verb was denied so the admin can allow it.

### Rate limits

**No default rate limit** [DOCS]. An optional "REST API Rate Limit" plugin lets the customer impose per-IP limits over a configurable interval [DOCS] — if enabled, parameters are customer-chosen and undiscoverable from the API [UNVERIFIED headers/codes; expect 429]. Be a good citizen anyway: the API fronts the customer's production SQL Server. Keep `Take` modest, use `Fields`, avoid tight polling loops, pause between bulk pages.

### Sessions & keep-alive — N/A for the Numa connector

Jiwa's session machinery (`/auth`, `ss-id` cookie / `X-ss-id` header, `SessionExpiryInMinutes`, `GET /KeepAlive` to extend, `/auth/logout`) applies **only to username/password auth** [DOCS]. The Numa connector uses **API-key Bearer auth, no auth step, no session** — every request stands alone [DOCS]. So: no token refresh, no re-auth flow, no KeepAlive. The only "expiry" is the key's own optional expiration date or revocation → 401 → user re-enters their key in the chat credential card.

## Counter-exceptions

> Behaviors that differ from standard HTTP/REST conventions.

1. **GET-with-nothing returns 204, not 200 + `[]`** [DOCS] — a JSON parse of "" will throw.
2. **401 body is empty (observed)** — status code only; bad/expired/revoked keys are indistinguishable from the response.
3. **404 is overloaded** — invalid ROUTE and missing RESOURCE share 404 [DOCS]; a typo'd path looks identical to a wrong RecID.
4. **`GET /SalesOrders/{InvoiceID}/Process` mutates** — a GET that posts journals and debtor transactions [DOCS][SPEC] — the single most dangerous counter-exception.
5. **Updates are PATCH, never PUT** [DOCS].
6. **Error responses can be content-negotiated** — without a JSON Accept/format hint some surfaces return HTML razor views [DOCS]; defensive parsing required.
7. **Webhook backoff is exponential base-10** (`10^(RetryNo × interval)`) — far steeper than typical providers; failed receivers go quiet quickly [DOCS].
8. **`Total` requires opt-in** (`Include=Total`) — pagination metadata absent by default, unlike most paged APIs [DOCS].

## Output formatting guide

> How to present Jiwa responses to the user.

| Data type      | Format                           | Example                                                                                      |
| -------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| Debtor         | AccountNo + Name (+ hold flag)   | "10001 — Sample Customer Pty Ltd (ON HOLD)"                                                  |
| Sales order    | InvoiceNo + customer + ref       | "Order 104923 — 10001 Sample Customer — ref 'Test order'"                                    |
| Inventory item | PartNo + Description             | "1170 — Copper Pipe 15mm"                                                                    |
| RecIDs         | Hide by default                  | Surface AccountNo/InvoiceNo/PartNo; keep RecIDs for follow-up calls                          |
| Money          | Currency-formatted, 2dp          | "$1,234.56" (AUD typical; check `DefaultCurrencyID` if it matters)                           |
| Dates          | Human-readable, no TZ claims     | "30 May 2026" — API timestamps carry no timezone                                             |
| Lists          | Markdown table, first 10–15 rows | "Showing 15 of {Total}" — `Include=Total` gives the count for free                           |
| Errors         | Status + body message            | "Jiwa rejected the request (409): record is referenced by a sales order"                     |
| 403 errors     | Name the route+verb              | "Your Jiwa user group doesn't permit GET /Queries/DB_Main — ask your Jiwa admin to allow it" |

**Truncation:** long child collections (notes, lines) — show the first ~10, note the rest. Full entity DTOs are huge — never dump raw; summarize the fields the user asked about. Offer to fetch the next `Skip` page rather than auto-walk a large `Total`.
