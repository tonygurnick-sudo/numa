# Connector Access Review (FEAT-129)

Admin security surface that answers: **"Which of my users has authorised which
connector, with what access, and let me revoke it."**

Status: **MVP**. Native connectors only. Pipedream-backed connections,
bulk-revoke, CSV export, and `last_used_at` are deferred (see below).

Flag: `CONNECTOR_ACCESS_REVIEW` (off by default, per client).

---

## Where it lives

| Layer   | Location                                                                           |
| ------- | ---------------------------------------------------------------------------------- |
| UI      | Settings → **Users** tab → "Connector Access Review" panel                         |
| Panel   | `numa-frontend/src/Components/UserManagement/ConnectorAccessPanel.tsx`             |
| Service | `numa-frontend/src/Services/AdminConnectorAccessService.ts`                        |
| API     | `lambdas/node/admin-connector-access/` (GET list, POST revoke)                     |
| Routes  | `GET /api/settings/connector-access`, `POST /api/settings/connector-access/revoke` |
| Infra   | `infra/constructs/app-agnostic-api-gateway-lambda-collection.ts`                   |
| Flag    | `infra/capabilities-metadata.ts` + config.json gen in `numa-client-stack.ts`       |

The panel is gated by `getFlag('CONNECTOR_ACCESS_REVIEW') && isAdmin`. The
Lambda is always deployed (cheap) — the flag only controls UI visibility.

---

## How "list authorizations" works

The source of truth is the **per-user consolidated Secrets Manager vault**:

```
{CLIENT_NAME}/vault/users/{user_sub}
  └─ secrets
       ├─ oauth-{provider}          → OAuth tokens (access/refresh) or a legacy single-token PAT
       ├─ connector-{provider}      → non-OAuth connector (PAT)
       ├─ connector-config-{provider} → admin-registered API key
       └─ oauth-client-{platform}   → COMPANY OAuth client creds (IGNORED — not a user auth)
```

(Shape defined in `lambdas/python/oauth-files-api/vault_integration.py`.)

The GET handler:

1. Enumerates Cognito users (`ListUsers`, paginated) to map `sub → email`.
2. Reads each user's vault (handling the gzip-`_compressed` shape).
3. Projects each `oauth-*` / `connector-*` entry into a row:
   `{ user, connector, method, scopes, connectedAt, lastUsedAt, status }`.
4. Filters out entries whose credential fields are blank (already-revoked).

`scopes` come straight from the stored token's `scope`/`scopes` field, split on
whitespace/commas. `oauth-client-*` (company OAuth client credentials) is never
a user authorization and is skipped.

Reads are **sequential** in the MVP — bounded by (users × connectors) and well
under Secrets Manager rate limits at current tenant sizes. See _Deferred_.

---

## How "revoke" works (native)

Reuses the exact mutation the Python OAuth path performs
(`vault_integration.revoke_oauth_token`): the entry shell is kept but its
credential fields are blanked in place, so the user can cleanly re-authorise.

It is **idempotent** — revoking an already-cleared (or missing) entry returns a
success with a `reason`. Every revoke emits a structured audit log:

```json
{
  "_name": "CONNECTOR_ACCESS_REVOKED",
  "client": "...",
  "admin": "<sub>",
  "targetUserSub": "...",
  "secretKey": "oauth-googledrive",
  "connector": "googledrive",
  "revoked": true
}
```

Filter CloudWatch on `_name = CONNECTOR_ACCESS_REVOKED` for the audit trail.

The row id is `{userSub}::{secretKey}`; the FE derives `userSub` + `secretKey`
from it and POSTs `{ userSub, secretKey, source: "native" }`. A non-`native`
`source` is rejected with 400 until Pipedream revoke lands.

---

## Auth

Both routes are admin-only. The Lambda re-checks the caller's
`cognito:groups` claim contains `admin` (defense-in-depth on top of the API
Gateway authorizer). IAM is scoped to:

- `secretsmanager:GetSecretValue` / `PutSecretValue` on
  `arn:aws:secretsmanager:*:*:secret:{client}/vault/users/*` (this client only).
- `cognito-idp:ListUsers` on this client's user pool.

---

## SPIKE — does Pipedream expose "list connections per external_user_id"?

**Yes for connections, no for scopes, and not tenant-wide.** Findings from
`lambdas/python/pipedream-proxy/pipedream_operations.py` + the relay
(`lambdas/python/pipedream-relay/`) + the `numa-integrations` skill:

- `_get_user_connections(external_user_id)` calls
  `GET /connect/{project}/accounts?external_user_id=...&include_credentials=false`
  and paginates. It returns `id`, `name` (the connected email), `app`,
  `created_at`, `healthy`, `dead` — **but no OAuth scopes**. Scopes only come
  back with `include_credentials=true`, which the proxy deliberately never
  requests (and exposing them would cross the proxy's security boundary).
- There is **no single tenant-wide "list every user's connections" call** — you
  must fan out one request per `external_user_id`. The external id is
  per-user, so a tenant-wide view = enumerate users × one proxy round-trip each.
- Revoke already exists as `disconnect_integration` (proxy
  `_delete_pipedream_account` → `DELETE /connect/{project}/accounts/{id}`,
  idempotent on 204/404), routed via the relay.

So Pipedream **can** populate the list (without scopes) and **can** be revoked,
but it needs a per-user fan-out and a scopes caveat — out of scope for this MVP.

---

## Deferred (recorded)

1. **Pipedream-backed authorizations.** List via per-`external_user_id` fan-out
   (no scopes; mark them as such in the row). Revoke via the relay's existing
   `disconnect_integration` operation. The GET currently returns
   `pipedreamDeferred: true` and the UI shows an honest "not yet covered" note.
2. **Bulk / select-all revoke.** One Secrets Manager write per row today; a
   bulk path should batch per-user vault writes (group rows by `user_sub`,
   clear multiple entries in a single `PutSecretValue`).
3. **Performance.** Sequential vault reads; parallelise with a bounded
   concurrency pool once tenant sizes warrant it.
4. **CSV export** of the authorization list.
5. **`last_used_at`.** The vault records no per-connector usage. Wire a usage
   signal (e.g. from connector file-op / tool-invocation logs) before surfacing
   a real value — it is `null` today.
6. **Playwright E2E** covering the panel render + a revoke round-trip.

---

## Deploy

`needsDeployToVerify = true`. The flag and routes only exist after a stack
deploy. To enable for a client, set `connectorAccessReview: true` in client
config (via the Customer Success Portal `UpdateClientConfig`, or
`clientConfigProd.json` for a local dev stack) and redeploy. After adding the
flag to `capabilities-metadata.ts`, run
`AWS_PROFILE=q-demo npx tsx tools/seed-capabilities-metadata.ts` to sync the
deployer DynamoDB table.
