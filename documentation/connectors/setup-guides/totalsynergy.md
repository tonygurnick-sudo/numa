# Connecting Total Synergy to Numa

This guide covers connecting Total Synergy — practice management for architecture and engineering firms — to Numa. Once connected, Numa can answer questions about your projects, contacts, staff, and timesheets directly in chat.

There are **two ways to connect**, and your administrator chooses which one your organisation uses:

| Method                         | How users sign in                                  | Best for                                                              |
| ------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------- |
| **Total Synergy (OAuth)**      | Click Connect → sign in to Synergy → approve        | Hands-off: tokens renew automatically while the connection is in use  |
| **Total Synergy (API Key)**    | Paste a personal API key from your Synergy profile | Simplest setup: no app registration, but keys must be renewed manually |

Both methods use the same Total Synergy API and give the same capabilities in chat. With either method, what Numa can see mirrors **your own Synergy permissions** — Total Synergy has no separate permission scopes, so data your Synergy role can't access is never visible to Numa.

## What you'll need

| Item                              | Who needs it  | Applies to |
| --------------------------------- | ------------- | ---------- |
| A Total Synergy account           | Admin + users | Both       |
| Numa admin access                 | Admin         | Both       |
| An OAuth application registered with Total Synergy | Admin | OAuth only |
| A personal Synergy API key        | Each user     | API Key only |

---

## Path A: Total Synergy (OAuth)

### Admin setup

Numa needs an Application Key (Client ID) and Application Secret (Client Secret) registered with Total Synergy.

1. Sign in to Total Synergy and open the application registration area at `https://app.totalsynergy.com/Applications`. If this page isn't available on your tenant, **contact Total Synergy support** and ask them to register an OAuth application for you.
2. Register a new application:
   - **Application name**: e.g. `Numa Integration`
   - **Callback / Redirect URI**: copy the **exact** redirect URI shown in Numa's Total Synergy (OAuth) setup wizard — it must match exactly.
3. Total Synergy generates an **Application Key** (public) and **Application Secret** (private). Copy both — the secret should be treated like a password.
4. In Numa, open the **Integrations** page, find **Total Synergy (OAuth)**, open the setup wizard, paste in the Application Key and Application Secret, and save.

### Connecting as a user

1. In Numa, go to the **Integrations** page.
2. Find the **Total Synergy (OAuth)** card and click **Connect**.
3. You'll be redirected to Total Synergy. Sign in and approve the access request.
4. You're returned to Numa with Total Synergy showing as connected.

Numa keeps the connection alive automatically. If the connection sits **unused for about a month**, Total Synergy expires it — just click **Connect** again.

---

## Path B: Total Synergy (API Key)

### Admin setup

The admin step is lightweight: in Numa, open the **Integrations** page, find **Total Synergy (API Key)**, and run the setup wizard to enable the connector (no credentials are entered here — keys are personal and each user supplies their own).

### Connecting as a user

First, generate your personal API key in Total Synergy:

1. Sign in to Total Synergy.
2. Click your **profile icon** (top-right) → **Profile settings**.
3. Click the **ellipsis (⋯)** menu → **API Key**.
4. Choose a key lifetime — **1 year** or **3 years** — and **copy the complete key**. Treat it like a password; it grants access to everything your Synergy login can see.

Then connect in Numa:

1. On the **Integrations** page, find the **Total Synergy (API Key)** card and click **Connect** — or simply ask Numa something about Synergy in chat, and it will show a credential card prompting you to connect.
2. Paste your **API key**, and enter your **instance URL** (e.g. `https://yourcompany.totalsynergy.com`).
3. Save. Your key is stored in your personal, encrypted vault — admins and other users can never see it.

> **Mark your calendar.** API keys expire after the lifetime you chose (1 or 3 years) and there is no automatic renewal. When the key expires, Numa's requests start failing until you generate a new key and paste it in again.

---

## Example chat prompts

- "List my active Total Synergy projects"
- "Show this week's timesheet from Synergy"
- "Find the contact for the Riverside Tower project in Total Synergy"

## Troubleshooting

### "Please reconnect Total Synergy" / authentication errors

**OAuth:** access tokens are short-lived and refresh automatically — you normally never notice. You'll be asked to reconnect if the connection was idle for over a month, or if the application was revoked or re-registered. Reconnecting takes under a minute.

**API Key:** there is **no automatic recovery** — an authentication failure means your key is expired, was regenerated, or was pasted incorrectly. Generate a fresh key in Synergy (Profile settings → ⋯ → API Key) and update it in Numa. Reconnecting without a new key won't help.

### Numa can't see projects or data you expect

Access mirrors the Synergy permissions of the account that connected. If data is missing, check you can see it in the Total Synergy app under the same login (for API keys: the login that **generated the key**). If a shared/team integration needs broader visibility, generate the key from a user whose Synergy role has the required access — and no more.

### "Rate limit reached for today"

Total Synergy enforces a **daily** API budget per organisation — once it's used up, requests fail until the next day, and retrying sooner won't help. Numa stops and tells you when this happens. If your team hits this regularly, Total Synergy offers a **Premium API add-on** with higher limits — ask your Total Synergy account manager.

### Admin: OAuth setup fails

- Check the **redirect URI** registered with Total Synergy matches the one in the Numa wizard exactly.
- If the self-service `/Applications` page isn't available on your tenant, the application must be registered through Total Synergy support — including allow-listing the redirect URI.
- If OAuth proves troublesome for your tenant, the **API Key** path is the supported fallback — same data, simpler plumbing.
