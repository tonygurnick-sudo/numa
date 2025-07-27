# Numa onboarding tools

This directory contains several tools for assisting in onboarding customers to Numa.

- create-users: This tool creates users based on an input.csv file, activates their Q licence using Playwright and outputs a user-details.csv file.
- upload-files: This tool uploads files to a customer's Q S3 data bucket and triggers a reindex.
- check-index-progress: This tool looks up the status of an S3 data bucket index and prints it.
- migrate-urls-to-crawler: This tool migrates URL data sources from client configurations to the web crawler DynamoDB tables.
- generate-usage-report: This tool generates comprehensive usage reports for Numa admins, including app runs and chat messages by user by month.

## Installation

Note: This repository contains a .devcontainer setup for VSCode. This is the recommended way of setting up an environment to ensure the following works.

These tools use yarn for dependency management. Install dependencies in the usual way:

```bash
corepack enable # Possibly not necessary, but doesn't hurt to run.
yarn install
```

create-users also requires Playwright's Webkit browser to be installed to work:

```bash
yarn playwright install webkit
yarn playwright install-deps webkit
```

## Usage

Note: The following are still in development and subject to change.

### create-users

create-users requires a .csv file of the users to be created to be at input.csv in this directory. The CSV should have a header row and three columns: given_name, family_name, email_address. The contents of the header file is not used, but the columns should be in that order.

The script will need to be run with a profile providing access to the arcanum-q-deployer-prod account. From there it will assume access into the customer's account.

The client-name is the key in infra/stacks/numa-client-stack.ts:clientsProd, e.g. arcanum-demo.

The web-experience-url can be retrieved from the output of the `cdktf deploy` for setting up the account. If this wasn't recorded, they it be retrieved by running `yarn cdktf output numa-customer-name` in the infra directory.

Run the script in dry-run mode to ensure that the input is correct:

<pre>
AWS_PROFILE=arcanum-q-deployer-prod yarn create-users <b>client-name</b> <b>web-experience-url</b>
</pre>

This will print out the users to be added.

Then, to run it in "live" mode and actually do things:

<pre>
AWS_PROFILE=arcanum-q-deployer-prod yarn create-users <b>client-name</b> <b>web-experience-url</b> live
</pre>

This will take a while (potentially around 10 minutes) to run.

Note: If there are some failures to activate users, the script may hang after printing "Done.", it is safe to terminate at this point.

The created users and their temporary passwords will be written to user-details.csv.

### delete-users

<pre>
# Dry run to see what would be deleted:
AWS_PROFILE=arcanum-q-deployer-prod yarn delete-users <b>client-name</b>

# Actually delete the users:
AWS_PROFILE=arcanum-q-deployer-prod yarn delete-users <b>client-name</b> live
</pre>

### upload-files

upload-files requires a flat zip file of the files to be indexed. If the files are being delivered through Jira, this can be created using the "Download all" menu item.

The script will need to be run with a profile providing access to the arcanum-q-deployer-prod account. From there it will assume access into the customer's account.

The client-name is the key in infra/stacks/numa-client-stack.ts:clientsProd, e.g. arcanum-demo.

<pre>
AWS_PROFILE=arcanum-q-deployer-prod yarn upload-files <b>filename.zip</b> <b>client-name</b>
</pre>

Once the upload completes, the data source sync will be started and its excution ID printed.

### check-index-progress

The script will need to be run with a profile providing access to the arcanum-q-deployer-prod account. From there it will assume access into the customer's account.

The client-name is the key in infra/stacks/numa-client-stack.ts:clientsProd, e.g. arcanum-demo.

Usage:

```bash
AWS_PROFILE=arcanum-q-deployer-prod yarn check-index-progress <client-name> [options]

Options:

--list: List all data sources
--all: Check all data sources
--data-source-id <id>: Check specific data source
--sync-status: Show sync status
--start-sync: Start a sync
--start-sync --all: Start sync for all data sources
--start-sync --data-source-id <id>: Start sync for specific data source
```

