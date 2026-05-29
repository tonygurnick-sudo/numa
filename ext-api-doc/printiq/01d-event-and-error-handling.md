---
api_name: 'PrintIQ'
api_slug: 'printiq'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
update_source: 'web research only — NO live API access; partner-gated docs'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# PrintIQ -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Event-driven capabilities (webhooks, punch-out/cXML, polling),
> error handling, and recovery playbooks.
>
> ⚠️ **CONFIDENCE: LOW.** Webhook _existence_ and the punch-out _cXML_ surface are `[DOCUMENTED]`, but
> the webhook event catalog, payload shapes, signatures, retry policy, error-response format, and rate
> limits are all `[UNKNOWN]`. Treat error-status semantics below as generic-REST `[INFERRED]`, not
> printIQ-confirmed.

---

## Event-Driven Capabilities

| Mechanism                | Supported            | Notes                                                                                      |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------ |
| Webhooks                 | Yes (support-set-up) | printIQ **support provisions webhooks per request**; not self-service [DOCUMENTED]         |
| cXML callbacks           | Yes (punch-out)      | Procurement punch-out uses cXML request/callback flows — **separate surface** [DOCUMENTED] |
| WebSocket                | [UNKNOWN]            | None found                                                                                 |
| Server-Sent Events (SSE) | [UNKNOWN]            | None found                                                                                 |
| Long polling             | No                   | [INFERRED]                                                                                 |
| Change feeds / streams   | [UNKNOWN]            | None found                                                                                 |

---

## Webhooks

> printIQ webhooks are **created by the printIQ team via a support request** — the consumer supplies a
> Webhook URL, and printIQ configures the event(s). There is **no public self-service registration API.**
> Do NOT attempt to register webhooks via the REST API — direct the user to their printIQ account manager.

### Setup

- **Registration method:** Support request (not API/UI self-service). [DOCUMENTED]
- **Registration endpoint:** None public. [UNKNOWN]
- **URL requirements:** Consumer provides an HTTPS webhook URL. [INFERRED]

### Event Catalog

> The full set of available webhook events is `[UNKNOWN]`. The only events confirmed publicly are the
> three used by the Infigo integration:

| Event Name                   | Trigger                        | Key Payload Fields (INFERRED) | Notes                                                         |
| ---------------------------- | ------------------------------ | ----------------------------- | ------------------------------------------------------------- |
| Static PDF product sync      | Product change                 | product code, details         | Pushes product changes [DOCUMENTED]                           |
| Inventory Items product sync | Inventory/stock product change | item code, stock level        | Pushes inventory changes [DOCUMENTED]                         |
| Shipped status update        | Job/order ships                | jobNo/orderNo, shippedDate    | Lets consumer mark shipped + notify end customer [DOCUMENTED] |

### Payload Format

`[UNKNOWN]` — no public payload schema. Anticipated (do NOT rely on it):

```json
[INFERRED — UNVERIFIED]
{ "event": "shipped", "jobNo": "J-100234", "shippedDate": "2026-06-04T02:00:00Z" }
```

### Verification / Security

- **Signature header / algorithm:** `[UNKNOWN]`. Ask printIQ support how (or whether) webhook payloads are signed, and validate accordingly before trusting them.
- **IP allowlist:** `[UNKNOWN]`.

### Reliability

- **Retry policy / schedule / max retries:** `[UNKNOWN]`.
- **Event ordering / duplicate delivery / dedup:** `[UNKNOWN]` — assume at-least-once delivery and dedupe on a stable key (e.g. `jobNo` + `shippedDate`). [INFERRED]

---

## Punch-Out (cXML) — OUT OF SCOPE for this connector

PrintIQ's Punch-Out is a **separate procurement integration surface** using **cXML** request/callback
flows with configured identities and shared secrets. It delivers orders (with artwork) straight to the
Production Board. **This is not the JSON REST IQConnect API** and is **out of scope** for the
workspace-agent direct-API connector. If a user asks about punch-out, explain that it's a separate
cXML integration handled outside this connector. [DOCUMENTED]

---

## Polling Fallback

> When no "shipped" webhook is provisioned, poll for job/order status changes.

### Recommended Approach

```http
[INFERRED — UNVERIFIED]
GET /api/Job/{jobNo}
Host: {instance}.printiq.com
Authorization: Bearer {token}
```

- **Change detection field:** `status` (and `shippedDate` if present). [INFERRED]
- **Modified-since list filter:** `[UNKNOWN]` — if a `modifiedSince` list filter exists, prefer it over per-job polling (see `01b` Pattern 4). [INFERRED]
- **Recommended interval:** conservative (e.g. every 5–15 minutes per job) — no published rate limits, and these are per-tenant instances. [INFERRED]

### Polling Pattern

```
1. Record the job's last-seen status (and shippedDate)
2. Wait the interval (start at ~10 min; back off if instance is busy)
3. GET /api/Job/{jobNo}
4. If status changed (or shippedDate became non-null) → notify / act
5. Update last-seen status
6. Goto 2
```

### Efficient Polling Tips

- Only poll jobs the user is actively tracking. [INFERRED]
- Prefer a single modified-since list call over many per-job GETs IF that filter exists. [INFERRED]
- Throttle hard — these are single-tenant instances with unknown capacity; do not hammer. [INFERRED]

