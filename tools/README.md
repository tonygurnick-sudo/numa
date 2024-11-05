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

The user-pool-id and web-experience-url can be retrieved from the output of the `cdktf deploy` for setting up the account. If these weren't recorded, they can be retrieved by running `yarn cdktf output numa-customer-name` in the infra directory.

Run the script in dry-run mode to ensure that the input is correct:

<pre>
AWS_PROFILE=arcanum-q-deployer-prod yarn create-users <b>account-id</b> <b>user-pool-id</b> <b>web-experience-url</b>
</pre>

This will print out the users to be added.

Then, to run it in "live" mode and actually do things:

<pre>
AWS_PROFILE=arcanum-q-deployer-prod yarn create-users <b>account-id</b> <b>user-pool-id</b> <b>web-experience-url</b> live
</pre>

This will take a while (potentially around 10 minutes) to run.

Note: If there are some failures to activate users, the script may hang after printing "Done.", it is safe to terminate at this point.

The created users and their temporary passwords will be written to user-details.csv.

### upload-files

upload-files requires a flat zip file of the files to be indexed. If the files are being delivered through Jira, this can be created using the "Download all" menu item.

The script will need to be run with a profile providing access to the arcanum-q-deployer-prod account. From there it will assume access into the customer's account.

<pre>
AWS_PROFILE=arcanum-q-deployer-prod yarn upload-files <b>filename.zip</b> <b>account-id<b>
</pre>

Once the upload completes, the data source sync will be started and its excution ID printed.

### check-index-progress

check-index-progress is for checking the status of an S3 data source sync job. At the moment, it is limited to showing the most recent one.

The script will need to be run with a profile providing access to the arcanum-q-deployer-prod account. From there it will assume access into the customer's account.

<pre>
AWS_PROFILE=arcanum-q-deployer-prod yarn check-index-progoress <b>account-id<b>
</pre>
