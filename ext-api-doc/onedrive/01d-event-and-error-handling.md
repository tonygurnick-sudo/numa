---
api_name: 'OneDrive (Microsoft Graph)'
api_slug: 'onedrive'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Events', 'Phase 8: Operational Concerns']
---

# OneDrive (Microsoft Graph) — Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Change tracking (delta), webhooks/subscriptions, the Graph
> error envelope, throttling, retry strategy, and file-download handling.

---

## Event-Driven Capabilities

| Mechanism                | Supported?     | Wired into Numa? | Notes                                                    |
| ------------------------ | -------------- | ---------------- | -------------------------------------------------------- |
| Change feed (delta)      | Yes            | ❌ No            | `/me/drive/root/delta` — pull-based incremental sync     |
| Webhooks (subscriptions) | Yes            | ❌ No            | `POST /subscriptions`; HTTPS callback + validation token |
| WebSocket (socket.io)    | Yes (beta-ish) | ❌ No            | `subscriptions/socketio` near-real-time channel          |
| Server-Sent Events       | No             | —                | —                                                        |
| Long polling             | No             | —                | —                                                        |

> **Neither delta nor subscriptions are wired** into the current connector — it is a synchronous
> browse/search/download surface. The material below is documented behavior for when an incremental
> re-sync layer is added. [DOCUMENTED]

---

## Change Tracking — delta (the recommended sync path)

If/when incremental sync is built, **use `delta`, not repeated `children` listings.** Paging
`children` can miss items if writes happen mid-enumeration; `delta` is the only method guaranteed to
return every item even during concurrent writes.

### Flow

```
1. First sync:   GET /me/drive/root/delta
                 → pages of items via @odata.nextLink …
                 → final page carries @odata.deltaLink (store it)
2. Next sync:    GET {stored @odata.deltaLink}
                 → only items changed since last time
                 → new @odata.deltaLink (store it)
```

```http
GET /me/drive/root/delta
Authorization: Bearer <token>
Accept: application/json
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

### delta rules

- **Deleted items carry the `deleted` facet** — that's how a removal is signalled. [DOCUMENTED]
- **An item may appear more than once** across delta pages — use the **last** occurrence, and track
  by **`id`** (delta omits `parentReference.path`). [DOCUMENTED]
- **`?token=latest`** returns just the current `@odata.deltaLink` without enumerating everything —
  use it to "start watching from now." [DOCUMENTED]
- **`410 resyncRequired`** means the stored delta token is stale/expired → discard it and restart
  delta from scratch. [DOCUMENTED]

---

## Webhooks — subscriptions (reference only)

Documented but **not wired**. Notifications are **change hints, not the changed data** — they tell
you the drive changed; you then call `delta` to learn what changed. [DOCUMENTED]

**Register a subscription:**

```http
POST /subscriptions
Content-Type: application/json

{ "changeType": "updated",
  "notificationUrl": "https://your-endpoint.example/webhook",
  "resource": "/me/drive/root",
  "expirationDateTime": "2026-06-01T00:00:00Z",
  "clientState": "<secret>" }
