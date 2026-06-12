# Connecting Xero to Numa

This guide walks your Numa administrator through setting up the Xero connector, and shows users how to connect their own Xero account. Once connected, Numa can answer questions about your invoices, contacts, payments, and bank transactions directly in chat.

The Xero connector is **read-only** — Numa can look up and summarise your accounting data, but cannot create or modify anything in Xero.

## What you'll need

| Item                          | Who needs it  | Notes                                                              |
| ----------------------------- | ------------- | ------------------------------------------------------------------ |
| A Xero account                | Admin + users | Users connect with their own Xero login                            |
| Access to the Xero Developer Portal | Admin   | `developer.xero.com` — free, uses your normal Xero login           |
| Numa admin access             | Admin         | To run the connector setup wizard in Numa                          |
| The redirect URI from Numa    | Admin         | Shown in the Numa setup wizard — you'll paste it into the Xero app |

## Admin setup: create the Xero app

Your admin does this once. Numa needs a "Client ID" and "Client Secret" from a Xero app registered to your organisation.

1. Go to the **Xero Developer Portal** at [developer.xero.com](https://developer.xero.com) and sign in → **My Apps**.
2. Click **New app** and select **Web app** as the integration type.
3. Fill in:
   - **App name**: e.g. `Numa Integration` (this is what users see on the consent screen)
   - **Company or application URL**: your Numa instance URL (e.g. `https://yourcompany.numa.arcanum.ai`)
   - **OAuth 2.0 redirect URI**: copy the **exact** redirect URI shown in Numa's Xero setup wizard. It must match character-for-character, including any trailing slash.
4. Save the app, then open it and go to **Configuration**:
   - Copy the **Client ID**.
   - Click **Generate a secret** and copy the **Client Secret** immediately — Xero only shows it once.
5. In Numa, open the **Integrations** page, find **Xero**, and open the setup wizard. Paste in the Client ID and Client Secret, and save.

That's it — the connector is now available for users to connect.

> **Note:** Numa requests read-only access to transactions and contacts (`accounting.transactions.read`, `accounting.contacts.read`). Areas like the chart of accounts, organisation settings, and reports are deliberately not included — if you ask Numa for those, it will explain that the capability isn't enabled. Talk to your Numa contact if you need them.

> **Apps registered on or after 2 March 2026** use Xero's newer granular scope model. If the Xero consent screen rejects the connection, contact your Numa support contact — the requested scopes may need updating.

## Connecting as a user

Each user connects their own Xero login — Numa only sees the organisations that user can access.

1. In Numa, go to the **Integrations** page.
2. Find the **Xero** card and click **Connect**.
3. You'll be redirected to Xero. Sign in, **choose which organisation(s) to connect**, and click **Allow access**.
4. You're returned to Numa with Xero showing as connected.

If you belong to multiple Xero organisations, Numa will tell you which organisation it's reading from when it answers — you can ask it to switch.

To disconnect, click **Disconnect** on the Xero card. This removes only your own connection; it doesn't affect other users or the admin setup.

## Example chat prompts

- "Show me our outstanding receivables in Xero"
- "Find the Xero contact named Acme and show their recent invoices"
- "List payments we received in June, largest first"

## Troubleshooting

### "Please reconnect Xero" / authentication errors

Xero access tokens last 30 minutes and Numa refreshes them automatically — you normally never notice. You'll only be asked to reconnect if:

- **You haven't used the connection in 60 days.** Xero expires unused connections after 60 days of inactivity. Just click **Connect** again.
- **Access was revoked in Xero** (by you or a Xero admin, under Connected Apps). Reconnect to restore access.

Reconnecting takes under a minute and doesn't require any admin changes.

### "Permission denied" or "capability not enabled" answers

A permission error on a specific request (rather than a connection failure) usually means the data lives behind a scope the connector doesn't request — e.g. the chart of accounts or Xero reports. This is by design: the connector is read-only and limited to transactions and contacts. Reconnecting will **not** fix this; the scope set has to be changed by your Numa administrator first, after which every user reconnects once.

### Numa answers from the wrong organisation

If your Xero login has access to several organisations, ask Numa explicitly: "Use the Acme Ltd organisation in Xero". Numa states which organisation it used in its answers.

### Admin: connection fails immediately during setup

- Check the **redirect URI** in your Xero app matches the one in the Numa wizard exactly — this is the most common cause.
- Check the Client Secret was copied correctly (it's only shown once — generate a new one in Xero if in doubt).

### Hitting rate limits

Xero limits API calls per minute and per day. If Numa reports it's being rate-limited, it will wait and retry automatically. For very large requests, ask for a narrower date range.
