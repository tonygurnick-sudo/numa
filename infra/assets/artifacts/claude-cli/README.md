# Claude CLI Artifact

Purpose
- Provides the `claude` binary for deployment containers and internal data/analysis runners.

Expected ZIP contents
- `bin/claude` (Linux x86_64 executable)

Where it lives
- Local path consumed by CDKTF: `infra/assets/artifacts/claude-cli/claude-x86_64.zip`
- Deployer S3 (seeded by CI): `s3://numa-claude-cli-artifacts/claude-artifacts/<version>/claude-x86_64.zip`
 - Client S3 (runtime download): `s3://numa-<client>[-env]-outputs/artifacts/claude-cli/<version>/claude-x86_64.zip`

Local fetch (no Docker)
- `yarn workspace @arcanumai/q-apps-deployer-tools fetch-claude-cli-artifact`
  - Defaults: bucket `numa-claude-cli-artifacts`, prefix `claude-artifacts`, version `1.0.100`

Infra usage
- During deploy, the local ZIP is uploaded to the client outputs bucket under `artifacts/claude-cli/<version>/claude-x86_64.zip`.
- Data Analysis runner uses runtime download: the Lambda downloads this ZIP from S3 on cold start, extracts `bin/claude` to `/tmp/claude`, and executes it via `CLAUDE_BIN=/tmp/claude`.
- Set `CLAUDE_CLI_VERSION` in the deploy environment to control the S3 key/version (default `1.0.100`).

Runtime env vars (runner)
- `BUCKET`: client outputs bucket name.
- `CLAUDE_CLI_S3_KEY`: `artifacts/claude-cli/<version>/claude-x86_64.zip`.
- `CLAUDE_BIN`: `/tmp/claude`.
