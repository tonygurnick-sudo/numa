---
api_name: PrintIQ
api_slug: printiq
companion_to: 01-llm-api-rules.md
content: events (webhooks, punch-out/cXML, polling), error handling, recovery, output formatting
confidence: LOW. Webhook EXISTENCE and the punch-out cXML surface are [DOCUMENTED]; the webhook event catalog, payload shapes, signatures, retry policy, error-response format, and rate limits are all [UNKNOWN]. Error-status semantics below are generic-REST [INFERRED], not printIQ-confirmed.
---

# PrintIQ — Event & Error Handling Reference

## Event-Driven Capabilities

| Mechanism              | Supported            | Notes                                                                                |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| Webhooks               | Yes (support-set-up) | printIQ **support provisions webhooks per request**; not self-service [DOCUMENTED]   |
| cXML callbacks         | Yes (punch-out)      | Procurement punch-out uses cXML request/callback — **separate surface** [DOCUMENTED] |
| WebSocket              | [UNKNOWN]            | None found                                                                           |
| Server-Sent Events     | [UNKNOWN]            | None found                                                                           |
| Long polling           | No                   | [INFERRED]                                                                           |
| Change feeds / streams | [UNKNOWN]            | None found                                                                           |

## Webhooks

Created by the printIQ team via a **support request** — the consumer supplies a Webhook URL, printIQ configures the event(s). There is **no public self-service registration API**. Do NOT attempt to register webhooks via REST — direct the user to their printIQ account manager.

- Registration: support request (not API/UI self-service) [DOCUMENTED]. Registration endpoint: none public [UNKNOWN]. URL requirement: consumer provides an HTTPS webhook URL [INFERRED].

Event catalog `[UNKNOWN]`. The only publicly confirmed events are the three used by the Infigo integration:
| Event | Trigger | Key payload fields (INFERRED) | Notes |
| --- | --- | --- | --- |
| Static PDF product sync | Product change | product code, details | Pushes product changes [DOCUMENTED] |
| Inventory Items product sync | Inventory/stock product change | item code, stock level | Pushes inventory changes [DOCUMENTED] |
| Shipped status update | Job/order ships | jobNo/orderNo, shippedDate | Lets consumer mark shipped + notify end customer [DOCUMENTED] |

Payload format `[UNKNOWN]` — no public schema. Anticipated (do NOT rely on it): `{ "event": "shipped", "jobNo": "J-100234", "shippedDate": "2026-06-04T02:00:00Z" }` [INFERRED — UNVERIFIED].
Security: signature header/algorithm `[UNKNOWN]` — ask printIQ support how (or whether) payloads are signed, and validate before trusting them. IP allowlist `[UNKNOWN]`.
Reliability: retry policy/schedule/max retries `[UNKNOWN]`. Ordering/duplicate delivery/dedup `[UNKNOWN]` — assume at-least-once delivery and dedupe on a stable key (e.g. `jobNo` + `shippedDate`). [INFERRED]

## Punch-Out (cXML) — OUT OF SCOPE

A separate procurement integration surface using **cXML** request/callback flows with configured identities and shared secrets; delivers orders (with artwork) straight to the Production Board. This is NOT the JSON REST IQConnect API and is out of scope for this connector. If a user asks about punch-out, explain it's a separate cXML integration handled outside this connector. [DOCUMENTED]

## Polling Fallback

When no "shipped" webhook is provisioned, poll for job/order status changes.

```http
[INFERRED — UNVERIFIED] GET /api/Job/{jobNo}   Host: {instance}.printiq.com   Authorization: Bearer {token}
```

- Change-detection field: `status` (and `shippedDate` if present). [INFERRED]
- Modified-since list filter `[UNKNOWN]` — if one exists, prefer it over per-job polling (see 01b Pattern 4). [INFERRED]
- Interval: conservative (~5–15 min per job) — no published rate limits and these are per-tenant instances. [INFERRED]

Pattern: (1) record last-seen status (+ shippedDate); (2) wait the interval (~10 min, back off if instance is busy); (3) GET `/api/Job/{jobNo}`; (4) if status changed or shippedDate became non-null → notify/act; (5) update last-seen; (6) loop.
Tips: only poll jobs the user is actively tracking; prefer a single modified-since list call over many per-job GETs IF that filter exists; throttle hard (single-tenant instances, unknown capacity). [INFERRED]

