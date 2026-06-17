---
api_name: Google Drive
api_slug: googledrive
companion_of: 01-llm-api-rules.md
base_url: https://www.googleapis.com/drive/v3
call_surface: file-store connector (list-files/search-files/download-file); NOT `numa integrations request`
event_model: connector is PULL-based — no push channels, no changes-feed polling wired today. Drive supports both (documented here for sync work / future variant).
confidence: doc-based [DOCUMENTED]; 403 reason strings from Google's error guide, not live-confirmed. 🔬 validate exact reason tokens against a real consent before building branch logic.
source_phases: Phase 7 (Real-Time/Event), Phase 8 (Operational)
---

# Google Drive — Event & Error Handling Reference

## Event-Driven Capabilities

| Mechanism                | Supported          | Notes                                                        |
| ------------------------ | ------------------ | ------------------------------------------------------------ |
| Webhooks (push channels) | Yes (not wired up) | `changes.watch` / `files.watch`; HTTPS + verified domain     |
| WebSocket                | No                 | —                                                            |
| Server-Sent Events       | No                 | —                                                            |
| Long polling             | No                 | —                                                            |
| Change feed (polling)    | Yes (recommended)  | `changes.list` + `startPageToken` — canonical sync mechanism |

## Webhooks (push channels) — not wired up

**Registration (API only):** `POST /drive/v3/changes/watch` (account-wide) or `POST /drive/v3/files/{id}/watch` (one file). Body:
`{"id":"<your-uuid>","type":"web_hook","address":"https://your-endpoint.example/webhook","token":"<opaque-secret>","expiration":1735689600000}`

- **URL:** HTTPS, valid (non-self-signed) cert, **verified domain**.
- **Expiration:** max **1 day** (`files.watch`) / **1 week** (`changes.watch`). **No auto-renew** — re-issue with a new channel `id` before expiry; a channel silently stops at expiry.
- **Stop:** `POST /drive/v3/channels/stop` with `{"id":"...","resourceId":"..."}`.

**Notification = header-only (no JSON body):**
| Header | Meaning |
| --- | --- |
| `X-Goog-Channel-ID` | Your channel id (echo of `id`) |
| `X-Goog-Resource-State` | `sync`/`add`/`remove`/`update`/`trash`/`untrash`/`change` |
| `X-Goog-Resource-ID` | Opaque id of the watched resource |
| `X-Goog-Message-Number` | Monotonic counter — dedupe/order on this |
| `X-Goog-Channel-Token` | Echo of your `token` — authenticate the callback |
| `X-Goog-Changed` | `content`/`parents`/`children`/`permissions` (what changed) |

**Security:** **No HMAC signature.** Relies on (a) HTTPS to a verified domain and (b) the secret `token` echoed in `X-Goog-Channel-Token` — reject callbacks whose token doesn't match. No signature header to compute. Treat the payload as "something changed, go look" → **re-fetch** via `changes.list` / `files.get` rather than trusting notification contents. Delivery is **at-least-once** (dedupe on `X-Goog-Message-Number`); no strict ordering.

## Polling Fallback — recommended sync mechanism

```
1. Seed:  GET /drive/v3/changes/startPageToken  → {"startPageToken":"8421"}  ← store it
2. Poll:  GET /drive/v3/changes?pageToken=<saved>&includeRemoved=true
              &includeItemsFromAllDrives=true&supportsAllDrives=true
              &fields=newStartPageToken,nextPageToken,changes(fileId,removed,time,file(id,name,mimeType,modifiedTime))
3. Page:  follow nextPageToken within this poll cycle
4. Save:  when nextPageToken absent, store newStartPageToken for the NEXT poll
5. Wait, goto 2
```

Example response: `{"newStartPageToken":"8455","changes":[{"changeType":"file","time":"2026-05-29T03:10:00.000Z","removed":false,"fileId":"1aBcD3eFgH","file":{"id":"1aBcD3eFgH","name":"Q2 Board Deck","mimeType":"application/vnd.google-apps.presentation","modifiedTime":"2026-05-29T03:09:55.000Z"}},{"changeType":"file","time":"2026-05-29T03:11:20.000Z","removed":true,"fileId":"9deletedId"}]}`

**Tips:**

