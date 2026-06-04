# 09 — Billing admins (who may see credit data in-client)

A second visibility layer on top of `SHOW_CREDITS`. `SHOW_CREDITS` decides whether the credit view exists
for a client **at all**; **billing-admin** decides **which users within that client** may see it.

```
SHOW_CREDITS (client-level flag)   →  is the Credits view available for this client?
        └─ billing-admin (per-user)  →  which users may actually see the numbers?
```

A plain admin still sees the **Credits tab** (so they know it exists) but gets a **lock screen** —
_"Only billing admins can see credit information"_ — until a billing-admin grants them access. Cost,
margin and credit figures are sensitive; this keeps them to a designated few, not every workspace admin.

---

## Why a DynamoDB list, NOT a Cognito group

This is the key design decision. Role changes in Numa are **client-side**: `numa-frontend`'s
`userManagementUtils.ts` calls `AdminAddUserToGroup` directly from the browser using the admin's own IAM
creds (the `manageUsers` feature-set grants it). So **any admin could add themselves to a `billing-admin`
Cognito group** with a hand-crafted SDK call — the rule "only a billing-admin promotes another" would be
unenforceable, and IAM can't scope `AdminAddUserToGroup` to "all groups except billing-admin".

Instead, membership lives in the **credit-ledger table** as `CLIENT#/BILLING_ADMIN#<sub>` rows. Admins'
browser IAM creds can write chat-history (scoped to their own username) but **not** the ledger table — so
the only way to grant billing-admin is a **server path that checks the caller** (the `admin-credits`
Lambda) or the **portal** (Arcanum, via assume-role). That makes "only a billing-admin promotes another"
**actually enforceable**, with Arcanum bootstrapping the first one. (It also avoids the Cognito
identity-pool role hazard: a user in two role-groups can break the `Groups` session-tag trust condition
and lose AWS access — never an issue here, since billing-admin isn't a role group.)

---

## Data model

| PK                | SK                    | What it is                                                                                       |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| `CLIENT#<client>` | `BILLING_ADMIN#<sub>` | A billing-admin grant. Fields: `sub`, `email`, `grantedBy` (caller sub / `portal`), `grantedAt`. |

Listing the roster = query `PK = CLIENT#<client>, begins_with(SK, "BILLING_ADMIN#")`. Membership check =
`GetItem` on `BILLING_ADMIN#<callerSub>`.

---

## The API — `admin-credits` Lambda

`lambdas/node/admin-credits/index.ts`. (`adminCreditsPolicy` already grants `PutItem`/`DeleteItem` on the
ledger, so no IAM change was needed — just the two routes in
`app-agnostic-api-gateway-lambda-collection.ts`.)

- **Gate** — `GET /credits/balance` + `GET /credits/ledger` now require **billing-admin** (`isBillingAdmin`
  reads the `BILLING_ADMIN#<callerSub>` row). A non-member gets **`403 { error: "not_billing_admin" }`** —
  the in-client lock screen reacts to this (defence-in-depth; the UI also checks first, below).
- **`GET /credits/billing-admins`** — any admin may read: returns `{ isBillingAdmin, admins[] }` (the
  caller's own status + the roster, so a locked-out admin sees who to ask and User Management can render
  badges).
- **`POST /credits/billing-admins`** `{action:'grant'|'revoke', sub, email?}` — **server-enforced**: the
  caller must already be a billing-admin (`403 not_billing_admin` otherwise), and the **last** billing-admin
  can't be revoked (`409 last_billing_admin` — Arcanum re-seeds via the portal if a client ever loses it).

Frontend service: `numa-frontend/src/Services/AdminCreditsService.ts` — `getBillingAdmins()` / `setBillingAdmin(action, sub, email)`.

---

## In-client UX

- **Lock screen** — `CreditsDashboardPanel` calls `getBillingAdmins()` first; if the caller isn't a
  billing-admin it renders the lock screen (with the roster — "ask one of …") and **never fetches** the
  credit data. (The API 403 is the backstop.)
- **User Management** — a **"Billing access"** grant/revoke control on **admin** users, shown only when
  `SHOW_CREDITS` is on and **enabled only for billing-admin callers**; plus a **Billing** badge in the user
  table. Wired in `UserManagement.tsx` → `UserDetailsModal.tsx` / `UserTableView.tsx`, calling the
  `admin-credits` POST. This is **peer-propagation** — an existing billing-admin promotes others.

---

## The portal bootstrap tool

`numa-customer-success-portal/src/components/BillingAdminsPanel.tsx`, mounted on the **NumaCredits** page
per client. Arcanum-side, via `ArcanumAIAccess` assume-role (same path `creditsService` already uses to push
the CONFIG row):

- Lists the client's Cognito users (`creditsService.listClientUsers` → cross-account `ListUsers`) + the
  current billing-admin roster.
- **Promote / Revoke** writes/deletes the `BILLING_ADMIN#<sub>` row and **logs to the portal activity table**.
- This **seeds the first** billing-admin per client; in-client peer-propagation handles the rest.

---

## Rollout & deploy order (matters)

1. **Deploy together**: the `admin-credits` gate change + the in-client lock screen. Deploying the gate
   **ahead** of the lock screen means plain admins get raw `403`s instead of the friendly lock state.
2. **Seed the first billing-admin** via the portal tool (the only bootstrap path — the API requires an
   existing billing-admin).
3. From then on, billing-admins **self-propagate** from in-client User Management.

Until a client has a billing-admin seeded, **every** admin sees the lock screen (intended).

---

## Enforcement summary

Hard, not advisory: billing-admin membership can only be written by a **caller-checked server endpoint**
(`admin-credits` POST, caller must be a billing-admin) or by **Arcanum** (the portal, via assume-role). A
workspace admin **cannot** self-grant — they have no write path to the ledger table. The last billing-admin
is protected from removal.
