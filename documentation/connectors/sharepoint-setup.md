# SharePoint Q Business Connector Setup

Step-by-step guide for connecting a customer's SharePoint to their Numa Q Business knowledge base.

## Prerequisites

- Client must have `provisionQResources: true` and `preferredKnowledgeBase: "q"` in their `numa-client-config` DynamoDB entry
- Client must have a deployed Q Business application (check with `aws qbusiness list-applications`)
- Client must have a Microsoft 365 business SharePoint Online account (personal MSA accounts do not work)

## Step 1: Get credentials from the customer

Send the customer the setup instructions (see [Customer Instructions](#customer-instructions) below). You need 6 values back:

| Value                               | Source                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| Azure App Registration Client ID    | Azure Portal > App registrations > Overview               |
| Azure App Registration Secret Value | Azure Portal > Certificates & secrets (NOT the Secret ID) |
| SharePoint App-Only Client ID       | Generated at `appregnew.aspx`                             |
| SharePoint App-Only Secret          | Generated at `appregnew.aspx`                             |
| Tenant ID                           | Azure Portal > Overview > Directory (tenant) ID           |
| Site URL(s)                         | e.g. `https://contoso.sharepoint.com/sites/MySite`        |

## Step 2: Update DynamoDB config

Add `sharePointConfigs` to the client's entry in the `numa-client-config` table (deployer account):

```bash
AWS_PROFILE=arcanum-q-deployer-prod aws dynamodb update-item \
  --table-name numa-client-config \
  --key '{"clientName":{"S":"CLIENT_NAME"}}' \
  --update-expression "SET config.sharePointConfigs = :sp" \
  --expression-attribute-values '{
    ":sp": {
      "L": [
        {
          "M": {
            "tenantId": {"S": "TENANT_ID"},
            "domain": {"S": "DOMAIN.sharepoint.com"},
            "siteUrls": {"L": [{"S": "https://DOMAIN.sharepoint.com/sites/SITE_NAME"}]},
            "configuration": {"M": {}}
          }
        }
      ]
    }
  }' \
  --region us-east-1
```

### Optional: filter what gets indexed

Add regex patterns inside `configuration` to limit crawling to specific folders/files:

```json
"configuration": {
  "inclusionFilePath": ["^.*(?:FolderName).*$"],
  "inclusionFileTypePatterns": [".*\\.pdf", ".*\\.docx"],
  "exclusionFileNamePatterns": [".*draft.*"]
}
```

See `infra/constructs/data-sources/sharepoint-datasource-construct.ts` for all available filter options.

## Step 3: Deploy

Deploy the client's stack. This creates:

- A Q Business SHAREPOINTV2 data source
- A Secrets Manager secret (`QBusines-sharepoint-secret...`)

The secret ARN appears in the Terraform output.

## Step 4: Populate the secret

### 4a: Compute the siteUrlsHash

SHA-256 hash of all site URLs, comma-separated, no spaces:

```bash
echo -n "https://DOMAIN.sharepoint.com/sites/SITE_NAME" | shasum -a 256 | awk '{print $1}'
```

For multiple sites: `echo -n "https://site1.sharepoint.com/sites/A,https://site2.sharepoint.com/sites/B" | shasum -a 256`

### 4b: Find the secret ARN

Assume into the client account and find the secret:

```bash
aws secretsmanager list-secrets --filters Key=name,Values=QBusines-sharepoint
```

### 4c: Populate the secret

```bash
aws secretsmanager put-secret-value \
  --secret-id SECRET_ARN \
  --secret-string '{
    "adClientId": "AZURE_APP_CLIENT_ID",
    "adClientSecret": "AZURE_APP_SECRET_VALUE",
    "clientId": "SP_APP_ONLY_CLIENT_ID@TENANT_ID",
    "clientSecret": "SP_APP_ONLY_SECRET",
    "authType": "OAuth2App",
    "siteUrlsHash": "COMPUTED_HASH"
  }'
```

**Important:**

- `clientId` is a compound value: `{SharePointAppOnlyClientID}@{TenantID}`
- `clientSecret` is the SharePoint App-Only secret, NOT the Azure AD one
- `adClientSecret` is the Azure AD secret VALUE, not the secret ID
- `authType` is always `OAuth2App`

## Step 5: Trigger initial sync

```bash
aws qbusiness start-data-source-sync-job \
  --application-id APP_ID \
  --index-id INDEX_ID \
  --data-source-id DATA_SOURCE_ID
```

Find these IDs with:

```bash
aws qbusiness list-applications
aws qbusiness list-indices --application-id APP_ID
aws qbusiness list-data-sources --application-id APP_ID --index-id INDEX_ID
```

## Step 6: Verify

Check sync status:

```bash
aws qbusiness list-data-source-sync-jobs \
  --application-id APP_ID \
  --index-id INDEX_ID \
  --data-source-id DATA_SOURCE_ID \
  --max-results 1
```

- `SUCCEEDED` with `documentsAdded > 0` = working
- `FAILED` with `SPE-5002` = bad credentials or invalid site URL
- `FAILED` with `Unable to find specified secret` = secret not populated yet

A successful first sync typically takes 5-15 minutes depending on the volume of content.

The data source syncs daily by default (`cron(0 0 ? * * *)`).

---

## Customer Instructions

Send this to the customer. Replace `DOMAIN` and `SITE_NAME` with their actual values.

---

### SharePoint Setup for Numa

We need two sets of credentials to connect your SharePoint to Numa.

#### Part 1: Azure AD App Registration

1. Sign in to [Azure Portal](https://portal.azure.com/)
2. Go to **Azure Active Directory** > **App registrations** > **New registration**
3. Name: `Q Business SharePoint Connector`
4. Supported account types: **Accounts in this organizational directory only**
5. Redirect URI: leave blank
6. Click **Register**
7. Copy the **Application (client) ID** and **Directory (tenant) ID** from the Overview page
8. Go to **Certificates & secrets** > **New client secret**
9. Add a description, choose expiry, click **Add**
10. **Copy the secret Value immediately** (not the Secret ID) — it cannot be viewed again

#### Part 2: SharePoint App-Only Registration

1. Go to `https://DOMAIN.sharepoint.com/_layouts/15/appregnew.aspx`
2. Click **Generate** next to Client Id and Client Secret
3. Title: `Numa SharePoint Access`
4. App Domain: `www.localhost.com`
5. Redirect URI: `https://www.localhost.com`
6. Click **Create**
7. **Copy the Client ID and Client Secret immediately** — the secret cannot be viewed again

#### Part 3: Grant Permissions

Go to `https://DOMAIN.sharepoint.com/sites/SITE_NAME/_layouts/15/appinv.aspx`

1. Paste the Client ID from Part 2 into the **App Id** field, click **Lookup**
2. In the **Permission Request XML** box, paste:

```xml
<AppPermissionRequests AllowAppOnlyPolicy="true">
   <AppPermissionRequest Scope="http://sharepoint/content/sitecollection/web" Right="FullControl" />
</AppPermissionRequests>
```

3. Click **Create**, then **Trust It**

> **Scope options:**
>
> - Subsite only (recommended): `Scope="http://sharepoint/content/sitecollection/web"` — use at the subsite's `appinv.aspx` URL
> - Whole site: `Scope="http://sharepoint/content/sitecollection"` — use at the site's `appinv.aspx` URL
> - Entire tenant: `Scope="http://sharepoint/content/tenant"` — use at `https://DOMAIN-admin.sharepoint.com/_layouts/15/appinv.aspx`

#### Part 4: Send us the credentials

Send these 6 values securely (not plain email):

1. Azure App Registration Client ID
2. Azure App Registration Secret Value
3. SharePoint App-Only Client ID
4. SharePoint App-Only Secret
5. Tenant ID
6. Site URL(s) to index

---

## Troubleshooting

### SPE-5002: Connection failed due to wrong credentials or invalid sites

- Verify Azure AD creds by requesting a token:

  ```bash
  curl -s -X POST "https://login.microsoftonline.com/TENANT_ID/oauth2/v2.0/token" \
    -d "client_id=AZURE_CLIENT_ID" \
    -d "client_secret=AZURE_SECRET" \
    -d "grant_type=client_credentials" \
    -d "scope=https://management.azure.com/.default"
  ```

  A 200 with a bearer token means Azure AD creds are valid.

- If Azure AD creds work but sync still fails, the SharePoint App-Only credentials are likely invalid. Ask the customer to regenerate at `appregnew.aspx`.

- The site URL may need to be simplified. If `https://domain.sharepoint.com/sites/Company/SubSite` fails, try `https://domain.sharepoint.com/sites/Company`.

### Unable to find specified secret

The Secrets Manager secret hasn't been populated yet. Run Step 4.

### Sync succeeds but 0 documents added

- The site may be empty or contain only unsupported file types
- Check if inclusion/exclusion filters are too restrictive
- OneNote documents are supported by Q Business but require OAuth 2.0 or App-Only auth with a Tenant ID

## Reference

- Infra construct: `infra/constructs/data-sources/sharepoint-datasource-construct.ts`
- Q Business setup: `infra/constructs/core-numa-infra-construct.ts` (lines 1087-1453)
- Notion guide: [Sharepoint Setup Guide](https://www.notion.so/Sharepoint-Setup-Guide-189cf755ee8280aa9087e12d6f980192)
- Existing clients with SharePoint: nzsba, tregaskisbrown, tda, chandler
