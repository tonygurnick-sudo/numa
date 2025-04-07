# Numa onboarding tools

This directory contains several tools for assisting in onboarding customers to Numa.

- create-users: This tool creates users based on an input.csv file, activates their Q licence using Playwright and outputs a user-details.csv file.
- upload-files: This tool uploads files to a customer's Q S3 data bucket and triggers a reindex.
- check-index-progress: This tool looks up the status of an S3 data bucket index and prints it.

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
