# Connecting QuickBooks Online to Numa

This guide walks your Numa administrator through setting up the QuickBooks Online connector, and shows users how to connect their own QuickBooks company. Once connected, Numa can answer questions about your invoices, customers, payments, expenses, and accounts directly in chat.

## What you'll need

| Item                              | Who needs it  | Notes                                                            |
| --------------------------------- | ------------- | ---------------------------------------------------------------- |
| A QuickBooks Online company       | Admin + users | Users connect with their own Intuit login                        |
| An Intuit Developer account       | Admin         | Free, at `developer.intuit.com`                                  |
| Numa admin access                 | Admin         | To run the connector setup wizard in Numa                        |
| The redirect URI from Numa        | Admin         | Shown in the Numa setup wizard — pasted into the Intuit app      |

## Admin setup: create the Intuit app

Your admin does this once. Numa needs a "Client ID" and "Client Secret" from an app registered in the Intuit Developer portal.

1. Go to the **Intuit Developer Portal** at [developer.intuit.com](https://developer.intuit.com), sign in, and open the **Dashboard**.
2. Click **Create an app** and select **QuickBooks Online and Payments**.
3. Open the app and go to **Keys & credentials**. Intuit gives you two sets of keys:
   - **Development keys** — work against QuickBooks **sandbox** companies only. Fine for a trial run.
   - **Production keys** — work against your real QuickBooks data. Intuit requires a short app review ("go live") before production keys are issued.
4. Under **Keys & credentials → Redirect URIs**, add the **exact** redirect URI shown in Numa's QuickBooks setup wizard. It must match character-for-character, including any trailing slash.
5. Copy the **Client ID** and **Client Secret**.
6. In Numa, open the **Integrations** page, find **QuickBooks Online**, and open the setup wizard. Paste in the Client ID and Client Secret, and save.

Numa requests the standard accounting scope (`com.intuit.quickbooks.accounting`) — no other permissions are needed.

> **Use production keys for real data.** If users connect successfully but Numa can't find your company data, the most likely cause is that development (sandbox) keys were pasted into Numa instead of production keys.

## Connecting as a user

Each user connects their own Intuit login.

1. In Numa, go to the **Integrations** page.
2. Find the **QuickBooks Online** card and click **Connect**.
3. You'll be redirected to Intuit. Sign in, **choose which QuickBooks company to connect**, and approve the access request.
4. You're returned to Numa with QuickBooks showing as connected.

> **One connection = one company.** Each authorisation is tied to a single QuickBooks company (Numa captures the company ID automatically during connection). If you work across multiple companies, connect once per company — Numa will tell you which company it's reading from.

To disconnect, click **Disconnect** on the QuickBooks card. This removes only your own connection; the admin setup is untouched. You can also revoke Numa's access from your Intuit account's connected-apps settings — Numa will then prompt you to reconnect the next time it needs QuickBooks.

### Switching companies

To move your connection to a different QuickBooks company, disconnect and connect again, picking the new company on the Intuit consent screen. The company choice is made on Intuit's side during authorisation — it can't be changed from within Numa.

## Example chat prompts

- "List unpaid invoices in QuickBooks, oldest first"
- "What did we bill the customer Acme this quarter?"
- "Summarise expenses by category for last month from QuickBooks"

## Troubleshooting

### "Please reconnect QuickBooks" / authentication errors

QuickBooks access tokens last 1 hour and Numa refreshes them automatically in the background — you normally never notice. Behind the scenes Intuit issues a fresh refresh token roughly every 24 hours, and as long as you use the connection at least once every ~100 days it stays alive indefinitely.

You'll only be asked to reconnect if:

- **The connection sat unused for ~100 days.** Intuit expires inactive connections. Click **Connect** again — it takes under a minute.
- **Access was revoked** from your Intuit account settings or by a company admin. Reconnect to restore access.

### "Permission denied" on specific requests

A 403 / authorization error on a particular request (while other requests work) means the data is outside the accounting scope the connector requests. Reconnecting won't change this — speak to your Numa administrator if you need additional access.

### Numa can't find my company / "company not found"

- Make sure you picked the right company on the Intuit consent screen — each connection is tied to exactly one company.
- Admin: verify **production** keys (not development/sandbox keys) are in the Numa wizard if you're connecting a real company.

### Admin: connection fails immediately during setup

- Check the **redirect URI** registered in the Intuit app matches the one shown in the Numa wizard exactly — this is the most common cause of setup failures.
- Check the Client ID and Client Secret were copied from the same key set (don't mix development and production values).

### Hitting rate limits

Intuit limits API throughput per company. If Numa reports it's being throttled, it waits and retries automatically. For large data pulls, ask for a narrower date range or fewer records.
