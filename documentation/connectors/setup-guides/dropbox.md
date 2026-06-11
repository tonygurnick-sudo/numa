# Connecting Dropbox to Numa

This guide walks your admin through setting up the Dropbox connector, and shows users how to connect their own account. Once connected, Numa can browse, search, and read your Dropbox files — both from **Files > Remote** and directly in chat.

Access is **read-only**: Numa can list and download files, but never modifies or deletes anything in Dropbox.

## What you'll need

- Data Connectors enabled on your Numa instance (if you don't see the Integrations page, contact Arcanum)
- A Numa admin account (for the one-time setup)
- A Dropbox account that can create apps in the [Dropbox App Console](https://www.dropbox.com/developers/apps)
- Each user connects with their own Dropbox account

## Admin setup (one time)

Your admin creates an app in the Dropbox App Console and gives Numa the resulting App key and App secret.

### Step 1: Open the Dropbox wizard in Numa

Go to **Integrations**, find **Dropbox**, and start the setup wizard. The wizard displays a **redirect URI** that looks like:

```
https://<your-company>.numa.arcanum.ai/oauth/callback/<id>
```

Keep this page open — you'll paste the exact value into Dropbox in Step 3. Dropbox requires an exact match, so always copy it from the wizard.

### Step 2: Create the app in the Dropbox App Console

1. Log in at [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) and click **Create app**
2. Choose **Scoped access**
3. Choose **Full Dropbox** as the access type (so the connector can browse the whole account, not just one app folder)
4. Name the app (e.g. `Numa Integration`) and create it

### Step 3: Configure permissions and the redirect URI

1. On the app's **Permissions** tab, enable these two read scopes, then click **Submit**:
   - `files.metadata.read` — list folders, read file details, search
   - `files.content.read` — download file content
   > Enable both scopes **before** anyone connects. Dropbox bakes permissions into each connection at approval time — scopes added later require users to disconnect and reconnect.
2. On the **Settings** tab, under **OAuth 2 → Redirect URIs**, paste the redirect URI from the Numa wizard and click **Add**
3. Still on **Settings**, copy the **App key** (this is the Client ID) and the **App secret** (click *Show*; this is the Client Secret)

> **Development vs production:** a new Dropbox app starts in Development mode and only works for the account that created it. Before rolling out to your team, use **Enable additional users** (or apply for production) on the Settings tab.

### Step 4: Save the credentials in Numa

Back in the Numa wizard, paste the **App key** as the Client ID and the **App secret** as the Client Secret, then save. Credentials are stored securely and shared by all users in your company; individual users never need them.

## Connecting as a user

1. Go to **Integrations** (or **Files > Remote**) and find **Dropbox**
2. Click **Connect**
3. You're redirected to Dropbox to sign in and approve read access to your files
4. After approving, you're returned to Numa — you're connected

Each user's connection is their own: Numa only sees the files **that user** can see in Dropbox. Your Dropbox folders will now also appear in **Files > Remote** for browsing.

## What you can do once connected

Browse your Dropbox in **Files > Remote**, or just ask in chat:

- *"Find the invoices folder in my Dropbox and list what's in it."*
- *"Search my Dropbox for last month's board report and give me the highlights."*
- *"Pull the latest pricing spreadsheet from my Dropbox and compare it with the one I uploaded."*

## Disconnecting

- **As a user:** click **Disconnect** on the Dropbox card. This removes only your personal connection — other users stay connected, and the admin setup is untouched.
- **As an admin:** removing the connector configuration deletes the company credentials and disables Dropbox for everyone. Users would need to reconnect after an admin sets it up again.

## Troubleshooting

**"My connection stopped working" / authentication errors (401)**
Numa refreshes Dropbox tokens automatically, so this usually means access was revoked — either you removed the app from your Dropbox account settings, or the admin changed the app. Click **Connect** again to re-approve.

**Permission or scope errors**
The two read scopes weren't enabled (or were enabled after you connected). The admin should check the app's **Permissions** tab has `files.metadata.read` and `files.content.read` submitted; affected users then disconnect and reconnect to pick up the new permissions.

**The Dropbox approval page shows a redirect URI error**
The redirect URI registered in the Dropbox app doesn't exactly match the one Numa uses. Re-copy the value from the Numa wizard into **Settings → OAuth 2 → Redirect URIs** — no trailing slashes or edits.

**Only the admin can connect; other users get an error**
The Dropbox app is still in Development mode. On the app's **Settings** tab, click **Enable additional users** or apply for production status.

**Some files won't open**
Dropbox Paper and other cloud-native documents aren't plain files and may be skipped. Very large files may also be too big to pull into chat — Numa can still list and search them.
