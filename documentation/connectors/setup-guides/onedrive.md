# Connecting OneDrive to Numa

This guide walks your admin through setting up the OneDrive connector, and shows users how to connect their own account. Once connected, Numa can browse, search, and read your OneDrive files — both from **Files > Remote** and directly in chat.

Access is **read-only**: Numa can list and download files, but never modifies or deletes anything in OneDrive.

## What you'll need

- Data Connectors enabled on your Numa instance (if you don't see the Integrations page, contact Arcanum)
- A Numa admin account (for the one-time setup)
- Access to the [Azure Portal](https://portal.azure.com/) with permission to create App registrations
- Each user connects with their own Microsoft work/school account

## Admin setup (one time)

Your admin registers an app in Microsoft Entra (Azure AD) and gives Numa the resulting Client ID and Client Secret.

### Step 1: Open the OneDrive wizard in Numa

Go to **Integrations**, find **OneDrive**, and start the setup wizard. The wizard displays a **redirect URI** that looks like:

```
https://<your-company>.numa.arcanum.ai/oauth/callback/<id>
```

Keep this page open — you'll paste the exact value into Azure in the next step. Always copy it from the wizard; don't type it by hand.

### Step 2: Register an app in the Azure Portal

1. Go to **Azure Portal → App registrations → New registration**
2. Set a name (e.g. `Numa OneDrive Integration`) and choose **"Accounts in any organizational directory"**
3. Under **Redirect URIs**, add the redirect URI from the Numa wizard, with platform type **Web** (not "Single-page application")
4. Click **Register**
5. Go to **Certificates & secrets → New client secret** → copy the secret **Value** (not the Secret ID — the Value is shown only once)
6. Copy the **Application (client) ID** from the **Overview** page

The connector requests two delegated Microsoft Graph permissions: `Files.Read.All` (read-only file access) and `offline_access` (stay connected without re-prompting).

> **Admin consent:** for some organizations, a Microsoft 365 tenant admin may need to grant admin consent for `Files.Read.All` before users can approve the connection.

### Step 3: Save the credentials in Numa

Back in the Numa wizard, paste the **Client ID** and **Client Secret** and save. Setup is complete — credentials are stored securely and shared by all users in your company; individual users never need them.

## Connecting as a user

1. Go to **Integrations** (or **Files > Remote**) and find **OneDrive**
2. Click **Connect**
3. You're redirected to Microsoft to sign in and approve read access to your files
4. After approving, you're returned to Numa — you're connected

Each user's connection is their own: Numa only sees the files **that user** can see in OneDrive. Your OneDrive folders will now also appear in **Files > Remote** for browsing.

## What you can do once connected

Browse your OneDrive in **Files > Remote**, or just ask in chat:

- *"List the files in my OneDrive and find anything related to the Q3 budget."*
- *"Search my OneDrive for the latest signed contract and summarize the key terms."*
- *"Download the project plan from my OneDrive and turn it into a status update."*

## Disconnecting

- **As a user:** click **Disconnect** on the OneDrive card. This removes only your personal connection — other users stay connected, and the admin setup is untouched.
- **As an admin:** removing the connector configuration deletes the company credentials and disables OneDrive for everyone. Users would need to reconnect after an admin sets it up again.

## Troubleshooting

**"My connection stopped working" / authentication errors (401)**
Numa refreshes Microsoft tokens automatically. If the connection hasn't been used for around 90 days, or your Microsoft admin revoked the app's access, the refresh fails — just click **Connect** again to re-approve.

**"Access denied" or permission errors (403)**
Your organization likely requires tenant admin consent for `Files.Read.All`. Ask your Microsoft 365 admin to grant admin consent on the app registration, then reconnect.

**The Microsoft sign-in page shows a redirect URI error**
The redirect URI in Azure doesn't exactly match the one Numa uses. Re-copy the value from the Numa wizard into the Azure app's Redirect URIs (type **Web**) — it must match character for character.

**"Secret expired" during setup or later**
Azure client secrets have an expiry date. When one expires, create a new secret in **Certificates & secrets**, copy the new Value, and update it in the Numa wizard.

**A file won't download**
Files over 100 MB can't be pulled into chat. Numa can still list and search them — for very large files, work with a smaller export.
