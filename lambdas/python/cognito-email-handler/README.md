# AWS Lambda Function: Custom Cognito Emails

This Lambda function customizes AWS Cognito emails, providing different templates for password reset and account creation scenarios.

## Description

When a user needs to reset their password or create a new password for the first time, this Lambda function intercepts the default Cognito email and replaces it with a customized HTML email that provides a better user experience.

## Customization Scenarios

The Lambda function handles two scenarios:

1. **Password Reset**: When an existing user requests a password reset
2. **Account Creation**: When a new user needs to set up their password for the first time

## How It Works

1. The Lambda function is triggered by the Cognito `CustomMessage_ForgotPassword` event
2. It checks the `clientMetadata.mode` parameter to determine the scenario:
   - `mode=reset` (default): For password reset
   - `mode=create`: For new user account creation
3. It applies the appropriate HTML template
4. It returns the modified event with a custom email subject and message

## Input

The Lambda function is triggered by Cognito and receives an event with the following structure:

```json
{
  "triggerSource": "CustomMessage_ForgotPassword",
  "request": {
    "codeParameter": "{####}",
    "userAttributes": {
      "email": "user@example.com"
    },
    "clientMetadata": {
      "mode": "reset|create"
    }
  },
  "response": {
    "emailSubject": "",
    "emailMessage": ""
  }
}
```

## Environment Variables

- `DEFAULT_DOMAIN`: The default domain to use in email links (default is determined by Cognito configuration)

## Usage from Frontend

When calling the requestPasswordReset function from the frontend, include the mode parameter:

```javascript
// For password reset
await requestPasswordReset(email, 'reset');

// For new account creation
await requestPasswordReset(email, 'create');
```

## Deployment

This Lambda function needs to be registered as a "Custom Message" trigger for your Cognito User Pool.

## HTML Email Templates

The Lambda includes beautifully styled HTML email templates with:

- Responsive design for mobile and desktop
- Clear visual hierarchy with color highlighting
- Highlighted verification code for better visibility
- Step-by-step instructions for users
- Proper branding with Numa purple accents
