# admin-connector-access (FEAT-129)

Admin-only Connector Access Review API. Lists every connector authorization in
the tenant — **native** (Secrets Manager vault) and **Pipedream** (managed auth)
— and revokes one or many authorizations.

## Routes

| Verb | Path                                     | Purpose                                         |
| ---- | ---------------------------------------- | ----------------------------------------------- |
| GET  | `/settings/connector-access`             | List all connector authorizations (native + pd) |
| POST | `/settings/connector-access/revoke`      | Revoke one authorization (native or pipedream)  |
| POST | `/settings/connector-access/revoke-bulk` | Revoke many authorizations in one request       |

Both require the caller to be in the Cognito `admin` group (checked from the JWT
`cognito:groups` claim).

## Data sources

**Native** connectors live in the per-user consolidated Secrets Manager vault
(`{CLIENT_NAME}/vault/users/{user_sub}`). We enumerate Cognito users, read each
vault, and project `oauth-{provider}` / `connector-{provider}` entries into rows
(user, connector, method, scopes, connected_at, status). Revoke clears the
credential fields in place — the same mutation
`lambdas/python/oauth-files-api/vault_integration.py::revoke_oauth_token`
performs — and is idempotent.

**Pipedream** connectors live in Pipedream (managed auth — we never see the OAuth
tokens). The GET fans out per `external_user_id` (`{clientName}_{userSub}`) to the
relay's `get_integration_status` op (relay → cross-account proxy → Pipedream
`/connect/{project}/accounts`), one row per `apn_xxx` account. A single user's
relay failure is isolated (`pipedreamErrors` count surfaced to the FE) so a dead
user never blanks the list. `scopes` is `null` for these rows (the Connect API
lists accounts with `include_credentials=false`). Revoke routes through the
relay's `disconnect_integration` op against the specific `account_id`.

### Bulk revoke

`revoke-bulk` takes `rows[]` of `{ source, userSub, secretKey | accountId,
connector }`. Native rows are grouped by user so each vault secret is read +
written once (one batched mutation per user); Pipedream disconnects fan out
concurrently. Returns `{ revoked[], failed[] }` per row.

### last_used_at

Each row's `lastUsedAt` is hydrated best-effort from the connector-usage table
(`CONNECTOR_USAGE_TABLE`, PK=`USER#{sub}`, SK=`CONN#{provider}#{connector}`,
attr `lastUsedAt` ISO8601), written by `workspace-chat-tools` when a connector is
used in chat. A missing row / unset env var / DynamoDB error leaves the field
`null` — never throws.

`_name=CONNECTOR_ACCESS_REVOKED` is emitted on every revoke for audit filtering;
`_name=CONNECTOR_ACCESS_LISTED` on every list.

## Env

- `CLIENT_NAME` — vault prefix + external-user-id prefix.
- `USER_POOL_ID` — Cognito user pool to enumerate.
- `PIPEDREAM_RELAY_LAMBDA_ARN` — relay to list/disconnect Pipedream accounts.
  Optional: absent ⇒ pipedream surface is skipped.
- `CONNECTOR_USAGE_TABLE` — connector-usage table for `lastUsedAt` hydration.
  Optional: absent ⇒ `lastUsedAt` stays null.
