# Connecting WorkflowMax to Numa

This guide walks your admin through setting up the WorkflowMax connector, and shows users how to connect their own account. Once connected, you can ask Numa about your WorkflowMax jobs, clients, staff, and time records directly in chat.

This connector works with **WorkflowMax 2** (the current product at workflowmax2.com), and is chat-only — WorkflowMax does not appear in **Files > Remote**.

## What you'll need

- Data Connectors enabled on your Numa instance (if you don't see the Integrations page, contact Arcanum)
- A Numa admin account (for the one-time setup)
- A [Xero Developer portal](https://developer.xero.com/) login (WorkflowMax apps are registered through Xero's developer platform)
- Each connecting user needs a WorkflowMax login, with **"Authorise 3rd Party Full Access"** enabled on their WorkflowMax staff record

## Admin setup (one time)

Your admin creates an app in the Xero Developer portal and gives Numa the resulting Client ID and Client Secret.

### Step 1: Open the WorkflowMax wizard in Numa

Go to **Integrations**, find **WorkflowMax**, and start the setup wizard. The wizard displays a **redirect URI** that looks like:

```
https://<your-company>.numa.arcanum.ai/oauth/callback/<id>
```

Keep this page open — you'll paste the exact value into the developer portal in the next step. It must match character for character, so always copy it from the wizard.

### Step 2: Create the app in the Xero Developer portal

1. Log in to the Xero Developer portal at [developer.xero.com](https://developer.xero.com/)
2. Go to **My Apps → New app** and select **"Web app"** as the integration type
3. Fill in the app details:
   - **App name:** e.g. `Numa Integration` (this is what users see on the consent screen)
   - **Company or application URL:** your Numa URL, e.g. `https://<your-company>.numa.arcanum.ai`
   - **OAuth 2.0 redirect URI:** paste the redirect URI from the Numa wizard
4. Save, then copy the **Client ID** and generate a **Client Secret** (the secret is shown once — copy it immediately)

### Step 3: Save the credentials in Numa

Back in the Numa wizard, paste the **Client ID** and **Client Secret** and save. Credentials are stored securely and shared by all users in your company; individual users never need them.

## Connecting as a user

1. Go to **Integrations** and find **WorkflowMax**
2. Click **Connect**
3. You're redirected to WorkflowMax to sign in; select your organisation and approve the consent screen
4. After approving, you're returned to Numa — you're connected

Each user's connection is their own: Numa acts with **that user's** WorkflowMax permissions, so they only see what they could see in WorkflowMax itself.

> **Before connecting:** your WorkflowMax administrator must enable **"Authorise 3rd Party Full Access"** on your staff record in WorkflowMax. Without it, the connection appears to succeed but every request is rejected.

## What you can do once connected

Ask in chat, for example:

- *"Show me the currently active jobs in WorkflowMax and who's assigned to each."*
- *"How many hours did each person log in WorkflowMax this week?"*
- *"Pull up the client record for Acme Ltd and summarize their open jobs."*

Numa will always ask for explicit confirmation before any destructive action (such as archiving or deleting a client).

## Disconnecting

- **As a user:** click **Disconnect** on the WorkflowMax card. This removes only your personal connection — other users stay connected, and the admin setup is untouched.
- **As an admin:** removing the connector configuration deletes the company credentials and disables WorkflowMax for everyone. Users would need to reconnect after an admin sets it up again.

## Troubleshooting

**"My connection stopped working" / authentication errors (401)**
WorkflowMax sessions are short-lived and refreshed automatically. If refresh fails (access revoked, or the session fully expired), click **Connect** again to re-approve. If you're asked to reconnect very frequently, contact Arcanum support.

**Requests rejected even though the connection looks fine (403)**
Your WorkflowMax staff record doesn't have **"Authorise 3rd Party Full Access"** enabled. Ask your WorkflowMax administrator to enable it, then disconnect and reconnect in Numa.

**The consent page shows a redirect URI error**
The redirect URI in the Xero developer app doesn't exactly match the one Numa uses. Re-copy the value from the Numa wizard into the app's **OAuth 2.0 redirect URIs**.

**Connected to the wrong organisation**
The consent screen lets you pick which WorkflowMax organisation to authorise. Disconnect in Numa, click **Connect** again, and choose the correct organisation on the consent screen.
