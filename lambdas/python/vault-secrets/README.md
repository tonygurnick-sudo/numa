# Numa Consolidated Vault - Developer Guide

## Overview

The Numa Vault provides secure, consolidated secret storage with a simple Python API. Secrets are stored in AWS Secrets Manager with automatic compression and audit logging.

## Quick Start - Python Functions

### Basic Operations

```python
# Import the vault functions
from consolidated_storage import (
    get_vault_secret,        # Get a specific secret with values
    list_vault_secrets,      # List secret metadata (no values)
    add_secret_to_vault,     # Create or update a secret
    remove_secret_from_vault # Delete a secret
)

def lambda_handler(event, context):
    user_id = event['user_sub']  # From Cognito JWT

    # List all secrets for a user (metadata only, safe for logs)
    secrets = list_vault_secrets(user_id)
    print(f"User has {len(secrets)} secrets")

    # Get a specific secret with sensitive values (audited)
    gmail_creds = get_vault_secret(user_id, 'gmail-oauth')
    if gmail_creds:
        access_token = gmail_creds['fields']['access_token']
        refresh_token = gmail_creds['fields']['refresh_token']
        # Use tokens for API calls...

    # Create a new secret
    api_key_data = {
        'display_name': 'Slack Bot API Key',
        'type': 'api_key',
        'category': 'API Keys',
        'fields': {
            'api_key': 'xoxb-1234567890',
            'bot_name': 'numa-assistant'
        }
    }
    add_secret_to_vault(user_id, 'slack-bot-key', api_key_data)

    # Delete a secret
    remove_secret_from_vault(user_id, 'old-api-key')
```

### Template Operations

```python
# Import template functions
from consolidated_storage import (
    get_available_templates,     # List all templates
    create_secret_from_template, # Create secret using template
    validate_against_template    # Validate data against template
)

# List available templates
templates = get_available_templates()
# Returns: ['googledrive-oauth', 'gmail-oauth', 'api-key', 'database-connection']

# Create OAuth secret using template (validates required fields)
oauth_data = {
    'access_token': 'ya29.a0AeG...',
    'refresh_token': '1//0GZ...',
    'user_email': 'user@gmail.com',
    'expires_at': '2024-12-31T23:59:59Z'
}
secret = create_secret_from_template('googledrive-oauth', oauth_data)
add_secret_to_vault(user_id, 'personal-gdrive', secret)

# Validate data before creating
is_valid, errors = validate_against_template('gmail-oauth', oauth_data)
if not is_valid:
    print(f"Validation errors: {errors}")
```

## REST API Endpoints

The vault also provides REST API access (requires Cognito authentication):

```
GET    /vault/secrets           -> List user secrets (metadata only)
GET    /vault/secrets/{name}    -> Get secret with values
POST   /vault/secrets           -> Create new secret
PUT    /vault/secrets/{name}    -> Update existing secret
DELETE /vault/secrets/{name}    -> Delete secret
POST   /vault/secrets/bulk      -> Batch operations
GET    /vault/templates         -> List available templates
```

## Common Use Cases

### 1. Store API Keys

```python
def store_service_api_key(user_id: str, service_name: str, api_key: str):
    """Store an API key for external service integration"""
    secret_data = {
        'display_name': f'{service_name} API Key',
        'type': 'api_key',
        'category': 'API Keys',
        'fields': {
            'api_key': api_key,
            'service': service_name,
            'created_date': datetime.utcnow().isoformat()
        }
    }
    return add_secret_to_vault(user_id, f'{service_name.lower()}-api', secret_data)

# Usage
store_service_api_key('user-123', 'OpenAI', 'sk-proj-...')
```

### 2. OAuth Token Management

```python
def store_oauth_tokens(user_id: str, provider: str, oauth_response: dict):
    """Store OAuth tokens using provider template"""
    template_name = f'{provider}-oauth'

    # Use template for validation and structure
    oauth_data = {
        'access_token': oauth_response['access_token'],
        'refresh_token': oauth_response['refresh_token'],
        'user_email': oauth_response.get('email'),
        'expires_at': oauth_response.get('expires_in')
    }

    secret = create_secret_from_template(template_name, oauth_data)
    return add_secret_to_vault(user_id, f'{provider}-{user_id[:8]}', secret)
```

### 3. Database Credentials

```python
def store_database_config(user_id: str, db_name: str, connection_string: str):
    """Store database connection securely"""
    db_secret = create_secret_from_template('database-connection', {
        'connection_string': connection_string,
        'database_type': 'postgres',
        'database_name': db_name
    })
    return add_secret_to_vault(user_id, f'db-{db_name}', db_secret)
```

## Security Features

