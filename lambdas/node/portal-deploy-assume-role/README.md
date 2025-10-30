Assume Backend Role Lambda

Small Node.js Lambda that assumes a target IAM role (for Terraform S3/DynamoDB backend access) and returns temporary credentials to callers such as Step Functions.

Input (JSON)
- roleArn (optional) — if omitted, uses env BACKEND_ROLE_ARN
- sessionName (optional) — default: portal-deploy-backend
- durationSeconds (optional) — default: 3600

Output (JSON)
```
{
  "Credentials": {
    "AccessKeyId": "...",
    "SecretAccessKey": "...",
    "SessionToken": "...",
    "Expiration": "ISO8601"
  }
}
```

Build/package
- yarn bundle (from this folder) produces lambda_function.zip
