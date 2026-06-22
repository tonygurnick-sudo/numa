# LinkedIn Integration Tips

All LinkedIn calls go through the `numa integrations` CLI. Action keys follow
`linkedin-<name>` (`numa integrations pipedream-actions linkedin` lists them).
Auth prop: `"linkedin": {"authProvisionId": "auto"}`.

## Scope reality — Marketing API token

The connection is scoped to LinkedIn's **Marketing API**. Practically:

- **Profile reads and post creation work** on a normal personal account.
- **Org / ad-account features need admin rights** on a LinkedIn Page or ad account. With none, those actions return **empty results (`[]` / null), not errors** — don't mistake that for a connectivity/auth problem (`list-organization-id-options`, `list-ad-account-id-options`, `get-org-member-access`, `search-organization` all return empty on a no-admin account).
- **No feed / connections / post-search / notifications** — the Marketing API doesn't expose them, and there are no actions for them.
- `search-organization` is **not a public directory** — it only returns orgs the connected account has a Marketing relationship with (a random company vanity name returns `[]`).

## Profile

- **`get-current-member-profile`** → `id`, `firstName`, `lastName`, `localizedHeadline`, `vanityName`, `profilePicture` (URN). **Save the `id`** — it's your member id, and you build the **actor URN** from it as `urn:li:person:{id}` (no action returns the actor URN pre-formed; comment/like actions need it).
- **`get-profile-picture-fields`** → sized CDN variants (100→800px). `identifierExpiresInSeconds` is a **Unix epoch timestamp** (when the URL expires), not a TTL. Leave `includeOriginalImage` false (needs a permission most accounts lack).
- `get-member-profile` / `get-multiple-member-profiles` take an opaque `personId` (the `xIHf…`-style id, not a vanity name) — there's no action to resolve a vanity name to an id.

## Posting

- **`create-text-post-user`** — `visibility` (required: `PUBLIC` / `CONNECTIONS` / `LOGGED_IN`), `text` (required), optional `article` URL. The actor is resolved from the authenticated account — you don't pass it here.
- **`create-image-post-user`** — `file` (required, a `/workdir/…` path or URL; auto-converted to a presigned URL), `text`, `visibility`. (Per the shared upload rule, the file must be under `/workdir/outputs/` or `/workdir/uploads/`, not `/workdir/tmp/`.)
- `create-text-post-organization` / `create-image-post-organization` need `organizationId` (resolve via `pipedream-props-options`) and admin rights.

## Comment / like / delete — actor URN required

- **`create-comment`** — `urnToComment` (the share/ugcPost URN), `actor` (`urn:li:person:{id}` or `urn:li:organization:{id}`), `message`.
- **`create-like-on-share`** — needs **three** distinct URNs: `parentUrn` (top-level share), `actor`, and `object` (the sub-entity to like). Read the share's structure before calling.
- **`delete-post`** — `postId` must be a **full URN** (`urn:li:ugcPost:{id}` or `urn:li:share:{id}`), not a bare numeric id.
- Several retrieval actions (`retrieve-comments-shares`, etc.) carry `destructiveHint: true` in the schema — a conservative Pipedream annotation, not actually destructive, but a cue to double-check intent.

## Broken / duplicate actions

- **`get-member-organization-access-control` is broken** (HTTP 426 — it hardcodes an unpublished `LinkedIn-Version`). It's a duplicate of **`get-org-member-access`** (newer, works) — use that one.
- **`list-campaign-id-options` is broken** (HTTP 400 — LinkedIn moved campaign endpoints to require the ad-account id in the path). Work around it with a direct `request` (see below):
  ```bash
  numa integrations request linkedin GET \
    "https://api.linkedin.com/rest/adAccounts/{adAccountId}/adCampaigns" \
    --headers '{"x-pd-proxy-LinkedIn-Version":"202401"}' -m "List campaigns"
  ```

## Direct API (`numa integrations request linkedin`) — works, with two gotchas

`request` **does** reach LinkedIn (verified). Use it for endpoints no action covers. Two things to know:

1. **The versioned `/rest/` API requires a `LinkedIn-Version` header** (format `YYYYMM`, e.g. `202401`) — without it you get `400 "A version must be present"`; with a stale value, `426 "version not active"`. Pass it with the **`x-pd-proxy-` prefix** so the proxy forwards it: `--headers '{"x-pd-proxy-LinkedIn-Version":"202401"}'`. (Older `/v2/` endpoints don't take a version but are mostly outside the token's scope.)
2. **Scope limits the surface** — most endpoints beyond profile/posts return **403** (the token is Marketing-API-scoped). That's an upstream permission, not a proxy failure.

> If `request` ever returns **"Integration 'linkedin' is not connected or account ID could not be resolved"**, that's the proxy failing to match the connection for the raw-request path (its account resolution differs from `pipedream-call`'s). It isn't universal — `request` resolves fine in normal setups — but if you hit it, fall back to the `pipedream-call` actions, which resolve the account a different way.

## Resolving `organizationId`

```bash
numa integrations pipedream-props-options linkedin linkedin-get-organization-administrators organizationId \
  --configured '{"linkedin":{"authProvisionId":"auto"}}' -m "Resolve org IDs"
```

Returns `[]` for an account with no administered Pages (correct, not an error).
