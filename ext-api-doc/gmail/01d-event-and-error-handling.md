---
api_name: 'Gmail API'
api_slug: 'gmail'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Gmail API — Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Push notifications (Pub/Sub), the history change feed,
> the Google error envelope, the quota-unit rate-limit model, and recovery.

---

## Event-Driven Capabilities

| Mechanism             | Supported | Notes                                                         |
| --------------------- | --------- | ------------------------------------------------------------- |
| Direct HTTP webhook   | No        | No native webhook; push is mediated by Cloud Pub/Sub          |
| Cloud Pub/Sub push    | **Yes**   | `users.watch` → GCP topic → push subscription → your endpoint |
| WebSocket             | No        | —                                                             |
| Server-Sent Events    | No        | —                                                             |
| Change feed (polling) | **Yes**   | `users.history.list` with `startHistoryId`                    |

> The connector registry declares trigger `eventTypes` (`new_email`, `email_read`,
> `label_changed`, `email_sent`). **Gmail does not emit these discrete types** — it emits a single
> "mailbox changed" Pub/Sub ping carrying only `{emailAddress, historyId}`. Numa derives the
> specific event by diffing `history.list`. [INFERRED — registry + docs]

---

## Push Notifications (`users.watch`)

### Setup (heavyweight — requires a GCP Pub/Sub topic)

1. Create a Cloud Pub/Sub topic in Numa's Google project.
2. Grant `gmail-api-push@system.gserviceaccount.com` the **Publisher** role on the topic.
3. Create a push subscription pointing at Numa's HTTPS receiver.
4. Call `users.watch` per mailbox:

```http
POST /gmail/v1/users/me/watch
Authorization: Bearer <token>
Content-Type: application/json

{
  "topicName": "projects/<gcp-project>/topics/gmail-numa",
  "labelIds": ["INBOX"],
  "labelFilterBehavior": "INCLUDE"
}
```

**Watch response:**

```json
{ "historyId": "1234567890", "expiration": "1431990098200" }
```

**Stop:** `POST /gmail/v1/users/me/stop` (empty body).

### Notification Payload

The Pub/Sub message `data` field is base64-encoded JSON; decoded it is **only**:

```json
{ "emailAddress": "user@example.com", "historyId": "9876543210" }
```

> The ping does **not** say what changed. You must call `history.list?startHistoryId=<last seen>`
> to learn the actual changes (messagesAdded, labelsAdded/Removed, …) and map them to the
> registry event types. [DOCUMENTED]

### Deriving the discrete events

| Registry event  | Derived from `history.list`                    |
| --------------- | ---------------------------------------------- |
| `new_email`     | `messagesAdded` entry in a watched label       |
| `email_read`    | `labelsRemoved` with `UNREAD`                  |
| `label_changed` | `labelsAdded` / `labelsRemoved` (non-`UNREAD`) |
| `email_sent`    | `messagesAdded` carrying the `SENT` label      |

### Reliability / Lifecycle

- **Re-call `watch` at least every 7 days** (Google recommends daily) or push silently stops. [DOCUMENTED]
- Pub/Sub is **at-least-once** → duplicate notifications happen. **Dedupe on `historyId`**;
  process only history records newer than the last applied `historyId`. [DOCUMENTED]
- Store the last-applied `historyId` per mailbox; pass it as `startHistoryId` next time.
- **`historyId` can expire** if the mailbox changes a lot before you poll — a 404 on
  `history.list` means do a full re-sync (re-list from current state). [DOCUMENTED]
- **Operational weight:** this is heavier than an HMAC webhook (needs a GCP topic + history
  diffing). 🔬 LIVE-CONFIRM the full plumbing before relying on triggers.

---

## Polling Fallback (change feed)

When push isn't viable, poll the history change feed:

```http
GET /gmail/v1/users/me/history?startHistoryId=9876543210&historyTypes=messageAdded&historyTypes=labelAdded
Authorization: Bearer <token>
```

```json
{
  "history": [
    {
      "id": "9876543300",
      "messages": [{ "id": "17c4...", "threadId": "17c4..." }],
      "messagesAdded": [{ "message": { "id": "17c4...", "labelIds": ["INBOX", "UNREAD"] } }]
    }
  ],
  "historyId": "9876543400",
  "nextPageToken": "..."
}
```

- **Coarse fallback:** `messages.list?q=newer_than:1h` when you have no `startHistoryId`.
- **Change-detection field:** `historyId` (preferred) or `internalDate`.
- **Interval:** respect quota; the registry `CACHING_PRESETS.email` TTL is **60s** — polling
  faster than ~60s is wasteful. [INFERRED — registry]
- `history.list` costs **2 quota units**; it is cheaper than re-listing messages.

---

## Error Handling

### Standard Google error envelope

```json
{
  "error": {
    "code": 401,
    "message": "Invalid Credentials",
    "errors": [
      {
        "domain": "global",
        "reason": "authError",
        "message": "Invalid Credentials",
        "locationType": "header",
        "location": "Authorization"
      }
    ],
    "status": "UNAUTHENTICATED"
  }
}
```

**Error fields:**

| Field             | Type   | Always present? | Description                                       |
| ----------------- | ------ | --------------- | ------------------------------------------------- |
| `code`            | number | yes             | HTTP status                                       |
| `message`         | string | yes             | Human-readable summary                            |
| `status`          | string | usually         | Canonical code (`PERMISSION_DENIED`, …)           |
| `errors[].reason` | string | usually         | Machine reason (`authError`, `rateLimitExceeded`) |
| `errors[].domain` | string | usually         | `global`, `usageLimits`, …                        |

> Detect errors by the presence of the top-level `error` object — success bodies never carry it.

### Reason codes that matter

