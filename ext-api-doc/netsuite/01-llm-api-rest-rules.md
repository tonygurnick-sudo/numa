---
api_name: NetSuite SuiteTalk REST + SuiteQL
api_slug: netsuite
call_surface: HTTP via `numa integrations request` (connector="netsuite"). For the MCP surface see 01-llm-api-rules.md.
record_api_base: https://{accountid}.suitetalk.api.netsuite.com/services/rest/record/v1
suiteql_endpoint: https://{accountid}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql
path_passed_to_request: relative path only (e.g. `/services/rest/record/v1/customer`) — backend prepends `https://{accountid}.suitetalk.api.netsuite.com` from the saved Account ID
path_version_segment: literal `/v1/` IS in the path (real segment, not a label)
auth: Bearer {access_token} (JWT RS256, ~3600s; backend auto-refreshes when <5min to expiry)
content_type: application/json (POST/PATCH)
field_casing: lowercase
id_format: integer internal id
rate_limit: concurrency-based (Standard 5 / Premium 10 parallel in-flight); 429 CONCURRENCY_LIMIT_EXCEEDED; no Retry-After header
mcp_vs_rest: use REST when the integration record scope is rest_webservices / restlets / suite_analytics. Use MCP (`mcp_call`, see 01-llm-api-rules.md) when scope is mcp. Scopes are mutually exclusive on one record. REST returning `INVALID_LOGIN_ATTEMPT — Insufficient scope` ⇒ record is mcp-scoped, switch to mcp_call.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors, 02=dev-spec, 03=connector-setup, 04=reauth
---

# NetSuite REST — API Rules

## Surface (read first)

- Call via `numa integrations request` with `connector: "netsuite"`. Pass the **relative path** (`/services/rest/record/v1/customer?limit=1`); the backend prepends `https://{accountid}.suitetalk.api.netsuite.com` from the saved Account ID. `/v1/` is a REAL path segment.
- Surfaces: SuiteTalk REST Record API (`/services/rest/record/v1`), SuiteQL (`/services/rest/query/v1/suiteql`), RESTlets (`/app/site/hosted/restlet.nl`).
- Example:
  ```
  numa integrations request connector=netsuite method=GET url=/services/rest/record/v1/customer?limit=1 -m "Smoke-test NetSuite REST"
  ```

## Critical rules (violations = broken requests)

1. **SuiteQL is Oracle-dialect SQL, NOT standard SQL:** concat `||` (not `+`/`CONCAT`); dates `TO_DATE('2024-01-01','YYYY-MM-DD')`; null `NVL(field,default)` (not ISNULL/IFNULL); substring `SUBSTR(str,pos,len)` (not SUBSTRING); row limit `ROWNUM` (not LIMIT/OFFSET/TOP); NO CTEs (`WITH … AS`), no recursive queries, no window functions outside the supported list; `IN` max 1000 items; booleans `'T'`/`'F'`.
2. **SuiteQL call:** `POST /services/rest/query/v1/suiteql` with body `{"q":"<sql>"}` and header `Prefer: transient` (prevents NetSuite saving the query as a search). Response: `{"links":[…],"count":10,"hasMore":true,"offset":0,"totalResults":1247,"items":[{"id":"123","companyname":"Acme"}]}`. Paginate with `?limit=<n>&offset=<m>`; default page 10, max 1000/page.
3. **Record API pagination:** `GET /services/rest/record/v1/customer?limit=100&offset=200`. Same `hasMore`/`links[]` shape. Default page size 10 — ALWAYS pass explicit `limit` (max 1000) unless you want one record.
4. **Record GETs return refs, not values, by default.** Related records appear as `{"id":"…","links":[{"rel":"self","href":"…"}]}`. Follow the link or use `?expandSubResources=true` for nested data inline.
5. **`fields` param trims response.** `?fields=id,companyname,email` on Record GETs returns only listed fields — much faster on wide records like `customer`.
6. **POST/PATCH bodies are nested JSON, sent directly (no `data` wrapper, unlike MCP).** Both `POST /services/rest/record/v1/customer` and `PATCH /services/rest/record/v1/customer/123`. Types must match: strings for text, ISO dates for date, references as `{"id":"<internalid>"}`.
7. **DELETE works** (unlike MCP): `DELETE /services/rest/record/v1/<recordType>/<id>`. Destructive — only after explicit user approval via the `request` op approval gate.
8. **End-of-results = `hasMore: false`** (authoritative). There is no `links[].rel="next"` on the last page; don't infer from link count.
9. **Concurrency, not rate.** NetSuite governs by parallel in-flight requests: Standard 5, Premium 10. Over limit → HTTP 429 `CONCURRENCY_LIMIT_EXCEEDED`, no `Retry-After`. Throttle parallelism; back off exponentially (1s,2s,4s,…).
10. **JWT access token (~3600s).** Don't validate the signature; just present it. Backend auto-refreshes when within 5 min of expiry.

