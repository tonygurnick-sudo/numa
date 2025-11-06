# Claude CLI Artifact

Purpose
- Provides the `claude` binary for deployment containers and internal data/analysis runners.

Expected ZIP contents
- `bin/claude` (Linux x86_64 executable)

Where it lives
- Local path consumed by CDKTF: `infra/assets/artifacts/claude-cli/claude-x86_64.zip`
- Deployer S3 (seeded by CI): `s3://numa-claude-cli-artifacts/claude-artifacts/<version>/claude-x86_64.zip`

Local fetch (no Docker)
- `yarn workspace @arcanumai/q-apps-deployer-tools fetch-claude-cli-artifact`
  - Defaults: bucket `numa-claude-cli-artifacts`, prefix `claude-artifacts`, version `1.0.100`
