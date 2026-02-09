# HubSpot Integration Tips

Before performing HubSpot operations, establish context:
1. Use `configure_props` to resolve dynamic values like pipelines, deal stages, and association types
2. For deals, resolve `pipeline` first, then use it to resolve `dealstage` (stages depend on pipeline)
3. For associations, resolve `fromObjectType` → `toObjectType` → `associationType` in sequence

## Key Tips

- **Get/Update actions use `objectId` parameter:** Despite the action names suggesting object-specific parameters (like `hubspot-get-company` or `hubspot-update-contact`), these actions all use `objectId` as the parameter name, NOT `companyId`, `contactId`, or `dealId`:
  ```json
  {
    "hubspot": {"authProvisionId": "auto"},
    "objectId": "23592296209"
  }
  ```

- **Create/update CRM objects use `objectProperties`:** When creating or updating contacts, companies, and deals, properties must be nested inside an `objectProperties` object:
  ```json
  {
    "hubspot": {"authProvisionId": "auto"},
    "objectProperties": {
      "name": "Acme Corp",
      "domain": "acme.com",
      "city": "Auckland"
    }
  }
  ```

- **Creating notes — use `hubspot-create-engagement` or `proxy_request`, NOT `hubspot-create-note`:** The `hubspot-create-note` action is broken (missing `objectProperties` parameter). Two working alternatives:

  **Option 1: `hubspot-create-engagement` (recommended for associations):**
  ```json
  {
    "hubspot": {"authProvisionId": "auto"},
    "engagementType": "notes",
    "objectProperties": {
      "hs_timestamp": "1770603900000",
      "hs_note_body": "Your note content here"
    }
  }
  ```
  With associations:
  ```json
  {
    "hubspot": {"authProvisionId": "auto"},
    "engagementType": "notes",
    "toObjectType": "company",
    "toObjectId": "2024900668",
    "associationType": 190,
    "objectProperties": {
      "hs_timestamp": "1770603900000",
      "hs_note_body": "Note content"
    }
  }
  ```

  **Option 2: `proxy_request` (simpler for standalone notes):**
  ```
  POST https://api.hubapi.com/crm/v3/objects/notes
  Body: {
    "properties": {
      "hs_timestamp": "1770603900000",
      "hs_note_body": "Note content"
    }
  }
  ```

- **`hs_timestamp` is required for engagements:** Despite HubSpot docs saying it's optional, omitting `hs_timestamp` returns a 400 error. Always include it as Unix timestamp in milliseconds.

- **Engagement associations require BOTH `toObjectId` AND `associationType`:** If you provide one, you must provide both, or you'll get: "Both toObjectId and associationType must be entered". Use `configure_props` to resolve valid association types.

- **Deal stages depend on pipeline:** Use `configure_props` to resolve `dealstage` values, and include the selected pipeline in `configured_props`:
  ```python
  # First, get pipelines
  configure_props(action_key="hubspot-create-deal", prop_name="pipeline",
    configured_props='{"hubspot":{"authProvisionId":"auto"}}')

  # Then, get stages for that pipeline
  configure_props(action_key="hubspot-create-deal", prop_name="dealstage",
    configured_props='{"hubspot":{"authProvisionId":"auto"},"pipeline":"default"}')
  ```

- **Association types are numeric:** When creating associations, `associationType` values are integers (e.g., `5` for "Primary", `190` for "notes_to_company", `341` for "deal_to_company"). Use `configure_props` to discover valid types for each object pair.

- **`hubspot-search-crm` has dynamic prop issues:** The action may fail with "Property undefined is not a searchable property". For reliable searches, use `proxy_request` with the direct API:
  ```
  POST https://api.hubapi.com/crm/v3/objects/companies/search
  Body: {
    "filterGroups": [{
      "filters": [{
        "propertyName": "name",
        "operator": "CONTAINS_TOKEN",
        "value": "search term"
      }]
    }],
    "limit": 10
  }
  ```

- **Create-or-update contact action:** The `hubspot-create-or-update-contact` action requires an `email` parameter at the top level (not inside `objectProperties`) and will create a new contact if no match is found, or update an existing contact with that email.

- **Batch actions use arrays of JSON strings:** Batch actions (`batch-create-companies`, `batch-create-or-update-contact`, etc.) expect the `inputs` or `contacts` parameter to be an array of JSON strings, not objects:
  ```json
  {
    "hubspot": {"authProvisionId": "auto"},
    "inputs": [
      "{\"properties\":{\"name\":\"Company A\"}}",
      "{\"properties\":{\"name\":\"Company B\"}}"
    ]
  }
  ```
  Note: `batch-create-or-update-contact` uses flat properties (not nested in `properties`):
  ```json
  {
    "hubspot": {"authProvisionId": "auto"},
    "contacts": [
      "{\"email\":\"a@example.com\",\"firstname\":\"Alice\"}",
      "{\"email\":\"b@example.com\",\"firstname\":\"Bob\"}"
    ]
  }
  ```

- **Deleting/archiving records — use batch archive endpoint:** DELETE requests via `proxy_request` return 500 errors. Use the batch archive endpoint instead:
  ```
  POST https://api.hubapi.com/crm/v3/objects/{objectType}/batch/archive
  Body: {"inputs": [{"id": "123"}, {"id": "456"}]}
  ```
  Works for: companies, contacts, deals, tickets, notes, meetings, tasks, communications, etc.

- **Auth key is `hubspot` in camelCase:** Unlike some integrations that use generic keys like `app`, HubSpot uses `hubspot` as the auth object key in all prop structures.
