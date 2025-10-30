# NextGen Portal Automation Plan

This plan proposes turning the manual “NextGen account provisioning” and “client setup” steps into guided tools inside the Customer Success Portal, using a small broker in the deployer account and the existing NextGen/Client infrastructure already in this repo.

## Goals

- Guided “Setup NextGen Client” wizard to rename the account, write client config, run Plan/Deploy (via SFN), and retrieve the system user password.
- Guided “Setup Non‑NextGen Client” wizard for customers that bring their own AWS account (no provisioning step), including role/trust pre‑checks.
- Keep sensitive AWS APIs off the browser (Organizations, Secrets) and broker them via a Lambda in the deployer account with least‑privilege IAM.
- Future improvement (not core in this phase): one‑click provisioning of new NextGen accounts (in the management org) with progress tracking.

## Tools In The Portal

1) Setup Nextgen Client (wizard)
   - Step A: Update account name to the client ID (Organizations `UpdateAccount`) via broker.
   - Step B: Create client config using the portal tool (validates and writes to `numa-client-config`).
   - Step C: Plan/Deploy via the existing Step Functions mechanism; show logs and manage locks.
   - Step D: Retrieve system user password (Secrets Manager) via broker for handover.
   - Optionally write/update a central registry (accountId ↔ clientName, region, status).

2) Setup Non‑Nextgen Client (wizard)
   - Step A: Pre‑checks – verify `ArcanumAIAccess` role exists in the customer account and trust relationships allow the deployer and portal roles.
   - Step B: Create client config via the portal tool.
   - Step C: Plan/Deploy via SFN; show logs and manage locks.
   - Step D: Retrieve system user password (if present) via broker.

3) (Future) Provision Next Gen Accounts
   - Inputs: N (count), optional base label.
   - Starts executions of the management account’s `createAccount` state machine; shows progress; registers accounts in `numa-account-registry`.

4) (Future) Update NextGen Accounts Table (admin)
   - Grid editor bound to `numa-account-registry` (accountId, allocatedClient, region, status, createdAt/updatedAt).
   - Supports add/update/delete entries; bulk paste import for reconciling with the Notion list.

## Architecture Overview

- Browser (portal SPA) → Broker Lambda(s) in the deployer account (direct Lambda invoke) for sensitive operations only (Organizations rename, Secrets retrieval).
  - No API Gateway required. The SPA invokes the broker Lambda directly using Cognito Identity Pool credentials and the Lambda client.
  - The SPA continues to use existing direct integrations for client‑config (DynamoDB) and deployments (Step Functions/ECS/Logs) in this phase.
  - Broker performs the privileged calls, logs/audits requests, and returns safe results to the SPA; assumes narrowly‑scoped roles in the management and client accounts.

### Broker Functions (Deployer Account)

- (Future) `startCreateAccounts`
  - Input: array of account descriptors or count N.
  - Action: Assume the management account role and call `states:StartExecution` on the `createAccount` state machine. Optionally batch.
  - Also support `states:DescribeExecution` for progress.

- `updateAccountName`
  - Action: Assume a management role that allows `organizations:UpdateAccount` to rename an account to the client ID.

- `writeClientConfig`
  - Not required in this phase. The portal already has create/update/JSON‑replace with validation and logging; keep using the portal’s direct DDB tooling.

- `getSystemUserSecret`
  - Action: Assume the client account `ArcanumAIAccess` and call `secretsmanager:GetSecretValue` for `system-user-password`.

- (Optional) `listAvailableAccounts`
  - Action: Read a central registry (DDB) of pre‑provisioned NextGen accounts; or directly call `organizations:ListAccounts` via the management role if we decide not to keep a registry.

- `updateAccountRegistry`
  - Action: Upsert/delete rows in the central `numa-account-registry` table. Used by an admin UI to reconcile the table with external sources (e.g., Notion).

### IAM & Trusts

- Portal browser role (Identity Pool):
  - Phase 1: Continue current model — DDB read/write for client configs, SFN `StartExecution` and Logs/ECR reads for deployments, and `lambda:InvokeFunction` for brokered operations.

- Broker Lambda role (Deployer account):
  - Allow `sts:AssumeRole` into the management account role(s) that can:
    - `states:{StartExecution,DescribeExecution}` for the (future) `createAccount` state machine.
    - `organizations:UpdateAccount` (rename) and related read (e.g., `ListAccounts`).
  - Allow `sts:AssumeRole` into client accounts’ `ArcanumAIAccess` for `secretsmanager:GetSecretValue` to fetch the `system-user-password`.
  - Standard CloudWatch Logs permissions.

- Management account roles:
  - `StartCreateAccountRole` (already exists in the NextGen root stack) – update trust to the broker Lambda role ARN (narrower than trusting the whole deployer account root principal).
  - (Optional) `AccountAdminBrokerRole` for `organizations:UpdateAccount` and safe read APIs; or a small dedicated Step Functions state machine `renameAccount` to keep the broker minimal.

