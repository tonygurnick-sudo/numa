---
api_name: isolved People Cloud
api_slug: isolved
base_url: https://{tenant}.myisolved.com/rest/api   (PER-TENANT — from the admin's Instance URL)
urls: relative preferred (`/employees?...`); absolute per-tenant on fallback (see 01)
call_surface: HTTP via `numa integrations request isolved <METHOD> <url>` (auth injected by Numa)
auth: OAuth2 client-credentials — company-level Bearer minted server-side; agent never sees it
field_casing: only `employment_status=ACTIVE` corroborated; everything else [VERIFY WITH PARTNER DOCS]
companions: 01=api-rules, 01a=domain-model, 01c=mutations, 01d=events+errors
confidence: ONE filter (`employment_status=ACTIVE`) is corroborated; pagination, sorting, date filters, and exact paths are [VERIFY WITH PARTNER DOCS]. Do NOT assume JobAdder-style grammar. Inspect the first live response envelope before building loops.
---

# isolved — Query Patterns

All reads go through the workspace agent's connector request command. Prefer a **relative URL**
(`/employees?employment_status=ACTIVE`) so Numa expands it against the configured **per-tenant**
base (`https://{tenant}.myisolved.com/rest/api`) and injects the company-level Bearer token. Never
set an Authorization header.

Call form (memorise this — recipes below are just method + URL fed to it):

```
numa integrations request isolved GET "/employees?employment_status=ACTIVE" -m "list active employees"
```

> ⚠️ **Most of isolved's query grammar is unverified.** The authoritative `/rest` reference is
> login-walled. The single corroborated filter is `employment_status=ACTIVE`. Pagination, sorting,
> date filtering, field selection, and exact endpoint paths are all **[VERIFY WITH PARTNER DOCS]**.
> Do not assume this API behaves like JobAdder or any other connector. **Observe the live response
> before generalising.**

## The one corroborated filter

```
GET /employees?employment_status=ACTIVE
```

- `employment_status` — corroborated as a query filter on the employee list; `ACTIVE` is the
  corroborated value. Exact casing of the param, and other values (e.g. terminated / on-leave),
  are **[VERIFY WITH PARTNER DOCS]**.
- Use this as the default "current employees" query. If it 400s, the param name/casing differs from
  what's documented here — drop it, fetch unfiltered (if granted), and report the discrepancy.

## Pagination — UNKNOWN, inspect the envelope first

**The pagination scheme is not published `[VERIFY WITH PARTNER DOCS]`.** Do NOT assume offset/limit,
page-number, or cursor. Procedure on the first list call:

1. Fetch one page: `GET /employees?employment_status=ACTIVE`.
2. **Inspect the response envelope** for any of: a `totalCount`/`total`/`count`, a `next`/`nextLink`/
   `links.next`, a `page`/`pageNumber`/`pageSize`, or a `hasMore`/`isLastPage` flag.
3. Follow whatever the response actually exposes. If it's a bare array with no paging metadata,
   assume the page may be capped and tell the user the result might be partial.
4. Until you've confirmed the scheme on a live call, **report counts as "at least N (pagination
   unconfirmed)"**, not as exact totals.

Do not invent `?offset=`/`?limit=`/`?page=` params — passing an unsupported param may be silently
ignored (giving you a false sense of completeness) or 400.

## Sorting / date filtering / field selection — UNKNOWN

- **Sorting:** no confirmed `sort` grammar `[VERIFY WITH PARTNER DOCS]`. If you need ordering and no
  sort param is confirmed, fetch and sort client-side.
- **Date filtering:** no confirmed date-filter grammar. Do **not** use `>`/`<` prefix operators
  (that's JobAdder, not isolved). For change detection, see the polling notes in 01d — and verify
  whether any `updated`-style filter exists before relying on it.
- **Field selection / expansion:** no confirmed `fields=`/`expand=` mechanism `[VERIFY]`.

## Entity reads (corroborated surface; exact paths VERIFY WITH PARTNER DOCS)

### Employees — `GET /employees` [path VERIFY]

| Param               | Status           | Notes                                               |
| ------------------- | ---------------- | --------------------------------------------------- |
| `employment_status` | **corroborated** | `ACTIVE` confirmed; other values/casing [VERIFY]    |
| id (path or query)  | [VERIFY]         | get a single employee — confirm the shape from docs |
| anything else       | [VERIFY]         | do not assume                                       |

### Payroll — `GET ...` [path VERIFY]

Read pay records/runs. Exact path + filters **[VERIFY WITH PARTNER DOCS]**. Likely scoped to an
employee and/or a pay period — confirm before building queries.

### Deductions — `GET ...` [path VERIFY]

Per-employee deduction lines. Exact path + filters **[VERIFY WITH PARTNER DOCS]**; likely
employee-scoped.

### Benefit Enrollment — `GET ...` [path VERIFY]

Per-employee benefit elections. Exact path + filters **[VERIFY WITH PARTNER DOCS]**; likely
employee-scoped.

## Common Recipes

Each is `numa integrations request isolved GET <url>`:

1. **Active employees (default "who works here")**:
   `GET /employees?employment_status=ACTIVE` → mirror the returned envelope; report count as
   provisional until pagination is confirmed.

2. **Connection sanity check** (smallest granted read): the same employee call. 200 = token mint +
   grant OK · 401 = mint failed (admin must check the company credential, 04) · 403/404 = object not
   granted or per-client access/Refresh not done.

3. **A specific employee** (only with a path/id shape confirmed by the user's docs):
   `GET /employees/{id}` [VERIFY path + id shape]. If you don't have a confirmed path, ask the user
   for it or fetch the list and match in-memory — do **not** guess the single-record path.

4. **Payroll / Deductions / Benefit Enrollment**: only call with a path the user/partner-docs have
   confirmed. If unconfirmed, say so and request the path — fabricating it risks 404s that look like
   grant problems and waste the user's time.

## Read Discipline

1. **Prefer relative URLs** so the per-tenant base resolves; fall back to the absolute per-tenant
   URL only if you hit "No base URL is configured" (01/03).
2. **Inspect the first response envelope** to learn the real pagination/field shape before
   generalising — this API is under-documented; live data is the source of truth.
3. **Don't fabricate paths or params.** Only `employment_status=ACTIVE` and the per-tenant
   `/rest/api` base are corroborated; everything else is `[VERIFY WITH PARTNER DOCS]`.
4. **Treat 403/404 as a grant/setup signal** (01a/01d), not a cue to mutate the URL repeatedly.
5. **Mind PII** — employee/payroll/benefit data is sensitive; return only what was asked.
6. **Pace conservatively** (≤ ~2 calls/sec, sequential) — rate limits are unpublished.