- **Audit Logging**: All secret access is automatically logged
- **User Isolation**: Users can only access their own secrets
- **Automatic Compression**: Large secrets are compressed automatically
- **Template Validation**: Optional structured validation for common patterns
- **Metadata-Only Listing**: `list_vault_secrets()` never returns sensitive values

## Available Templates

The system includes these built-in templates:

- **`googledrive-oauth`**: Google Drive OAuth tokens
- **`gmail-oauth`**: Gmail OAuth tokens
- **`api-key`**: Generic API key storage
- **`database-connection`**: Database connection strings

## Environment Variables

Functions automatically use `CLIENT_NAME` environment variable. In Lambda contexts, this is set automatically.

## Error Handling

All functions include proper error handling:

```python
try:
    secret = get_vault_secret(user_id, 'nonexistent-secret')
    if secret is None:
        print("Secret not found")
except Exception as e:
    print(f"Vault error: {e}")
    # Check CloudWatch logs for detailed error info
```

## MCP Tools (Workspace Agent Integration)

The vault integrates with the workspace agent through MCP tools:

- `list_vault_secrets` - Discover available secrets
- `request_vault_secret` - Request secret access (with approval)
- `create_oauth_connector` - Set up OAuth integrations
- `create_custom_secret` - Store custom configurations

## Function Reference

### Core Functions

- `get_consolidated_vault(user_id, client_name=None)` - Get entire user vault
- `get_vault_secret(user_id, secret_name, client_name=None)` - Get single secret
- `list_vault_secrets(user_id, client_name=None)` - List secret metadata
- `add_secret_to_vault(user_id, secret_name, secret_data, template=None, client_name=None)` - Create/update
- `remove_secret_from_vault(user_id, secret_name, client_name=None)` - Delete
- `bulk_import_secrets(user_id, secrets_data, conflict_resolution, client_name=None)` - Batch ops

### Template Functions

- `get_available_templates(client_name=None)` - List templates
- `get_template(template_name, client_name=None)` - Get template definition
- `create_secret_from_template(template_name, user_values, client_name=None)` - Template-based creation
- `validate_against_template(template_name, secret_data, client_name=None)` - Validation
- `create_freeform_secret(secret_data)` - Create without template

All functions return appropriate data structures and handle errors gracefully.

## Advanced Usage

### Bulk Operations

```python
# Import multiple secrets at once
secrets_data = [
    {
        'name': 'github-api',
        'display_name': 'GitHub API Token',
        'type': 'api_key',
        'fields': {'api_key': 'ghp_...', 'username': 'developer'}
    },
    {
        'name': 'slack-webhook',
        'display_name': 'Slack Webhook URL',
        'type': 'webhook',
        'fields': {'url': 'https://hooks.slack.com/...', 'channel': '#alerts'}
    }
]

results = bulk_import_secrets(user_id, secrets_data, conflict_resolution='skip')
print(f"Imported {len(results['success'])} secrets")
```

### Custom Secret Structure

```python
# Store complex configuration as a secret
config_secret = {
    'display_name': 'Application Configuration',
    'type': 'config',
    'category': 'Application Settings',
    'fields': {
        'database': {
            'host': 'localhost',
            'port': 5432,
            'ssl': True
        },
        'external_apis': {
            'payment_gateway': 'https://api.stripe.com',
            'email_service': 'https://api.sendgrid.com'
        },
        'feature_flags': {
            'new_checkout': True,
            'beta_dashboard': False
        }
    }
}

add_secret_to_vault(user_id, 'app-config', config_secret)
```

### Working with Large Secrets

```python
# Large secrets are automatically compressed
large_certificate = {
    'display_name': 'SSL Certificate Bundle',
    'type': 'certificate',
    'category': 'Security',
    'fields': {
        'certificate': '-----BEGIN CERTIFICATE-----\n' + very_long_cert_data,
        'private_key': '-----BEGIN PRIVATE KEY-----\n' + very_long_key_data,
        'ca_bundle': '-----BEGIN CERTIFICATE-----\n' + ca_cert_data,
        'metadata': {
            'expires': '2025-12-31',
            'issuer': 'Let\'s Encrypt',
            'domains': ['example.com', 'www.example.com']
        }
    }
}

# Automatically compressed and stored
add_secret_to_vault(user_id, 'ssl-cert', large_certificate)
```

## Integration Examples

### Using with External APIs

```python
def make_authenticated_api_call(user_id: str, api_name: str, endpoint: str):
    """Make API call using stored credentials"""
    # Get API credentials from vault
    creds = get_vault_secret(user_id, f'{api_name}-api')
    if not creds:
        raise ValueError(f"No credentials found for {api_name}")

    api_key = creds['fields']['api_key']
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }

    # Make the API call
    response = requests.get(endpoint, headers=headers)
    return response.json()

# Usage
data = make_authenticated_api_call('user-123', 'openai', 'https://api.openai.com/v1/models')
```

