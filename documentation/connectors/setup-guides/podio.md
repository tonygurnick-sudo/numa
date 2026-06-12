# Connecting Podio to Numa

This guide walks your admin through setting up the Podio connector, and shows users how to connect their own account. Once connected, you can ask Numa about your Podio workspaces, apps, and items directly in chat.

This connector is chat-only — Podio does not appear in **Files > Remote**.

## What you'll need

- Data Connectors enabled on your Numa instance (if you don't see the Integrations page, contact Arcanum)
- A Numa admin account (for the one-time setup)
- A Podio account that can create API keys (via the [Podio Developer Portal](https://developers.podio.com/) → **API Keys**, or directly at `https://podio.com/settings/api`)
- Each user connects with their own Podio account

## Admin setup (one time)

Your admin creates an API client application in Podio and gives Numa the resulting Client ID and Client Secret.

### Step 1: Open the Podio wizard in Numa

Go to **Integrations**, find **Podio**, and start the setup wizard. The wizard displays a **redirect URI** that looks like:

```
https://<your-company>.numa.arcanum.ai/oauth/callback/<id>
```

Keep this page open — you'll need it in the next step. Copy the value from the wizard; don't build it by hand.

### Step 2: Create the API client in Podio

1. Go to the **Podio Developer Portal → API Keys** (or sign in to Podio and open `https://podio.com/settings/api`)
2. Create a new API client application:
   - **Application name:** e.g. `Numa Integration` (this is what users see on the consent screen)
   - **Domain / return URL:** use the redirect URI shown in the Numa wizard. Podio validates the **domain** of the redirect (e.g. `<your-company>.numa.arcanum.ai`) against this field, so make sure the domain matches exactly
3. Save. Podio issues a **Client ID** and a **Client Secret** — copy both immediately (the secret is shown once)

Podio has no per-permission scopes to configure: each connection simply inherits the connecting user's own Podio permissions.

### Step 3: Save the credentials in Numa

Back in the Numa wizard, paste the **Client ID** and **Client Secret** and save. Credentials are stored securely and shared by all users in your company; individual users never need them.

## Connecting as a user

1. Go to **Integrations** and find **Podio**
2. Click **Connect**
3. You're redirected to Podio to sign in and approve the connection
4. After approving, you're returned to Numa — you're connected

Each user's connection is their own: Numa acts with **that user's** Podio permissions, so they only see the organisations, workspaces, and apps they could see in Podio itself.

## What you can do once connected

Ask in chat, for example:

- *"List my Podio workspaces and the apps in each."*
- *"Show me the open leads in our Podio Leads app created this month."*
- *"Create a new item in the Projects app called 'Website refresh' — check the app's fields first."*

Numa inspects an app's field structure before reading or writing items, so it works with whatever custom apps your team has built.

## Disconnecting

- **As a user:** click **Disconnect** on the Podio card. This removes only your personal connection — other users stay connected, and the admin setup is untouched.
- **As an admin:** removing the connector configuration deletes the company credentials and disables Podio for everyone. (Disabling or deleting the API key in Podio's settings has the same effect — all existing connections stop working.)

## Troubleshooting

**"My connection stopped working" / authentication errors (401)**
Numa refreshes Podio tokens automatically, but a connection that goes **unused for 28 days** expires and can't be refreshed. Click **Connect** again to re-approve. The same applies if you removed the app from your Podio account settings or the admin disabled the API key.

**The Podio approval page shows an error before you can sign in**
The redirect domain registered with the API key doesn't match your Numa domain. The admin should check the API key's domain/return URL field matches the redirect URI shown in the Numa wizard.

**"I can't see a workspace or app I expected"**
Numa can only reach what your Podio user can. There are no scopes to adjust — ask your Podio admin to grant your user access to the organisation, workspace, or app in Podio, then try again (reconnect if needed).

**Requests slow down or temporarily fail during big queries**
Podio rate-limits heavy operations (such as large item filters). Numa backs off and retries automatically — if it happens often, break large requests into smaller ones.
