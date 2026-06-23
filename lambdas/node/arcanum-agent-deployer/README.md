# Arcanum Agent Deployer Lambda (FEAT-206)

Deployer-account Lambda that pushes curated **Arcanum** agents from the central
library into client Numa instances — a **separate push, not a full Numa deploy**.

Invoked same-account by the Customer Success Portal (Identity Pool creds).
Returns the `{ ok, result, error }` envelope (same as `portal-nextgen-broker`).

## What it does (per target client)

1. Resolves the **desired set** from the client's `deployedAgents` config
   (`{ includeAll, agentIds }`) or an explicit override in the event.
2. Assumes `ArcanumAIAccess` in the client account.
3. For each desired library agent: copies reference files into
   `numa-{client}-outputs` (`numa-chat/agents/arcanum/{libraryId}/…`), invokes
   `{client}_extract-content` to produce extracted text, and upserts an
   Arcanum-managed row into `{client}-agents`
   (`agent_id = agt_arcanum_{libraryId}`, `managed_by: 'arcanum'`).
4. **Drift removal:** deletes managed rows whose `library_agent_id` is no longer desired.
5. Writes an audit record to `numa-arcanum-agent-deployments`.

Deterministic agent ids make re-deploys idempotent (upsert in place).

## Actions

- `deployToClient` → `{ clientName, includeAll?, agentIds?, actor? }`
- `previewClient` → `{ clientName, includeAll?, agentIds? }` (dry-run diff, no writes)
- `deployFleet` → `{ actor? }` (every client with `deployedAgents` configured)
- `statusForClient` → `{ clientName, limit? }`

## Environment

- `LIBRARY_TABLE` — `numa-arcanum-agent-library`
- `DEPLOYMENTS_TABLE` — `numa-arcanum-agent-deployments`
- `LIBRARY_BUCKET` — library S3 bucket (raw reference files)
- `CLIENT_CONFIG_TABLE_NAME` — `numa-client-config`
- `CLIENT_ASSUME_ROLE_NAME` (default `ArcanumAIAccess`)
- `DEPLOYMENTS_TTL_DAYS` (default `180`)

## Build / Bundling

`yarn bundle` to produce `lambda_function.zip`.

Lives in `q-apps-deployer-stack`, but — like `portal-nextgen-broker` — it **must**
be listed in `.node-matrix` in `.gitlab-ci.yml`. That matrix drives `node-package`,
which builds the zip artifact that `build-deployment-container` bakes into the
`numa-deploy` image; the deployer-stack `cdktf deploy` reads it via
`Fn.filebase64sha256(...)`. Omit it and the deploy dies at synth with a missing-zip error.