```

- **Validation handshake:** on creation Graph sends a `validationToken` query param; the endpoint
  must echo it back as `200 text/plain` within ~10s, or the subscription fails. [DOCUMENTED]
- **Lifetime:** subscriptions are short-lived (~3 days max for drive resources) and must be renewed
  via `PATCH /subscriptions/{id}` before `expirationDateTime`. [DOCUMENTED]
- **Security:** HTTPS required; `clientState` is echoed back so the receiver can verify the source. [DOCUMENTED]

---

## Polling Fallback

| Item                      | Value                                                                | Confidence   |
| ------------------------- | -------------------------------------------------------------------- | ------------ |
| Recommended approach      | `delta` with a stored `@odata.deltaLink` — NOT re-listing `children` | [DOCUMENTED] |
| Why not poll children     | Paging `children` can miss items written mid-enumeration             | [DOCUMENTED] |
| Per-item change detection | `lastModifiedDateTime` / `eTag` / `cTag`                             | [DOCUMENTED] |
| Cheap change check        | `if-none-match: {eTag}` on a GET → `304 Not Modified`                | [DOCUMENTED] |
| Throttling implication    | delta is far cheaper than repeated full listings                     | [DOCUMENTED] |

---

## Error Handling

### Standard Error Envelope (all Graph errors)

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

**Error fields:**

| Field                   | Always Present? | Description                                           |
| ----------------------- | --------------- | ----------------------------------------------------- |
| `error.code`            | yes             | Machine-readable code (e.g. `itemNotFound`)           |
| `error.message`         | yes             | Human-readable summary                                |
| `error.innerError`      | usually         | Nested detail — **carries `request-id` for support**  |
| `innerError.request-id` | usually         | **Capture this** — Microsoft needs it to trace a call |

> Detect errors by the presence of a top-level `error` key, not by status code alone.

### Recovery Playbook

| HTTP | `error.code`                               | Meaning                         | Retryable? | Recovery Action                           | Max Retries |
| ---- | ------------------------------------------ | ------------------------------- | ---------- | ----------------------------------------- | ----------- |
| 400  | `invalidRequest`                           | Malformed request/params        | No         | Fix request (e.g. bad `$filter`)          | 0           |
| 401  | `InvalidAuthenticationToken`               | Token missing/expired/invalid   | Yes        | Refresh token, retry once                 | 1           |
| 403  | `accessDenied`                             | Insufficient scope / no license | No         | Re-consent / explain read-only boundary   | 0           |
| 404  | `itemNotFound`                             | Drive/item does not exist       | No         | Verify the item/folder id                 | 0           |
| 409  | `nameAlreadyExists`                        | Conflict with current state     | Maybe      | N/A for reads (would be a write)          | 1           |
| 410  | `resyncRequired`                           | delta token stale/gone          | Yes        | Discard token, restart delta from scratch | 1           |
| 423  | `notAllowed` (locked)                      | Resource locked                 | Maybe      | Retry later                               | 1           |
| 429  | `TooManyRequests` / `activityLimitReached` | Throttled                       | Yes        | Honor `Retry-After`                       | 3           |
| 500  | `generalException`                         | Server error                    | Yes        | Exponential backoff                       | 3           |
| 503  | `serviceNotAvailable`                      | Temporary unavailability        | Yes        | Honor `Retry-After`, else backoff         | 3           |
| 507  | `quotaLimitReached`                        | Storage quota exhausted         | No         | N/A for reads                             | 0           |

### Rate Limits & Throttling

| Item                 | Value                                                                  | Confidence   |
| -------------------- | ---------------------------------------------------------------------- | ------------ |
| Status code          | `429` (and some `503`)                                                 | [DOCUMENTED] |
| Published thresholds | **None** — per app+tenant, variable; writes throttled before reads     | [DOCUMENTED] |
| Backend coupling     | OneDrive rides the SharePoint throttle bus (extra per-resource limits) | [DOCUMENTED] |
| `Retry-After` header | Present on 429 and most 503 — **seconds to wait**                      | [DOCUMENTED] |

**429 response body:**

```json
{
  "error": {
    "code": "TooManyRequests",
    "message": "Please retry again later.",
    "innerError": { "code": "429", "date": "2026-05-29T12:51:51", "request-id": "94fb...3aa2", "status": "429" }
  }
}
```

**Backoff strategy (matches the shipped provider):**

1. On `429`/`503`, **honor `Retry-After`** — sleep that many seconds before retrying. [CONFIRMED]
2. If `Retry-After` is absent, use exponential backoff (start ~1–2s, double, cap ~60s, add jitter).
3. The provider retries up to **3 times** (`_make_request_with_retry`). [CONFIRMED]
4. Throttling is per app+tenant — **serialise** bursty workloads rather than fanning out parallel calls.

---

## File Handling (download specifics)

| Item              | Value                                                                                         | Confidence   |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------ |
| Download endpoint | `GET /me/drive/items/{id}/content` → `302 Found` → preauth URL                                | [CONFIRMED]  |
| Redirect host     | `*.1drv.com` (personal) or SharePoint host (business)                                         | [CONFIRMED]  |
| **Token safety**  | Follow `Location` **WITHOUT** `Authorization` — never leak the bearer token                   | [CONFIRMED]  |
| Range support     | `Range: bytes=0-1023` on the **download URL** → `206 Partial Content`                         | [DOCUMENTED] |
| Max size (Numa)   | **100 MB** (`MAX_DOWNLOAD_SIZE`); checked via `Content-Length` on redirect AND final response | [CONFIRMED]  |
| Oversize error    | `FILE_TOO_LARGE` raised before the body is read                                               | [CONFIRMED]  |

> The provider uses `follow_redirects=False`, reads `Location`, then re-requests it with only a
> `User-Agent` header (no auth). This is the canonical, secure download flow — replicate it.

---

## Idempotency & Consistency

- All connector operations are `GET` → naturally idempotent; safe to retry. [CONFIRMED]
- Use `if-none-match: {eTag}` → `304 Not Modified` to cheaply check whether an item changed. [DOCUMENTED]
- delta shows **latest state per item**, not each change — the same item may recur; take the **last**
  occurrence and key on `id`. [DOCUMENTED]

---

## Counter-Exceptions

1. **Errors are under `error`, success bodies under `value` / the item object** — detect failure by
   the presence of `error`, not by shape.
2. **`Retry-After` is in seconds, not milliseconds** — sleep that many _seconds_.
3. **A `302` on download is success, not an error** — it's the expected handoff to the preauth URL.
4. **`410 resyncRequired` ≠ a transient error** — it means "your delta token is dead, start over."

---

## Output Formatting Guide

| Data Type      | Format                | Example                                                        |
| -------------- | --------------------- | -------------------------------------------------------------- |
| Folder listing | Markdown table        | name · type (file/folder) · size · modified                    |
| Single file    | Key-value summary     | "Budget.xlsx — 82 KB — modified 28 May 2026"                   |
| Search results | Markdown table + note | rows + "showing first 50; refine the query to narrow"          |
| Download       | Confirm + summary     | "Downloaded Budget.xlsx (82 KB)" then analyze content          |
| Errors         | Clear message         | "Couldn't find that item — it may have been moved or deleted." |

- Lists: show first ~20–50 rows; there is **no total count**, so say "and more" when paging continues.
- Always branch on the `folder`/`file` facet when rendering — never assume a type field.
- On `403`, tell the user OneDrive is connected **read-only**; don't imply a fix is possible in-session.

---

_Generated from the investigation questionnaire, Phases 7–8._
