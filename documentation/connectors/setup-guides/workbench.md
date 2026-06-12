# Workbench International Setup Guide

Connect Numa to Workbench International so chat can answer questions about your jobs, job costing, timesheets, and purchasing data.

Workbench is hosted **per customer** — your company runs its own Workbench instance at its own web address. That address is part of the setup, so have it handy.

## What you'll need

- Your company's **Workbench instance URL** — the address you use to open Workbench in the browser, e.g. `https://yourcompany.workbench.com`
- A **Workbench API token** (bearer token) — see below for how to get one
- A Numa admin account

### Getting a Workbench API token

API tokens are issued from your Workbench instance by an admin or API-capable user. The token inherits that user's Workbench permissions, so issue it under a user whose role covers the data you want Numa to read.

If your instance doesn't have a self-service token area, raise a ticket with Workbench support and ask them to issue an API token for the integration user. Copy the token as soon as it's shown — assume it is displayed only once.

## Admin setup (in Numa)

1. Go to **Settings → Integrations → Data Connectors**.
2. Find **Workbench International** and click **Add**.
3. The wizard registers the connector for your company. Enter your company's **instance URL** here so it's configured once for everyone, and optionally adjust the display name, description, or rate limits. **No tokens are entered at this step.**
4. Save. The connector is now available to everyone in your workspace.

## Connecting as a user

Each user connects with a token the first time they use Workbench in chat:

1. Ask Numa something Workbench-related (see examples below).
2. Numa shows an **inline credential card** in the chat asking for your **Workbench bearer token** and your **instance URL**.
3. Paste your token, and enter the instance URL — the same address you use to open Workbench in the browser (ask your admin if you're unsure). Include `https://` and leave off any trailing slash.
4. Click **Connect**. Your token is stored in your personal vault — it is never shared with other users.
5. Re-ask your question — Numa picks up from where it left off.

## How the connection works

Numa sends your token securely on every Workbench request — it never appears in chat, links, or logs. Because the token carries the issuing user's Workbench permissions, what Numa can see always mirrors what that user can see in Workbench itself. To change what Numa can access, change the user's role (or issue a token under a different user).

## Example chat prompts

- "List the active jobs in Workbench."
- "What's the cost to date on job 4012, broken down by cost type?"
- "Summarise the timesheets entered this week."

## Troubleshooting

### "Unauthorized" / 401 errors

The token has expired or been revoked. There is no automatic renewal for Workbench tokens — issue a new token in Workbench (or via Workbench support) and paste it into the credential card Numa shows in chat to reconnect.

### "Forbidden" / 403 errors on specific data

The token is valid but the issuing user's Workbench role doesn't cover that data. Have a Workbench admin expand the user's role, or issue a new token under a user with broader access, then reconnect.

### Nothing works at all / "not found" errors

This is almost always the instance URL rather than the token:

- Confirm it's the exact address you use to open Workbench in the browser
- Make sure it starts with `https://`
- Remove any trailing slash or extra path

Fix the address in the credential card (or have your Numa admin correct the company-level instance URL in **Data Connectors**) and try again.

### Admin removed the connector

Removing the connector in **Data Connectors** deletes the company configuration — including the saved instance URL — and disables Workbench for all users. Re-adding it restores access; users may be prompted to reconnect.
