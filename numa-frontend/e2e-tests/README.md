# Playwright E2E Tests Quickstart

## Setup Environment

1. Create `.env` file in frontend root (`/numa-frontend/.env`)
2. Add test credentials:
   ```
   TEST_USERNAME=your_test_username
   TEST_PASSWORD=your_test_password
   ```

## Run Tests

### Run tests without UI

`yarn run test:e2e {Stack Name}`
`yarn run test:e2e arcanum-demo`

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