Examples:

1. Default: Check S3 data source status

```bash
AWS_PROFILE=arcanum-q-deployer-prod yarn check-index-progress <client-name>
```

2. List all available data sources

```bash
AWS_PROFILE=arcanum-q-deployer-prod yarn check-index-progress <client-name> --list
```

3. Start sync for specific data source

```bash
AWS_PROFILE=arcanum-q-deployer-prod yarn check-index-progress <client-name> --start-sync --data-source-id 70ba69cb-eddd-44b8-89e4-cf888c6343e3
```

4. Check sync status for all data sources

```bash
AWS_PROFILE=arcanum-q-deployer-prod yarn check-index-progress <client-name> --sync-status
```

5. Check sync status for specific data source

```bash
AWS_PROFILE=arcanum-q-deployer-prod yarn check-index-progress <client-name> --sync-status --data-source-id 70ba69cb-eddd-44b8-89e4-cf888c6343e3
```

### migrate-urls-to-crawler

This tool migrates URL data sources from client configurations to the web crawler DynamoDB tables. It uses role assumption to access client accounts and create/update entries in the crawler tables.

```bash
# Migrate all clients
yarn migrate-urls-to-crawler

# Test migration for all clients (dry run)
yarn migrate-urls-to-crawler --dry-run

# Migrate only a specific client
yarn migrate-urls-to-crawler client-name

# Test migration for a specific client (dry run)
yarn migrate-urls-to-crawler client-name --dry-run

# Use a specific AWS profile
yarn migrate-urls-to-crawler --profile=my-aws-profile

# Combine options
yarn migrate-urls-to-crawler client-name --dry-run --profile=my-aws-profile
```

By default, the tool uses the `arcanum-q-deployer-prod` AWS profile if no profile is specified. You can override this by:
1. Using the `--profile=profile-name` command line option
2. Setting the `AWS_PROFILE` environment variable

6. Start sync for all data sources

```bash
AWS_PROFILE=arcanum-q-deployer-prod yarn check-index-progress <client-name> --start-sync --all
```

### downgrade-licences

Downgrades all licences for a particular customer to lite. Also deletes licences without a matching Cognito user.

```bash
AWS_PROFILE=arcanum-q-deployer-prod yarn downgrade-licences <client-name>
```

### check-bedrock-cases

Checks the current Bedrock Claude quota and status of quota increase support cases for a client.

Usage:

```bash
# Check a single client
AWS_PROFILE=arcanum-q-deployer-prod yarn check-bedrock-cases <client-name> [options]

# Check all clients and generate a report
AWS_PROFILE=arcanum-q-deployer-prod yarn check-bedrock-cases --all [options]

Options:
--include-resolved: Include resolved cases in the output
--details: Show detailed case information including communications history
--all: Check all clients and generate a summary report

```

### check-email-cases

Checks Cognito user pools for email addresses containing capital letters. This is useful for identifying users whose email addresses may need to be normalized to lowercase.

Usage:

```bash
# Check a single client
AWS_PROFILE=arcanum-q-deployer-prod yarn check-email-cases <client-name> [options]

# Check all clients and generate a report
AWS_PROFILE=arcanum-q-deployer-prod yarn check-email-cases --all [options]

Options:
--dev: Only check dev instances
--all: Check all clients and generate a summary report
--fix: Automatically convert emails with capital letters to lowercase

```

The script will:

1. Find the Cognito user pool for each client
2. List all users in the pool
3. Check each user's email attribute for capital letters
4. If --fix is specified, automatically convert any emails with capital letters to lowercase
5. Generate a report of users with capital letters in their email addresses

The report includes:

- Total number of clients checked
- Number of clients with capital email addresses
- Total number of users with capital email addresses
- Detailed list of affected users by client

The report is saved as `email-case-report.json`.

Example with fix:

```bash
# Check and fix emails for a single client
AWS_PROFILE=arcanum-q-deployer-prod yarn check-email-cases <client-name> --fix

# Check and fix emails for all dev instances
AWS_PROFILE=arcanum-q-deployer-prod yarn check-email-cases --all --dev --fix
```

