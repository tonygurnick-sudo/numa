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

- **Deal stages depend on pipeline:** Use `configure_props` to resolve `dealstage` values, and make sure to include the selected pipeline in `configured_props`:
  ```python
  # First, get pipelines
  configure_props(action_key="hubspot-create-deal", prop_name="pipeline",
    configured_props='{"hubspot":{"authProvisionId":"auto"}}')

  # Then, get stages for that pipeline
  configure_props(action_key="hubspot-create-deal", prop_name="dealstage",
    configured_props='{"hubspot":{"authProvisionId":"auto"},"pipeline":"default"}')
  ```

- **Association types are numeric:** When creating associations between objects, `associationType` values are integers (e.g., `1` for "Primary", `279` for "contact_to_company"), not strings. Use `configure_props` to discover valid association types for each object pair.

- **Property groups provide additional fields:** Actions like `hubspot-create-company` have a `propertyGroups` dynamic prop that reveals additional property categories you can work with (e.g., "Company information", "Social media information", "Buyer Intent"). Use `configure_props` to see available groups.

- **Create-or-update contact action:** The `hubspot-create-or-update-contact` action requires an `email` parameter at the top level (not inside `objectProperties`) and will create a new contact if no match is found, or update an existing contact with that email.

- **Auth key is `hubspot` in camelCase:** Unlike some integrations that use generic keys like `app`, HubSpot uses `hubspot` as the auth object key in all prop structures.
