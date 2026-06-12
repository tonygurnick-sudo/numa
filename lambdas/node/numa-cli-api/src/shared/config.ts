/**
 * Env-driven constants. Centralised so every module reads from the same place
 * and so it's obvious which env vars the Lambda actually depends on.
 *
 * Defaults are deliberately empty strings (not throws) — the Lambda boots
 * with no env vars during cold-start sanity checks, and we want individual
 * features to fail loudly only when actually used.
 */

export const CLIENT_NAME = process.env['CLIENT_NAME'] ?? '';
export const REGION = process.env['AWS_REGION'] ?? 'us-east-1';

/**
 * S3 bucket holding `company-data.json` — the company profile blob the
 * workspace agent loads at startup for system-prompt personalisation. Wired
 * from infra (`core-numa-infra-construct.ts` → `companyBucket`). Optional
 * — some client stacks don't provision this bucket.
 */
export const COMPANY_BUCKET_NAME = process.env['COMPANY_BUCKET_NAME'] ?? '';

/**
 * Shared secret CloudFront injects on real traffic. The `kb_manager` Lambda
 * is behind a CloudFront-fronted Function URL (not API Gateway) and gates
 * incoming requests on this header before letting them through. When we
 * invoke kb_manager directly via Lambda.Invoke we have to forward the secret
 * ourselves. Other Lambdas reached via API Gateway don't need it — API
 * Gateway's custom authorizer is the gate there and JWT alone is enough.
 */
export const CLOUDFRONT_SHARED_SECRET = process.env['CLOUDFRONT_SHARED_SECRET'] ?? '';

/**
 * Numa Ops entitlement flag. Hard server-side gate: `ops_*` tool invocations
 * are rejected unless this is set. Mirrors the workspace agent container's read
 * of the same env (see services/numa-workspace-agent/.../sdk_config.py) so the
 * CLI surfaces Ops only for clients who have it. Wired from infra off the
 * client's `numaOps` feature flag (same source as the workspace agent). With
 * the broad `Bash(numa:*)` CLI permission the old MCP-registration gate is gone,
 * so this restores the entitlement check at the API boundary.
 */
export const NUMA_OPS_ENABLED = ['1', 'true', 'yes'].includes((process.env['NUMA_OPS_ENABLED'] ?? '').toLowerCase());

/**
 * Minimum CLI version compatible with this Lambda's response shape. Bumped
 * when we introduce breaking wire changes. CLI warns the user when its own
 * version is below this floor; we don't hard-fail to avoid bricking devs
 * mid-flow.
 */
export const CLI_MIN_VERSION = '0.1.0';