- **`removed:true`** = file deleted OR you lost access — the only reliable deletion signal (`files.list` with `trashed=false` just omits deleted items; can't tell you they vanished).
- **`includeRemoved=true`** to receive tombstones; pass shared-drive flags to catch shared-drive changes.
- Always set `fields` to trim the embedded `file` payload.
- Single-file change-detection fields: `modifiedTime`, `md5Checksum` (binary), `version`.
- A simpler "modified since" sweep — `files.list?q=modifiedTime > '...'` — works but **misses deletions**; prefer the changes feed for real sync.
- Recommended interval: conservative (≥60s) to stay within quota.

## Rate Limits (quota-unit model)

Drive meters by **quota units**, not request count. Method cost: `files.list` ~100 · download (`alt=media`) ~200 · `files.get`/metadata ~5 · `files.export` download-class.
| Scope | Limit | Window |
| --- | --- | --- |
| Per project | 1,000,000 units | per minute |
| Per user per project | 325,000 units | per minute |
| Per project (egress) | 1 TB | per day |

A browse-then-download session is dominated by list (~100) + download (~200). **No** `X-RateLimit-*` headers; `Retry-After` **not consistently sent**.

Rate-limit response: `{"error":{"code":403,"message":"User Rate Limit Exceeded","errors":[{"domain":"usageLimits","reason":"userRateLimitExceeded","message":"User Rate Limit Exceeded"}]}}`
Quota exhaustion surfaces as **403** (`userRateLimitExceeded`/`rateLimitExceeded`) OR **429** (`rateLimitExceeded`) — detect by `reason`, not status alone.

**Backoff:** no reliable `Retry-After` → truncated exponential backoff `min((2^n) + random_ms, 64s)` with jitter to avoid thundering herds. Serialise bursty download workloads (downloads are most expensive) rather than fanning out.

## Error Handling

Standard Google envelope: `{"error":{"code":404,"message":"File not found: 1aBcD3eFgH.","errors":[{"domain":"global","reason":"notFound","message":"File not found: 1aBcD3eFgH.","locationType":"parameter","location":"fileId"}]}}`

| Field            | Type   | Always present? | Description                                          |
| ---------------- | ------ | --------------- | ---------------------------------------------------- |
| `error.code`     | number | yes             | HTTP status                                          |
| `error.message`  | string | yes             | Human-readable summary                               |
| `error.errors[]` | array  | usually         | Detail list; `.reason` is the branch key             |
| `.reason`        | string | usually         | Machine token (`notFound`, `fileNotDownloadable`, …) |
| `.domain`        | string | usually         | `global` / `usageLimits` / `userLimits`              |
| `.location`      | string | on param errors | Offending param (`fileId`, `q`)                      |

**Branch on `errors[].reason`, NEVER the HTTP code alone** — `403` spans permission, rate-limit, and wrong-download-method (`fileNotDownloadable`), all opposite recovery paths.

### Recovery Playbook

| Status  | reason(s)                                        | Meaning                              | Retryable | Action                                  | Max retries |
| ------- | ------------------------------------------------ | ------------------------------------ | --------- | --------------------------------------- | ----------- |
| 400     | `badRequest`, `invalidQuery`, `invalidParameter` | Malformed `q`/params                 | No        | Fix query/params                        | 0           |
| 401     | `authError`, `invalidCredentials`                | Expired/invalid token                | Yes       | Connector refreshes token, retry once   | 1           |
| 403     | `insufficientPermissions`                        | Scope/ACL too narrow                 | No        | Re-consent w/ scope, or file not shared | 0           |
| 403     | `userRateLimitExceeded`, `rateLimitExceeded`     | Quota exhausted                      | Yes       | Exponential backoff                     | 3+          |
| 403     | `fileNotDownloadable`                            | `alt=media` on a native doc          | No        | Use `/files/{id}/export`                | 0           |
| 403     | `cannotDownloadAbusiveFile`                      | File flagged as malware              | No        | `acknowledgeAbuse=true` (owner only)    | 0           |
| 404     | `notFound`                                       | File/permission missing or no access | No        | Verify id/access; re-list parent        | 0           |
| 429     | `rateLimitExceeded`                              | Quota exhausted                      | Yes       | Exponential backoff                     | 3+          |
| 500     | `internalError`                                  | Server error                         | Yes       | Exponential backoff                     | 3           |
| 502/503 | `backendError`                                   | Transient backend                    | Yes       | Exponential backoff                     | 3           |

**Connector-level guard:** provider raises `OAuthError(error_code="FILE_TOO_LARGE")` when `size` (or `Content-Length` on download) exceeds `MAX_DOWNLOAD_SIZE`. This is a **connector guard, not a Drive API error** — surface as "file too large to pull into the workspace", not a 4xx/5xx.

### Overloaded-case warnings

1. **403 is overloaded** — permission AND rate-limit (`userRateLimitExceeded`) AND wrong-download-method (`fileNotDownloadable`). Inspect `reason`.
2. **Deletion is invisible to `files.list`** — a deleted file isn't returned; you can't distinguish "deleted" from "never existed"/"moved out of scope". Use the `changes` feed (`removed:true`).
3. **Native docs 403 on download** — no byte content; `alt=media` → `403 fileNotDownloadable`; must `export` (provider auto-branches on the `vnd.google-apps.` prefix).

## Output Formatting

| Data type   | Format            | Example                                                       |
| ----------- | ----------------- | ------------------------------------------------------------- |
| Single file | Key-value summary | "Q2 Board Deck — Google Slides — modified 20 May 2026"        |
| File list   | Markdown table    | name · type · modified · size (folders first)                 |
| Folder      | Labelled clearly  | "📁 Reports (folder)" so user knows it's navigable            |
| Dates       | Human-readable    | "20 May 2026, 9:14 AM UTC"                                    |
| Size        | Human units       | "471 KB" (convert byte string; native docs: "—")              |
| Errors      | Clear message     | "Couldn't find that file, or it isn't shared with you (404)." |

**Truncation:** lists show first ~20–25 rows, note "more available" while a `nextPageToken` remains (no total); native docs show "—" not "0 B" for size; always prefer `webViewLink` when pointing the user at the original.
