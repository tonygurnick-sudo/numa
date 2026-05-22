# Connecting to the Fergus API

> Step-by-step setup for obtaining credentials and getting the first successful API call against Fergus. Pure Fergus-side reference — no Numa-specific wiring.

Fergus is a single-tenant SaaS — there is one shared API hostname for all customers. Each customer authenticates with their own credentials.

---

## 1. Product context

|                    |                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Vendor             | Fergus Pty Ltd (New Zealand)                                                                  |
| Product            | Fergus — job management for trades/services businesses                                        |
| Website            | https://fergus.com                                                                            |
| API base URL       | `https://api.fergus.com` (single shared host)                                                 |
| OpenAPI spec       | `https://api.fergus.com/docs/json` (203 KB JSON; Swagger UI at `https://api.fergus.com/docs`) |
| Dev portal landing | https://info.fergus.com/developers                                                            |
| Help centre        | https://help.fergus.com                                                                       |

---

## 2. Authentication options

Fergus supports two auth schemes against the same API:

### 2.1 Personal Access Token (PAT) — self-service

- Customer-owned long-lived bearer token; format `fergPAT_<UUID-like>`.
- **Generated in the Fergus UI** by a user with appropriate permissions. As of late 2025 the UI flow is not officially documented in the help centre — confirm the current location with Fergus support or directly with `integrations@fergus.com`. Common location: Account/User Settings → API or Integrations.
- **Lifetime:** ~1 year from creation [INFERRED — derived from a single observed token, not in any public Fergus doc]. There is no refresh flow; the user must generate a new PAT before expiry.
- **Authorization header:** `Authorization: Bearer fergPAT_...`
- Same token grants full API access for the company (not per-user scopes).

### 2.2 OAuth 2.0 Authorization Code — partner/integration

- Defined in the OpenAPI spec (`securitySchemes.oauth2`):
  - Authorize URL: `https://auth.fergus.com/oauth2/authorize`
  - Token URL: `https://auth.fergus.com/oauth2/token` (also the refresh URL)
- Scopes: declared but empty `{}` in spec — no granular scope vocabulary published.
- **Not self-service.** To register an OAuth client, contact `integrations@fergus.com` (or Paul De Bazin per the Fergus developer site). Fergus will issue `client_id` / `client_secret` and configure your redirect URI by hand.

For most third-party integrations the PAT path is faster to ship.

---

## 3. Required headers (every authenticated call)

```
Authorization: Bearer {PAT_OR_OAUTH_ACCESS_TOKEN}
Content-Type:  application/json     ← POST/PATCH only
Accept:        application/json
```

---

## 4. First successful call — smoke test

After obtaining a PAT:

```http
GET https://api.fergus.com/version
Authorization: Bearer {PAT}
```

Expected: `200 OK` with body `{"message": "<version-string>"}`.

> ⚠️ **The response shape is `{"message": string}`, NOT `{"result":"success","data":{"version":"v1"}}`.** [VERIFIED 2026-05-19 against the OpenAPI spec `/version` response schema]. Earlier docs in this folder claimed the wrapped envelope — that was wrong.

Follow-up to confirm company access:

```http
GET https://api.fergus.com/company
Authorization: Bearer {PAT}
```

Expected: `200 OK` with body matching the `GetCompanyResponse` schema in the OpenAPI spec.

> ⚠️ The endpoint is **`/company`** (NOT `/my-company` — that path does not exist). [VERIFIED 2026-05-19]

Failure modes:

| Status | Meaning                                                                                                                      | Action                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 401    | PAT invalid / expired / OAuth token expired                                                                                  | Regenerate PAT or refresh OAuth token               |
| 403    | Authenticated, but no API permission                                                                                         | Check user/company API access permissions in Fergus |
| 404    | Wrong path — likely missing `/api/partner/` server prefix (this is the server's internal route; client-facing paths drop it) | Verify endpoint against the OpenAPI spec            |

---

## 5. Rate limits

| Limit         | Value                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| Per company   | **100 requests / minute** — shared across **all** PATs and OAuth tokens for that company |
| Limit headers | `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` on every response      |
| Exceeded      | HTTP `429` + `Retry-After` header (seconds)                                              |

Source: `info.description` field of the OpenAPI spec, verbatim.

There is no per-token quota — multiple integrations against the same company compete for the same 100/min budget. Plan polling cadences accordingly.

---

## 6. Pagination

|                   |                                                                     |
| ----------------- | ------------------------------------------------------------------- |
| Mechanism         | `pageCursor` query param (0-based integer) + `pageSize`             |
| Default page size | 10                                                                  |
| Behaviour         | When more results exist, the response carries a HATEOAS `next` link |

Notes: the `pageCursor` is an integer offset, not an opaque token — it advances by `pageSize` each page.

---

## 7. Critical gotchas (verified)

1. **`/jobs/{id}/finalise` is PUT, not POST.** The HATEOAS link returned in job-create responses claims `"type": "POST"` — that's a server-side bug. The OpenAPI spec defines this path with `put` only, and the `Jayco-Design/fergus-mcp` SDK uses `client.put('/jobs/${jobId}/finalise')`. POST returns 404. [VERIFIED 2026-05-19]
2. **Calendar events use POST for updates, not PUT.** `POST /calendarEvents/{id}` updates an existing event.
3. **`/quotes` and `/stockOnHand` standalone endpoints don't exist.** Use `/jobs/quotes` and `/phases/{id}/stockOnHand`. (The 404 error message helpfully reveals the internal `/api/partner/` prefix in the route name.)
4. **303 on duplicates.** `POST /customers` and `POST /sites` return HTTP 303 with a `location` header pointing to the existing resource if one is already in the company.
5. **Notes sort field uses snake_case.** `?sortField=created_at`, not `createdAt`. Only known endpoint with this exception.
6. **No webhooks.** Polling is the only change-detection mechanism — budget against the 100 req/min limit.

---

## 8. Quick-reference URLs

| Resource            | URL                                                       |
| ------------------- | --------------------------------------------------------- |
| Base URL            | `https://api.fergus.com`                                  |
| OpenAPI JSON        | `https://api.fergus.com/docs/json`                        |
| Swagger UI          | `https://api.fergus.com/docs`                             |
| Help centre         | https://help.fergus.com                                   |
| Developer landing   | https://info.fergus.com/developers                        |
| Integration contact | `integrations@fergus.com` (for OAuth client registration) |
