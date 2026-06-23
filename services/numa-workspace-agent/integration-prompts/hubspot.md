# HubSpot Integration Tips

All HubSpot calls go through the `numa integrations` CLI. Action keys below are
real (`numa integrations pipedream-actions hubspot` lists them). The auth prop is
always required — pass `"hubspot": {"authProvisionId": "auto"}` and the proxy
resolves the user's connected account.

Before performing HubSpot operations, establish context:

1. Use `numa integrations pipedream-props-options` to resolve dynamic values like pipelines, deal stages, and association types
2. For deals, resolve `pipeline` first, then use it to resolve `dealstage` (stages depend on pipeline)
3. For associations, resolve `fromObjectType` → `toObjectType` → `associationType` in sequence

## Key Tips

- **Get/Update actions use `objectId` parameter:** Despite the action names suggesting object-specific parameters (like `hubspot-get-company` or `hubspot-update-contact`), these actions all use `objectId` as the parameter name, NOT `companyId`, `contactId`, or `dealId`:

  ```bash
  numa integrations pipedream-call hubspot hubspot-get-company \
    --props '{"hubspot":{"authProvisionId":"auto"},"objectId":"23592296209"}' \
    -m "Fetching company from HubSpot"
  ```

- **Create/update CRM objects use `objectProperties`:** When creating or updating contacts, companies, and deals, properties must be nested inside an `objectProperties` object:

  ```bash
  numa integrations pipedream-call hubspot hubspot-create-company \
    --props '{"hubspot":{"authProvisionId":"auto"},"objectProperties":{"name":"Acme Corp","domain":"acme.com","city":"Auckland"}}' \
    -m "Creating company in HubSpot"
  ```

- **Creating notes — use `hubspot-create-engagement` or a raw request, NOT `hubspot-create-note`:** The `hubspot-create-note` action is broken (missing `objectProperties` parameter). Two working alternatives:

  **Option 1: `hubspot-create-engagement` (recommended for associations):**

  ```bash
  numa integrations pipedream-call hubspot hubspot-create-engagement \
    --props '{"hubspot":{"authProvisionId":"auto"},"engagementType":"notes","objectProperties":{"hs_timestamp":"1770603900000","hs_note_body":"Your note content here"}}' \
    -m "Creating note in HubSpot"
  ```

  With associations:

  ```bash
  numa integrations pipedream-call hubspot hubspot-create-engagement \
    --props '{"hubspot":{"authProvisionId":"auto"},"engagementType":"notes","toObjectType":"company","toObjectId":"2024900668","associationType":190,"objectProperties":{"hs_timestamp":"1770603900000","hs_note_body":"Note content"}}' \
    -m "Creating note associated with company"
  ```

  **Option 2: raw request (simpler for standalone notes):**

  ```bash
  numa integrations request hubspot POST https://api.hubapi.com/crm/v3/objects/notes \
    --body '{"properties":{"hs_timestamp":"1770603900000","hs_note_body":"Note content"}}' \
    -m "Creating standalone note in HubSpot"
  ```

- **`hs_timestamp` is required for engagements:** Despite HubSpot docs saying it's optional, omitting `hs_timestamp` returns a 400 error. Always include it as Unix timestamp in milliseconds.

- **Engagement associations require BOTH `toObjectId` AND `associationType`:** If you provide one, you must provide both, or you'll get: "Both toObjectId and associationType must be entered". Use `numa integrations pipedream-props-options` to resolve valid association types.

- **Deal stages depend on pipeline:** Use `pipedream-props-options` to resolve `dealstage` values, and include the selected pipeline in the auth/props payload:

  ```bash
  # First, get pipelines
  numa integrations pipedream-props-options hubspot hubspot-create-deal pipeline \
    --hubspot '{"authProvisionId":"auto"}' -m "Resolving HubSpot pipelines"

  # Then, get stages for that pipeline
  numa integrations pipedream-props-options hubspot hubspot-create-deal dealstage \
    --hubspot '{"authProvisionId":"auto"}' --props '{"pipeline":"default"}' -m "Resolving deal stages"
  ```

- **Association types are numeric:** When creating associations, `associationType` values are integers (e.g., `5` for "Primary", `190` for "notes_to_company", `341` for "deal_to_company"). Use `numa integrations pipedream-props-options` to discover valid types for each object pair.

- **`hubspot-search-crm` has dynamic prop issues:** The action may fail with "Property undefined is not a searchable property". For reliable searches, use a raw request to the direct API:

  ```bash
  numa integrations request hubspot POST https://api.hubapi.com/crm/v3/objects/companies/search \
    --body '{"filterGroups":[{"filters":[{"propertyName":"name","operator":"CONTAINS_TOKEN","value":"search term"}]}],"limit":10}' \
    -m "Searching companies in HubSpot"
  ```

- **Create-or-update contact action:** The `hubspot-create-or-update-contact` action requires an `email` parameter at the top level (not inside `objectProperties`) and will create a new contact if no match is found, or update an existing contact with that email.

- **Batch actions use arrays of JSON strings:** Batch actions (`batch-create-companies`, `batch-create-or-update-contact`, etc.) expect the `inputs` or `contacts` parameter to be an array of JSON strings, not objects:

  ```bash
  numa integrations pipedream-call hubspot hubspot-batch-create-companies \
    --props '{"hubspot":{"authProvisionId":"auto"},"inputs":["{\"properties\":{\"name\":\"Company A\"}}","{\"properties\":{\"name\":\"Company B\"}}"]}' \
    -m "Batch-creating companies in HubSpot"
  ```

  Note: `batch-create-or-update-contact` uses flat properties (not nested in `properties`):

  ```bash
  numa integrations pipedream-call hubspot hubspot-batch-create-or-update-contact \
    --props '{"hubspot":{"authProvisionId":"auto"},"contacts":["{\"email\":\"a@example.com\",\"firstname\":\"Alice\"}","{\"email\":\"b@example.com\",\"firstname\":\"Bob\"}"]}' \
    -m "Batch-creating/updating contacts in HubSpot"
  ```

- **Deleting/archiving records — use batch archive endpoint:** DELETE requests return 500 errors. Use the batch archive endpoint instead:

  ```bash
  numa integrations request hubspot POST https://api.hubapi.com/crm/v3/objects/companies/batch/archive \
    --body '{"inputs":[{"id":"123"},{"id":"456"}]}' \
    -m "Archiving HubSpot records"
  ```

  Works for: companies, contacts, deals, tickets, notes, meetings, tasks, communications, etc. (swap `companies` in the URL for the target object type).

- **Auth key is `hubspot` in camelCase:** Unlike some integrations that use generic keys like `app`, HubSpot uses `hubspot` as the auth object key in all prop structures.
