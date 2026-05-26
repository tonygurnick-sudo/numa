# NetSuite REST — Workspace Agent API Rules

> **Purpose:** Concise rules for any LLM calling NetSuite via the SuiteTalk REST + SuiteQL surfaces.
> **Protocol:** HTTPS (record CRUD) + JSON SuiteQL | **Auth:** OAuth 2.0 (PKCE optional for confidential clients, recommended)
> **Surfaces:** SuiteTalk REST (`/services/rest/record/v1`), SuiteQL (`/services/rest/query/v1/suiteql`), RESTlets (`/app/site/hosted/restlet.nl`)

---

## When to use this vs MCP

| You should use REST when…                                                                                                                               | You should use MCP (`mcp_call`) when…                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| The integration record's Scope is `REST Web Services`, `RESTlets`, or `SuiteAnalytics Connect` (or any combination — they're combinable on one record). | The integration record's Scope is `NetSuite AI Connector Service` (`mcp`).          |
| You need explicit control over which records / fields you read or write.                                                                                | You want NetSuite's pre-defined JSON-RPC tools to handle field discovery for you.   |
| You need to run SuiteQL directly (it's fastest for ad-hoc reporting).                                                                                   | You're happy delegating queries to `ns_runCustomSuiteQL` (which itself is SuiteQL). |

If a REST call returns `INVALID_LOGIN_ATTEMPT — Insufficient scope`, the integration record is mcp-scoped — switch to `mcp_call`. The two scopes are mutually exclusive on a single integration record.

---

## Connection

| Setting          | Value                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Record API base  | `https://<accountid>.suitetalk.api.netsuite.com/services/rest/record/v1`                           |
| SuiteQL endpoint | `https://<accountid>.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`                    |
| Auth header      | `Authorization: Bearer <access_token>`                                                             |
| Content-Type     | `application/json` (for POST/PATCH)                                                                |
| Prefer (SuiteQL) | `Prefer: transient` (recommended — prevents NetSuite from saving the query as a search definition) |

Through the `connectors.request` op the agent only sees the **relative path** — the backend prepends the per-account base automatically using the saved Account ID. So in practice:

```
connectors(name="request", params={
    connector: "netsuite",
    method: "GET",
    url: "/services/rest/record/v1/customer?limit=1",
    description: "Smoke-test NetSuite REST connection"
})
```

is equivalent to hitting `https://<accountId>.suitetalk.api.netsuite.com/services/rest/record/v1/customer?limit=1` with the user's Bearer token attached.

---

## Critical Rules (violations = broken requests)

1. **SuiteQL is Oracle-dialect SQL, NOT standard SQL.**
   - Use `||` for string concatenation (not `+` or `CONCAT`).
   - Use `TO_DATE('2024-01-01', 'YYYY-MM-DD')` for date literals.
   - Use `NVL(field, default)` (not `ISNULL` / `IFNULL`).
   - Use `SUBSTR(str, pos, len)` (not `SUBSTRING`).
   - Use `ROWNUM` for limiting rows (not `LIMIT`, `OFFSET`, `TOP`).
   - **No CTEs** (`WITH … AS`), **no recursive queries**, **no window functions outside the supported list**.
   - `IN` clause max: 1,000 items.
   - Booleans: `'T'` / `'F'` (not `true` / `false`).

2. **SuiteQL response shape.** POST `/services/rest/query/v1/suiteql` with `{ "q": "<sql>" }` and `Prefer: transient`. Response:

   ```json
   {
     "links": [...],
     "count": 10,
     "hasMore": true,
     "offset": 0,
     "totalResults": 1247,
     "items": [{ "id": "123", "companyname": "Acme" }, ...]
   }
   ```

   Use `?limit=<n>&offset=<m>` query params for pagination. Default page size is 10; max 1,000 per page.

3. **Pagination on Record API.** GET `/services/rest/record/v1/customer?limit=100&offset=200`. Same `hasMore` / `links[]` shape. The default page size is 10 — **always pass an explicit `limit`** unless you want one record. Maximum `limit` is 1,000.

4. **Record GETs return refs, not field values, by default.** `GET /services/rest/record/v1/customer/123` returns the resource with field-name keys, but related records appear as `{ "id": "…", "links": [{ "rel": "self", "href": "…" }] }` — you have to follow the link or use `?expandSubResources=true` to get nested data inline.

5. **`fields` query param trims the response.** Use `?fields=id,companyname,email` on Record GETs to return only the listed fields. Saves bandwidth and is much faster on wide records like `customer`.

6. **POST / PATCH bodies are nested JSON.** Both `POST /services/rest/record/v1/customer` and `PATCH /services/rest/record/v1/customer/123` accept the JSON body directly (no `data` wrapper, unlike MCP). Field types must match — strings for `text`, ISO dates for `date`, references as `{ "id": "<internalid>" }`.

7. **DELETE works.** Unlike MCP (which has no delete tool), REST supports `DELETE /services/rest/record/v1/<recordType>/<id>`. **This is destructive** — only call it after explicit user approval via the `request` op's built-in approval gate.

8. **There is no `links[].rel = "next"` on the last page.** `hasMore: false` is the authoritative end-of-results signal. Don't infer from link count alone.

9. **Error envelope.** All REST errors return:

   ```json
   {
     "type": "https://www.netsuite.com/error/...",
     "title": "Invalid login attempt",
     "status": 401,
     "o:errorCode": "INVALID_LOGIN",
     "o:errorDetails": [{ "detail": "...", "o:errorPath": "..." }]
   }
   ```

   Parse `o:errorCode` for branching:
   - `INVALID_LOGIN` → token expired, refresh and retry.
   - `INVALID_LOGIN_ATTEMPT` + `Insufficient scope` → integration record is mcp-scoped, switch to `mcp_call`.
   - `USER_ERROR` → role lacks the record permission; tell the user.
   - `CONCURRENCY_LIMIT_EXCEEDED` → 429; back off exponentially (1s, 2s, 4s, …). NetSuite does NOT return a `Retry-After` header.
   - `RCRD_DSNT_EXIST` → record ID not found.
   - `VALIDATION_ERROR` → body field type/format wrong; `o:errorDetails[].o:errorPath` names the offending field.

10. **Concurrency, not rate.** NetSuite governs by parallel in-flight requests, not requests-per-second. Standard tier = 5 concurrent. Premium = 10. Going over returns HTTP 429 with `CONCURRENCY_LIMIT_EXCEEDED`. Don't fire requests in parallel without throttling.

11. **JWT access token, ~3600s lifetime.** Don't validate the signature client-side; just present it. The backend handles refresh automatically via the OAuth handler when the saved token is within 5 minutes of expiry.

---

## Common Patterns

### Look up a customer by company name (SuiteQL — fastest)

```
connectors(name="request", params={
    connector: "netsuite",
    method: "POST",
    url: "/services/rest/query/v1/suiteql",
    headers: { "Prefer": "transient" },
    body: { "q": "SELECT id, companyname, email FROM customer WHERE LOWER(companyname) LIKE '%acme%' AND ROWNUM <= 10" },
    description: "Find customers matching Acme"
})
```

### Fetch a single record by internal ID

```
connectors(name="request", params={
    connector: "netsuite",
    method: "GET",
    url: "/services/rest/record/v1/customer/12345?fields=id,companyname,email,subsidiary",
    description: "Get customer 12345"
})
```

### Create a record

```
connectors(name="request", params={
    connector: "netsuite",
    method: "POST",
    url: "/services/rest/record/v1/customer",
    body: {
        "companyname": "Acme Corp",
        "email": "info@acme.com",
        "subsidiary": { "id": "1" }
    },
    description: "Create customer Acme Corp"
})
```

Returns `201 Created` with a `Location` header containing the new record's internal ID; the response body is empty by default. Pass `?expandSubResources=true` to get the full record back inline.

### Update fields on an existing record (partial — PATCH)

```
connectors(name="request", params={
    connector: "netsuite",
    method: "PATCH",
    url: "/services/rest/record/v1/customer/12345",
    body: { "phone": "+1-555-0100" },
    description: "Update phone on customer 12345"
})
```

### Run a saved search via SuiteQL

NetSuite saved searches are exposed through the REST API as `customsearch_xxx` table-valued functions. Query them like any other SuiteQL table:

```
{ "q": "SELECT * FROM (customsearch_my_open_invoices) WHERE ROWNUM <= 100" }
```

---

## What's NOT in REST that IS in MCP (and vice versa)

- **MCP has `ns_listSavedSearches` / `ns_runSavedSearch` / `ns_listAllReports` / `ns_runReport` as discoverable methods.** REST has no equivalent introspection — you need to know the search/report internal ID in advance. SuiteQL against `searchresult` / `transactionsearch` can substitute for many saved-search use cases.
- **REST has `DELETE`.** MCP does not — there is no delete tool in `com.netsuite.mcpstandardtools`.
- **REST returns Oracle-typed errors with `o:errorCode`.** MCP returns JSON-RPC error envelopes with method-specific error codes.
- **REST supports bulk operations through SuiteTalk REST async jobs** (POST `/services/async/customer` etc.). MCP does not.

---

## Reference

- REST API Browser: https://system.netsuite.com/help/helpcenter/en_US/APIs/REST_API_Browser/record/v1/2024.1/index.html
- SuiteQL docs: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156257770590.html
- Status page: https://status.netsuite.com
- Connector setup (account ID, integration record, scopes): see `03-connector-setup.md` in this folder.
