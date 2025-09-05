# Pipedream Account Sync Lambda

This lambda synchronizes allowed client accounts from the deployer account to the proxy account.

## Architecture

- **Location**: Pipedream Proxy Account (965745962688)
- **Trigger**: EventBridge rule (hourly)
- **Purpose**: Sync client account IDs from numa-client-config table to pipedream-allowed-accounts table

## Security Flow

1. Directly accesses numa-client-config table via DynamoDB resource policy
2. Scans numa-client-config table for all client configurations
3. Extracts unique clientAccountId values
4. Updates local allowed accounts table:
   - Adds new accounts with ACTIVE status
   - Reactivates previously suspended accounts
   - Suspends accounts no longer in config (retains for audit trail)

## Environment Variables

- `ENVIRONMENT`: Environment name (prod, dev)
- `ALLOWED_ACCOUNTS_TABLE`: Name of the allowed accounts DynamoDB table
- `LOG_LEVEL`: Logging level (INFO, DEBUG)

## IAM Requirements

### In Proxy Account
- Read/write access to allowed accounts table

### In Deployer Account
- DynamoDB resource policy on numa-client-config table allows read access from proxy account sync lambda role

## Monitoring

- CloudWatch logs: `/aws/lambda/pipedream-account-sync`
- Structured JSON logging with sync results
- Metrics: accounts added, suspended, activated per sync
