---
api_name: GoHighLevel
api_slug: gohighlevel
base_url: https://services.leadconnectorhq.com
auth_type: token — user vault holds a Private Integration Token (pit-…), sent as Bearer every request. No OAuth, no refresh.
path_version_segment: none (version is the Version header, never a path)
required_header: Version (non-secret; agent sets per call; 2021-07-28 default, 2023-02-21 contacts)
call_surface: HTTP via `numa integrations request`. NOT a file-store connector.
confidence: GoHighLevel facts docs-derived (2026-05-04), connector path NOT live-validated.
companions: 02=api-spec, 03=connector-setup
---

# GoHighLevel — Connection & Reauthorization

Auth type **token**: the user's vault holds a Private Integration Token (`pit-…`), sent as `Authorization: Bearer` on every request. No OAuth handshake, no token exchange, no expiry, no refresh — the PIT works until rotated/revoked or the Private Integration is deleted. Every request also needs the non-secret **Version header**, set by the agent per call (03 §2).

```
Authorization: Bearer pit-…          ← injected by the Numa backend
Version: 2021-07-28                  ← set by the agent per request (2023-02-21 on contacts)
Content-Type: application/json       ← POST/PUT with body
```

Two scoping facts shape everything:

- **Scopes are baked into the PIT at creation** (checkbox list in the Private Integrations screen). A token can never call outside its scopes → 403.
- **PITs are issued per sub-account (location).** A token sees one location's data — multi-location agencies need the PIT created in the location Numa should access.

## 1. Create the PIT (HighLevel side)

1. Log into HighLevel and switch into the **sub-account (location)** Numa should access.
2. Settings → Private Integrations.
3. Create New Integration, name it (e.g. `Numa`).
4. **Select scopes** — determines everything the token can ever do. Recommended baseline for Numa: View Contacts, View Conversations, View Conversation Messages, View Opportunities, View Calendars, View Calendar Events, View Payment Orders, View Payment Transactions, View Custom Fields, View Locations, View Forms. Edit scopes only if writes are agreed.
5. Copy the generated token (begins `pit-`).
6. Hand the PIT to the user(s) through a secure channel — they paste it into Numa's chat credential card (§2).

**Token strategy:** a single shared "Numa" PIT is the simple default — all users paste the same token and share its access. Per-user PITs (one integration each) isolate rotation blast-radius at admin-overhead cost. PIT access is defined by its scopes, not the pasting user's HighLevel role — a broad token gives every Numa user that breadth.

## 2. Per-user connection — inline chat credential card

No admin step for user credentials — the wizard stores metadata only. Each user connects lazily, in chat:

1. The user asks the agent something that needs GoHighLevel (e.g. "what's in my pipeline this week?").
2. The backend finds no `connector-gohighlevel` secret in that user's personal vault and returns a structured `needs_credential` error built from the `credential_fields` snapshot on `connector-config-gohighlevel`.
3. The agent surfaces this as an **inline credential card** asking for one field: **Personal Access Token** — the PIT (`pit-…`), with hint text pointing at HighLevel → Settings → Private Integrations.
4. On submit, the token is stored as `connector-gohighlevel` in the **user's personal vault** (field `api_key`). The agent retries and the request succeeds.

