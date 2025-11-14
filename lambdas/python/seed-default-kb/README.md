# Seed Default KB Lambda

## Purpose

This Lambda function creates the default "company" knowledge base on stack deployment.

## Behavior

- Creates a KB record with `kb_id: "company"` (not a UUID)
- Sets `viewers: ["*"]` to allow all users to access the default KB
- Uses `s3_prefix: "documents/company/"` for file organization
- Idempotent: Checks if KB exists before creating
- Invoked once via Terraform `LambdaInvocation` resource

## Environment Variables

- `CLIENT_NAME`: The tenant/client identifier (e.g., "arcanum")

## Returns

- 200: Success (KB created or already exists)
- 500: Error during KB creation
