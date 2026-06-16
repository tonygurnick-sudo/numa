---
api_name: OneDrive (Microsoft Graph)
api_slug: onedrive
companion_of: 01-llm-api-rules.md
scope: change tracking (delta), webhooks, error envelope, throttling, retry, download handling
base_url: https://graph.microsoft.com/v1.0
confidence: confirmed against docs + shipped provider unless tagged [DOCUMENTED]
---

# OneDrive — Event & Error Handling Reference

## Event-driven capabilities

| Mechanism                | Supported?     | Wired into Numa? | Notes                                                    |
| ------------------------ | -------------- | ---------------- | -------------------------------------------------------- |
| Change feed (delta)      | Yes            | ❌ No            | `/me/drive/root/delta` — pull-based incremental sync     |
| Webhooks (subscriptions) | Yes            | ❌ No            | `POST /subscriptions`; HTTPS callback + validation token |
| WebSocket (socket.io)    | Yes (beta-ish) | ❌ No            | `subscriptions/socketio` near-real-time channel          |
| Server-Sent Events       | No             | —                | —                                                        |
| Long polling             | No             | —                | —                                                        |

Neither delta nor subscriptions are wired — this is a synchronous browse/search/download surface. Material below is documented behavior for when an incremental re-sync layer is added. [DOCUMENTED]

## Change tracking — delta (recommended sync path)

If/when incremental sync is built, **use `delta`, not repeated `children` listings** — paging `children` can miss items written mid-enumeration; `delta` is the only method guaranteed to return every item during concurrent writes.

Flow: first sync `GET /me/drive/root/delta` → pages via `@odata.nextLink` → final page carries `@odata.deltaLink` (store it). Next sync `GET {stored deltaLink}` → only changed items → new `@odata.deltaLink` (store it).

```
GET /me/drive/root/delta
```

```json
{
  "value": [
    {
      "id": "01ABC...123",
      "name": "Budget.xlsx",
      "file": { "mimeType": "..." },
      "lastModifiedDateTime": "2026-05-28T08:22:10Z"
    },
    { "id": "01DEL...999", "name": "Old.docx", "deleted": { "state": "deleted" } }
  ],
  "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=aTokenValue"
}
```

delta rules: [DOCUMENTED]

- Deleted items carry the `deleted` facet — that's how a removal is signalled.
- An item may appear more than once across delta pages — use the **last** occurrence; track by **`id`** (delta omits `parentReference.path`).
- `?token=latest` returns just the current `@odata.deltaLink` without enumerating everything — use to "start watching from now."
- `410 resyncRequired` ⇒ stored delta token stale/expired → discard it and restart delta from scratch (NOT a transient error).

## Webhooks — subscriptions (reference only, not wired)

Notifications are **change hints, not the changed data** — they tell you the drive changed; you then call `delta` to learn what. [DOCUMENTED]

```json
POST /subscriptions
{"changeType":"updated","notificationUrl":"https://your-endpoint.example/webhook","resource":"/me/drive/root","expirationDateTime":"2026-06-01T00:00:00Z","clientState":"<secret>"}
```

- Validation handshake: on creation Graph sends a `validationToken` query param; the endpoint must echo it back as `200 text/plain` within ~10s, or the subscription fails.
- Lifetime: short-lived (~3 days max for drive resources); renew via `PATCH /subscriptions/{id}` before `expirationDateTime`.
- Security: HTTPS required; `clientState` is echoed back so the receiver can verify the source.

## Polling fallback [DOCUMENTED]

Recommended: `delta` with a stored `@odata.deltaLink` — NOT re-listing `children` (paging can miss items written mid-enumeration; delta is far cheaper than repeated full listings). Per-item change detection: `lastModifiedDateTime` / `eTag` / `cTag`. Cheap check: `if-none-match: {eTag}` on a GET → `304 Not Modified`.

## Error handling

Standard envelope (all Graph errors). Detect errors by the presence of a top-level `error` key, not status code alone.

```json
{
  "error": {
    "code": "itemNotFound",
    "message": "The resource could not be found.",
    "innerError": {
      "code": "itemNotFound",
      "request-id": "94fb5d36-3aa2-4f1e-9d12-5b6c0e1a2b3c",
      "client-request-id": "94fb5d36-3aa2-4f1e-9d12-5b6c0e1a2b3c",
      "date": "2026-05-29T12:51:51"
    }
  }
}
```

Fields: `error.code` (always, machine-readable e.g. `itemNotFound`), `error.message` (always, human summary), `error.innerError` (usually — carries `request-id`), `innerError.request-id` (usually — **capture it**; Microsoft needs it to trace a call).

