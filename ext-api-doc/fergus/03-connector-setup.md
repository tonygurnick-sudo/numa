---
api_name: Fergus
api_slug: fergus
base_url: https://api.fergus.com (single shared host; single-tenant SaaS — no per-customer instance URL)
route_prefix_injected_by_connector: /api/partner
path_version_segment: none ("v1" is a label, never a path segment; /v1/... → 404)
auth: Bearer {token} (PAT self-service, or OAuth partner-only)
field_casing: camelCase
id_format: integer
call_surface: HTTP via `numa integrations request` (NOT a file-store connector)
confidence: every fact live-API-confirmed 2026-04-04 unless tagged [INFERRED] or [VERIFIED <date>]
---

# Connecting to the Fergus API

Fergus-side credential setup + first successful call. One shared API host for all customers; each authenticates with its own credentials.

## 1. Product context

|              |                                                                                       |
| ------------ | ------------------------------------------------------------------------------------- |
| Vendor       | Fergus Pty Ltd (New Zealand)                                                          |
| Product      | Fergus — job management for trades/services                                           |
| Website      | https://fergus.com                                                                    |
| API base URL | `https://api.fergus.com` (single shared host)                                         |
| OpenAPI spec | `https://api.fergus.com/docs/json` (203 KB; Swagger UI `https://api.fergus.com/docs`) |
| Dev portal   | https://info.fergus.com/developers                                                    |
| Help centre  | https://help.fergus.com                                                               |

## 2. Authentication options (two schemes, same API)

### 2.1 PAT — self-service

- Customer-owned long-lived bearer token; format `fergPAT_<UUID-like>`.
- Generated in the Fergus UI by a permitted user. UI flow not officially documented as of late 2025 — confirm location with Fergus support / `integrations@fergus.com`. Common location: Account/User Settings → API or Integrations.
- Lifetime: ~1 year from creation [INFERRED — one observed token, not in any public Fergus doc]. No refresh flow; user generates a new PAT before expiry.
- Header: `Authorization: Bearer fergPAT_...`. Grants full API access for the company (not per-user scopes).

### 2.2 OAuth 2.0 Authorization Code — partner/integration

- In spec (`securitySchemes.oauth2`): Authorize `https://auth.fergus.com/oauth2/authorize`; Token (+ refresh) `https://auth.fergus.com/oauth2/token`. Scopes declared but empty `{}` — no granular vocabulary published.
- NOT self-service. Register via `integrations@fergus.com` (or Paul De Bazin per the Fergus developer site) → Fergus issues `client_id`/`client_secret` and configures redirect URI by hand.

PAT is faster to ship for most third-party integrations.

## 3. Required headers (every authenticated call)

```
Authorization: Bearer {PAT_OR_OAUTH_ACCESS_TOKEN}
Content-Type:  application/json     ← POST/PATCH only
Accept:        application/json
```

## 4. First successful call — smoke test

`GET https://api.fergus.com/version` with `Authorization: Bearer {PAT}` → `200 OK` body `{"message":"<version-string>"}`.
Response shape is `{"message":string}`, NOT `{"result":"success","data":{"version":"v1"}}` [VERIFIED 2026-05-19 against the OpenAPI `/version` response schema; earlier docs claiming the wrapped envelope were wrong].
Confirm company access: `GET https://api.fergus.com/company` → `200 OK` matching `GetCompanyResponse`. Endpoint is `/company`, NOT `/my-company` (does not exist) [VERIFIED 2026-05-19].

Failure modes:
| Status | Meaning | Action |
|---|---|---|
| 401 | PAT/OAuth token invalid or expired | regenerate PAT or refresh OAuth token |
| 403 | authenticated, no API permission | check user/company API access permissions in Fergus |
| 404 | wrong path — likely missing the server's internal `/api/partner/` prefix (client-facing paths drop it) | verify endpoint against the OpenAPI spec |

## 5. Rate limits

| Limit       | Value                                                                               |
| ----------- | ----------------------------------------------------------------------------------- |
| Per company | 100 requests / minute — shared across ALL PATs and OAuth tokens for that company    |
| Headers     | `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` on every response |
| Exceeded    | HTTP 429 + `Retry-After` (seconds)                                                  |

Source: `info.description` of the OpenAPI spec, verbatim. No per-token quota — multiple integrations compete for the same 100/min budget. Plan polling cadences accordingly.

## 6. Pagination

`pageCursor` query param (0-based integer offset, advances by `pageSize` each page — not opaque) + `pageSize` (default 10). When more results exist the response carries a HATEOAS `next` link.

## 7. Critical gotchas (verified)

1. `/jobs/{id}/finalise` is PUT, not POST. The job-create HATEOAS link claims `"type":"POST"` — server-side bug. Spec defines `put` only; `Jayco-Design/fergus-mcp` uses `client.put('/jobs/${jobId}/finalise')`. POST → 404. [VERIFIED 2026-05-19]
2. Calendar events use POST for updates, not PUT: `POST /calendarEvents/{id}`.
3. `/quotes` and `/stockOnHand` standalone don't exist. Use `/jobs/quotes` and `/phases/{id}/stockOnHand`. (404 message reveals the internal `/api/partner/` prefix.)
4. 303 on duplicates: `POST /customers` and `POST /sites` return HTTP 303 + `location` header to the existing resource.
5. Notes sort field is snake_case: `?sortField=created_at`, not `createdAt`. Only known exception.
6. No webhooks. Polling is the only change-detection mechanism — budget against 100 req/min.

## 8. Quick-reference URLs

| Resource            | URL                                                   |
| ------------------- | ----------------------------------------------------- |
| Base URL            | `https://api.fergus.com`                              |
| OpenAPI JSON        | `https://api.fergus.com/docs/json`                    |
| Swagger UI          | `https://api.fergus.com/docs`                         |
| Help centre         | https://help.fergus.com                               |
| Developer landing   | https://info.fergus.com/developers                    |
| Integration contact | `integrations@fergus.com` (OAuth client registration) |
