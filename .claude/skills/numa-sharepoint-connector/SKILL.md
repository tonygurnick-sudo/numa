---
name: numa-sharepoint-connector
description: Set up SharePoint Q Business data source connectors for Numa clients. Use when connecting SharePoint to Q Business, onboarding a customer's SharePoint, configuring SharePoint credentials, troubleshooting SharePoint sync failures (SPE-5002), or working with sharePointConfigs in DynamoDB.
---

# SharePoint Q Business Connector Setup

End-to-end guide for connecting a customer's SharePoint Online to their Numa Q Business knowledge base.

## Prerequisites

- Client has `provisionQResources: true` and `preferredKnowledgeBase: "q"` in `numa-client-config`
- Client has a deployed Q Business application
- Client has a Microsoft 365 business SharePoint Online account (personal MSA accounts do not work)

## Overview

The connector requires **two credential pairs** from the customer:

1. **Azure AD App Registration** — `adClientId` + `adClientSecret`
2. **SharePoint App-Only Registration** — `clientId` + `clientSecret` (generated at `appregnew.aspx`, NOT Azure AD)

These are different things. The most common failure is the customer providing Azure AD credentials for both, or providing an expired/invalid SharePoint App-Only secret.

## Step-by-Step

### Step 1: Get credentials from the customer

Send the customer the instructions from the **Customer Instructions** section below. You need 6 values:

| Value                               | Source                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| Azure App Registration Client ID    | Azure Portal > App registrations > Overview               |
| Azure App Registration Secret Value | Azure Portal > Certificates & secrets (NOT the Secret ID) |
| SharePoint App-Only Client ID       | Generated at `_layouts/15/appregnew.aspx`                 |
| SharePoint App-Only Secret          | Generated at `_layouts/15/appregnew.aspx`                 |
| Tenant ID                           | Azure Portal > Overview > Directory (tenant) ID           |
| Site URL(s)                         | e.g. `https://contoso.sharepoint.com/sites/MySite`        |

### Step 2: Update DynamoDB config

Add `sharePointConfigs` to the client's entry in the `numa-client-config` table (deployer account, `us-east-1`):

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

**Optional filters** inside `configuration` to limit what gets indexed:

```json
"configuration": {
  "inclusionFilePath": ["^.*(?:FolderName).*$"],
  "inclusionFileTypePatterns": [".*\\.pdf", ".*\\.docx"],
  "exclusionFileNamePatterns": [".*draft.*"]
}
```

All filter options are defined in `infra/constructs/data-sources/sharepoint-datasource-construct.ts`.

### Step 3: Deploy

Deploy the client's stack. This creates:

- A Q Business `SHAREPOINTV2` data source
- A Secrets Manager secret (`QBusines-sharepoint-secret...`)

### Step 4: Populate the secret

**4a: Compute the siteUrlsHash**

```bash
echo -n "https://DOMAIN.sharepoint.com/sites/SITE_NAME" | shasum -a 256 | awk '{print $1}'
```

Multiple sites: comma-separate with no spaces before hashing.

**4b: Find the secret**

Assume into the client account, then:

```bash
aws secretsmanager list-secrets --filters Key=name,Values=QBusines-sharepoint
```

**4c: Write the secret**

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

**Critical details:**

- `clientId` is a **compound value**: `{SharePointAppOnlyClientID}@{TenantID}`
- `clientSecret` is the SharePoint App-Only secret, NOT the Azure AD one
- `adClientSecret` is the Azure AD secret **Value**, not the secret ID
- `authType` is always `OAuth2App`

### Step 5: Trigger initial sync

```bash
aws qbusiness start-data-source-sync-job \
  --application-id APP_ID \
  --index-id INDEX_ID \
  --data-source-id DATA_SOURCE_ID
```

Find these IDs:

```bash
aws qbusiness list-applications
aws qbusiness list-indices --application-id APP_ID
aws qbusiness list-data-sources --application-id APP_ID --index-id INDEX_ID
```

### Step 6: Verify

```bash
aws qbusiness list-data-source-sync-jobs \
  --application-id APP_ID \
  --index-id INDEX_ID \
  --data-source-id DATA_SOURCE_ID \
  --max-results 1
```

| Status                                          | Meaning                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| `SUCCEEDED` with `documentsAdded > 0`           | Working                                        |
| `SYNCING` for 5+ minutes                        | Probably working (failures die in under 6 min) |
| `FAILED` with `SPE-5002`                        | Bad credentials or invalid site URL            |
| `FAILED` with `Unable to find specified secret` | Secret not populated yet                       |

First sync takes 5-15 minutes. Daily sync runs via `cron(0 0 ? * * *)`.

---

## Customer Instructions

Send this to the customer. Replace `DOMAIN` and `SITE_NAME` with their values.

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

**Scope options:**

- Subsite only (recommended): `Scope="http://sharepoint/content/sitecollection/web"` at the subsite's `appinv.aspx`
- Whole site: `Scope="http://sharepoint/content/sitecollection"` at the site's `appinv.aspx`
- Entire tenant: `Scope="http://sharepoint/content/tenant"` at `https://DOMAIN-admin.sharepoint.com/_layouts/15/appinv.aspx`

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

1. **Test Azure AD creds** — if this works, Azure AD side is fine:

   ```bash
   curl -s -X POST "https://login.microsoftonline.com/TENANT_ID/oauth2/v2.0/token" \
     -d "client_id=AZURE_CLIENT_ID" \
     -d "client_secret=AZURE_SECRET" \
     -d "grant_type=client_credentials" \
     -d "scope=https://management.azure.com/.default"
   ```

   200 with a bearer token = valid. But note: this only tests Azure AD, not SharePoint App-Only creds. The Q Business connector authenticates differently — a curl failure does NOT necessarily mean the creds won't work with Q Business.

2. **If Azure AD works but sync fails** — the SharePoint App-Only credentials are likely invalid. Ask the customer to regenerate at `appregnew.aspx`.

3. **Site URL issues** — if `https://domain.sharepoint.com/sites/Company/SubSite` fails, try `https://domain.sharepoint.com/sites/Company`.

### Unable to find specified secret

Secret not populated. Run Step 4.

### Sync succeeds but 0 documents added

- Site may be empty or contain only unsupported file types
- Inclusion/exclusion filters may be too restrictive
- OneNote requires OAuth 2.0 or App-Only auth with a Tenant ID

## Key Files

| File                                                               | Purpose                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `infra/constructs/data-sources/sharepoint-datasource-construct.ts` | CDKTF construct, filter options, field mappings             |
| `infra/constructs/core-numa-infra-construct.ts`                    | Q Business app/index/retriever creation, data source wiring |
| `documentation/sharepoint-connector-setup.md`                      | Full reference doc                                          |

## Existing Clients with SharePoint

| Client         | Region         | Status  |
| -------------- | -------------- | ------- |
| nzsba          | us-east-1      | Working |
| tregaskisbrown | us-east-1      | Working |
| tda            | us-east-1      | Working |
| chandler       | ap-southeast-2 | Working |

## External References

- [Notion: Sharepoint Setup Guide](https://www.notion.so/Sharepoint-Setup-Guide-189cf755ee8280aa9087e12d6f980192) (Nathan Douglas, under Nick Walton's Numa Datasource Documentation)
- [AWS: Q Business SharePoint connector](https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/sharepoint-cloud-connector.html)