| HTTP | `reason`                                                             | Meaning                                  | Retryable?             | Action                            |
| ---- | -------------------------------------------------------------------- | ---------------------------------------- | ---------------------- | --------------------------------- |
| 400  | `invalidArgument` / parse                                            | Bad `q` or param                         | No                     | Fix request                       |
| 401  | `authError`                                                          | Expired/invalid access token             | Yes                    | Refresh token, retry once         |
| 403  | `insufficientPermissions`                                            | Scope missing (e.g. send under readonly) | **No**                 | Re-consent w/ broader scope; stop |
| 403  | `rateLimitExceeded` / `userRateLimitExceeded` / `dailyLimitExceeded` | Quota exceeded                           | Yes                    | Exponential backoff + jitter      |
| 403  | `domainPolicy`                                                       | Workspace admin blocked the API          | No                     | Admin must allow                  |
| 404  | `notFound`                                                           | Message/label/history id gone            | No (history → re-sync) | Verify id                         |
| 429  | `RESOURCE_EXHAUSTED`                                                 | Quota (newer surface)                    | Yes                    | Backoff + retry                   |
| 500  | `backendError`                                                       | Transient server error                   | Yes                    | Backoff + retry                   |
| 503  | `SERVICE_UNAVAILABLE`                                                | Overloaded                               | Yes                    | Backoff + retry                   |

> **Critical distinction:** a 403 `insufficientPermissions` is **not** retryable — it's a scope
> problem (this is what `messages.send` returns under `gmail.readonly`). A 403 `*rateLimitExceeded`
> **is** retryable with backoff. Read `errors[].reason`, not just the status code.

### Recovery Playbook

| HTTP        | Retryable? | Recovery                                       | Max Retries |
| ----------- | ---------- | ---------------------------------------------- | ----------- |
| 400         | No         | Fix `q`/params                                 | 0           |
| 401         | Yes        | Refresh access token, retry once               | 1           |
| 403 (scope) | No         | Re-consent with broader scope; surface to user | 0           |
| 403 (quota) | Yes        | Exponential backoff + jitter                   | 3+          |
| 404         | No\*       | Verify id; for `history` 404 → full re-sync    | 0           |
| 429         | Yes        | Exponential backoff + jitter                   | 3+          |
| 5xx         | Yes        | Exponential backoff                            | 3           |

### OAuth token-endpoint errors

These come from the **token URL** (`https://oauth2.googleapis.com/token`), not the API:

- `{"error":"invalid_grant"}` — refresh token revoked/expired → **force full re-consent**.
- `{"error":"invalid_client"}` — client id/secret wrong → connector config issue.

---

## Rate Limits (quota-unit model)

Gmail bills **quota units**, not raw requests. [DOCUMENTED]

| Scope                          | Limit            | Window  | Notes                             |
| ------------------------------ | ---------------- | ------- | --------------------------------- |
| Per project                    | 1,200,000 units  | /minute | Project-wide ceiling              |
| **Per user per project**       | **6,000 units**  | /minute | **The limit you'll actually hit** |
| Per project (daily, free tier) | 80,000,000 units | /day    | Above → billing/quota increase    |

**Per-method cost:**

| Method            | Units |
| ----------------- | ----- |
| `labels.list`     | 1     |
| `history.list`    | 2     |
| `messages.list`   | 5     |
| `messages.get`    | 5     |
| `messages.modify` | 5     |
| `attachments.get` | 5     |
| `messages.send`   | 100   |
| `drafts.send`     | 100   |

> At 6,000 units/user/min you can do ~1,200 `messages.get`/min/user. A 50-row hydrated folder
> (≈255 units) is cheap; **runaway pagination over thousands of messages is the quota risk.**
> Bound searches with `newer_than:`/`after:` instead of scanning whole labels.

### Rate-limit response (403) + backoff

```json
{
  "error": {
    "code": 403,
    "message": "User-rate limit exceeded.  Retry after 2026-05-29T12:00:05.000Z",
    "errors": [{ "domain": "usageLimits", "reason": "userRateLimitExceeded", "message": "User Rate Limit Exceeded" }]
  }
}
```

**Backoff strategy:**

1. `Retry-After` is **not reliably present** — don't depend on it.
2. Truncated exponential backoff with jitter: start ~1s, double each attempt, cap ~32–64s.
3. Limits are per-user-per-minute → **serialise** bursty workloads rather than fanning out.

---

## Counter-Exceptions

1. **A push notification tells you nothing but "something changed"** — it carries only
   `{emailAddress, historyId}`. Never trust it for content; always `history.list` to discover the
   change, then re-fetch records.
2. **Duplicate notifications are normal** (Pub/Sub at-least-once) — dedupe on `historyId`; make the
   receiver idempotent.
3. **A 403 can be either a hard scope error or a soft quota error** — branch on
   `errors[].reason`, not on the bare `403`.
4. **`history.list` 404/expired `historyId`** means a full re-sync, not a retry of the same call.

---

## Output Formatting Guide

| Data Type    | Format            | Example                                              |
| ------------ | ----------------- | ---------------------------------------------------- |
| Single email | Key-value summary | "Invoice #4471 — from Acme Billing — 3 May 2021"     |
| Message list | Markdown table    | from · subject · date (hydrate stubs first)          |
| Label list   | Bullets / table   | name · unread/total counts                           |
| Attachment   | Note + offer      | "1 PDF attached (82 KB) — download it?"              |
| Errors       | Plain message     | "I can't send email — this connection is read-only." |

- Lists: show first ~20–25 rows; note `resultSizeEstimate` is approximate.
- For read-only scope, never imply send/modify succeeded — say it's not available and stop.

---

_Generated from the investigation questionnaire, Phases 7–8._
