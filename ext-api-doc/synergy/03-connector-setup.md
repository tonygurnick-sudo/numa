# Connecting to the 12d Synergy API

> Step-by-step setup for obtaining credentials and getting the first successful API call against a 12d Synergy instance. Pure 12d-side reference — no Numa-specific wiring.

12d Synergy is **per-instance** — each customer hosts (or has 12d host) their own Synergy server. URLs are scoped to the instance hostname; there is no central API.

---

## 1. Product context

|                       |                                                                      |
| --------------------- | -------------------------------------------------------------------- |
| Vendor                | 12d Solutions Pty Ltd (Australia)                                    |
| Product               | 12d Synergy — construction / civil-engineering project collaboration |
| Website               | https://www.12dsynergy.com                                           |
| Help portal           | https://help.12dsynergy.com                                          |
| Public demo instance  | `https://synergy.12dsynergycloud.com`                                |
| Per-customer instance | `https://{customer-instance-hostname}` (set during deployment)       |

---

## 2. Prerequisites

- A live 12d Synergy instance reachable on HTTPS.
- The instance must have the system setting **"Creation and Authentication of Personal Access Tokens"** enabled by a Synergy administrator (System Settings). PATs do not work until this is on.
- A user account on the instance with API-level permissions for the data they want to access. PATs inherit that user's role and permissions.

---

## 3. Authentication — Personal Access Token (PAT)

12d Synergy uses **PAT bearer auth only**. There is **no OAuth flow**, no refresh-token mechanism, and no API-key issuance outside the PAT flow.

### 3.1 Generating a PAT (in the Synergy UI)

Path (verified against 12d help docs for v5 web/mobile and v6 desktop client):