---

## Error Handling

### Standard Error Response Format

`[UNKNOWN]` — not public. Anticipated (do NOT rely on field names):

```json
[INFERRED — UNVERIFIED]
{ "success": false, "message": "Invalid credentials", "errorCode": "AUTH_FAILED" }
```

**Error fields:** all `[UNKNOWN]`. On the first real error, capture the exact body shape (is it
`{message}`? `{error, message, statusCode}`? an XML fault?) and adapt parsing to it.

### Validation Error Format

`[UNKNOWN]` — field-level validation error shape is not public. Discover from a deliberately-malformed write.

### Recovery Playbook

> ⚠️ Status semantics are generic-REST `[INFERRED]`, NOT confirmed for printIQ.

| HTTP Status | Meaning             | Retryable? | Recovery Action                                                | Max Retries |
| ----------- | ------------------- | ---------- | -------------------------------------------------------------- | ----------- |
| 400         | Bad request         | No         | Fix body/params; check REST-vs-XML body expectation            | 0           |
| 401         | Unauthorized        | Yes        | Re-mint token (re-POST the 4 credentials); verify token header | 1           |
| 403         | Forbidden           | No         | API user lacks permission for that resource — check its role   | 0           |
| 404         | Not found           | No         | Verify reference AND instance host/base path (ambiguous!)      | 0           |
| 409         | Conflict            | Maybe      | Re-read resource, resolve, retry once                          | 1           |
| 422         | Validation error    | No         | Fix fields per message (format unknown)                        | 0           |
| 429         | Rate limited        | Yes        | Honor Retry-After if present; else exponential backoff         | 3           |
| 500         | Internal error      | Yes        | Retry with exponential backoff                                 | 3           |
| 502         | Bad gateway         | Yes        | Retry after a few seconds                                      | 3           |
| 503         | Service unavailable | Yes        | Retry after Retry-After if present                             | 3           |

### Rate Limit Details

| Scope  | Limit     | Window | Headers   |
| ------ | --------- | ------ | --------- |
| Global | [UNKNOWN] | —      | [UNKNOWN] |

- **No published rate limits.** Apply conservative client-side throttling by default. [INFERRED]
- **429 behaviour:** `[UNKNOWN]` — honor a `Retry-After` header if present; otherwise exponential backoff
  starting at 2s, max ~60s, with jitter, ≤3 retries. [INFERRED]

### Error Code Reference

`[UNKNOWN]` — no printIQ-specific error-code catalog is public. Discover from live errors.

---

## Counter-Exceptions

> Behaviors to watch for that differ from standard REST. (All `[INFERRED]` until verified.)

1. **404 is ambiguous (wrong reference vs wrong host).** Because the base URL is per-tenant and not in
   the credentials, a 404 often means the _host/base path_ is wrong, not the reference. Re-check the
   instance URL first.
   - Standard behavior: 404 = resource doesn't exist.
   - Possible actual behavior: 404 = wrong instance host / base path. [INFERRED]

2. **Token header may not be `Authorization: Bearer`.** The issued token might attach via a custom
   header or query param.
   - Standard behavior: `Authorization: Bearer {token}`.
   - Possible actual behavior: custom header or query token. [UNKNOWN]

3. **A "JSON" endpoint may actually expect/return XML.** Older printIQ surfaces may be SOAP/XML.
   - Standard behavior: JSON request/response.
   - Possible actual behavior: XML on some endpoints. [INFERRED]

---

## Output Formatting Guide

> How to present PrintIQ responses to the user in the workspace agent.

### Recommended Display Formats

| Data Type    | Format                  | Example                                                              |
| ------------ | ----------------------- | -------------------------------------------------------------------- |
| Price result | Price + currency + lead | "500 × BC-350GSM (matte, double-sided): **NZD $250.00**, ~3 days"    |
| Quote        | Number + status + total | "Q-100235: Draft — NZD $250.00 for Acme Signs Ltd"                   |
| Job / order  | Number + status + due   | "J-100234: In Production, due Jun 4 2026 (not yet shipped)"          |
| Customer     | Name + code + status    | "Acme Signs Ltd (CUST001) — Active, Trade pricing"                   |
| Product      | Name + code             | "Business Card 350gsm (BC-350GSM)"                                   |
| Currency     | Localized               | "NZD $1,250.00" (currency from instance settings)                    |
| Date         | Human-readable          | "June 4, 2026"                                                       |
| Errors       | Clear, actionable       | "Couldn't reach PrintIQ — confirm the instance URL and credentials." |

### Truncation Rules

- Lists: show first ~10 records, note the total if known.
- Long fields (specs, breakdowns): summarize; offer to expand.
- Nested records: show 2 levels deep (e.g. Quote → lines, not every option detail).

### When data is uncertain

- If a call fails because an endpoint/path is unverified, tell the user plainly that the PrintIQ API
  surface is partner-gated and may need the IQConnect doc pack / instance URL from printIQ support —
  do not silently retry guessed paths forever. [INFERRED]

---

_Generated from the investigation questionnaire, Phases 7-8 (web research only; no live call). Webhooks + cXML existence are documented; payload/error/rate-limit detail is unknown — discover and re-tag before relying on it._