The agent never sees the token: the backend (`handle_connect_request` in `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) reads it via `_user_connector_token` and injects `Authorization: Bearer pit-…` on every call. Agents never set that header — but MUST set Version on each request.

## 3. Credential lifetime / rotation

| Property              | Value                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expiry / refresh      | **None** — PITs are long-lived static tokens; no refresh                                                                                                                                           |
| Rotation              | manual, in HighLevel → Settings → Private Integrations — the old token stops working                                                                                                               |
| Revocation / deletion | same screen; deleting the integration kills the token immediately                                                                                                                                  |
| Scope changes         | edit the integration's scopes in the same screen (or recreate). Whether a scope edit rotates the token value is [UNVERIFIED] — if users start getting 401 after a scope change, re-enter the token |

**Token rotated or integration revoked/deleted:** stored `connector-gohighlevel` secrets go stale → **401**. Recovery is the same card as first connect: the next request fails auth, the agent re-prompts with the credential card, the user pastes the current PIT (overwriting their vault secret). No Numa-admin involvement. If multiple users shared the rotated token, **each** re-enters it on next use.

**Scope added:** if the token value is unchanged, newly allowed endpoints start working immediately (scopes evaluated server-side per request). If HighLevel issues a new token on edit, treat it as a rotation.

## 4. Failure diagnosis — 401 vs 403 is the GoHighLevel signature

- **401 Unauthorized** — bad credentials: wrong/rotated/revoked PIT (or the integration was deleted). Re-prompt via the credential card. ⚠️ A missing/invalid Version header may also surface as a 4xx [UNVERIFIED] — confirm the request included it first.
- **403 Forbidden** — the token is **valid**; the PIT **lacks the scope** for that endpoint (chosen at creation). Fixed in HighLevel (Settings → Private Integrations) by editing/recreating with the right scopes. **Never re-prompt for credentials on a 403**, and never retry — not transient.
- **404** — wrong path or id (also check the resource exists in _this_ PIT's location).
- **400/422** — validation (bad fields, country values, non-E.164 phones). Not auth.
- **429** — rate limited; budget unpublished. Back off 1s → 5s → 30s → 2m with jitter.
- **5xx** — server error; retry once with backoff, then surface.
  Raw error **bodies** are undocumented — diagnose from the status code first; body text is supporting evidence.

### Reauthorization triggers

| Trigger                           | Detection                              | Action                                                               |
| --------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| PIT rotated / integration deleted | 401 on every call for affected users   | each user re-enters the PIT via the inline chat card                 |
| Scope missing                     | 403 on specific endpoints only         | edit scopes in HighLevel → Private Integrations — **not** a Numa fix |
| Missing Version header            | 4xx despite a known-good token         | agent adds Version to the request — not a credential issue           |
| Rate limited                      | 429                                    | backoff with jitter; keep page-walks spaced                          |
| Wrong location                    | 404 / empty results despite valid auth | confirm the PIT belongs to the intended sub-account                  |

## 5. Disconnect semantics

| Action                | What is deleted                                | Effect                                                                                                                                                             |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **User disconnects**  | `connector-gohighlevel` (their personal vault) | only that user loses access; re-prompted via the card on next use. The PIT itself stays valid — delete/rotate the Private Integration in HighLevel to truly revoke |
| **Admin disconnects** | `connector-config-gohighlevel` (company vault) | connector unconfigured for everyone — no base URL, no credential-card schema; user secrets remain but are inert until an admin re-adds the connector               |

## Numa connector wiring

**Company secret `connector-config-gohighlevel`** (admin wizard; metadata only):
| Key | Type | Description |
| --- | --- | --- |
| `base_url` | Config | `https://services.leadconnectorhq.com` (from the registry) |
| `connector_type` | Config | `token` |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card |
**User secret `connector-gohighlevel`** (chat credential card, per user):
| Key | Type | Description |
| --- | --- | --- |
| `api_key` | Secret | the Private Integration Token (`pit-…`) |

### Test connection sequence

```
1. GET https://services.leadconnectorhq.com/locations/search?limit=1   (Version: 2021-07-28)
   200 { locations: [...] } — note the locationId for later calls
   401: PIT invalid/rotated/revoked → re-enter via chat card
   403: PIT valid but lacks the Locations scope → fix scopes in HighLevel
2. GET /contacts/search?locationId={locationId}&limit=1                (Version: 2023-02-21)
   200 — proves the Contacts view scope; 403 → add the scope in HighLevel
```

### Auto-reconnect logic

```
on 401: # nothing to refresh — the static PIT is bad (rotated/revoked/deleted)
  first rule out a missing Version header on the request itself
  emit needs_credential → inline chat card re-prompts the user for the PIT
on 403: do NOT re-prompt — the token works; the PIT lacks that endpoint's scope.
  user edits the integration's scopes in HighLevel (Settings → Private Integrations).
on 429: backoff with jitter (1s → 5s → 30s → 2m); budget unpublished — never busy-retry.
```

## Events & future surfaces

- **Webhooks: not available on this connector.** HighLevel webhooks (50+ event types, Ed25519 signatures) are exclusive to OAuth marketplace apps — a PIT cannot register them. Event needs are met by **polling** the search endpoints; building an OAuth marketplace app is a product decision, not connector configuration.
- **Official MCP server** (`https://services.leadconnectorhq.com/mcp/`) authenticates with the **same PIT** — a natural future second surface via Numa's `mcp_call`, no extra credential capture. Out of scope for v1.
