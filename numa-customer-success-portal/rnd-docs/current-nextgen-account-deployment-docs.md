Docs and set up sets are detailed below

| Account id   | Organisation | Allocated client    |
| ------------ | ------------ | ------------------- |
| 006043185629 | NextGen      | nolia               |
| 776126713613 | NextGen      | thealternativeboard |
| 760023434717 | NextGen      | springload          |
| 042666117240 | NextGen      | collegeoflaw        |
| 805629929118 | NextGen      | rollexgroup         |
| 392928624335 | NextGen      | capitalfootball     |
| 950318176385 | NextGen      | quantiq             |
| 858955002160 | NextGen      | huddle-advisory     |
| 377977678801 | NextGen      | uplift-education    |
| 382337760991 | NextGen      | colliers            |
| 047471738088 | NextGen      | newzealandai        |
| 038785695707 | NextGen      | mexted              |
| 947931883577 | NextGen      | tleaft              |
| 728951503701 | NextGen      | worldbank           |
| 017117988822 | NextGen      | goodmans-nz         |
| 288862304077 | NextGen      | rocketscience       |
| 753747399340 | NextGen      | tech-connect        |
| 450119683782 | NextGen      | uplift-admin        |
| 234026642139 | NextGen      | justcabins          |
| 706859116098 | NextGen      | vadacom             |
| 396531909098 | NextGen      | alexandergroup      |
| 001187921205 | NextGen      | median              |
| 114657496115 | NextGen      | mkcl                |
| 998716768892 | NextGen      | synergy-tech        |
| 698752407583 | NextGen      | tregaskisbrown      |
| 837801696792 | NextGen      | myriad              |
| 919586550650 | NextGen      | racetech            |
| 954690186230 | NextGen      | otc                 |
| 942204942465 | NextGen      | pcl                 |
| 866994607941 | NextGen      |                     |
| 910599465907 | NextGen      |                     |
| 340234701983 | NextGen      |                     |
| 737771471445 | NextGen      |                     |
| 538269500074 | NextGen      |                     |
| 838207858000 | NextGen      |                     |
| 825200688101 | NextGen      |                     |
| 830101142393 | NextGen      |                     |
| 798555099573 | NextGen      |                     |
| 489975610175 | NextGen      |                     |
| 727529935650 | NextGen      |                     |
| 339126663632 | NextGen      |                     |
| 464115713868 | NextGen      |                     |
| 597482567576 | NextGen      |                     |
| 444625565534 | NextGen      |                     |
| 148590264296 | NextGen      |                     |
| 326246079726 | NextGen      |                     |
| 048119077582 | NextGen      |                     |
| 170407096871 | NextGen      |                     |
| 532442478361 | NextGen      |                     |
| 849695476748 | NextGen      |                     |
| 187641964244 | NextGen      |                     |
| 851936785814 | NextGen      |                     |
| 861536898047 | NextGen      |                     |
| 753916465016 | NextGen      |                     |
| 550357520907 | NextGen      |                     |
| 997439899063 | NextGen      |                     |
| 032896315914 | NextGen      |                     |
| 384236450119 | NextGen      |                     |
| 669409471969 | NextGen      |                     |
| 231866325831 | NextGen      |                     |
| 289259597350 | NextGen      |                     |
| 724663511818 | NextGen      |                     |
| 035904364368 | NextGen      |                     |
| 732132791560 | NextGen      |                     |
| 578941298075 | NextGen      |                     |
| 037776137953 | NextGen      |                     |
| 579939802812 | NextGen      |                     |
| 334419247435 | NextGen      |                     |
| 635146785917 | NextGen      |                     |
| 803355016775 | NextGen      |                     |
| 323041436535 | NextGen      |                     |
| 564103198730 | NextGen      |                     |
| 398564003032 | NextGen      |                     |
| 025434362039 | NextGen      |                     |
| 012079073878 | NextGen      |                     |
| 205251327521 | NextGen      |                     |
| 879390138559 | NextGen      |                     |
| 935542360612 | NextGen      |                     |
| 844892156540 | NextGen      |                     |
| 902747178819 | NextGen      |                     |
| 825738202612 | NextGen      |                     |
| 423452794458 | NextGen      |                     |
| 245003609975 | NextGen      |                     |
| 364301298809 | NextGen      |                     |
| 309642614677 | NextGen      |                     |
| 602695720054 | NextGen      |                     |
| 665565853077 | NextGen      |                     |
| 100403449979 | NextGen      |                     |
| 599273006016 | NextGen      |                     |
| 200937443847 | NextGen      |                     |
| 593067253426 | NextGen      |                     |

# Nextgen AWS Account Customer Setup Guide

## Prerequisites

- Access to numa repository
- AWS permissions
- yarn package manager

## Step 1: Create Customer Configuration

### 1.1 Default Configuration

```json
{
  "clientAccountId": "123456789",
  "region": "region",
  "allProdApps": true,
  "provisionQResources": false,
  "allowBedrockQuotaSharing": false,
  "preferredKnowledgeBase": "bedrock"
}
```

### 1.2 Select Account ID

- Choose unused account ID from customer account table
- Replace `clientAccountId` with selected account ID

### 1.3 Select Region

- **us-east-1**: North America/US customers
- **ap-southeast-2**: Asia-Pacific customers

## Step 2: Update AWS Account Name

### 2.1 Access AWS Organizations Console

1. Visit the AWS SSO portal: https://d-9767a1e6b1.awsapps.com/start/#/console?account_id=282304106064&role_name=AdministratorAccess
2. Complete the login process

### 2.2 Navigate to Organizations

