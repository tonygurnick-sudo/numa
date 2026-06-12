# numa-cli (workspace root)

Tool-execution CLI for the Numa platform. Distinct from `numa-admin-cli/` (admin/ops tooling).

**Audience:** Numa-the-LLM (running inside the workspace agent Docker image) and developers (debugging or scripting from a laptop).

**Stack:** TypeScript, `commander`, `cognito-srp-helper`. Two npm packages from one workspace.

## Why two packages

The CLI splits into two npm packages so the workspace image can install only the production surface:

| Package         | Path                | Binary     | Audience               | When installed                        |
| --------------- | ------------------- | ---------- | ---------------------- | ------------------------------------- |
| `@numa/cli`     | `packages/cli/`     | `numa`     | Numa-the-LLM + scripts | Workspace MicroVM + developer laptops |
| `@numa/cli-dev` | `packages/cli-dev/` | `numa-dev` | Developers only        | Developer laptops only                |

`@numa/cli-dev` declares `@numa/cli` as a workspace dependency and imports the prod command factories via `@numa/cli/commands`, then bolts on the dev-only extras (`--d-hum`, per-command `--yes`, `*-test` self-tests, `reference` doc launcher, context manipulation). The dev binary IS the prod binary with extras layered on top.

**Hermetic security model:** when the workspace Docker image runs `npm install @numa/cli` (not `@numa/cli-dev`), the dev code physically isn't present on disk. Numa-the-LLM can't `find` it, can't `node ./numa-dev.js`, can't bypass HITL by reaching for the dev binary. The boundary is enforced at the package layer, not at runtime.

## Layout

```
numa-cli/                                  # workspace root
├── package.json                           # @numa/cli-workspace (private)
├── README.md                              # this file
├── docs/
│   └── numa-cli-reference-internal.html   # human reference (open via `numa-dev reference`)
└── packages/
    ├── cli/                               # @numa/cli — production
    │   ├── package.json                   # bin: { numa }
    │   ├── tsconfig.json
    │   ├── README.md
    │   └── src/
    │       ├── cli/numa.ts                # prod binary entrypoint
    │       ├── commands/                  # bootstrap, prompt, auth/, actions/
    │       ├── api/                       # HTTP clients
    │       ├── auth/                      # SRP, tokens, JWT
    │       ├── context/                   # ~/.config/numa/ state, scope resolver
    │       ├── metadata/                  # tool types + display registry
    │       ├── output/                    # emitResult, prettyOrSpill, modes
    │       └── index.ts                   # barrel — re-exports every subpath
    └── cli-dev/                           # @numa/cli-dev — dev addon
        ├── package.json                   # bin: { numa-dev }, deps @numa/cli
        ├── tsconfig.json
        ├── README.md
        └── src/
            ├── cli/numa-dev.ts            # dev binary entrypoint
            └── commands/dev/              # context, reference, *-test runners
```

## Quick start

```bash
# From the monorepo root or this directory
yarn install                        # discovers both packages via yarn workspaces

# Build both packages (topological order — cli first, then cli-dev)
yarn build

# Symlink both binaries onto your $PATH
ln -sf "$(pwd)/packages/cli/dist/cli/numa.js"           ~/.local/bin/numa
ln -sf "$(pwd)/packages/cli-dev/dist/cli/numa-dev.js"   ~/.local/bin/numa-dev

# First-time auth
numa login nd-labs                  # SRP login, runs bootstrap automatically
numa whoami                         # verify identity
```

## Documentation

The canonical reference lives in [`docs/numa-cli-reference-internal.html`](docs/numa-cli-reference-internal.html) — a single-file HTML doc with overview, every command, worked examples, output modes deep-dive, self-tests, and design/architecture. Open with:

```bash
numa-dev reference                              # opens in default browser
numa-dev reference --section integrations       # deep-link to a section
numa-dev reference --print-path                 # just print file:// URL
```

Light is the default theme; the sidebar has a dark-mode toggle that persists in `localStorage`.

## Per-package details

- [`packages/cli/`](packages/cli/) — prod package README, command list, exports
- [`packages/cli-dev/`](packages/cli-dev/) — dev addon README, self-tests, context tools

## Identity & auth — how the CLI proves who you are

Two transports, selected at call time by `NUMA_AUTH_MODE` (see [`packages/cli/src/api/client.ts`](packages/cli/src/api/client.ts)):

| Mode            | Caller                    | Transport                                                 | Credential sent                              | Verified by                                      |
| --------------- | ------------------------- | --------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| unset (laptop)  | developer                 | HTTPS → CloudFront → API Gateway                          | Cognito **access** token (from `numa login`) | API-GW authorizer **and** numa-cli-api in-Lambda |
| `workspace-iam` | the LLM, inside a MicroVM | direct `lambda:InvokeFunction` on `<client>_numa-cli-api` | the token in **`NUMA_IDENTITY_TOKEN`**       | numa-cli-api in-Lambda                           |

**The security rule: numa-cli-api derives the user ONLY from a cryptographically verified token. It never trusts a plaintext sub.** This matters because inside a MicroVM the LLM controls the workspace IAM role and can invoke numa-cli-api directly with any payload — so an asserted `sub`, or an unverified JWT, would let it impersonate any user in the tenant. The IAM signature proves "a real MicroVM is calling"; the _token_ proves _which user_.

`NUMA_IDENTITY_TOKEN` holds one of two verifiable tokens, set by the workspace agent (`sdk_config.py`) from what the proxy hands down:

- **Interactive chat** → the user's real **Cognito id token** (verified against Cognito JWKS).
- **Non-interactive runs** (scheduled agents, V2 apps, Nolia) have no user token, so the **workspace-chat-agent-proxy mints a short-lived HS256 "service token"** (`iss: numa-workspace-proxy`, `aud: numa-cli-api`) signed with a secret shared only between the proxy and numa-cli-api — never injected into the MicroVM. numa-cli-api verifies it and reads the signed `sub`.

The CLI itself is token-agnostic: it just forwards `NUMA_IDENTITY_TOKEN` in the `authorization` header. Full threat model and verification logic: [`lambdas/node/numa-cli-api/src/shared/auth.ts`](../lambdas/node/numa-cli-api/src/shared/auth.ts). Design note: [`dev-notes/tasks/numa-cli/identity-model.md`](../dev-notes/tasks/numa-cli/identity-model.md).

## State files (shared between both binaries)

```
~/.config/numa/profile                     # active account name
~/.config/numa/tokens-<account>.json       # access/id/refresh tokens (chmod 600)
~/.config/numa/context-<account>.json      # bootstrap response (KBs, integrations, etc.)
~/.config/numa/dev-context-<account>.json  # dev-only scope override (numa-dev context)
~/.cache/numa/integrations/<slug>/         # cached Pipedream action indexes
./tmp/numa-cli/                            # standard-mode envelope spill files (gitignored)
```