## Error Handling

Standard error format `[UNKNOWN]` — not public. Anticipated (do NOT rely on field names): `{ "success": false, "message": "Invalid credentials", "errorCode": "AUTH_FAILED" }` [INFERRED — UNVERIFIED]. On the first real error, capture the exact body shape (is it `{message}`? `{error, message, statusCode}`? an XML fault?) and adapt parsing.
Validation error format `[UNKNOWN]` — discover from a deliberately-malformed write.

Recovery playbook (status semantics generic-REST `[INFERRED]`, NOT printIQ-confirmed):
| Status | Meaning | Retryable? | Recovery | Max retries |
| --- | --- | --- | --- | --- |
| 400 | Bad request | No | Fix body/params; check REST-vs-XML body expectation | 0 |
| 401 | Unauthorized | Yes | Re-mint token (re-POST the 4 creds); verify token header | 1 |
| 403 | Forbidden | No | API user lacks permission for that resource — check its role | 0 |
| 404 | Not found | No | Verify reference AND instance host/base path (ambiguous!) | 0 |
| 409 | Conflict | Maybe | Re-read resource, resolve, retry once | 1 |
| 422 | Validation error | No | Fix fields per message (format unknown) | 0 |
| 429 | Rate limited | Yes | Honor Retry-After if present; else exponential backoff | 3 |
| 500 | Internal error | Yes | Retry with exponential backoff | 3 |
| 502 | Bad gateway | Yes | Retry after a few seconds | 3 |
| 503 | Service unavailable | Yes | Retry after Retry-After if present | 3 |

Rate limit: global limit/window/headers all `[UNKNOWN]`. No published limits — apply conservative client-side throttling by default. 429 behaviour `[UNKNOWN]` — honor `Retry-After` if present; else exponential backoff starting 2s, max ~60s, jitter, ≤3 retries. [INFERRED]
Error-code catalog: `[UNKNOWN]` — none public; discover from live errors.

## Counter-Exceptions (behaviors differing from standard REST; all `[INFERRED]` until verified)

1. **404 is ambiguous (wrong reference vs wrong host).** Base URL is per-tenant and not in the credentials, so a 404 often means the host/base path is wrong, not the reference. Standard: 404 = resource doesn't exist. Possible: 404 = wrong instance host/base path. Re-check the instance URL first.
2. **Token header may not be `Authorization: Bearer`.** Standard: `Authorization: Bearer {token}`. Possible: a custom header or query param. [UNKNOWN]
3. **A "JSON" endpoint may actually expect/return XML.** Older printIQ surfaces may be SOAP/XML. Standard: JSON request/response. Possible: XML on some endpoints. [INFERRED]

## Output Formatting (how to present printIQ responses)

| Data type    | Format                  | Example                                                              |
| ------------ | ----------------------- | -------------------------------------------------------------------- |
| Price result | Price + currency + lead | "500 × BC-350GSM (matte, double-sided): **NZD $250.00**, ~3 days"    |
| Quote        | Number + status + total | "Q-100235: Draft — NZD $250.00 for Acme Signs Ltd"                   |
| Job / order  | Number + status + due   | "J-100234: In Production, due Jun 4 2026 (not yet shipped)"          |
| Customer     | Name + code + status    | "Acme Signs Ltd (CUST001) — Active, Trade pricing"                   |
| Product      | Name + code             | "Business Card 350gsm (BC-350GSM)"                                   |
| Currency     | Localized               | "NZD $1,250.00" (currency from instance settings)                    |
| Date         | Human-readable          | "June 4, 2026"                                                       |
| Errors       | Clear, actionable       | "Couldn't reach PrintIQ — confirm the instance URL and credentials." |

Truncation: lists → show first ~10 records, note total if known; long fields (specs, breakdowns) → summarize, offer to expand; nested records → show 2 levels deep (Quote → lines, not every option detail).
When data is uncertain: if a call fails because a path is unverified, tell the user plainly that the printIQ API surface is partner-gated and may need the IQConnect doc pack / instance URL from printIQ support — do NOT silently retry guessed paths forever. [INFERRED]
