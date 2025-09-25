# Numa Customer Success Portal

A React-based customer success portal for managing client configurations, viewing deployment status, and monitoring ECR container images within the Numa AI platform.

## Architecture

Built with React 19, TypeScript, and Bootstrap 5, this portal provides authenticated access to:
- Client configuration management via DynamoDB
- ECR image browsing and deployment monitoring
- Real-time deployment status tracking
- Cognito-based authentication

## Prerequisites

### ECR Access Policy
The following resource policy must be added to the `arcanum-prod-images` account to enable ECR image access:

```json
{
  "Statement": [
    {
      "Action": [
        "ecr:DescribeImages",
        "ecr:ListImages"
      ],
      "Principal": {
        "AWS": [
          "arn:aws:iam::207567759910:role/customer-success-portal-authenticated-role"
        ]
      },
      "Effect": "Allow",
      "Sid": "AllowPortalRead"
    }
  ],
  "Version": "2008-10-17"
}
```

## Development

### Setup
```bash
yarn install
```

### Development Server
```bash
yarn dev
```
Starts the development server with hot reload on `http://localhost:5173`

### Build
```bash
yarn build
```
Creates production build in `dist/` directory

### Testing
```bash
yarn test
```
Runs tests with coverage reporting

### Linting
```bash
yarn lint
```

## Project Structure

```
src/
├── components/     # Reusable UI components
├── contexts/       # React context providers
├── pages/          # Page-level components
├── services/       # API and AWS service integrations
├── styles/         # Custom CSS and theming
└── types/          # TypeScript type definitions
```

## Key Features

- **Authentication**: Cognito integration with role-based access
- **ECR Browser**: View and manage container images across accounts
- **Config Management**: CRUD operations for client configurations
- **Deployment Tracking**: Monitor deployment status and history
- **Responsive Design**: Bootstrap-based responsive interface

## AWS Dependencies

- **Cognito**: User authentication and authorization
- **DynamoDB**: Client configuration storage
- **ECR**: Container image registry access
- **STS**: Cross-account role assumption
