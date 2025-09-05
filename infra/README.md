# Infra

The infrastructure for this project is written using CDKTF. Deployments are done via GitLab (TODO).

## Infra layout

As with all CDKTF infracode, this project consists of three main parts:

- App: The top-level grouping of all the associated parts of the infrastructure.
- Stacks: Groupings of resources that need to be deployed together.
- Constructs: Reusable components consisting of a single resource (or tightly coupled group of resources).

The App for this project is defined in main.ts, while the stacks and constructs are in the stacks and constructs directories, or imported from other projects.

## Installation

### Dependencies

This project uses yarn 4 as the package manager and requires node >= 20.

To install the dependencies run:

```bash
yarn install
```

If you receive error messages about dependencies not being found, see [the setup instructions for yarn >= 2](https://gitlab.com/arcanumai/cdktf-resources/-/blob/main/README.md#accessing-the-packages).

Then install any additional CDKTF providers:

```bash
yarn get
```

### AWS Profiles

The deploy script for this project requires you to have access to the arcanum-q-deployer accounts and expects their profiles in your .aws/config file to be named `arcanum-q-deployer-dev` and `arcanum-q-deployer-prod`.

## Usage

Usage of this project is facilitated via the `yarn cdktf` helper script.

---

**Note**

Most stacks require the lambdas to be build, just run `package-all.sh` (requires GNU parallel, not the one from moreutils) in the lambdas directory. There is package-python-lambda.sh to build only one lambda (to be run from the lambda directory or passing in the path the directory)

---

The main command to give to `yarn cdktf` is `plan`. This will produce a plan of the changes that the infracode will make to the infrastructure.

```bash
yarn cdktf plan
```

`plan` will need to be followed by the identifier of the stack to plan if there is more than one stack defined, however a maximum of one stack can be supplied at a time.

```bash
yarn cdktf plan q-apps-deployer
```

### Deploying stacks to customer accounts

Customer accounts grant access to our production deployer account.

To run the deploy of Numa to a customer account, do the following:

```bash
yarn cdktf deploy --auto-approve numa-{client-id}
```

The client-id must be the name of an entry from the clientsProd list in numa-client-stack.ts.

### Deploying the Pipedream Proxy Stack

The Pipedream proxy stack provides secure cross-account access to Pipedream integrations. It is deployed to a dedicated AWS account to isolate Pipedream credentials from client accounts.

**Secrets Management:**
This account stores Pipedream OAuth credentials in AWS Secrets Manager. The secret is named `pipedream/credentials-prod` and is read by the proxy lambda in `us-east-1`.

Pipedream Credentials Secret Format
- `client_id`: string — Pipedream OAuth client ID
- `client_secret`: string — Pipedream OAuth client secret
- `project_id`: string — Pipedream Connect project ID
- `environment`: string — Pipedream environment, by default we are using `production`

# To update the secret (multi‑line)
```bash
# Make sure you have the AWS CLI configured with access to the Pipedream proxy account
aws secretsmanager update-secret \
  --secret-id "pipedream/credentials-prod \
  --secret-string '{
    "client_id": "YOUR_ACTUAL_CLIENT_ID",
    "client_secret": "YOUR_ACTUAL_CLIENT_SECRET",
    "project_id": "YOUR_ACTUAL_PROJECT_ID",
    "environment": "production"
  }'
```

**Deployment:**
```bash
# Package the relavant lambdas before deployment
bash package-python-lambda.sh lambdas/python/pipedream-proxy
bash package-python-lambda.sh lambdas/python/pipedream-account-sync

# Deploy the proxy infrastructure to the dedicated proxy account
unset CLIENT_OVERRIDE
export TF_ENVIRONMENT=prod
export AWS_REGION=us-east-1
yarn cdktf deploy --auto-approve pipedream-proxy
```

  **Architecture:**
  - **DynamoDB Tables**:
    - `pipedream-user-mappings` - Security mapping table that tracks account-to-user relationships
    - `pipedream-allowed-accounts` - Authorized client accounts synced from deployer account
  - **Lambda Functions**:
    - `pipedream-proxy` - Generic proxy that validates requests and calls Pipedream APIs
    - `pipedream-account-sync` - Hourly sync of allowed client accounts from deployer account
  - **EventBridge**: Hourly schedule for account synchronization
  - **Secrets Manager**: Stores Pipedream OAuth credentials securely
  - **IAM Roles**: Minimal permissions for lambda operations and cross-account access
  - **CloudWatch**: Log groups for both lambda functions

**Security Model:**
- Caller validation via presigned STS GetCallerIdentity URL (generated in the caller account). The proxy verifies the URL over HTTPS and parses the STS XML.
- Role name validation against allowlist
- First-request registration with negative case handling
- Cross-account trust relationships for client account access

## Development

Linting can be run with `yarn lint`. This will run eslint and then tsc for type checking.

Tests can be run with `yarn test`.

## Web Crawler Configuration

The Numa infrastructure supports two methods for configuring web crawlers:

1. Direct URL Crawling
   The simplest method is to specify URLs directly in the client configuration:

"webCrawlerConfigs": [
{
"url": "https://example.com"
}
]

2. Sitemap-based Crawling
   For more comprehensive crawling, you can use XML sitemaps.

Download the client's sitemap and save it in the client-sitemaps directory
Configure the crawler to use this sitemap in the client configuration:

"webCrawlerConfigs": [
{
"siteMapFiles": [
["client-sitemaps", "client-name-sitemap.xml"]
]
}
]

Important Notes:

1. Before deploying: You must manually download and place the sitemap file in the client-sitemaps directory
2. The sitemap path is relative to the project root
3. You can combine both URL-based and sitemap-based configurations for the same client
4. Sitemaps must be in valid XML format

## Index Configuration

Amazon Q Business requires an index to be configured for each application. There are two types of indexes available:

### Index Types

- **STARTER**: Default index type

  - Supports up to 5 units
  - Each unit provides capacity for 20,000 documents or 200 MB (whichever is reached first)

- **ENTERPRISE**: Advanced index type
  - Supports up to 50 units
  - Each unit provides capacity for 20,000 documents or 200 MB (whichever is reached first)

### Configuration

Index configuration can be specified in the client config JSON files (`clientConfigDev.json` and `clientConfigProd.json`):

```json
{
  "clientname": {
    "indexType": "ENTERPRISE", // Optional. Defaults to "STARTER" if not specified
    "indexUnits": 5 // Optional. Defaults to 1 if not specified
    // ... other configurations
  }
}
```

## AWS Budget Alerting

Numa supports configuring AWS budget alerts for client accounts. When enabled, this feature sets up budget monitoring and forwards alerts to a centralised SNS topic for notification.

### Configuration

Budget alerting can be configured in the client config:(`clientConfigProd.json`):

```json
{
  "clientname": {
    "budget": {
      "name": "monthly-budget", // Required: Name of the budget
      "limitAmount": 500, // Required: Budget limit in USD
      "timeUnit": "MONTHLY", // Optional: Time unit (defaults to "MONTHLY")
      "alertThresholds": [50, 80, 100] // Optional: Notification thresholds as percentages (defaults to [80, 100])
    }
  }
}
```

### How It Works

1. When configured, the system creates:

   - An AWS Budget in the client account
   - A Lambda function that forwards budget alerts with client metadata
   - An SNS topic that sends alerts to the centralised topic

2. Alerts are batched and forwarded to a central SNS topic for consistent processing and notification delivery.
