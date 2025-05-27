# Send Email Lambda

This Lambda function provides a reusable email sending service using Amazon SES (Simple Email Service). It's designed to be a generic component that can be used across different Numa applications.

## Overview

The Lambda serves as a centralized email sending service with capabilities including:

1. Sending simple text and HTML emails
2. Supporting multiple recipients (To, CC, BCC)
3. Adding reply-to addresses
4. Including S3-stored attachments or direct content attachments
5. Configuring SES settings
6. Loading email configuration from S3
7. Comprehensive error handling and logging

## Configuration

The Lambda accepts the following environment variables:

- `SES_CONFIGURATION_SET` (optional): Default SES configuration set to use when not specified in the request

## Input Parameters

The Lambda accepts three formats of events:

### Simple Email Format

```json
{
    "to": ["recipient@example.com"],
    "subject": "Email Subject",
    "body_html": "<p>HTML body</p>",
    "body_text": "Plain text body",
    "from": "sender@example.com",  // Required
    "cc": ["cc@example.com"],  // Optional
    "bcc": ["bcc@example.com"],  // Optional
    "reply_to": ["reply@example.com"],  // Optional
    "configuration_set": "ses-config-set"  // Optional, falls back to SES_CONFIGURATION_SET
}
```

### Email with Attachments Format

#### S3-stored Attachments

```json
{
    "to": ["recipient@example.com"],
    "subject": "Email Subject",
    "body_html": "<p>HTML body</p>",
    "body_text": "Plain text body",
    "from": "sender@example.com",  // Required
    "cc": ["cc@example.com"],  // Optional
    "bcc": ["bcc@example.com"],  // Optional
    "reply_to": ["reply@example.com"],  // Optional
    "configuration_set": "ses-config-set",  // Optional
    "attachments": [
        {
            "bucket": "my-bucket",
            "key": "path/to/attachment.pdf",
            "filename": "report.pdf"  // Optional, defaults to the file name in the key
        }
    ]
}
```

#### Direct Content Attachments

```json
{
    "to": ["recipient@example.com"],
    "subject": "Email Subject",
    "body_html": "<p>HTML body</p>",
    "body_text": "Plain text body",
    "from": "sender@example.com",  // Required
    "attachments": [
        {
            "content": "Base64 encoded or string content",
            "filename": "document.txt",
            "content_type": "text/plain"  // Optional, defaults to "application/octet-stream"
        }
    ]
}
```

### Email with S3 Key Reference

```json
{
    "email_data_s3_key": "path/to/email/data.json"  // S3 key containing complete email configuration
}
```

With this format, the Lambda will load the full email configuration from the specified S3 object, which should contain a JSON document matching one of the other formats.

## Output Format

The Lambda returns a response with the following structure:

```json
{
  "statusCode": 200,
  "body": {
    "status": "sent",
    "messageId": "01020123abc123-def456-...",
    "recipients": {
      "to": ["recipient@example.com"],
      "cc": ["cc@example.com"],
      "bcc": ["bcc@example.com"]
    }
  }
}
```

Or in case of an error:

```json
{
  "statusCode": 400,
  "body": {
    "status": "error",
    "error": "Error message"
  }
}
```

## Required Permissions

The Lambda requires the following IAM permissions:

- `ses:SendEmail` - For sending simple emails
- `ses:SendRawEmail` - For sending emails with attachments
- `s3:GetObject` - For accessing S3 attachments or S3-stored email configurations

## Dependencies

This Lambda depends on the following packages:

- AWS Lambda Powertools
- Internal helpers library
- Internal s3_helpers library


## Integration Examples

### Invoking from another Lambda

```python
import boto3
import json

def send_notification_email(to_address, subject, html_content, from_address):
    lambda_client = boto3.client('lambda')

    email_payload = {
        "to": [to_address],
        "subject": subject,
        "body_html": html_content,
        "from": from_address
    }

    response = lambda_client.invoke(
        FunctionName='send-email',
        InvocationType='RequestResponse',
        Payload=json.dumps(email_payload)
    )

    return json.loads(response['Payload'].read().decode('utf-8'))
```

### Loading Email Configuration from S3

```python
import boto3
import json

def trigger_email_from_s3_config(s3_key):
    lambda_client = boto3.client('lambda')

    email_payload = {
        "email_data_s3_key": s3_key
    }

    response = lambda_client.invoke(
        FunctionName='send-email',
        InvocationType='RequestResponse',
        Payload=json.dumps(email_payload)
    )

    return json.loads(response['Payload'].read().decode('utf-8'))
```

### Sending from a Step Function

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::lambda:invoke",
  "Parameters": {
    "FunctionName": "send-email",
    "Payload": {
      "to": ["recipient@example.com"],
      "subject": "Step Function Notification",
      "body_html": "<p>This email was sent from a Step Function workflow</p>",
      "from": "sender@example.com"
    }
  }
}
```

## Error Handling

The Lambda includes comprehensive error handling for common scenarios:

- Missing required parameters (recipient, sender, subject, body)
- SES service errors
- S3 access/permission errors when loading attachments
- Malformed email configuration

All errors are logged with structured logging via `structlog` and returned in a standardized format.

## Related Components

This Lambda is designed to be used by various applications, including:

1. `beyond-expectations-analyse-logs`: Sends analysis reports via email
2. Other applications that need email notification capabilities
