# Connecteam Setup Guide

Connect Numa to Connecteam so chat can answer questions about your employees, time clock activity, schedules, and form submissions.

There are two ways to connect — choose one:

| Method                      | Best for                                                  | Connecteam plan required                            |
| --------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| **API Key** (simplest)      | Most teams — one key, no app registration                 | Expert or higher (the Forms API requires Enterprise) |
| **OAuth**                   | Teams that prefer a scoped app over a full-access key     | Enterprise (OAuth apps live in the Integration Center) |

Both methods use the same Connecteam API — chat works identically once connected.

---

## Method 1: API Key

### What you'll need

- A Connecteam **account owner** login — only owners can create API keys (managers/admins cannot)
- A Connecteam **Expert plan or higher** (Forms data requires Enterprise)
- A Numa admin account

### Admin setup (in Numa)

1. Go to **Settings → Integrations → Data Connectors**.
2. Find **Connecteam (API Key)** and click **Add**.
3. The wizard registers the connector for your company. You can optionally adjust the display name, description, or rate limits — **no credentials are entered here**.
4. Save. The connector is now available to everyone in your workspace.

### Connecting as a user

Each user supplies an API key the first time they use the connector — directly in chat:

1. Ask Numa something Connecteam-related (see examples below).
2. Numa shows an **inline credential card** in the chat asking for your Connecteam API key.
3. Generate a key: an **account owner** logs in to Connecteam, goes to **Settings → API Keys**, and clicks **Add API key**. Name it for identification (e.g. `Numa`) and copy it immediately. If you're not an owner, ask your account owner to generate one for you and share it securely.
4. Paste the key into the chat card and click **Connect**. The key is stored in your personal vault — it is never shared with other users.
5. Re-ask your question — Numa picks up from where it left off.

Connecteam API keys don't expire, so this is a one-time step unless the key is deleted or regenerated.

---

## Method 2: OAuth

### What you'll need

- A Connecteam **Enterprise plan** (OAuth apps require the Integration Center)
- Permission to create apps in your Connecteam account
- A Numa admin account

### Admin setup

1. In Numa, go to **Settings → Integrations → Data Connectors**, find **Connecteam (OAuth)**, and click **Add**. The wizard shows a **redirect URI** — keep this page open.
2. In Connecteam, open the developer area: **your profile name → Integration Center → OAuth 2.0 → Create app**.
3. Name the app (e.g. `Numa`) and set the redirect URI to the exact value shown in the Numa wizard.
4. Choose the scopes the integration needs (e.g. read access for users, scheduling, and forms). **Scopes cannot be changed after the app is created** — to change them later you must create a new app.
5. Copy the **Client ID** and **Client Secret**. The secret is shown **only once** — capture it immediately.
6. Paste both into the Numa wizard and save.

### Connecting as a user

When Numa first needs Connecteam, you'll be prompted to **Connect** and authorize access. Connecteam access tokens last 24 hours; Numa renews them automatically — you won't be asked again unless access is revoked.

---

## Example chat prompts

- "List our active employees in Connecteam."
- "How many hours did the warehouse team clock last week?"
- "Show this week's shifts on the field services schedule."
- "Summarise the latest submissions of our site safety form."

---

## Troubleshooting

### "Unauthorized" / 401 errors

The API key was deleted or regenerated in Connecteam (or, for OAuth, access was revoked). Numa will show the credential card in chat again — generate a fresh key at **Settings → API Keys** and paste it in to reconnect.

### Everything returns "forbidden" / 403

This is a plan gate, not a credential problem. The Connecteam API requires the **Expert plan or higher**, and Forms data requires **Enterprise**. Check your Connecteam subscription.

### Requests are being throttled (429)

Connecteam rate limits are **per account** and shared across all keys and integrations (e.g. Expert: 100 requests/minute, 10,000/day). Numa backs off automatically, but heavy use from other integrations on the same account counts against the quota.

### Australian-hosted accounts

If your Connecteam data is hosted in Australia and every request fails, contact us — AU accounts use a different API address and we'll point your connector at it.

### Admin removed the connector

Removing the connector in **Data Connectors** deletes the company configuration and disables Connecteam for all users. Re-adding it restores access; users may be prompted to reconnect.
