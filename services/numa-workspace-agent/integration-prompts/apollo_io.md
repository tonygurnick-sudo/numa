**Before performing Apollo.io operations**, establish context:

1. Use `search-contacts`, `search-accounts`, or `search-sequences` with empty search param to list existing data
2. Resolve dynamic props via `numa integrations pipedream-props-options` for stages, owners, email accounts, etc.
3. For `accountStageId`, use the proxy API workaround (`pipedream-props-options` returns 500 error)

When working with Apollo.io, keep these tips in mind:

- **Auth key is `apolloIo`:** Use camelCase in props:

  ```json
  { "apolloIo": { "authProvisionId": "auto" }, "email": "..." }
  ```

- **`accountStageId` options resolution fails:** Use the proxy API to get account stages directly:

  ```bash
  numa integrations request apollo_io GET https://api.apollo.io/v1/account_stages \
    -m "Listing Apollo account stages"
  ```

- **People enrichment `revealPhoneNumber` requires webhook:** When using `revealPhoneNumber: true`, you must also provide `webhook_url` (not in schema). Error: `"Please add a valid 'webhook_url' parameter when using 'reveal_phone_number'"`. For basic enrichment, omit `revealPhoneNumber` entirely.

- **Deleting records via proxy API:** No built-in delete actions exist. Use the proxy API:
  - Contacts: `DELETE https://api.apollo.io/api/v1/contacts/{id}`

    ```bash
    numa integrations request apollo_io DELETE https://api.apollo.io/api/v1/contacts/{id} \
      -m "Deleting Apollo contact"
    ```

  - Accounts: `POST https://api.apollo.io/api/v1/accounts/bulk_destroy` with `{"ids": ["..."]}`

    ```bash
    numa integrations request apollo_io POST https://api.apollo.io/api/v1/accounts/bulk_destroy \
      --body '{"ids": ["..."]}' -m "Bulk-deleting Apollo accounts"
    ```

  - Opportunities: `POST https://api.apollo.io/api/v1/opportunities/bulk_destroy` with `{"ids": ["..."]}`
  - Note: Direct DELETE to `/accounts/{id}` and `/opportunities/{id}` fails — must use `bulk_destroy` POST endpoints.

- **Date format for opportunities:** Use ISO format `"2026-03-31"` for `closedDate` parameter.

- **Create vs upsert contact:** `create-contact` always creates new (may error if email exists). `create-update-contact` upserts by email — updates if exists, creates if not.

  ```bash
  numa integrations pipedream-call apollo_io apollo_io-create-update-contact \
    --props '{"apolloIo":{"authProvisionId":"auto"},"email":"..."}' \
    -m "Upserting Apollo contact"
  ```

- **Add contacts to sequence requires three params:** `sequenceId`, `contactIds` (array), and `emailAccountId` — all are required despite schema not marking them all as such.

- **Stage updates accept arrays:** Both `update-contact-stage` and `update-account-stage` can batch update multiple records:
  ```bash
  numa integrations pipedream-call apollo_io apollo_io-update-contact-stage \
    --props '{"apolloIo":{"authProvisionId":"auto"},"contactIds":["id1","id2"],"contactStageId":"stage_id"}' \
    -m "Batch-updating Apollo contact stages"
  ```
