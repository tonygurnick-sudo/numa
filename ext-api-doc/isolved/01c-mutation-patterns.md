---
api_name: isolved People Cloud
api_slug: isolved
base_url: https://{tenant}.myisolved.com/rest/api   (PER-TENANT — from the admin's Instance URL)
urls: relative preferred (`/employees`); absolute per-tenant on fallback (see 01)
call_surface: HTTP via `numa integrations request` (connector=isolved); POST/PUT pass JSON `body` (single object)
auth: OAuth2 client-credentials — company-level Bearer minted server-side; agent never sees it
field_casing: NOT confirmed — GET a real record and mirror its field names before composing any write body. Only `employment_status=ACTIVE` corroborated.
companions: 01=api-rules, 01a=domain-model, 01b=queries, 01d=events+errors
confidence: write SURFACE (new hires → Pending Employee; deductions; benefit enrollment) corroborated, all grant-gated; exact paths, body schemas, and the token path are [VERIFY WITH PARTNER DOCS]. NOT live-validated. Confirm with the user before any write; never fabricate body fields.
---

# isolved — Mutation Patterns

All writes via `numa integrations request` (connector=isolved), relative URL preferred, JSON `body`.
isolved is a **payroll/HR system of record** — writes touch people's pay, benefits, and employment.
Treat every mutation as high-stakes.

## Write Rules (read first)

1. **Confirm with the user before any write**, and echo back exactly what you're about to change.
   This is payroll/benefits data — irreversible-ish and consequential.
2. **Writes are grant-gated.** The integration can only write objects/methods in its allowed-methods
   grant. A write outside the grant → **403** (not a retry condition; it's a grant problem — 01a/01d).
3. **New hires post as Pending Employees**, not active employees. After a successful create, report
   "created as **pending** — finalise in isolved", never "the employee is now active".
4. **GET before you write.** Field names, types, enums, and code lists are **[VERIFY WITH PARTNER
   DOCS]** and **client-specific**. Fetch an existing record of the same object, mirror its real
   field names and code values, then compose the body. **Never invent a schema.**
5. **Resolve client-specific codes first** (employment status, deduction codes, benefit plan codes,
   pay/earnings codes) from live records — they differ per Client Code; reusing a code from another
   client/tenant will 422 or write garbage.
6. **No confirmed idempotency mechanism.** Treat POSTs as non-idempotent. On a timeout/5xx after a
   create, **search before re-creating** — and remember a create may have landed as a Pending
   Employee even if the response was lost.
7. **Exact paths + the token path are unconfirmed** `[VERIFY WITH PARTNER DOCS]`. Only write to a
   path the user/partner-docs confirmed or that you've seen return 2xx. Don't guess.

## Employees — new hire (create → Pending)

### Create — `POST /employees` [path VERIFY] → Pending Employee

- Posting an employee creates a **Pending Employee**: a new-hire record that must be **finalised
  inside isolved**. It does not become an active employee via the API.
- **Body schema: [VERIFY WITH PARTNER DOCS].** GET an existing employee first and mirror the real
  field names. Likely-needed groups (names unconfirmed): identity (name, SSN/national id),
  hire date, Client Code association, department/location, pay rate/type, employment status.
- After 2xx: confirm the record exists as pending, then tell the user it's **pending finalisation in
  isolved** and what (if anything) they must do there. Do **not** claim the hire is complete/active.

```
# 1) learn the schema from a real record
GET  /employees?employment_status=ACTIVE        → inspect one item's field names/codes
# 2) create (only if write is granted; AFTER user confirmation; body fields mirrored from step 1)
POST /employees   body { ...mirrored employee fields... }     → Pending Employee
# 3) verify
GET  /employees/{id or filter}                  → confirm it landed; report "pending"
```

### Update — `PUT/PATCH /employees/{id}` [method + path VERIFY]

Whether employee updates are supported, and via which verb/path, is **[VERIFY WITH PARTNER DOCS]**.
If you can't confirm the method/path, don't attempt it — ask the user or point them to isolved.

## Deductions [path VERIFY]

Maintaining per-employee deductions is part of the corroborated write surface, grant-gated. Exact
path, verb, and body **[VERIFY WITH PARTNER DOCS]**.

- **Resolve the deduction code list from live records first** — codes are client-specific.
- Mind effective-dating: deductions usually have effective dates; whether the API exposes them, and
  how, is **[VERIFY]**. Confirm with the user what effective date they intend.
- Echo the employee + deduction code + amount + effective date before writing.

## Benefit Enrollment [path VERIFY]

Maintaining benefit elections/enrollment is part of the corroborated write surface, grant-gated.
Exact path, verb, and body **[VERIFY WITH PARTNER DOCS]**.

- Benefit **plan codes** are client-specific — resolve from live records; never hardcode.
- Enrollment is often window-bound (open enrollment / qualifying events) — a write outside a valid
  window may 422 even with a correct body. Confirm the user expects the write to be valid now.

## Payroll [path VERIFY]

Payroll writes (e.g. pushing pay data / running payroll) are **the highest-risk** surface and may
not be granted at all. Do **not** attempt a payroll mutation unless the user explicitly asks, the
path/verb/body are **confirmed**, and the write is within the integration's grant. When unsure,
decline and explain that payroll writes need confirmed partner-doc paths + an explicit grant.

## What you CANNOT mutate

| Wish                                  | Reality                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| Make a new hire instantly active      | Creates land as **Pending Employees**; finalisation happens in isolved                  |
| Write an object outside the grant     | 403 — the allowed-methods whitelist forbids it; fix the grant, don't retry              |
| Use a code from another client/tenant | Codes are client-specific — resolve from live records or expect 422                     |
| Set the `Authorization` header        | Backend-injected (company-level client-credentials token)                               |
| Rely on idempotent retries            | No confirmed idempotency keys; search-before-recreate (a create may be a stray Pending) |

## Post-Write Verification

isolved write responses + their bodies are **[VERIFY WITH PARTNER DOCS]**. After any write:

1. **GET the record back** and confirm the changed fields / that the pending record exists.
2. For a new hire, explicitly state it is **pending** and what remains to finalise it in isolved.
3. Keep an in-conversation log of writes (object, id, change) — there is no confirmed API-side undo,
   and a failed step in a multi-write sequence must be reported precisely.
4. On 5xx/timeout after a create, **search before retrying** — the record may already exist as
   Pending. On 403, stop and treat it as a grant problem (01a/01d), not a body problem.
