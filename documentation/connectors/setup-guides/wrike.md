# Connecting Wrike to Numa

This guide walks your Numa administrator through setting up the Wrike connector, and shows users how to connect their own Wrike account. Once connected, Numa can answer questions about your projects, tasks, folders, and team workload directly in chat.

The Wrike connector is **read-only** by default — Numa can look up and summarise your work, but cannot create or modify tasks unless your administrator explicitly enables write access.

## What you'll need

| Item                       | Who needs it  | Notes                                                          |
| -------------------------- | ------------- | --------------------------------------------------------------- |
| A Wrike account            | Admin + users | Users connect with their own Wrike login                       |
| Wrike admin access         | Admin         | To create an app in the Wrike App Console                      |
| Numa admin access          | Admin         | To run the connector setup wizard in Numa                      |
| The redirect URI from Numa | Admin         | Shown in the Numa setup wizard — pasted into the Wrike app     |

## Admin setup: create the Wrike app

Your admin does this once. Numa needs a "Client ID" and "Client Secret" from an app created in Wrike's App Console. There is a single global console — it works the same regardless of which region your Wrike data lives in.

1. Sign in to Wrike with an admin account and open the **App Console** at `https://www.wrike.com/appconsole.htm` (also reachable from the Wrike UI: profile menu → **Apps & Integrations** → **API**).
2. Click **Create new** and name the app, e.g. `Numa Integration` (users see this name on the consent screen).
3. Wrike issues a **Client ID** and **Client Secret** — copy the secret immediately.
4. In the app's settings, add the **Redirect URI** exactly as shown in Numa's Wrike setup wizard. Wrike matches it character-for-character, so copy and paste the whole string.
5. Optionally set the app's default permission to **wsReadOnly** to match what Numa requests.
6. In Numa, open the **Integrations** page, find **Wrike**, and open the setup wizard. Paste in the Client ID and Client Secret, and save.

> **Regions are handled automatically.** If your Wrike account is hosted in the EU (or another non-US data centre), there's nothing extra to configure — Numa detects the correct regional API host when each user connects.

## Connecting as a user

Each user connects their own Wrike login — Numa only sees the spaces, projects, and tasks that user can see in Wrike.

1. In Numa, go to the **Integrations** page.
2. Find the **Wrike** card and click **Connect**.
3. You'll be redirected to Wrike. Sign in and approve the access request (it will show read-only access).
4. You're returned to Numa with Wrike showing as connected.

To disconnect, click **Disconnect** on the Wrike card. You can also revoke the app from your Wrike account's connected-apps settings — Numa will then prompt you to reconnect next time.

### How the connection stays alive

Wrike doesn't put a fixed expiry on the connection — as long as Numa can keep refreshing it, you stay connected indefinitely. Numa handles all of this in the background; you only ever need to act when Numa explicitly asks you to reconnect.

## Example chat prompts

- "What tasks are assigned to me in Wrike, and which are overdue?"
- "Summarise the status of the Website Redesign project in Wrike"
- "Who has the most active tasks in Wrike this week?"

## Troubleshooting

### "Please reconnect Wrike" / authentication errors

Wrike access tokens last 1 hour and Numa refreshes them automatically — you normally never notice. Each refresh also rotates the underlying long-lived token, which Numa manages for you. You'll only be asked to reconnect if:

- **You (or an admin) revoked the app in Wrike** — from your connected-apps settings or by disabling the app in the App Console. Reconnect to restore access.
- **The stored connection became stale** (rare). Reconnecting takes under a minute and fixes it.

One reconnect resolves almost every authentication issue. If 401 errors persist immediately after a fresh reconnect, contact your Numa support contact.

### "Not allowed" when asking Numa to create or change tasks

The connector requests **read-only** access (`wsReadOnly`). Any attempt to create, update, or comment on tasks is rejected by Wrike with a permissions error — this is expected. Enabling writes is an administrator decision: the Wrike app's permissions must be widened to read-write, the Numa connector configuration updated to match, and then **every user reconnects once** — existing read-only connections don't gain write access on their own.

### Numa can't see a project or task you can see in Wrike

Numa's view mirrors **your** Wrike permissions. If something is missing, check you can open it in Wrike under the same login you connected with. Shared/restricted spaces you're not a member of won't be visible.

### Admin: connection fails immediately during setup

- Check the **redirect URI** in the Wrike app matches the one in the Numa wizard exactly — Wrike requires an exact match and this is the most common cause.
- Check the Client Secret was copied correctly; you can view the app's credentials again in the App Console.

### Hitting rate limits

Wrike throttles heavy API usage. Numa waits and retries automatically; for big questions, narrow the date range or the project scope.

### Revoking access for a leaver

Two options, in order of scope:

- **One user:** the user disconnects in Numa, or a Wrike admin removes the app from that user's connected apps in Wrike.
- **Everyone:** a Wrike admin disables or deletes the `Numa Integration` app in the App Console — all connections stop working immediately.
