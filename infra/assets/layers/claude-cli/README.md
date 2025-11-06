# Claude CLI Lambda Layer

Purpose
- Provides the `claude` binary to Lambdas via a Lambda Layer. Used by internal data/analysis runners.

Expected ZIP contents
- `bin/claude` (Linux x86_64 executable)

Where it lives
- Local path consumed by CDKTF: `infra/assets/layers/claude-cli/claude-x86_64.zip`
- Deployer S3 (seeded by CI): `s3://numa-claude-cli-layers/claude-layers/<version>/claude-x86_64.zip`

Local fetch (no Docker)
- `yarn workspace @arcanumai/q-apps-deployer-tools fetch-claude-cli-layer`
  - Defaults: bucket `numa-claude-cli-layers`, prefix `claude-layers`, version `1.0.100`