1. Sign in to the Synergy instance.
2. Open **My Profile → Personal Access Tokens** (the path is _not_ "User Settings → API Access" as earlier docs claimed — verified against [help.12dsynergy.com/docs/v5profile](https://help.12dsynergy.com/docs/v5profile) and [help.12dsynergy.com/docs/synergyclientgenerateapersonalaccesstokenpatinsynergyclientdoc](https://help.12dsynergy.com/docs/synergyclientgenerateapersonalaccesstokenpatinsynergyclientdoc)).
3. Click **Generate** (or **New**).
4. Fill in:
   - **Client ID** (free-text identifier, e.g. `numa-integration`)
   - **Name / description**
   - **Expire in days** (max **180**)
5. Save. Synergy displays the PAT once — capture it immediately.

### 3.2 PAT lifecycle

|                | Value                                                                            |
| -------------- | -------------------------------------------------------------------------------- |
| Max lifetime   | 180 days from creation                                                           |
| Refresh flow   | None — a new PAT must be generated before the current one expires                |
| Expiry warning | User receives an email **1 week before expiry**, and another at expiry           |
| Revocation     | Via `POST /api/v1/auth/delete-pat` (requires body) or via the same My Profile UI |

[VERIFIED — help.12dsynergy.com `v5profile` doc]

### 3.3 Programmatic PAT management (requires an existing PAT)

```http
# List your PATs
GET https://{instance}/api/v1/auth/getPersonalAccessTokens
Authorization: Bearer {EXISTING_PAT}

# Revoke a PAT
POST https://{instance}/api/v1/auth/delete-pat
Authorization: Bearer {EXISTING_PAT}
Content-Type: application/json
# Body shape unverified — confirm against {instance}/swagger before relying on field names
```

> ⚠️ **Corrected 2026-05-19:** prior versions of these docs listed `GET /api/v1/auth/tokens` and `DELETE /api/v1/auth/tokens/{id}`. **Both return 404** on the live demo. The real endpoints are `/auth/getPersonalAccessTokens` (GET, returns 401 unauth = exists) and `/auth/delete-pat` (POST, returns 411 = exists, wants body). Verified by live probe against `synergy.12dsynergycloud.com`.

The first PAT must always be created interactively in the UI — there is no bootstrapping endpoint.

---

## 4. Base URL & required headers

```
Base URL:       https://{instance}/api/v1/
Authorization:  Bearer {PAT}
Content-Type:   application/json     ← POST/PUT only
Accept:         application/json
```

> ⚠️ **Path-versioning quirks.** Almost all endpoints sit under `/api/v1/`, **but two paths skip it:**
>
> - `GET /health` — no version prefix. Returns `{"status":"Healthy"}`. [VERIFIED 2026-05-19 against synergy.12dsynergycloud.com]
> - `POST /api/Tasks` — task create/update uses `/api/Tasks` (no `/v1/`). [Reported in the spec dump in `02-api-spec-investigation.md`; not independently verifiable from public docs]

---

## 5. First successful call — smoke test

After obtaining a PAT and the instance hostname:

```http
# Step 1 — server reachable + healthy (no auth needed)
GET https://{instance}/health
→ 200 {"status":"Healthy"}

# Step 2 — PAT valid
GET https://{instance}/api/v1/auth/getPersonalAccessTokens
Authorization: Bearer {PAT}
→ 200 with a list of PATs for the authenticated user
→ 401 if PAT invalid/expired
→ 403 if PAT user lacks API permissions
```

> ⚠️ Do **not** use `/health` as an auth check — it doesn't require auth, so a 200 there proves nothing about token validity.

---

## 6. Swagger / API reference

|              | URL                                  | Verified                                                                                                               |
| ------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Swagger UI   | `https://{instance}/swagger`         | ✅ 200 on the public demo (2026-05-19)                                                                                 |
| Swagger JSON | `https://{instance}/api-docs/api/v1` | Only reachable from inside an authenticated browser session on most instances; **404 from outside** on the public demo |

Earlier drafts of these docs listed `/api-docs/ui/index` as the UI path — that returns 404 on the live demo. The real path is `/swagger`.

The spec dump in `02-api-spec-investigation.md` reports **359 paths / 369 operations**. The "369 endpoints / 274 models" headline you may see in older drafts conflated _operations_ with _endpoints_ and the model count is not independently verifiable — treat counts as `[INFERRED]`.

---

## 7. Rate limits & errors

|                      | Value                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limit           | **Not publicly documented** — 12d Synergy has not published RPS or daily limits. Most instances are private and lightly trafficked, so customer-perceived limits vary. |
| Error response shape | The spec dump reports many endpoints return errors as **plain text strings**, not JSON envelopes. Treat error bodies as opaque text and key off the HTTP status.       |
| Rate-limit response  | Status code if/when enforced is `[UNKNOWN]`                                                                                                                            |

---

## 8. Known integration constraints

1. **Per-instance.** Every customer's URL is different — the instance hostname is part of every API call, every Swagger URL, every PAT generated. You cannot bootstrap a connector without the instance URL.
2. **PAT is the only auth.** No OAuth, no API-key issuance, no service accounts. The first PAT must be generated by a human in the UI.
3. **No refresh.** PATs expire at most 180 days from creation; the user must generate a replacement before expiry.
4. **Composite IDs and mixed casing.** Path parameters mix Pascal- and snake-case across endpoints. The Swagger spec is authoritative — don't infer paths from naming conventions.
5. **No webhooks.** The spec dump confirms zero webhook/event endpoints. Polling is the only change-detection option.
6. **Path quirks.** `/health` and `/api/Tasks` skip the `/api/v1/` prefix; everything else uses it.

---

## 9. Quick-reference URLs

| Resource                        | URL                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Vendor site                     | https://www.12dsynergy.com                                                                      |
| Help portal                     | https://help.12dsynergy.com                                                                     |
| PAT generation doc (v5)         | https://help.12dsynergy.com/docs/v5profile                                                      |
| PAT generation doc (v6 desktop) | https://help.12dsynergy.com/docs/synergyclientgenerateapersonalaccesstokenpatinsynergyclientdoc |
| Public demo Swagger UI          | https://synergy.12dsynergycloud.com/swagger                                                     |
| Public demo health endpoint     | https://synergy.12dsynergycloud.com/health                                                      |
| API examples zip                | https://www.12dsynergy.com/downloads/5.1/api/SynergyWebAPI_Examples.zip                         |
