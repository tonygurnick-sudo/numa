# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Numa Customer Success Portal is an internal React SPA that enables the Customer Success team to manage client configurations, view deployment container images, trigger deployments, generate reports, and manage users without accessing CI/CD directly.

Built with React 19 + TypeScript, Vite, and Bootstrap 5. Authenticates via AWS Cognito and uses Identity Pool credentials to make AWS API calls directly from the browser.

## Development Commands

### Local Development

```bash
yarn install             # Install dependencies
yarn dev                 # Start dev server (http://localhost:5173)
yarn build              # Build for production
yarn test               # Run tests with coverage
yarn lint               # Lint TypeScript/React code
```

### Configuration Setup

Copy and edit `public/config.json` for local development. The app loads runtime config from `/config.json` which must contain required AWS service identifiers (Cognito pools, DynamoDB tables, etc.).

### Deployment

The portal deploys as part of the main infra stack when `enableCustomerSuccessPortal` is enabled:

```bash
# Build first
yarn build

# Deploy via infra (from ../infra/)
export TF_ENVIRONMENT=prod
export AWS_REGION=us-east-1
export CLIENT_OVERRIDE=none
yarn cdktf deploy --auto-approve q-apps-deployer
```

Static files upload to S3+CloudFront, and `config.json` is generated server-side during deployment.

## Architecture

### Authentication Flow

- **Cognito User Pool**: User authentication and session management
- **Cognito Identity Pool**: Browser AWS credentials for authenticated users
- **IAM Role**: `customer-success-portal-authenticated-role` with scoped permissions
- **Cross-Account Access**: Assumes `ArcanumAIAccess` role in client accounts via STS

### Key Services Architecture

- **Config Service**: Runtime configuration loader with 7-minute cache in sessionStorage
- **Auth Context**: Cognito session management with automatic 30-second token refresh
- **Client Service**: Reads client configs via `@arcanumai/client-config` from DynamoDB
- **Deployment Service**: Orchestrates infrastructure deploys via Step Functions + ECS
- **Tools**: Usage and Quota reports that assume roles across multiple client accounts

### Data Flow Patterns

All AWS operations run in-browser using Identity Pool credentials. Tools authenticate to client accounts by assuming the `ArcanumAIAccess` role, enabling cross-account data access for reports and management operations.

### Component Structure

```
src/
├── components/          # Reusable UI (navigation, auth guards, tool widgets)
├── contexts/           # AuthContext for Cognito session state
├── hooks/             # useAssumeRole, useToolExecution
├── pages/             # Route components (Dashboard, Configs, Tools, etc.)
├── services/          # AWS service clients and business logic
├── types/             # TypeScript definitions and Zod schemas
└── utils/             # Export utilities, date helpers
```

Key architectural files:

- `src/components/ConfigLoader.tsx`: Loads `/config.json` at startup, handles cache management
- `src/contexts/AuthContext.tsx`: Cognito authentication with background token refresh
- `src/services/configService.ts`: Runtime configuration management with sessionStorage cache
- `src/services/clientService.ts`: Client configuration access via shared library
- `src/services/deploymentService.ts`: Infrastructure deployment orchestration

### Deployment Architecture

- **Step Functions**: `NumaPortalDeployment` state machine orchestrates each deploy
- **ECS Fargate**: Runs `numa-deploy` container with `cdktf deploy numa-<client>`
- **DynamoDB**: `numa-portal-deployments` table tracks history and status
- **Auto-retry**: One automatic retry for 25-35 minute failures (token expiry heuristic)

## Development Patterns

### AWS Service Integration

Services use Identity Pool credentials with on-demand client construction. Cross-account operations assume `ArcanumAIAccess` role in target client accounts.

### Configuration Management

Runtime config loads from `/config.json` with required properties validation. Local development uses `public/config.json`, production uses S3-generated config.

### Tool Development

New tools should:

- Use `useToolExecution` hook for progress tracking
- Implement progress updates via `ProgressTracker` component
- Handle cross-account authentication via `useAssumeRole`
- Export results using utilities in `src/utils/fileExport.ts`

### Client List Rendering

Always use the specialized client grouping components when displaying client lists:

- **`ClientSelectGroup`**: For dropdown/select inputs - automatically groups clients into "Dev/Demo Stacks" and "Client Stacks" optgroups based on `devInstance` config flag
- **`ClientTableGroup`**: For table displays - renders grouped sections with visual headers separating development from production clients
- **`groupClientsByType`**: Utility function from `clientService.ts` that separates clients by `config.devInstance` boolean

These components ensure consistent UX by clearly distinguishing between development/demo environments and production client deployments across all portal features.

### State Management

React Context for authentication state. AWS service calls are stateless with credential providers. Tools manage execution state through custom hooks.

## Required AWS Setup

### Portal IAM Permissions

The `customer-success-portal-authenticated-role` requires:

- DynamoDB access to `numa-client-config` table
- ECR read access to `numa-deploy` repository
- Cognito User Pool management for portal users
- STS assume role access to `arn:aws:iam::*:role/ArcanumAIAccess`

### Client Account Requirements

Each client account must have:

- `ArcanumAIAccess` role trusting the portal's authenticated role
- DynamoDB tables: `${clientName}-<app>-recent-jobs`, `numa-${clientName}-chat-history`
- Cognito User Pool: `numa-${clientName}` (for user lookup in reports)

### Cross-Account ECR Access

ECR repository policy must allow `DescribeImages` and `ListImages` from the portal role principal.

## Troubleshooting

### Authentication Issues

- Verify `/config.json` values match deployed Cognito resources
- Check Identity Pool role trust and permissions
- Ensure session tokens haven't expired (30-second refresh cycle)

### Tool Failures

- Confirm `ArcanumAIAccess` role exists in target client accounts
- Verify role trust policy includes portal's authenticated role ARN
- Check that required DynamoDB tables exist for the selected time period

### Configuration Problems

- All required config properties must be present in `/config.json`
- Config cache refreshes every 7 minutes or on page reload
- Use browser dev tools to inspect sessionStorage for cached config values

### Deployment Issues

- Build the portal (`yarn build`) before deploying infrastructure
- Deploy failures around 30 minutes trigger automatic retry
- Check ECS task logs via deployment history page for detailed error information
