---
api_name: isolved People Cloud
api_slug: isolved
base_url: https://{tenant}.myisolved.com/rest/api   (PER-TENANT — from the admin's Instance URL)
urls: relative preferred (`/employees`); absolute per-tenant on fallback (see 01)
call_surface: HTTP via `numa integrations request` (connector=isolved)
auth: OAuth2 client-credentials — company-level Bearer minted server-side; re-minted on expiry; NO refresh token; agent never sees it
companions: 01=api-rules, 01a=domain-model, 01b=queries, 01c=mutations
confidence: no webhook evidence → polling-first; 403/404 = allowed-methods/per-client-grant model is corroborated; error-body shapes, rate limits, and change-filter grammar are [VERIFY WITH PARTNER DOCS] / [UNKNOWN]. Not live-validated.
---

# isolved — Event & Error Handling

## Webhooks / events — none evidenced

No webhook or event-subscription mechanism is evidenced for the isolved REST API
**[VERIFY WITH PARTNER DOCS]**. From workspace chat, treat isolved as **polling-first**: there is
nowhere for isolved to push to, and no confirmed event feed.

For "tell me when an employee/deduction/benefit changes", use polling (below) or suggest a Numa
scheduled agent. Do not promise real-time notifications.

## Change detection — polling (grammar unconfirmed)

isolved does not publish a confirmed change-filter grammar. The corroborated filter is
`employment_status=ACTIVE` — there is **no confirmed `updatedSince`/date filter**
**[VERIFY WITH PARTNER DOCS]**.

Procedure:

1. **Check whether any change/updated filter exists** in the user's partner `/rest` docs before
   relying on one. Do **not** assume JobAdder-style `updatedAt=>...` prefixes — that grammar does
   not apply here.
2. If no change filter exists, poll the full (granted) list and **diff client-side** against a
   stored snapshot (e.g. a workspace file holding the last-seen records keyed by employee id).
3. Persist the checkpoint between runs; for recurring needs, recommend a Numa scheduled agent.
4. Keep cadence conservative (rate limits unpublished) and remember pagination is unconfirmed (01b)
   — a "full list" may be a partial page until you've confirmed the paging scheme.

## Auth lifecycle — client-credentials, server-side (no per-user reconnect)

Numa mints the Bearer token from the **company-level** `client_id`/`client_secret`
(`grant_type=client_credentials`) and **re-mints on expiry**. Client-credentials has **no refresh
token** — re-minting is just another token POST with the same company credential.

Consequences for error handling:

- A **401** surfacing to you means the **server-side mint failed** — the company `client_id`/
  `client_secret` is wrong, disabled, or the partner API Application was revoked. **This is an admin
  problem, not a per-user reconnect.** There is **no chat credential card** and **no per-user OAuth
  redirect** for this connector. Tell the user/admin to check the isolved API Application credential
  in the connector's company config (04). Do not retry blindly.
- **403/404** is almost always the **allowed-methods grant** or the **per-client access setup**, not
  auth (see below).

## Error model

**Error-body shape: [UNKNOWN / VERIFY WITH PARTNER DOCS].** Parse defensively: status code first,
then try JSON, fall back to raw text. Quote whatever message the body carries verbatim.

| Status  | Meaning                                                                                                                | Agent action                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 200/2xx | success (response/body shape [VERIFY])                                                                                 | mirror the real envelope; for writes, GET to confirm (01c)                                            |
| 400     | malformed request/params                                                                                               | fix syntax; don't retry unchanged; suspect an unconfirmed param (01b)                                 |
| 401     | token missing/expired/invalid → **the server-side client-credentials mint failed**                                     | admin checks the company `client_id`/`client_secret` (04); NOT a per-user reconnect; don't busy-retry |
| 403     | method **not in the integration's allowed-methods grant**, OR the per-client access grant/Refresh System Data not done | confirm the grant scope + per-client setup (below); do NOT retry-loop                                 |
| 404     | wrong/unconfirmed path, OR an **ungranted** object surfaced as not-found                                               | verify the path against partner docs; suspect the grant before mutating the URL                       |
| 422     | validation error (e.g. a client-specific code that doesn't exist, or an out-of-window enrollment)                      | fix the field/code (resolve codes from live records, 01a/01c); don't retry unchanged                  |
| 429     | rate limited (limits unpublished)                                                                                      | back off 2s → 10s → 30s with jitter; halve pacing for the session                                     |
| 5xx     | isolved-side error                                                                                                     | retry once after 5s; for writes, **search first** — a create may have landed as Pending               |

## 403 / 404 — the signature failures (grant + per-client setup)

isolved's access model produces 403/404 for two distinct, non-auth reasons. Triage in this order:

1. **Per-client access not set up.** For each customer **Client Code**, the isolved admin must:
   - add the partner user under **Security → Partner Users → Client Access** (grant access to that
     Client Code), then
   - run **Production Utilities → Refresh System Data**.
     Until both are done, calls against that Client Code 403/404. **Symptom: _everything_ 403/404s for
     one client** while the same integration works elsewhere → this step is the prime suspect.

2. **Method not in the allowed-methods grant.** isolved whitelists, per integration, which
   methods/objects are callable. **Symptom: some calls work, but a specific object/method 403/404s
   consistently** → the integration wasn't granted that method. Fix = isolved adjusts the grant for
   the integration (a partner/isolved-side change), not a Numa or per-user action.

In both cases: **do not retry-loop and do not suggest "reconnecting"** (there's no per-user
reconnect). Name the object/method you attempted and point at the correct fix.

## 429 / backoff discipline

No public numeric limits or rate-limit headers `[VERIFY WITH PARTNER DOCS]`. Defensive defaults:

1. Sequential calls only; never parallel-fan-out through the connector.
2. ≤ ~2 requests/second sustained.
3. On 429: wait 2s, retry; 10s; 30s; then stop and report. Halve pacing for the session.
4. If a `Retry-After` header appears, honour it [VERIFY whether sent].

## Connector-level vs API-level failures (triage in order)

1. **Tool error, no HTTP status** (connector not found, no connection configured) → the isolved
   connector isn't set up: the admin hasn't entered the company `client_id`/`client_secret` +
   Instance URL, or `DATA_CONNECTORS_ENABLED` is off → point at integration setup (03/04), don't
   debug the API.
2. **"No base URL is configured for connector 'isolved'"** → the per-tenant Instance URL isn't wired
   into the vault yet (a known to-be-built gap for `oauth2` connectors — 03). Retry once with the
   absolute per-tenant URL the admin supplied; flag the setup gap.
3. **401** → the server-side mint failed (company credential) — admin fix (04).
4. **403/404 for ONE client / one object** → grant or per-client setup (above).
5. **403/404 across EVERYTHING right after setup** → per-client access grant + Refresh System Data
   not done (above); or the Instance URL/token path is wrong → escalate, don't hammer retries.
6. **Repeated 5xx across objects** → isolved-side incident; report and stop.

## Session hygiene

- Start an isolved-heavy session with the smallest granted read (e.g. one page of active employees)
  to confirm the token mint + grant before doing real work.
- Resolve client-specific code lists (employment statuses, deduction/benefit codes) from live
  records once and reuse them within the session; re-resolve after a 422 blames a code.
- Keep an in-conversation log of writes (object, id, change) — no confirmed API-side undo; a new
  hire may exist as Pending even after a failed-looking create.