### update-q-deploy-config

Updates client configurations to enable Q Business resources only for customers who have Microsoft connectors (SharePoint or Teams data sources). This tool ensures that Q resources are provisioned only for clients that actually need them based on their data source configurations.

Usage:

```bash
# Dry run (default) - analyze all clients and show what changes would be made
AWS_PROFILE=arcanum-q-deployer-prod yarn update-q-deploy-config

# Apply changes to all clients
AWS_PROFILE=arcanum-q-deployer-prod yarn update-q-deploy-config --apply

# Analyze specific clients only (dry run)
AWS_PROFILE=arcanum-q-deployer-prod yarn update-q-deploy-config client1 client2

# Apply changes to specific clients
AWS_PROFILE=arcanum-q-deployer-prod yarn update-q-deploy-config client1 client2 --apply
```

The script will:

1. Retrieve configurations for all clients (or specified clients)
2. Check each client for Microsoft data source connectors (SharePoint and Teams)
3. Set `provisionQResources: true` for clients with Microsoft connectors
4. Set `provisionQResources: false` for clients without Microsoft connectors
5. Show a detailed summary of changes to be made
6. Apply changes only when `--apply` flag is used (dry run is the default)

The tool provides detailed output including:
- Which clients have Microsoft connectors and what type
- Current vs. new `provisionQResources` settings
- Summary of total clients analyzed and updated
- Success/error counts for the update process

Examples:

```bash
# See what changes would be made to all clients (default dry run)
AWS_PROFILE=arcanum-q-deployer-prod yarn update-q-deploy-config

# Actually apply the changes to all clients
AWS_PROFILE=arcanum-q-deployer-prod yarn update-q-deploy-config --apply

# Check specific clients without making changes
AWS_PROFILE=arcanum-q-deployer-prod yarn update-q-deploy-config acme-corp example-client

# Apply changes to specific clients
AWS_PROFILE=arcanum-q-deployer-prod yarn update-q-deploy-config acme-corp example-client --apply
```

### check-user-password-state

Checks Cognito user pools for users in the FORCE_CHANGE_PASSWORD state.

When run, the default developer account will be used to get the client configs, but then
when editing the passwords in the customer account the profile `arcanum-q-deployer-prod`
will be used.

Usage:

```bash
# Check a single client
yarn check-user-password-state <client-name> [options]

# Check all clients and generate a report
yarn check-user-password-state --all [options]

Options:
--dev: Only check dev instances
--fix: Changes all users in FORCE_CHANGE state to have a random permenant password
```

The script uses credentials directly from your current AWS profile, so make sure you have the necessary permissions to access Cognito resources in the customer accounts.

The script will:

1. Find the Cognito user pool for each client
2. List all users in the pool
3. Identify users in the FORCE_CHANGE_PASSWORD state
4. Generate a report of affected users

The report includes:
- Total number of clients checked
- Number of clients with users in FORCE_CHANGE_PASSWORD state
- Total number of affected users
- Detailed list of affected users by client

The report is saved as `password-state-report.json`.

Examples:

```bash
# Check a single client
yarn check-user-password-state <client-name>

# Check all dev instances
yarn check-user-password-state --all --dev
```

### retrieve-config and write-config

Read and write config.

#### Editing on disk

The typical workflow is to retrieve the config and write it to a file. The file can then be edited before writing it back.

```bash
$ yarn retrieve-config dave-test | tee dave-test.json
{
  "clientAccountId": "905418183804",
  "createServiceLinkedRole": false,
  "devInstance": true,
  "region": "us-east-1",
  "apps": {
    "meeting-analyser": {}
  }
}
# Edit and save the JSON to add policy-analyser
$ yarn write-config dave-test dave-test.json
Differences: [
  {
    "type": "UPDATE",
    "key": "apps",
    "changes": [
      {
        "type": "ADD",
        "key": "policy-analyser",
        "value": {}
      }
    ]
  }
]
Approve changes? [y/N] y
Changes approved.
Writing new config...
Successfully wrote client config for dave-test:
{
  "clientAccountId": "905418183804",
  "createServiceLinkedRole": false,
  "devInstance": true,
  "region": "us-east-1",
  "apps": {
    "meeting-analyser": {},
    "policy-analyser": {}
  }
}
```

