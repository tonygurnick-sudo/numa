---
api_name: Gmail API
api_slug: gmail
companion_of: 01-llm-api-rules.md
base_url: https://gmail.googleapis.com/gmail/v1 (version /gmail/v1 already in base; do NOT add /v1)
call_surface: file-browse connector (list-files/search-files/download-file); raw HTTP below is reference/debug only
confidence: [DOCUMENTED] unless tagged [INFERRED]. 🔬 = needs live smoke test.
source_phases: Phase 7 (Real-Time & Event-Driven), Phase 8 (Operational Concerns)
---

# Gmail — Event & Error Handling Reference

Push notifications (Pub/Sub), the history change feed, the Google error envelope, the quota-unit rate-limit model, recovery.

## Event-Driven Capabilities

| Mechanism             | Supported | Notes                                                         |
| --------------------- | --------- | ------------------------------------------------------------- |
| Direct HTTP webhook   | No        | no native webhook; push is mediated by Cloud Pub/Sub          |
| Cloud Pub/Sub push    | **Yes**   | `users.watch` → GCP topic → push subscription → your endpoint |
| WebSocket             | No        | —                                                             |
| Server-Sent Events    | No        | —                                                             |
| Change feed (polling) | **Yes**   | `users.history.list` with `startHistoryId`                    |

Registry declares trigger `eventTypes` (`new_email`, `email_read`, `label_changed`, `email_sent`). **Gmail does not emit these discrete types** — it emits a single "mailbox changed" Pub/Sub ping carrying only `{emailAddress, historyId}`. Numa derives the specific event by diffing `history.list`. [INFERRED — registry + docs]

## Push Notifications (`users.watch`)

Setup (heavyweight — needs a GCP Pub/Sub topic):

1. Create a Cloud Pub/Sub topic in Numa's Google project.
2. Grant `gmail-api-push@system.gserviceaccount.com` the **Publisher** role on the topic.
3. Create a push subscription pointing at Numa's HTTPS receiver.
4. `POST /gmail/v1/users/me/watch` + `Content-Type: application/json`, body `{"topicName":"projects/<gcp-project>/topics/gmail-numa","labelIds":["INBOX"],"labelFilterBehavior":"INCLUDE"}`
   → `{"historyId":"1234567890","expiration":"1431990098200"}`

**Stop:** `POST /gmail/v1/users/me/stop` (empty body).

**Notification payload:** the Pub/Sub message `data` field is base64-encoded JSON; decoded it is **only** `{"emailAddress":"user@example.com","historyId":"9876543210"}`. The ping does **not** say what changed — call `history.list?startHistoryId=<last seen>` to learn the actual changes and map to registry event types. [DOCUMENTED]

**Deriving discrete events:**
| Registry event | Derived from `history.list` |
| --- | --- |
| `new_email` | `messagesAdded` entry in a watched label |
| `email_read` | `labelsRemoved` with `UNREAD` |
| `label_changed` | `labelsAdded` / `labelsRemoved` (non-`UNREAD`) |
| `email_sent` | `messagesAdded` carrying the `SENT` label |

**Reliability / lifecycle:**

- **Re-call `watch` ≥ every 7 days** (Google recommends daily) or push silently stops. [DOCUMENTED]
- Pub/Sub is **at-least-once** → duplicate notifications. **Dedupe on `historyId`**; process only records newer than the last applied `historyId`. Store last-applied per mailbox; pass as `startHistoryId` next time. [DOCUMENTED]
- **`historyId` can expire** if the mailbox changes a lot before you poll — a 404 on `history.list` means full re-sync (re-list from current state). [DOCUMENTED]
- Heavier than an HMAC webhook (needs GCP topic + history diffing). 🔬 LIVE-CONFIRM the full plumbing before relying on triggers.

## Polling Fallback (change feed)

`GET /gmail/v1/users/me/history?startHistoryId=9876543210&historyTypes=messageAdded&historyTypes=labelAdded`
→ `{"history":[{"id":"9876543300","messages":[{"id":"17c4...","threadId":"17c4..."}],"messagesAdded":[{"message":{"id":"17c4...","labelIds":["INBOX","UNREAD"]}}]}],"historyId":"9876543400","nextPageToken":"..."}`

- Coarse fallback when you have no `startHistoryId`: `messages.list?q=newer_than:1h`.
- Change-detection field: `historyId` (preferred) or `internalDate`.
- Interval: respect quota; `CACHING_PRESETS.email` TTL is **60s** — polling faster than ~60s is wasteful. [INFERRED — registry]
- `history.list` costs **2 quota units** — cheaper than re-listing messages.

## Error Handling

Standard Google envelope:
`{"error":{"code":401,"message":"Invalid Credentials","errors":[{"domain":"global","reason":"authError","message":"Invalid Credentials","locationType":"header","location":"Authorization"}],"status":"UNAUTHENTICATED"}}`

