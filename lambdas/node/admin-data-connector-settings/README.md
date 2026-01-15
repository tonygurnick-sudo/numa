## Admin Integration Settings Lambda

This AWS Lambda function provides an API for managing integration settings for different clients. It allows for the retrieval and updating of integration settings in a DynamoDB table.

### Endpoints

- `GET /settings/integrations`: Retrieve all integration settings.
- `PUT /settings/integrations/{integration}`: Update integration settings for a specific integration.

### Authentication

This API requires authentication via AWS Cognito. Only users in the `admin` group are allowed to update integration settings.

### DynamoDB Table

The integration settings are stored in a DynamoDB table. The table name is specified in the `GLOBAL_TABLE_NAME` environment variable.

### Error Handling

Errors are returned with appropriate HTTP status codes and error messages.
