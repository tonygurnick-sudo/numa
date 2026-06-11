# HireHop Setup Guide

Connect Numa to HireHop so chat can answer questions about your jobs, equipment, availability, and depots.

## What you'll need

- A HireHop login with **admin access** (to generate an API token)
- Your company's **HireHop web address** — the one you log in at, e.g. `https://myhirehop.com`, `https://hirehop.net`, or `https://myhirehop.co.uk`
- A Numa admin account

## Before you start: create a dedicated API user (strongly recommended)

A HireHop API token belongs to a HireHop **user**, and it is **silently invalidated** the moment that user logs in through the HireHop website or changes their email or password. If you generate the token under someone's everyday login, the connection will break the next time they sign in.

To avoid this:

1. In HireHop, enter **Admin mode** and go to **Settings → Users**.
2. Create a new user just for the integration (e.g. `Numa API`). Give it only the permissions the integration needs — the token inherits this user's access.
3. Never log in as this user and never change its credentials. The token then stays valid indefinitely.

## Admin setup (in Numa)

1. Go to **Settings → Integrations → Data Connectors**.
2. Find **HireHop** and click **Add**.
3. The wizard registers the connector for your company. You can optionally adjust the display name, description, or rate limits, and pre-set your company's HireHop web address — **no credentials are entered here**.
4. Save. The connector is now available to everyone in your workspace.

## Connecting as a user

Each user connects with their own token the first time they use HireHop in chat:

1. Ask Numa something HireHop-related (see examples below).
2. Numa shows an **inline credential card** in the chat asking for your **HireHop API token** and your **HireHop web address**.
3. Get a token: in HireHop, enter **Admin mode** → **Settings → Users**, select the API user, open its **Menu**, and click **API Token**. Copy the token immediately. (Regenerating from the same menu issues a new token and kills the old one.)
4. For the web address, enter the address you use to log in to HireHop — **not** `www.hirehop.com` (that's the marketing site and will not work).
5. Paste both into the chat card and click **Connect**. Your token is stored in your personal vault — it is never shared with other users.
6. Re-ask your question — Numa picks up from where it left off.

## How the connection works

Numa sends your token securely on every HireHop request — it never appears in chat, links, or logs. The token and web address together identify your company, so there's nothing else to configure. Access in Numa always mirrors the API user's permissions in HireHop.

## Example chat prompts

- "What jobs are going out this week in HireHop?"
- "Check availability of our PA speakers for the last weekend of the month."
- "List our depots and how many open jobs each one has."

## Troubleshooting

### Connection suddenly stopped working (401 / 403)

The token was invalidated. By far the most common cause: **someone logged in as the token's user** in the HireHop web app, or changed that user's email or password. There is no warning when this happens.

Fix: regenerate the token (**Settings → Users → the API user → Menu → API Token**) and paste the new one into the credential card Numa shows in chat. To stop it recurring, make sure the token belongs to a dedicated API user that nobody logs in as (see above).

### Nothing works at all / "not found" errors

The web address is wrong. Double-check that you entered the address you actually log in at (e.g. `https://myhirehop.com`), with `https://` at the front — and never `www.hirehop.com`.

### "Insufficient permissions" errors on specific data

The token inherits its user's HireHop permissions. Have a HireHop admin expand that user's role, then retry — no need to regenerate the token.

### Requests are being throttled (429)

HireHop allows 60 requests per minute (and 3 per second) per user. Numa backs off and retries automatically; very large requests may just take a little longer.

### Admin removed the connector

Removing the connector in **Data Connectors** deletes the company configuration and disables HireHop for all users. Re-adding it restores access; users may be prompted to reconnect.
