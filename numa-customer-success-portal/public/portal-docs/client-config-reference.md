# Client Config Reference

This document describes all supported fields in a client configuration (stored in the `numa-client-config` DynamoDB table), their defaults, and how to set them using the portal tools. Any fields not listed here are not recognized by the deployment stack.

Notes
- Portal tools provide UI for the common fields. Advanced fields are available via JSON upload/replace or CLI.
- JSON upload in the portal uses a strict schema: unknown fields are rejected.
- Do not set conflicting values (e.g., `preferredKnowledgeBase: 'q'` while `provisionQResources` is false) — the deployment will error.

Core (required)
- `clientAccountId` (string): 12‑digit AWS account ID for the client. Portal: Create/Update UI.
- `region` (string): Primary AWS region for deployment. Portal: Create/Update UI.

Development & UX
- `devInstance` (boolean, default false): Mark environment as development/demo; enables dev‑only apps. Portal: Create/Update UI.
- `enableIFrame` (boolean, default false): Allow embedding via iframe. Portal: JSON only.
- `customDomain` (string): Custom domain, e.g. `acme.numa.arcanum.ai`. Portal: JSON only.

Q Business
- `qBusinessRegion` (string, default `us-east-1`): Region for Amazon Q Business resources. Portal: JSON only.
- `provisionQResources` (boolean, default false): Provision Q resources for the client. Portal: JSON only.

Knowledge Base & Models
- `preferredKnowledgeBase` (`'q' | 'bedrock'`): Primary KB for retrieval; defaults to `'q'` when `provisionQResources` is true, otherwise `'bedrock'`. Portal: JSON only.
- `embeddingModel` (string, default `amazon.titan-embed-text-v2:0`): Embedding model for KB. Portal: JSON only.
- `bedrockParserModel` (string, default `amazon.nova-lite-v1:0`): Parser model for document processing. Portal: JSON only.
- `visionModelType` (`'haiku' | 'nova-pro'`, default `'haiku'`): Vision model for extraction. Portal: JSON only.

Apps
- `allApps` (boolean, default false): Deploy all apps (including non‑prod as applicable). Portal: Available in Create/Update UI when "Development Instance" is enabled.
- `allProdApps` (boolean, default false): Deploy all production apps. Portal: Create/Update UI.
- `apps` (record): Map of app IDs to config. Use to select specific apps or override app‑specific options. Portal: Create/Update UI (selection) or JSON.
  - Supported production app IDs: `candidate-screening`, `company-profile`, `contract-analysis`, `document-summariser`, `financial-analysis`, `meeting-analyser`, `policy-drafter`, `policy-reviewer`.
  - Additional app IDs (subject to change): `beyond-expectations`, `costing-calculator`, `gdsr-assessment`, `infringement-review`, `tor-assessment`, `nzsba-policy-builder`, `procurement-rfp-assessment`, `rfp-response-comparison`.
  - Dev/test app: `e2e-test` (enabled automatically when `devInstance` is true).

Communication
- `senderEmail` (string): SES “from” address. Portal: JSON only.
- `receiverEmails` (string[]): Array of notification recipients. Portal: JSON only.
- `bedrockAccount` (string): Cross‑account alias/ID for Bedrock usage. Portal: JSON only.

Feature Flags
- `numaChatAgents` (boolean, default true): Enable Strands/Numa chat agents. Portal: JSON only.
- `allowBedrockQuotaSharing` (boolean, default false): Provision quota‑sharing role for Bedrock. Portal: Create/Update UI.
  - Warning: Only enable on one environment per AWS account (role naming is fixed).
- `pipedreamIntegrations` (boolean, default false): Enable Pipedream proxy integrations. Portal: Create/Update UI.

Data Sources (JSON only)
- `webCrawlerConfigs` (array): `{ url: string, maxDepth?: number, maxPages?: number }`
- `sharePointConfigs` (array): `{ siteUrl: string, tenantId: string }`
- `boxConfigs` (array): `{ clientId: string, clientSecret: string }`
- `teamsConfigs` (array): `{ tenantId: string }`
- `s3Configs` (array): `{ bucketName: string, prefix?: string }`

Budget (JSON only)
- `budget` (object): `{ name: string, limitAmount: number, alertThresholds: number[] }` for AWS Budget alarms and notifications.

How to Configure
- Create Client Config (UI): Set `clientAccountId`, `region`, `devInstance`, `allProdApps` or specific `apps`, `pipedreamIntegrations`, `allowBedrockQuotaSharing`.
- Update Client Config (UI): Modify the same subset as Create.
- JSON Upload (Create → “Create from JSON” or Update → “Replace from JSON”): Full control of all fields; strict validation.
- CLI (tools/write-config.ts): Full control with infra schema validation.

Conflicts & Validation
- If `provisionQResources` is false, do not set `preferredKnowledgeBase: 'q'`.
- Unknown app IDs are rejected by deployment.
- Unknown top‑level fields are rejected by JSON upload in the portal.