1. In the AWS Console, navigate to **AWS Organizations**
2. Go to the **AWS Accounts** page to view the organization structure

### 2.3 Locate the Target Account

1. Navigate to **Workloads** > **Clients**
2. Find and open the account you're allocating to the new customer

**Or Assume into account**

1. top right drop down choose ‘Account’

### 2.4 Update Account Name

1. Click **Actions** > **Update Account Name**
2. Change the account name to match your client ID (e.g., `test-client-name`)
3. Click **Save** to confirm the changes

## Step 3: Write Configuration to Database

### 2.1 Navigate to Tools Directory

```bash
cd numa/tools

```

### 2.2 Create Configuration File

Create a JSON file (e.g., `customer-name.json`) with your configuration:

```json
{
  "clientAccountId": "123456789",
  "region": "region",
  "allProdApps": true,
  "provisionQResources": false,
  "allowBedrockQuotaSharing": false,
  "preferredKnowledgeBase": "bedrock"
}
```

### 2.3 Write Configuration to Database

Use the write-config tool to store the configuration:

```bash
yarn write-config {customer-name} {customer-name}.json
# e.g. write-config sallys-day-spa sallys-day-spa.json
```

**Note**: The tool will:

- Show you a diff of changes
- Ask for approval before writing
- Validate the configuration format
- Display the final configuration upon success

### 2.4 Verify Configuration (Optional)

You can verify the configuration was written correctly:

```bash
yarn retrieve-config {customer-name}
# e.g. retrieve-config sallys-day-spa
```

## Step 4: Deploy New Client

### 4.1 Find the most recent prod pipeline in GitLab

- _Note: Ensure main is stable, else deploy from the latest known stable merged pipeline_

This can be done by navigating to https://gitlab.com/arcanumai/numa/-/pipelines?page=1&scope=all&ref=main and finding the most recent pipeline where jobs in the deploy:customer stage have been run.

### 4.2 Run the deploy-to-client-custom job

Note: If this has previously been used for this pipeline, you will need to use the “Update CI/CD variables” button in the top right.

Set a variable with “CLIENT_NAME” as the key and the customer’s name, e.g. “arcanum-demo” as the value.

![Screenshot 2025-07-14 at 9.17.07 AM.png](attachment:0948c8e1-c0d2-4ebd-a118-cef0fd9bbe3c:Screenshot_2025-07-14_at_9.17.07_AM.png)

This deploy **MUST** be a success. If an error is thrown, the config.json may not write correctly, leaving the account in a broken state.

## Step 5: Retrieve the system user password

### 5.1 Fetch the password

1. Visit https://d-9767a1e6b1.awsapps.com/start/#/?tab=accounts
2. Login to the customer’s account.
3. Go to Secrets Manager.
4. Click the “system-user-password” secret.
5. Click “Retrieve secret value”

### 5.2 Send it to Pras/Ian

1. Open BitWarden
2. Click “Send”
3. Click “+”
4. Name the Send “{Customer Name} System User” e.g. “Arcanum Demo System User”
5. Click “Text”
6. Enter “Username: numa-system-user@arcanum.ai”
7. Enter “Password: “ followed by the password retrieved from the secret.
8. Enter “Url: https://{customerId}.numa.arcanum.ai” e.g. “https://arcanum-demo.numa.arcanum.ai”
9. Click the save icon
10. Copy the Send link under “Share” and private message it to Ian and Pras on Slack.

## Step 6: Update the .gitlab-ci-clients.yml file

This file contains a list of all our customers and needs to be kept up-to-date so that customers are deployed to.

## Configuration Reference

### Configuration Fields

| Field                      | Required | Default Value                                         | Description                                                                                                                         |
| -------------------------- | -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `clientAccountId`          | Yes      | N/A                                                   | AWS Account ID (must be unique per customer)                                                                                        |
| `region`                   | Yes      | N/A                                                   | AWS region (`us-east-1` or `ap-southeast-2`)                                                                                        |
| `allProdApps`              | No       | `false`                                               | Enable all production applications                                                                                                  |
| `allApps`                  | No       | `false`                                               | Enable _all_ apps (for dev use only)                                                                                                |
| `apps`                     | No       | `{}`                                                  | Map of appId: configuration to deploy (configuration is currently always `{}`)                                                      |
| `allowBedrockQuotaSharing` | No       | `false`                                               | Allow other accounts to use this account’s Bedrock quota                                                                            |
| `bedrockAccount`           | No       | `undefined`                                           | An account id to use for making Bedrock calls (for quota sharing). That account must have `allowBedrockQuotaSharing` set to `true`. |
| `provisionQResources`      | No       | `false`                                               | Whether to provision Q for this stack.                                                                                              |
| `preferredKnowledgeBase`   | No       | `"q"` if `provisionQResources`, otherwise `"bedrock"` | Which type of knowledge base to use.                                                                                                |

### Region Selection Guidelines

- **us-east-1**: Recommended for customers in:
  - United States
  - Canada
  - Other North American regions
- **ap-southeast-2**: Recommended for customers in:
  - Australia
  - New Zealand
  - Other Asia-Pacific regions

## Post-Deployment Verification

After successful deployment:

1. Verify the customer can access their account
2. Test core functionality
3. Confirm the correct region is being used
4. Validate that all expected applications are available

## Notes

- Each customer must have a unique `clientAccountId` allocated from the table of available accounts
- Configuration changes require rebuilding and redeployment
- Keep track of used account IDs to avoid conflicts. The table should mirror the DB.
- The `write-config` tool includes built-in validation to prevent invalid configurations
