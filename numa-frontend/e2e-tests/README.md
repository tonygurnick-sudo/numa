# Playwright E2E Tests Quickstart

## Setup Environment

1. Create `.env` file in frontend root (`/numa-frontend/.env`)
2. Add test credentials:
   ```
   # Basic auth tests
   TEST_USERNAME=your_test_username
   TEST_PASSWORD=your_test_password

   # AWS access permission tests
   TEST_STANDARD_USERNAME=your_standard_test_user
   TEST_STANDARD_PASSWORD=your_standard_test_password
   TEST_ADMIN_USERNAME=your_admin_test_user
   TEST_ADMIN_PASSWORD=your_admin_test_password
   ```

## Test Suites

### Authentication Tests (`auth.spec.ts`)
Basic login/logout functionality tests using the standard test credentials.

### Apps Tests (`apps.spec.ts`)
Application-specific functionality tests.

### AWS Access Permission Tests (`aws-access.spec.ts`)
Comprehensive tests for AWS service access permissions based on user roles:
- **Standard User Tests**: Chat features, company data access, outputs bucket access
- **Admin User Tests**: User management, data modification, administrative features
- **Negative Access Tests**: Cross-user data access prevention, unauthorized operations

These tests verify that IAM policies and role-based access controls are working correctly across:
- S3 buckets (data, outputs, company)
- DynamoDB (chat history with row-level security)
- Amazon Q Business (search and data sources)
- Amazon Bedrock (knowledge base operations)
- Amazon Cognito (user management)

## Run Tests

### Run all tests without UI

`yarn run test:e2e {Stack Name}`
`yarn run test:e2e arcanum-demo`

### Run specific test file

`yarn run test:e2e {Stack Name} --grep "AWS Access"`
`yarn run test:e2e arcanum-demo --grep "Authentication"`

### Run tests with UI

`yarn run test:e2e:ui {Stack Name}`
`yarn run test:e2e:ui arcanum-demo`

### Important

Run from external terminal (host machine), not inside DevContainer

## Troubleshooting

If error mentions missing environment variables, verify:

- `.env` file exists in correct location which is `numa/numa-frontend`
- Variable names include `TEST_` prefix
- Credentials are valid
- For AWS tests: Ensure test users exist in Cognito with appropriate group memberships
- For AWS tests: Verify `public/config.json` contains all required AWS resource IDs

### AWS Test Requirements

The AWS access tests require:
1. Two test users in Cognito: one with 'standard' group, one with 'admin' group
2. Valid `config.json` with AWS resource identifiers
3. Properly configured IAM roles and policies
4. Test users should have permanent passwords (not temporary/requiring reset)