#### retrieve-config

Retrieves config from clientConfigProd.json if available, else DynamoDB. Prints to stdout.

```bash
yarn retrieve-config dave-test
{
  "clientAccountId": "905418183804",
  "createServiceLinkedRole": false,
  "devInstance": true,
  "region": "us-east-1",
  "apps": {
    "meeting-analyser": {}
  }
}
```

#### write-config

Takes config from a file and writes to DynamoDB.

```bash
$ cat dave-test.json
{
  "clientAccountId": "905418183804",
  "createServiceLinkedRole": false,
  "devInstance": true,
  "region": "us-east-1",
  "apps": {
    "meeting-analyser": {}
  }
}
$ yarn write-config arcanum-dave dave-test.json
Differences: [
  {
    "type": "UPDATE",
    "key": "apps",
    "changes": [
      {
        "type": "REMOVE",
        "key": "policy-drafter",
        "value": {}
      }
    ]
  }
]
Approve changes? [y/N] y
Changes approved.
Writing new config...
Successfully wrote client config for arcanum-dave:
{
  "clientAccountId": "905418183804",
  "createServiceLinkedRole": false,
  "devInstance": true,
  "region": "us-east-1",
  "apps": {
    "meeting-analyser": {}
  }
}
```

Attempting to write configs that don't validate correctly will produce an error:

```bash
$ cat dave-test.json
{
  "clientAccountId": "905418183804",
  "createServiceLinkedRole": false,
  "devInstance": true,
  "region": "us-east-1",
  "apps": {
    "meeting-analyser": {}
  },
  "a-random-entry": {}
}
$ yarn write-config arcanum-dave dave-test.json
[
  {
    code: 'unrecognized_keys',
    keys: [ 'a-random-entry' ],
    path: [],
    message: "Unrecognized key(s) in object: 'a-random-entry'"
  }
```

### generate-usage-report

generate-usage-report creates comprehensive usage reports for Numa administrators to track staff usage and get insights for investment optimization.

The script will need to be run with a profile providing access to the arcanum-q-deployer-prod account. From there it will assume access into the customer's account.

#### Usage

```bash
yarn generate-usage-report <client-name> [time-period] [format]
```

**Parameters:**
- `client-name` (required): The client name key from infra/stacks/numa-client-stack.ts:clientsProd, e.g. arcanum-demo
- `time-period` (optional): Time period to generate reports for (defaults to 'current-year')
  - `current-year` - Current year (default)
  - `previous-month` - Previous month
  - `YYYY` - Specific year (e.g., 2024)
  - `YYYY-MM` - Specific month (e.g., 2024-03)
- `format` (optional): Output format - 'csv' (default) or 'json'

**Examples:**
```bash
# Generate CSV reports for current year (default)
yarn generate-usage-report arcanum-demo

# Generate reports for previous month
yarn generate-usage-report arcanum-demo previous-month

# Generate reports for specific year
yarn generate-usage-report arcanum-demo 2024

# Generate reports for specific month
yarn generate-usage-report arcanum-demo 2024-03

# Generate JSON format report for previous month
yarn generate-usage-report arcanum-demo previous-month json
```

#### Output Files

**CSV Format (default):**
- `{client}-app-runs-{period}-{timestamp}.csv` - Detailed app run records
- `{client}-chat-messages-{period}-{timestamp}.csv` - Detailed chat message records
- `{client}-usage-summary-{period}-{timestamp}.csv` - Aggregated monthly usage summary

**JSON Format:**
- `{client}-usage-report-{period}-{timestamp}.json` - Complete report with metadata and all data