Error fields: `code` (number, always — HTTP status) · `message` (string, always) · `status` (string, usually — canonical code e.g. `PERMISSION_DENIED`) · `errors[].reason` (string, usually — machine reason e.g. `authError`, `rateLimitExceeded`) · `errors[].domain` (string, usually — `global`, `usageLimits`). Detect errors by presence of the top-level `error` object — success bodies never carry it.

**Reason codes that matter — branch on `errors[].reason`, NOT bare status:**
| HTTP | `reason` | Meaning | Retryable? | Action |
| --- | --- | --- | --- | --- |
| 400 | `invalidArgument` / parse | bad `q` or param | No | fix request |
| 401 | `authError` | expired/invalid access token | Yes | refresh token, retry once |
| 403 | `insufficientPermissions` | scope missing (e.g. send under readonly) | **No** | re-consent w/ broader scope; stop |
| 403 | `rateLimitExceeded` / `userRateLimitExceeded` / `dailyLimitExceeded` | quota exceeded | Yes | backoff + jitter |
| 403 | `domainPolicy` | Workspace admin blocked the API | No | admin must allow |
| 404 | `notFound` | message/label/history id gone | No (history → re-sync) | verify id |
| 429 | `RESOURCE_EXHAUSTED` | quota (newer surface) | Yes | backoff + retry |
| 500 | `backendError` | transient server error | Yes | backoff + retry |
| 503 | `SERVICE_UNAVAILABLE` | overloaded | Yes | backoff + retry |

**Critical distinction:** 403 `insufficientPermissions` is **not** retryable — it's a scope problem (what `messages.send` returns under `gmail.readonly`). 403 `*rateLimitExceeded` **is** retryable with backoff.

**Recovery max-retries:** 400 → 0 · 401 → 1 (refresh, retry once) · 403 scope → 0 (re-consent, surface to user) · 403 quota → 3+ (backoff+jitter) · 404 → 0 (history 404 → full re-sync) · 429 → 3+ (backoff+jitter) · 5xx → 3 (exponential backoff).

**OAuth token-endpoint errors** (from `https://oauth2.googleapis.com/token`, not the API): `{"error":"invalid_grant"}` = refresh token revoked/expired → **force full re-consent**. `{"error":"invalid_client"}` = client id/secret wrong → connector config issue.

## Rate Limits (quota-unit model)

Gmail bills **quota units**, not raw requests. [DOCUMENTED]

| Scope                          | Limit            | Window  | Notes                             |
| ------------------------------ | ---------------- | ------- | --------------------------------- |
| Per project                    | 1,200,000 units  | /minute | project-wide ceiling              |
| **Per user per project**       | **6,000 units**  | /minute | **the limit you'll actually hit** |
| Per project (daily, free tier) | 80,000,000 units | /day    | above → billing/quota increase    |

Per-method cost: `labels.list` 1 · `history.list` 2 · `messages.list` 5 · `messages.get` 5 · `messages.modify` 5 · `attachments.get` 5 · `messages.send` 100 · `drafts.send` 100.

At 6,000 units/user/min ≈ 1,200 `messages.get`/min/user. A 50-row hydrated folder (≈255 units) is cheap; **runaway pagination over thousands of messages is the quota risk.** Bound searches with `newer_than:`/`after:`.

**Rate-limit response (403):** `{"error":{"code":403,"message":"User-rate limit exceeded.  Retry after 2026-05-29T12:00:05.000Z","errors":[{"domain":"usageLimits","reason":"userRateLimitExceeded","message":"User Rate Limit Exceeded"}]}}`

**Backoff:** `Retry-After` is **not reliably present** — don't depend on it. Truncated exponential backoff with jitter: start ~1s, double each attempt, cap ~32–64s. Limits are per-user-per-minute → **serialise** bursty workloads rather than fanning out.

## Counter-Exceptions

1. A push notification tells you nothing but "something changed" — it carries only `{emailAddress, historyId}`. Always `history.list` to discover the change, then re-fetch records.
2. Duplicate notifications are normal (Pub/Sub at-least-once) — dedupe on `historyId`; make the receiver idempotent.
3. A 403 can be either a hard scope error or a soft quota error — branch on `errors[].reason`, not bare `403`.
4. `history.list` 404 / expired `historyId` means a full re-sync, not a retry of the same call.

## Output Formatting Guide

| Data type    | Format            | Example                                              |
| ------------ | ----------------- | ---------------------------------------------------- |
| Single email | key-value summary | "Invoice #4471 — from Acme Billing — 3 May 2021"     |
| Message list | Markdown table    | from · subject · date (hydrate stubs first)          |
| Label list   | bullets / table   | name · unread/total counts                           |
| Attachment   | note + offer      | "1 PDF attached (82 KB) — download it?"              |
| Errors       | plain message     | "I can't send email — this connection is read-only." |

Lists: show first ~20–25 rows; note `resultSizeEstimate` is approximate. For read-only scope, never imply send/modify succeeded — say it's not available and stop.
