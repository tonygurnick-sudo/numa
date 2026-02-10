**Before performing Apollo.io operations**, establish context:
1. Use `search-contacts`, `search-accounts`, or `search-sequences` with empty search param to list existing data
2. Resolve dynamic props via `configure_props` for stages, owners, email accounts, etc.
3. For `accountStageId`, use proxy API workaround (`configure_props` returns 500 error)

When working with Apollo.io, keep these tips in mind:

- **Auth key is `apolloIo`:** Use camelCase in props:
  ```json
  {"apolloIo": {"authProvisionId": "auto"}, "email": "..."}
  ```

- **`accountStageId` `configure_props` fails:** Use proxy API to get account stages directly:
  ```
  proxy_request(method="GET", upstream_url="https://api.apollo.io/v1/account_stages", integration_slug="apollo_io")
  ```

- **People enrichment `revealPhoneNumber` requires webhook:** When using `revealPhoneNumber: true`, you must also provide `webhook_url` (not in schema). Error: `"Please add a valid 'webhook_url' parameter when using 'reveal_phone_number'"`. For basic enrichment, omit `revealPhoneNumber` entirely.

- **Deleting records via proxy API:** No built-in delete actions exist. Use proxy API:
  - Contacts: `DELETE https://api.apollo.io/api/v1/contacts/{id}`
  - Accounts: `POST https://api.apollo.io/api/v1/accounts/bulk_destroy` with `{"ids": ["..."]}`
  - Opportunities: `POST https://api.apollo.io/api/v1/opportunities/bulk_destroy` with `{"ids": ["..."]}`
  - Note: Direct DELETE to `/accounts/{id}` and `/opportunities/{id}` fails — must use `bulk_destroy` POST endpoints.

- **Date format for opportunities:** Use ISO format `"2026-03-31"` for `closedDate` parameter.

- **Create vs upsert contact:** `create-contact` always creates new (may error if email exists). `create-update-contact` upserts by email — updates if exists, creates if not.

- **Add contacts to sequence requires three params:** `sequenceId`, `contactIds` (array), and `emailAccountId` — all are required despite schema not marking them all as such.

- **Stage updates accept arrays:** Both `update-contact-stage` and `update-account-stage` can batch update multiple records:
  ```json
  {"apolloIo": {"authProvisionId": "auto"}, "contactIds": ["id1", "id2"], "contactStageId": "stage_id"}
  ```