## Error envelope

```json
{
  "type": "https://www.netsuite.com/error/...",
  "title": "Invalid login attempt",
  "status": 401,
  "o:errorCode": "INVALID_LOGIN",
  "o:errorDetails": [{ "detail": "...", "o:errorPath": "..." }]
}
```

Branch on `o:errorCode`:

- `INVALID_LOGIN` → token expired; refresh and retry.
- `INVALID_LOGIN_ATTEMPT` + `Insufficient scope` → record is mcp-scoped; switch to `mcp_call`.
- `USER_ERROR` → role lacks the record permission; tell the user.
- `CONCURRENCY_LIMIT_EXCEEDED` → 429; exponential backoff (no Retry-After).
- `RCRD_DSNT_EXIST` → record id not found.
- `VALIDATION_ERROR` → body field type/format wrong; `o:errorDetails[].o:errorPath` names the field.

## Common patterns

**Look up customer by name (SuiteQL — fastest):**

```
numa integrations request connector=netsuite method=POST url=/services/rest/query/v1/suiteql headers={"Prefer":"transient"} body={"q":"SELECT id, companyname, email FROM customer WHERE LOWER(companyname) LIKE '%acme%' AND ROWNUM <= 10"} -m "Find customers matching Acme"
```

**Fetch one record by internal id:**

```
numa integrations request connector=netsuite method=GET url=/services/rest/record/v1/customer/12345?fields=id,companyname,email,subsidiary -m "Get customer 12345"
```

**Create a record** — returns `201 Created` with a `Location` header carrying the new internal id; body empty by default (pass `?expandSubResources=true` for the full record inline):

```
numa integrations request connector=netsuite method=POST url=/services/rest/record/v1/customer body={"companyname":"Acme Corp","email":"info@acme.com","subsidiary":{"id":"1"}} -m "Create customer Acme Corp"
```

**Partial update (PATCH):**

```
numa integrations request connector=netsuite method=PATCH url=/services/rest/record/v1/customer/12345 body={"phone":"+1-555-0100"} -m "Update phone on customer 12345"
```

**Run a saved search via SuiteQL** — saved searches are exposed as `customsearch_xxx` table-valued functions: `{"q":"SELECT * FROM (customsearch_my_open_invoices) WHERE ROWNUM <= 100"}`.

## REST vs MCP feature differences

- MCP has discoverable `ns_listSavedSearches`/`ns_runSavedSearch`/`ns_listAllReports`/`ns_runReport`. REST has no introspection — you must know the search/report internal id in advance (SuiteQL against `searchresult`/`transactionsearch` substitutes for many saved-search uses).
- REST has `DELETE`; MCP has no delete tool.
- REST returns Oracle-typed errors with `o:errorCode`; MCP returns JSON-RPC error envelopes.
- REST supports bulk via SuiteTalk async jobs (`POST /services/async/customer` etc.); MCP does not.

## Reference

- REST API Browser: https://system.netsuite.com/help/helpcenter/en_US/APIs/REST_API_Browser/record/v1/2024.1/index.html
- SuiteQL docs: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156257770590.html
- Status: https://status.netsuite.com
- Connector setup (account id, integration record, scopes): see 03-connector-setup.md.
