# Numa Management System

Internal Q management system built with React + Vite.

## Usage

The site takes your credentials file from /aws/credentials and uses it to fetch data from Q Business and Cognito.

Your default AWS profile must be access keys for the Arcanum root AWS account. We use the SDK to assume a role into the Customer Account via the Prod Deployer account and the trust relationship defined in the Customer Account.

Once authenticated, you will be able to see Data Sources and the Cognito Users in the pool. To interact with the Q Apps, you will need the service accounts password that is in each Q Workspace.

## Features

### Data Sources

Allows quick insight into the data sources that are deployed, the last time they ran, the status of the most recent run, the ability to re-run the sync and view the data source configuration.

### Q Apps

Allows quick insight into the Q Apps that are deployed into the library, the ability to create new Q Apps in the library, and the ability to import/export Q Apps from/to a JSON file.

### Cognito Users

Allows quick insight into the Cognito users in the pool, and their login history. TODO: Add the ability to manage Cognito users, with features like reset passwords, reset MFA, and disable users.

## Setup

1. Install dependencies:

```bash
yarn install
```

2. Run dev server:

```bash
yarn run dev
```

## Tech Stack

- React
- Vite
- Bootstrap 5
- SCSS
