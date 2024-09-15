# Amazon Q Apps Deployer

This project is a Streamlit-based interface for managing and deploying Q Apps in an Amazon Q Business environment. It handles secret loading, OAuth2 token retrieval, and Q App creation.

## Installation

1. Install dependencies using Poetry:

    poetry install

2. Run the Streamlit app using Poetry:

    streamlit run app.py

3. The deployer is accessible at

    http://localhost:8501/

## Secrets Format

Secrets are stored in AWS Secrets Manager and follow the structure below for context selection:

```json
{
  "account1": {
    "username": "your-username",
    "password": "your-password",
    "iam_role": "arn:aws:iam::123456789012:role/YourRole",
    "idc_application_id": "idc-app-id",
    "q_app_id": "q-app-id",
    "cognito_domain": "your-cognito-domain",
    "client_id": "your-client-id"
  },
  "account2": {
    "username": "another-username",
    "password": "another-password",
    ...
  }
}
```

Each account can be selected for authentication and context-specific operations like Q App creation or listing library items.

## Running the Application

- Load your secret credentials from AWS Secrets Manager.
- Select an account to authenticate.
- OAuth2 tokens will be retrieved, and the app will allow you to create and list Q Apps.