### OAuth Token Refresh

```python
def refresh_oauth_token(user_id: str, provider: str):
    """Refresh OAuth token and update vault"""
    # Get current OAuth credentials
    oauth_secret = get_vault_secret(user_id, f'{provider}-oauth')
    if not oauth_secret:
        raise ValueError(f"No OAuth credentials for {provider}")

    refresh_token = oauth_secret['fields']['refresh_token']

    # Refresh the token (example for Google)
    refresh_response = requests.post('https://oauth2.googleapis.com/token', {
        'client_id': os.environ['GOOGLE_CLIENT_ID'],
        'client_secret': os.environ['GOOGLE_CLIENT_SECRET'],
        'refresh_token': refresh_token,
        'grant_type': 'refresh_token'
    })

    if refresh_response.status_code == 200:
        new_tokens = refresh_response.json()

        # Update the secret with new tokens
        oauth_secret['fields']['access_token'] = new_tokens['access_token']
        if 'refresh_token' in new_tokens:
            oauth_secret['fields']['refresh_token'] = new_tokens['refresh_token']

        # Save back to vault
        add_secret_to_vault(user_id, f'{provider}-oauth', oauth_secret)
        return new_tokens['access_token']

    raise ValueError("Failed to refresh OAuth token")
```

## Troubleshooting

### Common Issues

1. **Import Error**: Make sure you're importing from the correct module

   ```python
   # Correct
   from consolidated_storage import get_vault_secret

   # Incorrect
   from vault_secrets import get_vault_secret
   ```

2. **Client Name Missing**: The `CLIENT_NAME` environment variable must be set

   ```python
   import os
   print(f"CLIENT_NAME: {os.environ.get('CLIENT_NAME', 'NOT SET')}")
   ```

3. **User ID Format**: User IDs should be the Cognito `sub` field

   ```python
   # Correct format (UUID)
   user_id = "12345678-1234-1234-1234-123456789012"

   # Incorrect
   user_id = "username" or "email@domain.com"
   ```

4. **Secret Not Found**: Check the exact secret name
   ```python
   # List all secrets to see what's available
   secrets = list_vault_secrets(user_id)
   print("Available secrets:", [s['name'] for s in secrets])
   ```

### Logging and Debugging

All vault operations are logged to CloudWatch. Look for log entries with:

- Operation type (e.g., "get_secret", "add_secret")
- User ID (truncated for privacy)
- Secret name
- Success/failure status

Example log search in CloudWatch:

```
fields @timestamp, @message
| filter @message like /vault secret access/
| sort @timestamp desc
```

## Performance Considerations

- **Metadata Listing**: Use `list_vault_secrets()` for UI displays - it's fast and secure
- **Caching**: Consider caching frequently accessed secrets in memory (with TTL)
- **Compression**: Large secrets are automatically compressed - no action needed
- **Batch Operations**: Use `bulk_import_secrets()` for multiple secrets to reduce API calls

## Security Best Practices

1. **Never log secret values** - Use metadata-only functions for debugging
2. **Use templates** for structured data - provides validation and consistency
3. **Regular rotation** - Update long-lived secrets periodically
4. **Principle of least privilege** - Only request secrets you actually need
5. **Audit trail** - All secret access is logged automatically

## Migration from Legacy Systems

### From Environment Variables

```python
def migrate_env_to_vault(user_id: str, env_mappings: dict):
    """Migrate environment variables to vault"""
    for env_var, secret_name in env_mappings.items():
        value = os.environ.get(env_var)
        if value:
            secret_data = {
                'display_name': f'Migrated {env_var}',
                'type': 'legacy_env',
                'category': 'Migrated',
                'fields': {'value': value, 'original_env_var': env_var}
            }
            add_secret_to_vault(user_id, secret_name, secret_data)
            print(f"Migrated {env_var} -> {secret_name}")

# Usage
migrate_env_to_vault('user-123', {
    'OPENAI_API_KEY': 'openai-api',
    'SLACK_BOT_TOKEN': 'slack-bot',
    'DATABASE_URL': 'database-connection'
})
```

### From Configuration Files

```python
import json

def migrate_config_file_to_vault(user_id: str, config_file_path: str):
    """Migrate JSON config file to vault secrets"""
    with open(config_file_path, 'r') as f:
        config = json.load(f)

    for key, value in config.items():
        if isinstance(value, dict) and 'secret' in str(value).lower():
            secret_data = {
                'display_name': f'Config: {key}',
                'type': 'config',
                'category': 'Application Config',
                'fields': value
            }
            add_secret_to_vault(user_id, f'config-{key.lower()}', secret_data)
```

This comprehensive guide provides everything developers need to leverage the Numa Vault system effectively. All functions are production-ready and include proper error handling, logging, and security features.