### Recovery playbook

| HTTP | `error.code`                               | Meaning                         | Retryable? | Recovery                                  | Max retries |
| ---- | ------------------------------------------ | ------------------------------- | ---------- | ----------------------------------------- | ----------- |
| 400  | `invalidRequest`                           | malformed request/params        | No         | fix request (e.g. bad `$filter`)          | 0           |
| 401  | `InvalidAuthenticationToken`               | token missing/expired/invalid   | Yes        | refresh token, retry once                 | 1           |
| 403  | `accessDenied`                             | insufficient scope / no license | No         | re-consent / explain read-only boundary   | 0           |
| 404  | `itemNotFound`                             | drive/item does not exist       | No         | verify item/folder id                     | 0           |
| 409  | `nameAlreadyExists`                        | conflict with current state     | Maybe      | N/A for reads (would be a write)          | 1           |
| 410  | `resyncRequired`                           | delta token stale/gone          | Yes        | discard token, restart delta from scratch | 1           |
| 423  | `notAllowed` (locked)                      | resource locked                 | Maybe      | retry later                               | 1           |
| 429  | `TooManyRequests` / `activityLimitReached` | throttled                       | Yes        | honor `Retry-After`                       | 3           |
| 500  | `generalException`                         | server error                    | Yes        | exponential backoff                       | 3           |
| 503  | `serviceNotAvailable`                      | temporary unavailability        | Yes        | honor `Retry-After`, else backoff         | 3           |
| 507  | `quotaLimitReached`                        | storage quota exhausted         | No         | N/A for reads                             | 0           |

### Rate limits & throttling [DOCUMENTED]

- Status `429` (and some `503`). Published thresholds: **none** — per app+tenant, variable; writes throttled before reads.
- OneDrive rides the SharePoint throttle bus (extra per-resource limits).
- `Retry-After` header present on 429 and most 503 — **seconds to wait** (not ms).

429 body:

```json
{
  "error": {
    "code": "TooManyRequests",
    "message": "Please retry again later.",
    "innerError": { "code": "429", "date": "2026-05-29T12:51:51", "request-id": "94fb...3aa2", "status": "429" }
  }
}
```

Backoff (matches shipped provider): (1) on `429`/`503` honor `Retry-After` — sleep that many seconds; (2) if absent, exponential backoff (~1–2s start, double, cap ~60s, add jitter); (3) provider retries up to **3 times** (`_make_request_with_retry`); (4) throttling is per app+tenant — **serialise** bursty workloads, don't fan out parallel calls.

## File handling (download specifics)

| Item              | Value                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Download endpoint | `GET /me/drive/items/{id}/content` → `302 Found` → preauth URL                                |
| Redirect host     | `*.1drv.com` (personal) or SharePoint host (business)                                         |
| Token safety      | follow `Location` **WITHOUT** `Authorization` — never leak the bearer token                   |
| Range support     | `Range: bytes=0-1023` on the **download URL** → `206 Partial Content` [DOCUMENTED]            |
| Max size (Numa)   | **100 MB** (`MAX_DOWNLOAD_SIZE`); checked via `Content-Length` on redirect AND final response |
| Oversize error    | `FILE_TOO_LARGE` raised before the body is read                                               |

Provider uses `follow_redirects=False`, reads `Location`, then re-requests it with only a `User-Agent` header (no auth). This is the canonical secure download flow — replicate it. A `302` on download is **success, not an error** — the expected handoff to the preauth URL.

## Idempotency & consistency

- All connector operations are `GET` → naturally idempotent; safe to retry.
- `if-none-match: {eTag}` → `304 Not Modified` cheaply checks whether an item changed. [DOCUMENTED]
- delta shows **latest state per item**, not each change — the same item may recur; take the **last** occurrence and key on `id`. [DOCUMENTED]

## Output formatting guide

| Data type      | Format                | Example                                                        |
| -------------- | --------------------- | -------------------------------------------------------------- |
| Folder listing | Markdown table        | name · type (file/folder) · size · modified                    |
| Single file    | Key-value summary     | "Budget.xlsx — 82 KB — modified 28 May 2026"                   |
| Search results | Markdown table + note | rows + "showing first 50; refine the query to narrow"          |
| Download       | Confirm + summary     | "Downloaded Budget.xlsx (82 KB)" then analyze content          |
| Errors         | Clear message         | "Couldn't find that item — it may have been moved or deleted." |

- Lists: show first ~20–50 rows; **no total count**, so say "and more" when paging continues.
- Always branch on the `folder`/`file` facet when rendering — never assume a type field.
- On `403`, tell the user OneDrive is connected **read-only**; don't imply an in-session fix.
