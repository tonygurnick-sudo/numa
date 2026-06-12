# numa-admin-cli

Admin/ops CLI for the Numa platform. Originally `numa-cli/` — renamed in May 2026 when a separate user-facing tool-execution CLI (`/numa-cli`) was scoped, to make the audience split explicit.

**Audience:** Numa devs / operators.
**Binary:** `numa-admin`
**Stack:** TypeScript, `commander`, AWS SDK v3, `cognito-srp-helper`.

## Commands (existing)

- `numa-admin init` — first-time setup
- `numa-admin env list / use <name>` — multi-environment config
- `numa-admin login / logout / whoami / set-password`
- `numa-admin users ls / promote / demote / delete / admin`
- `numa-admin create shared doc <file>` — shareable Q&A link
- `numa-admin roles` — role management

## Relationship to `/numa-cli`

|                | `numa-admin-cli` (this)                | `numa-cli` (planned)                                |
| -------------- | -------------------------------------- | --------------------------------------------------- |
| Audience       | Numa devs / operators                  | End users + Numa-the-LLM running scripts            |
| Surface        | User mgmt, env, roles, doc sharing     | Tool execution: integrations, KB, ops, agents, HITL |
| Binary         | `numa-admin`                           | `numa`                                              |
| Lambda backend | Hits existing admin endpoints directly | Goes through the new `numa-cli-api` Lambda          |

The two share Cognito auth (both use `cognito-srp-helper` against the same user pool) but otherwise have no code in common. They can coexist on the same machine without conflict.

## Build / dev

```
yarn install
yarn build      # tsc compile to dist/
yarn dev        # tsc --watch
yarn typecheck
```
