---
api_name: GitLab
api_slug: gitlab
doc: connection-and-reauth
---

# GitLab — Connection & Reauthorization

## Token type

GitLab has several token types; this connector uses one the user pastes in chat:

| Token                           | Scope of access                | When to use                       |
| ------------------------------- | ------------------------------ | --------------------------------- |
| **Personal Access Token (PAT)** | everything the user can see/do | default — most users              |
| **Project Access Token**        | a single project               | bot/automation scoped to one repo |
| **Group Access Token**          | a group + its projects         | bot scoped to a group             |

All three are sent identically as `Authorization: Bearer <token>`. The token carries the owner's permissions and role.

## Create a Personal Access Token (gitlab.com)

1. GitLab → top-right avatar → **Edit profile** → **Access Tokens** (`https://gitlab.com/-/user_settings/personal_access_tokens`).
2. **Add new token**: name it (e.g. "Numa"), set an **expiry** (GitLab.com enforces a max; pick the longest your policy allows).
3. **Scopes:** select `api` for full read+write, or `read_api` (+ `read_repository`) for read-only.
4. **Create personal access token** and copy the value (`glpat-…`) — it is shown **once**.
5. In Numa chat, when prompted for the GitLab credential, paste the token. It is stored in your personal vault only.

### Project/Group token (alternative)

Project: **Settings → Access Tokens**. Group: **Settings → Access Tokens**. Choose a **role** (Developer+ for writes, Maintainer+ to merge) and the same `api`/`read_api` scopes.

## Self-managed GitLab

- The admin sets the **Instance URL** in the connector wizard to the instance's API root, e.g. `https://gitlab.example.com/api/v4`.
- Users generate the PAT on that instance (same Access Tokens UI), not gitlab.com.
- The instance must be reachable over HTTPS from Numa's backend.

## Token lifecycle / reauth

- **No refresh flow.** PATs are static bearer credentials; there is no OAuth refresh.
- **Expiry:** a PAT past its expiry date returns **401**. GitLab also emails the owner ~7 days before expiry. The user creates a new token and reconnects via the chat credential card.
- **Revocation:** revoking the token in the Access Tokens UI kills it immediately → 401 on the next call.
- **Scope/role change:** if a user hits **403**, they either need a token with `api` (not just `read_api`) or a higher project role — re-create the token / adjust the role, then reconnect.

## Reauth triggers (what the agent should tell the user)

| Symptom                        | Cause                                  | Fix                                                             |
| ------------------------------ | -------------------------------------- | --------------------------------------------------------------- |
| 401 on every call              | token wrong/expired/revoked            | create a new PAT, reconnect                                     |
| 403 on writes only             | `read_api`-only token, or role too low | create token with `api` scope, or get Developer/Maintainer role |
| 404 on a known private project | token user not a member                | grant access, or use a token whose user is a member             |

## Disconnect

- **User disconnect** deletes only the user's PAT secret from their personal vault — the company `connector-config-gitlab` is untouched, and other users stay connected.
- **Admin disconnect** removes `connector-config-gitlab` (the connector config) — this does not delete users' PATs but makes the connector unconfigured.
