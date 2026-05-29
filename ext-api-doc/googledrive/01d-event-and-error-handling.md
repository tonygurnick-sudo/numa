---
api_name: 'Google Drive'
api_slug: 'googledrive'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Google Drive — Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Event-driven capabilities (push channels, the changes feed,
> polling), the quota-unit rate-limit model, the Google error envelope, and recovery playbooks.
>
> **Connector reality:** the connector is **pull-based** and does not register push channels or poll
> the changes feed today. Drive _supports_ both — documented here for sync work and a future
> event-driven variant. The 403 `reason` strings are **[DOCUMENTED]** (Google's error guide), not
> live-confirmed. 🔬 Validate exact reason tokens against a real consent before building branch logic.

---

## Event-Driven Capabilities

| Mechanism                | Supported          | Notes                                                            |
| ------------------------ | ------------------ | ---------------------------------------------------------------- |
| Webhooks (push channels) | Yes (not wired up) | `changes.watch` / `files.watch`; HTTPS + verified domain         |
| WebSocket                | No                 | —                                                                |
| Server-Sent Events       | No                 | —                                                                |
| Long polling             | No                 | —                                                                |
| Change feed (polling)    | Yes (recommended)  | `changes.list` + `startPageToken` — the canonical sync mechanism |

---

## Webhooks (push channels) — not wired up

### Setup

- **Registration:** API only. `POST /drive/v3/changes/watch` (account-wide) or
  `POST /drive/v3/files/{id}/watch` (one file). Channel body:

```http
POST /drive/v3/changes/watch
Authorization: Bearer <token>
Content-Type: application/json

{ "id": "<your-uuid>", "type": "web_hook",
  "address": "https://your-endpoint.example/webhook",
  "token": "<opaque-secret>", "expiration": 1735689600000 }
```

- **URL requirements:** HTTPS with a valid (non-self-signed) cert on a **verified domain**.
- **Expiration:** max **1 day** for `files.watch`, **1 week** for `changes.watch`. **No auto-renew** —
  re-issue with a new channel `id` before expiry.
- **Stop:** `POST /drive/v3/channels/stop` with `{ "id": "...", "resourceId": "..." }`.

### Notification format — header-only (no body)

Drive push notifications carry **no JSON body**; everything is in headers:

| Header                  | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `X-Goog-Channel-ID`     | Your channel id (echo of `id`)                                        |
| `X-Goog-Resource-State` | `sync` / `add` / `remove` / `update` / `trash` / `untrash` / `change` |
| `X-Goog-Resource-ID`    | Opaque id of the watched resource                                     |
| `X-Goog-Message-Number` | Monotonic counter — use to dedupe / order                             |
| `X-Goog-Channel-Token`  | Echo of your `token` — use to authenticate the callback               |
| `X-Goog-Changed`        | `content` / `parents` / `children` / `permissions` (what changed)     |

### Verification / Security

- **No HMAC signature.** Security relies on (a) HTTPS to a verified domain and (b) the secret
  `token` you supplied being echoed in `X-Goog-Channel-Token`. Reject callbacks whose token doesn't
  match. There is no signature header to compute.
- **Treat the payload as "something changed, go look".** Because the notification has no body and no
  per-file detail beyond the resource state, **re-fetch** via `changes.list` (or `files.get`) rather
  than trusting the notification contents.

### Reliability

- **At-least-once** delivery — duplicates are possible; dedupe on `X-Goog-Message-Number`.
- **No strict ordering** guarantee.
- A channel silently stops at expiry — re-register proactively.

---

## Polling Fallback — the recommended sync mechanism

This is how to sync Drive without webhooks, and the path a future incremental-sync feature should use.

### Pattern

```
1. Seed:   GET /drive/v3/changes/startPageToken
           → { "startPageToken": "8421" }   ← store it
2. Poll:   GET /drive/v3/changes?pageToken=<saved>&includeRemoved=true
                 &includeItemsFromAllDrives=true&supportsAllDrives=true
                 &fields=newStartPageToken,nextPageToken,changes(fileId,removed,time,file(id,name,mimeType,modifiedTime))
3. Page:   follow nextPageToken within this poll cycle
4. Save:   when nextPageToken is absent, store newStartPageToken for the NEXT poll
5. Wait, goto 2
```

### Example response

```json
{
  "newStartPageToken": "8455",
  "changes": [
    {
      "changeType": "file",
      "time": "2026-05-29T03:10:00.000Z",
      "removed": false,
      "fileId": "1aBcD3eFgH",
      "file": {
        "id": "1aBcD3eFgH",
        "name": "Q2 Board Deck",
        "mimeType": "application/vnd.google-apps.presentation",
        "modifiedTime": "2026-05-29T03:09:55.000Z"
      }
    },
    { "changeType": "file", "time": "2026-05-29T03:11:20.000Z", "removed": true, "fileId": "9deletedId" }
  ]
}
```

### Efficient polling tips

- **`removed: true`** = the file was deleted or you lost access — the only reliable deletion signal
  (a `files.list` with `trashed=false` simply omits deleted items; it can't tell you they vanished).
- **`includeRemoved=true`** to receive those tombstones; pass shared-drive flags to catch shared-drive
  changes.
- **Always set `fields`** to trim the embedded `file` payload.
- **Change-detection fields** for a single file: `modifiedTime`, `md5Checksum` (binary), `version`.
- A simpler "modified since" sweep — `files.list?q=modifiedTime > '...'` — works but **misses
  deletions**; prefer the changes feed for real sync.
- Recommended interval: conservative (e.g. ≥ 60 s) to stay well within quota.

---

## Rate Limits (quota-unit model)

Drive meters by **quota units**, not request count. Different methods cost different amounts:

| Method class           | Approx. cost (units) |
| ---------------------- | -------------------- |
| `files.list`           | ~100                 |
| download (`alt=media`) | ~200                 |
| `files.get` / metadata | ~5                   |
| `files.export`         | download-class       |

| Scope                | Limit           | Window     |
| -------------------- | --------------- | ---------- |
| Per project          | 1,000,000 units | per minute |
| Per user per project | 325,000 units   | per minute |
| Per project (egress) | 1 TB            | per day    |

> A browse-then-download session is dominated by list (~100) + download (~200) costs. There are **no
> standard `X-RateLimit-*` headers**, and `Retry-After` is **not consistently sent**.

**Rate-limit exceeded response:**

```json
{
  "error": {
    "code": 403,
    "message": "User Rate Limit Exceeded",
    "errors": [{ "domain": "usageLimits", "reason": "userRateLimitExceeded", "message": "User Rate Limit Exceeded" }]
  }
}
```

> Quota exhaustion surfaces as **either `403`** (`userRateLimitExceeded` / `rateLimitExceeded`)
> **or `429`** (`rateLimitExceeded`). Detect by `reason`, not status alone.

**Backoff strategy:**

1. No reliable `Retry-After` → use **truncated exponential backoff**: `min((2^n) + random_ms, 64s)`.
2. Add jitter (the `random_ms`) to avoid thundering herds.
3. Serialise bursty download workloads rather than fanning out — downloads are the most expensive.

---

## Error Handling

### Standard Google error envelope

```json
{
  "error": {
    "code": 404,
    "message": "File not found: 1aBcD3eFgH.",
    "errors": [
      {
        "domain": "global",
        "reason": "notFound",
        "message": "File not found: 1aBcD3eFgH.",
        "locationType": "parameter",
        "location": "fileId"
      }
    ]
  }
}
```

**Error fields:**

| Field            | Type   | Always Present? | Description                                            |
| ---------------- | ------ | --------------- | ------------------------------------------------------ |
| `error.code`     | number | yes             | HTTP status                                            |
| `error.message`  | string | yes             | Human-readable summary                                 |
| `error.errors[]` | array  | usually         | Detail list; `.reason` is the branch key               |
| `.reason`        | string | usually         | Machine token (e.g. `notFound`, `fileNotDownloadable`) |
| `.domain`        | string | usually         | `global` / `usageLimits` / `userLimits`                |
| `.location`      | string | on param errors | The offending parameter (e.g. `fileId`, `q`)           |

> **Branch on `errors[].reason`, never on the HTTP code alone.** `403` covers permission _and_ rate
> limits with opposite recovery paths.

### Recovery Playbook

| HTTP Status | reason(s)                                        | Meaning                              | Retryable? | Recovery Action                         | Max Retries |
| ----------- | ------------------------------------------------ | ------------------------------------ | ---------- | --------------------------------------- | ----------- |
| 400         | `badRequest`, `invalidQuery`, `invalidParameter` | Malformed `q` / params               | No         | Fix the query/params                    | 0           |
| 401         | `authError`, `invalidCredentials`                | Expired/invalid token                | Yes        | Connector refreshes token, retry once   | 1           |
| 403         | `insufficientPermissions`                        | Scope/ACL too narrow                 | No         | Re-consent w/ scope, or file not shared | 0           |
| 403         | `userRateLimitExceeded`, `rateLimitExceeded`     | Quota exhausted                      | Yes        | Exponential backoff                     | 3+          |
| 403         | `fileNotDownloadable`                            | `alt=media` on a Google-native doc   | No         | Use `/files/{id}/export` instead        | 0           |
| 403         | `cannotDownloadAbusiveFile`                      | File flagged as malware              | No         | `acknowledgeAbuse=true` (owner only)    | 0           |
| 404         | `notFound`                                       | File/permission missing or no access | No         | Verify id / access; re-list parent      | 0           |
| 429         | `rateLimitExceeded`                              | Quota exhausted                      | Yes        | Exponential backoff                     | 3+          |
| 500         | `internalError`                                  | Server error                         | Yes        | Retry with exponential backoff          | 3           |
| 502 / 503   | `backendError`                                   | Transient backend                    | Yes        | Retry with exponential backoff          | 3           |

### Connector-level error code

The provider raises `OAuthError(error_code="FILE_TOO_LARGE")` when a file's `size` (or the
`Content-Length` header on download) exceeds `MAX_DOWNLOAD_SIZE`. This is a **connector guard, not a
Drive API error** — surface it as "file too large to pull into the workspace", not a 4xx/5xx.

---

## Counter-Exceptions

1. **403 is overloaded.**
   - Standard expectation: 403 = permission problem.
   - Actual: 403 also means rate-limit exhaustion (`userRateLimitExceeded`) and
     "wrong download method" (`fileNotDownloadable`). Inspect `reason`.

2. **Deletion is invisible to `files.list`.**
   - Standard expectation: a list reflects current state, so missing = deleted.
   - Actual: a deleted file simply isn't returned — you can't distinguish "deleted" from "never
     existed" or "moved out of scope". Use the `changes` feed (`removed: true`) for deletions.

3. **Native docs 403 on download.**
   - Standard expectation: GET the file URL → bytes.
   - Actual: Google-native docs have no byte content; `alt=media` → `403 fileNotDownloadable`. Must
     `export`. The provider auto-branches on the `vnd.google-apps.` prefix.

---

## Output Formatting Guide

| Data Type   | Format            | Example                                                       |
| ----------- | ----------------- | ------------------------------------------------------------- |
| Single file | Key-value summary | "Q2 Board Deck — Google Slides — modified 20 May 2026"        |
| File list   | Markdown table    | name · type · modified · size (folders first)                 |
| Folder      | Labelled clearly  | "📁 Reports (folder)" so the user knows it's navigable        |
| Dates       | Human-readable    | "20 May 2026, 9:14 AM UTC"                                    |
| Size        | Human units       | "471 KB" (convert the byte string; native docs: "—")          |
| Errors      | Clear message     | "Couldn't find that file, or it isn't shared with you (404)." |

### Truncation Rules

- Lists: show the first ~20–25 rows; note "more available" while a `nextPageToken` remains (no total).
- Native docs have no `size` — show "—", not "0 B".
- Always prefer the file's `webViewLink` when pointing the user at the original.

---

_Generated from the investigation questionnaire, Phases 7–8._
