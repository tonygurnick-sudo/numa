# GCP Setup Skill

Conversational guide for setting up a Google Cloud project to enable Gmail, Google Drive, and other Google connectors in Numa.

## Activation

Activate when the user asks about:

- Setting up Google services/connectors
- Configuring Gmail or Google Drive connectors
- Google Cloud project setup
- OAuth credentials for Google APIs
- Pub/Sub configuration for Google notifications

## Flow

### Step 1: Introduction

Explain what's needed:

- A Google Cloud project (new or existing)
- OAuth credentials for user authentication
- (Optional) Pub/Sub topic for real-time event notifications

Ask if they have an existing GCP project or need to create one.

### Step 2: Create/Select GCP Project

**If creating new:**

1. Go to https://console.cloud.google.com/projectcreate
2. Enter a project name (e.g., "numa-integrations")
3. Click "Create"
4. Wait for project creation to complete
5. Copy the Project ID from the dashboard

**If using existing:**

- Ask them to provide the Project ID
- Verify: Go to https://console.cloud.google.com/ and select the project

Ask them to paste the project ID so you can proceed.

### Step 3: Enable Required APIs

Guide them to enable each API:

1. **Gmail API**: https://console.cloud.google.com/apis/library/gmail.googleapis.com
   - Click "Enable"
2. **Google Drive API**: https://console.cloud.google.com/apis/library/drive.googleapis.com
   - Click "Enable"
3. **Cloud Pub/Sub API** (for real-time events): https://console.cloud.google.com/apis/library/pubsub.googleapis.com
   - Click "Enable"

After each, confirm with the user that it's enabled.

### Step 4: Configure OAuth Consent Screen

1. Go to https://console.cloud.google.com/apis/credentials/consent
2. Select "Internal" (if Google Workspace) or "External" (for all users)
3. Fill in:
   - App name: "Numa"
   - User support email: (their admin email)
   - Developer contact: (their admin email)
4. Add scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/drive.readonly`
5. Save and continue

### Step 5: Create OAuth Client Credentials

1. Go to https://console.cloud.google.com/apis/credentials
2. Click "Create Credentials" > "OAuth Client ID"
3. Application type: "Web application"
4. Name: "Numa Connector"
5. Authorized redirect URIs: Add the redirect URI from the Numa connector setup page
   - This is typically `https://{your-numa-domain}/api/oauth/callback`
6. Click "Create"
7. **Copy the Client ID and Client Secret** — they'll need these in the next step

Ask the user to paste:

- Client ID
- Client Secret

### Step 6: Store Credentials in Numa

Once they provide the Client ID and Client Secret, guide them to:

1. Go to Numa > Settings > Integrations (Admin)
2. Find Gmail (or Google Drive); if it isn't on the list yet, click **Add integration** and pick it
3. In the Manage modal, switch to the **Native** method card and click **Set up** / **Reconfigure**
4. Paste the Client ID and Client Secret
5. Save

Or use the connector configuration API directly if available.

### Step 7: (Optional) Set Up Pub/Sub for Real-Time Events

If the user wants real-time Gmail notifications:

1. Go to https://console.cloud.google.com/cloudpubsub/topic/create
2. Topic ID: `numa-connector-events`
3. Click "Create Topic"
4. Create a subscription:
   - Go to the topic > "Create Subscription"
   - Subscription ID: `numa-connector-events-push`
   - Delivery type: "Push"
   - Endpoint URL: (the Numa webhook URL for connector events)
5. Grant Gmail permission to publish:
   - On the topic, click "Show Info Panel" > "Add Principal"
   - Principal: `gmail-api-push@system.gserviceaccount.com`
   - Role: "Pub/Sub Publisher"

### Step 8: Verification

Help them verify the setup:

1. Go to the user-facing Numa Integrations page (`/integrations`)
2. Find the Gmail card and click **Connect**
3. Complete the Google sign-in; once back, the card should show **Connected** with their email visible

## Error Handling

Common issues:

- **"Access denied"**: The OAuth consent screen may not be configured, or the user doesn't have admin access to the GCP project
- **"API not enabled"**: One of the required APIs hasn't been enabled yet
- **"Invalid redirect URI"**: The redirect URI in the OAuth client doesn't match what Numa expects
- **"Pub/Sub permission denied"**: The Gmail service account hasn't been granted publisher access

## Notes

- The admin's Google account needs Owner or Editor role on the GCP project
- For production use with external users, Google requires OAuth consent screen verification (can take days/weeks)
- For internal (Google Workspace) use, verification is not required
- Pub/Sub is only needed for real-time event notifications; polling works without it
