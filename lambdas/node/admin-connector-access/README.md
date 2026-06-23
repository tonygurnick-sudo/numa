# admin-connector-access (FEAT-129)

Admin-only Connector Access Review API. Lists every **native** connector
authorization in the tenant and revokes a single authorization.

## Routes

| Verb | Path                                | Purpose                              |
| ---- | ----------------------------------- | ------------------------------------ |
| GET  | `/settings/connector-access`        | List native connector authorizations |
| POST | `/settings/connector-access/revoke` | Revoke one authorization (per row)   |

Both require the caller to be in the Cognito `admin` group (checked from the JWT
`cognito:groups` claim).

## Data source

The source of truth is the per-user consolidated Secrets Manager vault
(`{CLIENT_NAME}/vault/users/{user_sub}`). We enumerate Cognito users, read each
vault, and project `oauth-{provider}` / `connector-{provider}` entries into rows
(user, connector, method, scopes, connected_at, status). Revoke clears the
credential fields in place — the same mutation
`lambdas/python/oauth-files-api/vault_integration.py::revoke_oauth_token`
performs — and is idempotent.

`_name=CONNECTOR_ACCESS_REVOKED` is emitted on every revoke for audit filtering;
`_name=CONNECTOR_ACCESS_LISTED` on every list.

## Deferred (see `documentation/security/connector-access-review.md`)

- **Pipedream authorizations** — listing per `external_user_id` is possible via
  the proxy but returns no scopes, and has no tenant-wide call; revoke would use
  the relay's `disconnect_integration`. The GET reports `pipedreamDeferred: true`.
- Bulk / select-all revoke, CSV export.
- `last_used_at` (no per-connector usage signal in the vault yet).

## Env

- `CLIENT_NAME` — vault prefix.
- `USER_POOL_ID` — Cognito user pool to enumerate.
