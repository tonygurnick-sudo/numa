---
api_name: isolved People Cloud
api_slug: isolved
base_url: https://{tenant}.myisolved.com/rest/api   (PER-TENANT — from the admin's Instance URL)
urls: relative preferred (`/employees`); absolute per-tenant on fallback (see 01)
call_surface: HTTP via `numa integrations request` (connector=isolved)
auth: OAuth2 client-credentials — company-level Bearer minted server-side; no per-user OAuth
field_casing: NOT confirmed — mirror live GET responses; only `employment_status=ACTIVE` corroborated
companions: 01=api-rules, 01b=queries, 01c=mutations, 01d=events+errors
confidence: object families (Employees/Payroll/Deductions/Benefit Enrollment) + Client-Code access unit + Pending-Employee-on-create corroborated across third-party integrators; ALL field-level schemas and exact paths are [VERIFY WITH PARTNER DOCS]. Do NOT fabricate fields — GET a real record and mirror it before writing.
---

# isolved — Domain Model Reference

> **Read this whole file as provisional.** isolved's authoritative `/rest` object reference is
> login-walled. What's corroborated across independent integrators (Finch, Merge, CozyROC, RoboMQ)
> is the **shape**: which objects exist, the access model (Client Code), and that new hires post as
> Pending Employees. **Field names, types, enums, and exact paths are `[VERIFY WITH PARTNER DOCS]`.**
> When in doubt: GET a real record, mirror its actual field names, and never invent a schema.

## HCM Hierarchy

```
Tenant host  →  https://{tenant}.myisolved.com   (per-tenant; e.g. rkl.myisolved.com)
  └── Client Code  (one isolved company / legal entity; the UNIT OF ACCESS)
        └── Employee  (the central object)
              ├── Payroll            (pay records / runs)
              ├── Deductions         (per-employee deduction lines)
              └── Benefit Enrollment (per-employee benefit elections)
```

Consequences:

- The **Client Code** is what the partner integration is granted access to (Security → Partner
  Users → Client Access). Access is **per Client Code**, not automatically tenant-wide. A tenant
  may contain several Client Codes; each needs its own grant + Refresh System Data (see 04).
- The **Employee** is the spine — Payroll, Deductions, and Benefit Enrollment all hang off
  employees within a Client Code.
- Capability is defined by the **allowed-methods grant**, not by the object model. An object below
  may be entirely read-only, write-enabled, or invisible to _this_ integration depending on the
  grant. Treat 403/404 as "not granted", not "doesn't exist".

## Access & Auth Model (recap — see 01/04 for detail)

- **One company-level service credential** (`client_id` + `client_secret`) mints a Bearer token via
  `grant_type=client_credentials`. No per-user identity travels in calls — results reflect the
  _integration's_ grant on the Client Code, not "the current user's" view.
- The token endpoint is `{instance}/rest/api/token` — **exact path [VERIFY WITH PARTNER DOCS]**.

## ID & Format Semantics

- Employee/record id shapes: **[VERIFY WITH PARTNER DOCS]** (could be numeric employee numbers,
  GUIDs, or composite Client-Code+employee keys — confirm from a live record).
- Timestamps: assume ISO-8601 until a live record proves otherwise [VERIFY].
- Field casing: the one corroborated example is snake_case with an uppercase value
  (`employment_status=ACTIVE`); do **not** generalise that across all fields — mirror live data.

## Employee — `/employees` [path VERIFY]

The primary object. Corroborated facts:

- **Filterable by employment status:** `employment_status=ACTIVE` (exact param/casing/values
  `[VERIFY WITH PARTNER DOCS]`; other likely values such as TERMINATED/LEAVE are unconfirmed).
- **Create → Pending Employee:** posting a new employee creates a **pending** record finalised
  inside isolved, not an immediately-active employee. This is a one-way "submit for onboarding",
  not an atomic activation.

| Field group        | Notes                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Identity           | name, employee id/number — exact field names [VERIFY]              |
| Employment status  | the corroborated filter axis (`employment_status`) [VERIFY values] |
| Dates              | hire / termination / rehire dates [VERIFY]                         |
| Org                | department / location / Client Code association [VERIFY]           |
| Compensation       | pay rate / type [VERIFY]                                           |
| Contact / personal | address, contact, demographics [VERIFY — PII; handle carefully]    |

> **PII caution:** employee records carry personal data. Surface only what the user asked for; do
> not dump full employee records casually.

## Payroll [path VERIFY]

Pay records / runs associated with employees. Read access is the corroborated surface; any write is
strictly grant-gated and high-risk (changing pay). Exact object(s), fields, and whether this is
read-only for the integration are **[VERIFY WITH PARTNER DOCS]**.

## Deductions [path VERIFY]

Per-employee deduction lines (e.g. benefits, garnishments, retirement). Corroborated as a
read + some-write surface (maintaining employee deductions), subject to the grant. Deduction codes
are **client-specific** — resolve/verify against the live tenant, never hardcode. Exact schema
**[VERIFY WITH PARTNER DOCS]**.

## Benefit Enrollment [path VERIFY]

Per-employee benefit elections / enrollment. Corroborated as read + some-write, grant-gated. Plan
codes and election structures are **client-specific** [VERIFY]. Exact schema
**[VERIFY WITH PARTNER DOCS]**.

## State Machines

- **New hire lifecycle:** `create → Pending Employee → (finalised in isolved) → active employee`.
  The API create only reaches the Pending state; activation/finalisation happens inside isolved.
  Exact intermediate states/transitions **[VERIFY WITH PARTNER DOCS]**.
- Payroll-run lifecycle, enrollment windows, deduction effective-dating: **[UNKNOWN — VERIFY]**.

## Configuration / Code Lists (resolve BEFORE writing — client-specific)

isolved is heavily client-configured. Codes you'll need before composing writes — and which differ
per Client Code — include employment statuses, deduction codes, benefit plan codes, pay/earnings
codes, departments, and locations. **There is no confirmed lookup endpoint** for these
**[VERIFY WITH PARTNER DOCS]**; in practice, derive valid values by GETting existing records and
mirroring the codes they use, rather than inventing them. Never reuse a code list across Client
Codes or tenants.

## Allowed-Methods Grant (what 403/404 is about)

isolved whitelists, per partner integration, the specific methods/objects the integration may call.
This is the closest analogue to OAuth scopes, but it is configured on the **isolved side per
integration**, not requested at the token endpoint (whether any scope string is passed at the token
endpoint at all is **[VERIFY WITH PARTNER DOCS]**).

- A read you weren't granted → **403/404**.
- A write on an object granted read-only → **403**.
- Everything 403/404 for a specific Client Code → the **per-client access grant + Refresh System
  Data** step is missing (04), not a code bug.

When reporting a 403/404, name the object/method you attempted and point at the grant + per-client
setup — don't suggest "reconnecting" (there is no per-user reconnect for a client-credentials
connector).