### Data

- New DDB table `numa-account-registry` (deployer account) to track:
  - `accountId` (PK), `allocatedClient`, `region`, `status` (available/allocated/active), `createdAt`, `updatedAt`.
  - Populated by the provisioning flow and updated by the setup wizard.
  - Editable via the “Update NextGen Accounts Table” tool (broker logs all mutations).

## UI Flow (at a glance)

- Tools page: two core cards (phase 1)
  - Setup Nextgen Client (wizard)
  - Setup Non‑Nextgen Client (wizard)

- Setup Nextgen Client (wizard)
  - Enter/select account ID → rename (broker) → write config (portal) → Plan/Deploy (SFN; logs + locks) → retrieve secret (broker).
  - Each step shows logs/status and can be retried.

- Setup Non‑Nextgen Client (wizard)
  - Pre‑checks (role/trust tests), then config (portal) → Plan/Deploy (SFN; logs + locks) → retrieve secret (broker).

- (Future) Provision Next Gen Accounts
  - Inputs: N (count), optional base label → starts executions → registers accounts in `numa-account-registry`.

## CDKTF Changes (Where To Update)

- NextGen root (management account):
  - Ensure `createAccount` state machine and its `StartCreateAccountRole` are deployed.
  - Tighten trust on `StartCreateAccountRole` to the broker Lambda role ARN (from the deployer account), rather than `*:root`.
  - (Optional) Add a small `renameAccount` state machine or a dedicated role `AccountAdminBrokerRole` with `organizations:UpdateAccount` restricted to the org.

- Deployer account stack:
  - Add a single `portal-nextgen-broker` Lambda (the functions above can be separate handlers or one handler with an `action` switch).
  - IAM for broker: assume management roles, write to `numa-client-config` and `numa-account-registry`, assume client `ArcanumAIAccess`, and logs.
  - Output the Lambda ARN for the portal; no API Gateway.

- Portal:
  - Add two core tool pages (phase 1) and simple forms.
  - Use existing credential path; call the broker only for sensitive actions; surface progress/status.

## Risks & Mitigations

- Security of Organizations access:
  - Mitigate by brokering; narrow trusts to the broker role; log all requests; enforce allow‑lists.

- Quotas/Throttling in Organizations/SSO:
  - Retain backoff/retry (the NextGen state machine already retries); show progress and partial failures.

- Consistency between registry and real org state:
  - Source of truth is AWS; registry is convenience. Provide a “Reconcile” action to refresh from Organizations.

## Success Criteria

- CS can set up a NextGen client: rename the account, write config, plan/deploy via SFN, and retrieve the system user password entirely from the portal with clear progress and without touching AWS consoles.
- Non‑Nextgen clients follow a similar guided flow with pre‑checks.
- All sensitive or high‑privilege actions (Organizations/Secrets) are brokered; no Organizations calls from the browser.

## Open Questions

- Do we want a “bulk” UI for provisioning with naming conventions, or keep it minimal (just count)?
- Should we persist plan summaries (add/change/destroy) in the record now, or keep it logs‑only until demanded?
- For Secrets Manager retrieval, do we want automated secure sharing (e.g., BitWarden Send/Slack) or keep it copy‑only in the portal? Copy only in the portal.
  - We could also create a seperate tool for this that just retrieves and shares the secret, if needed. In case the password needs to be retrieved again or the user missed it the first time.

## Client Config Tooling (Further Planning)
Update: This has been done in the portal now; keep using the portal tools rather than brokering config writes.

"Create client config (write to `numa-client-config` with validation)" needs a short design pass to define what CS can adjust safely and how the UI presents it. Proposal:

- Split into dedicated tools:
  - Create Client Config (wizard)
  - Update Client Config (editor)
  - (Admin‑only) Delete Client Config

- Editable fields (initial set):
  - `pipedreamIntegrations` (boolean)
  - `allProdApps` (boolean). If false, allow selecting a subset from the full prod app list
  - `apps` selection when `allProdApps=false` (multi‑select of known app IDs)
  - Group assignments (e.g., admin/user features lists) with safe presets
  - Also consider region, preferredKnowledgeBase, bedrockAccount — likely fixed at creation time only.

- Validation & safety:
  - Reuse the existing portal schema validator and strict JSON validation; present a human‑readable diff and require confirmation before write
  - Audit via the portal’s activity log of config changes

- UX considerations:
  - CS‑friendly labels and help text; defaults from a “template” config per region
  - Guard rails to prevent conflicting options (e.g., `preferredKnowledgeBase` vs `provisionQResources`)
  - After write, suggest running a Plan Only (then Deploy) to materialize config changes where applicable

- Implementation note:
  - No broker required for config create/update in this phase; keep portal calls simple and reuse existing shared schema/types
