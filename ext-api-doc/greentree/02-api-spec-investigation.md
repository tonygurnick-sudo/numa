---
api_name: MYOB Greentree API
api_slug: greentree
base_url: NONE — per-customer instance URL; no shared host, no default. Customer-hosted; the API is its own web server (no IIS), default port 9000 (ListenPort in jadegt.ini).
path_rule: http(s)://<server>:<port>/<company>/<entity>/<identifier> — segment order mandatory; company code (e.g. 01) is in EVERY path
path_version_segment: none — API is unversioned (no version segment/header/param); feature availability tracks the Greentree release
spec_format: none — hand-written HTML KB docs only; no OpenAPI/Swagger, no machine-readable route catalog
docs_url: https://enterprisesupport.myob.com/greentree/api-overview + /api-documentation
auth: NOT OAuth. HTTP Basic (per-user Greentree login) + ApiKey header (site serial number). Both on every call. (An earlier card TKT-543 said "OAuth" — that was wrong.)
call_surface: native data connector, authType username-password; HTTP via connectors(name="request", connector="greentree", url, method[, body]). NOT Pipedream, NOT a file source (list_files/download_file N/A).
field_casing: PascalCase
id_format: business primary key (human key); Greentree allocates on create (per-entity exceptions documented)
date_researched: 2026-06-11
confidence: NOT live-validated — no test instance, no credentials, no vendor-hosted endpoint to probe. Every claim is [DOCS] (KB); inferences [UNVERIFIED]. Verify §Known Unknowns on a real instance before first customer use.
---

# MYOB Greentree — API Specification & Investigation

Developer reference compiled from the official MYOB Greentree Knowledge Base: "API overview" (`api-overview`) + "API documentation — URLs, functions and modifiers" (`api-documentation`).

## Overview

- **Vendor:** MYOB Greentree — enterprise ERP (GL, AR/AP, sales/purchase orders, inventory, job costing, HR/payroll, CRM, fixed assets, manufacturing, service). Built on the **Jade** object database.
- **Release markers gating features:** 2018.3, 2019.2, 2019.3, 2020.1, 2021.1, 2021.4, plus internal 4@8-5 / 4@11.
- **API type:** RESTful HTTP — GET=read, POST=write/create/update, DELETE=delete (same URL, different verb). XML **or** JSON, selected by `Content-Type` (POST) / `Accept` (response); JSON POST bodies from 4@8-5.
- **Scale:** ~120 documented entities across ~12 modules. No SDKs, no Postman, no OpenAPI. Events: none — no webhooks/SSE/streams; poll.
- (base URL, path rule, version, spec, auth, call surface, casing, id format → frontmatter.)

**Summary:** Full-surface ERP API over the Jade database. Every object at `/{company}/{Entity}[/{identifier}]`, with shared modifiers for paging, Global Search, sorting, and including attachments/sticky notes/approvals/plugin properties/linked objects. Reads via paged list GETs (100-row cap), writes via POST (Greentree allocates identifiers), reports to PDF, generic attachment up/download on every entity.

**Numa integration model:** Native data connector. Agent calls `connectors(name="request", params={connector:"greentree", url:"/01/GLAccount?page=1&pageSize=50", method:"GET"})`. Backend expands the relative URL against the admin-configured `instance_url` (`connector-config-greentree`, required, no default), injects `Authorization: Basic …` from the user's vault + the account-level `ApiKey` header from the company secret. Agent never sees/sets either. **Company code (`01`) is part of the relative URL the agent supplies** — not config, not a header.

## Authentication

TWO mechanisms, BOTH on every call (dual-auth, same shape as ProWorkflow). No OAuth/tokens/expiry/refresh/login call — both long-lived (fail only when the user's password changes or the site serial is reissued).
| Credential | Level | Header sent | Stored | Notes |
| --- | --- | --- | --- | --- |
| HTTP Basic (per user) | per user | `Authorization: Basic base64(username:password)` | user vault `connector-greentree` (`username`,`password`) | API runs with **exactly that user's Greentree permissions** — different roles see different data |
| `ApiKey` (account/site) | account | `ApiKey: {site serial number}` (e.g. `23440933`) | company secret `connector-config-greentree.api_key` + `api_key_header: ApiKey` | same for every user of the site; can also pass `?ApiKey=…` (browser) but Numa uses the header so it never lands in logs/URLs |

**Failure semantics [UNVERIFIED]:** docs don't state codes for bad Basic vs bad ApiKey. Expect `401` for bad auth, `404` for a wrong company code/entity/identifier in the path. Error bodies (XML vs JSON vs empty) undocumented — confirm live.

## URL structure & verb conventions

```
GET    /{company}/{Entity}                       list (≤100; page with page/pageSize)
GET    /{company}/{Entity}/{identifier}          read one
GET    /{company}/{Entity}?globalSearch=<term>   Global Search (2020.1)
POST   /{company}/{Entity}                        create (Greentree allocates the identifier*)
POST   /{company}/{Entity}/{identifier}           update an existing object
DELETE /{company}/{Entity}/{identifier}           delete
POST   /{company}/{Entity}/{id}?action=report     run a soft-coded report → PDF (2019.2)
POST   /{company}/{Entity}/{id}?action=approve|reject|clearApproval   approval workflow
GET    /{company}/{Entity}/{id}?action=attachment&name=<n>            download an attachment
POST   /{company}/{Entity}/{id}?action=attachment                     upload (multipart/form-data)
```

\*Client generally cannot specify the new identifier; per-entity exceptions are documented in the entity's article.

| Segment           | Meaning                                 | Example                   |
| ----------------- | --------------------------------------- | ------------------------- |
| `<server>:<port>` | customer's API host (default port 9000) | `greentree.site.com:9000` |
| `<company>`       | Greentree company code (in EVERY path)  | `01`                      |
| `<entity>`        | Jade class / entity name                | `SOPackingSlip`           |
| `<identifier>`    | business primary key (optional)         | `24333.01`                |

Worked example: `GET /01/SOPackingSlip/24333.01` reads a packing slip; `POST` to the same URL updates it; `DELETE` deletes it.

## Shared query modifiers (any entity)

| Modifier(s)                                      | Purpose                                           | Available                          |
| ------------------------------------------------ | ------------------------------------------------- | ---------------------------------- |
| `page`, `pageSize`                               | pagination (100-row cap; default page size 100)   | always                             |
| `globalSearch=<term>`                            | Global Search (uses the install's config)         | 2020.1                             |
| `sortBy<n>=<prop>`, `sortDesc<n>=true`           | sorting (multi-key; reference props `x.code`)     | 2021 preview, rolling per endpoint |
| `includeAttachments=true`                        | embed attachments collection                      | always                             |
| `includeStickyNotes=true`, `stickyNoteType=<T>`  | embed sticky notes (non-confidential, active)     | read always                        |
| `includePluginProperties=true`                   | embed plugin/dynamic properties                   | 2020                               |
| `includeLinkedObjects=true`                      | embed generic object links                        | 2020                               |
| `includeApprovals=true`                          | embed approvals collection                        | always                             |
| `ApiKey=<serial>`                                | account key as a URL param (Numa uses the header) | always                             |
| `action=report`, `timeout=<sec>`                 | run a report (PDF); override 60s engine timeout   | 2019.2                             |
| `action=attachment&name=<n>&modifiedSince=<iso>` | download attachment (skip unchanged)              | always                             |

Per-entity filter parameters ("most … specific to the particular request") are in each entity's KB article and are [UNVERIFIED] here.

## Entity inventory (~120 entities by module)

Names as they appear in the KB index. Read each entity's article for its identifier shape, fields, and entity-specific query parameters.
| Module | Entities |
| --- | --- |
| **GL** | GL Account, GL Account Segment Definition, GL Budget, GL Control, GL Document, GL Period Summary, GL Bank In (Cash Receipts), GL Bank Out (Cash Payments) |
| **AR** | AR Customer, AR Invoice, AR Receipt, AR Credit Note, AR Control, AR SalesPerson |
| **AP** | AP Supplier, AP Invoice, AP Invoice On-Charge, AP Payment, AP Credit Note, AP Control |
| **SO** | SO Sales Order, SO Packing Slip, SO Status Definition, SO Carrier |
| **PO/SCM** | PO Purchase Orders, PO Receipt, PO Shipments, PO Status Definition, SCM Requisitions, Profit Centre |
| **IN** | IN Stock Item, IN Transaction (+Type), IN Location, IN Storage Profile, IN Forecast, IN Budget, IN Stock Take (+Item), IN Serial Lot, IN Unit Of Measure, IN Analysis Code, IN Bin Type/Transaction, IN Control, IN Advanced Pricing (Price Level/Customer Code × Stock Item/Analysis Code) |
| **JC** | JC Job, JC Job Type, JC Estimate, JC Timesheet, JC Activity, JC Disbursement, JC Plant Charge, JC Employee, JC Work Centre (+Plan), JC Status, JC Control |
| **HR** | HR Person, HR Applicant, HR Position, HR Employment Type, HR Leave Request, HR Incident (+Type/Status/Event Type), HR Injury Type/Severity, HR Training Type, HR Skill Type, HR Certification Type, HR Education Type, HR Medical Role, HR Award Class, HR CV* (Education/Employment/Skill/Training/Medical/Certification) |
| **CRM** | CRM Contact, CRM Organisation, CRM Lead, CRM Quote, CRM Task, CRM Service Request, CRM Communication (+Priority), CRM Message, CRM Document Rule, CRM Web Timesheet, CRM SV* (Request Type/Status, Contract (+Cost), Location, Asset (+Class/Type/Usage)) |
| **FA** | FA Master, FA Purchase, FA Depreciation, FA Disposal, FA Transfer, FA Revaluation, FA Write Offs, FA Adjustment, FA Balance Adjustment, FA Control |
| **Mfg** | BOM Bill Of Materials, FO Factory Order (+Receipts) |
| **UT/system** | Company, Branch, Tree, User (+UDF Definitions, Security Snapshot), EC Web User, Browser Timesheets, UT Tax Code/Payment Term/Currency Code/Country, AH Form Definition, Global search, **Ping** (health check) |

## Data models

Docs publish no per-entity JSON schemas. Below are the XML samples for the **cross-cutting collections**; per-entity field lists must be read from each article and are [UNVERIFIED] here. JSON shape mirrors the XML but field-by-field is unconfirmed.

**Attachments collection (`?includeAttachments=true`):**

```xml
<Attachments collection='true' count='2'><Attachment><Name>desktop.jpg</Name><Edition>3</Edition><OidString>3456.768</OidString><FileName>desktop.jpg</FileName><FileSize>4421</FileSize><ModifiedTimeStamp>2013-08-28T16:19:04</ModifiedTimeStamp><Type>Image</Type></Attachment></Attachments>
```

Upload modifiers: `action=attachment`, `name`, `type`, `replaceIfExists`, `summary`, `isPrimary` (2021.1), `isWebAccessible` (2021.1). Download: `action=attachment&name=<n>[&modifiedSince=<iso>]`. Upload content is `multipart/form-data`; name/filename from the `Content-Disposition`.

**Sticky Notes collection (`?includeStickyNotes=true`):** a `<StickyNotes count='N'>` collection of `<StickyNote>` (Edition, `OidString`, Type, Note, IsActive, optional SortDate). Write rule: include `OidString` to **update** (cross-checked against the containing entity); omit it to **create**. Confidential/inactive notes are never returned. (Create/update 2020.1.)

**Approvals collection (`?includeApprovals=true`):** a `<Approvals count='N'>` collection of `<Approval>` (Code, Status, Reason) each with `<Approvers>` (Status, ToBeApprovedBy, ApprovedBy, ApprovedTimeStamp). Drive with `action=approve`/`action=reject` (payload names the approver/rejector + narration; default = the API user) or `action=clearApproval` (no payload, post-2018.3, clears all approval state).

**Plugin Properties / Linked Objects (2020):** `?includePluginProperties=true` embeds `<PlugInProperties>` (OID, bookmark text, dynamic props); `?includeLinkedObjects=true` embeds generic object-to-object links.

**Reports payload (`?action=report`):** POST an `AHFormDefn` naming the report + its `AHParameter` values; response is a PDF. Optional `<Attachment>` block (`ReplaceIfExists`, `RespondWithAttachment`) attaches the PDF to the record. Engine default timeout 60s, override `?timeout=n`.

**Error/envelope DTOs:** not documented [UNVERIFIED] — no standard error envelope. Parse defensively (status first, negotiated format next, raw text fallback, tolerate empty bodies).

## Pagination

Page-number — `page` + `pageSize` on list GETs. Default page size 100; hard cap 100 per request. Total count not available — detect the end by a short page.

```
Page 1: GET /01/SOPackingSlip?page=1&pageSize=20   → 20 rows → continue
Page 2: GET /01/SOPackingSlip?page=2&pageSize=20   → 20 rows → continue
Stop:   when a page returns < pageSize rows
```

Always supply both `page` and `pageSize`; keep `pageSize` small to be polite to the customer's ERP server.

## Rate limits

**None documented.** No API rate limiting, no rate-limit headers. Server-side throughput is governed by Jade worker-thread tuning in `jadegt.ini` (`MaxWorkerThreads`, `MinWorkerThreads`, `QueueDepthLimit`, `QueueDepthLimitTimeout`, `WorkerIdleTimeout`). **Self-throttle anyway** — this is a customer's production ERP on their own (often modest) Jade server. `CallDurationLogTrigger` exists server-side to flag slow calls in `apilog.log`.

## Error handling

Documented behaviour: verb semantics only (GET reads, POST writes, DELETE deletes). **Status codes and error body shapes are NOT documented** [UNVERIFIED]. Server-side diagnosis uses `ApiTracing`/`ApiLogging` (`[JadeLog]` → `apilog.log`), queried in real time (don't leave on in production).

**Expected status codes [UNVERIFIED — confirm live]:**
| Status | Likely meaning | Retryable | Recovery |
| --- | --- | --- | --- |
| 200 | OK | — | |
| 401 | bad/missing Basic auth or wrong `ApiKey` | No | fix user login / serial; reconnect |
| 404 | wrong company code, entity, or identifier in path | No | verify `/{company}/{Entity}/{id}` |
| 4xx | malformed write / business-rule veto | No | fix payload |
| 5xx | server/Jade error (plugin/report failure, timeout) | Cautiously | check `apilog.log`; usually environmental |

**Parse defensively:** status first → negotiated format (JSON or XML) → raw text → tolerate empty bodies.

**Idempotency:** no idempotency keys. GET idempotent (except `action=report`/`approve`/`reject`, which are POSTs). DELETE idempotent. **POST-create retries can duplicate** records (Greentree allocates the identifier — no client dedupe key); **query before retrying** after a timeout. Sticky-note POSTs without `OidString` **append** — retries can duplicate notes.

## Webhooks / events

None. No webhook/SSE/streaming. A future Numa Automations trigger would **poll** a paged list GET (optionally `sortBy<n>` on a date field where supported) and diff. The only built-in change hint is `modifiedSince`; there is no universal `LastModified` field.

## Deployment model: customer-hosted, on-premise (the structural caveat)

There is **no Greentree SaaS API** — each customer runs the API themselves:

1. **The API is its own web server** — services queries against the Jade database directly; no IIS. Default port **9000** (`ListenPort` in `jadegt.ini`). Runs either as **its own Windows service** (`jadclient.exe service=install … app=ApiStartup schema=ApiSchema`) **or** as part of the database service (`ServerApplication<n>=ApiSchema,ApiStartup` in `[JadeServer]`). Running as its own service is **not possible from Greentree 2021.4+** — it must run inside the database service from then on.
2. **Config in `jadegt.ini`** — `[GreentreeApi]` (ListenPort, worker threads, `ReadTimeout` (2019.3), `RetainXmlWhitespace`, `CallDurationLogTrigger`) and `[JadeLog]` (`ApiTracing`, `ApiLogging`, `LogDirectory`).
3. **TLS/HTTPS** — docs' examples are internal `http://...:9000`. For internet exposure the KB article "Achieving an SSL connection by configuring IIS as a Reverse Proxy" describes fronting the API with a reverse proxy to terminate TLS.

**Reachability constraint for Numa:** the Numa backend (AWS Lambda, per-client account) must reach the customer's instance over the public internet with valid TLS (same as Jiwa):

- LAN-only installs **cannot** connect until the customer publishes the API (public DNS + cert + reverse proxy / port-forward / Cloudflare).
- IP-whitelisting must allow Numa's egress (per-client egress IPs are not stable — coordinate before promising whitelist support).
- Connectivity failures look like timeouts/TLS errors, not API errors — the connector test must distinguish network-unreachable from auth failures.
- `instance_url` differs per customer, **must include scheme + host (+ port)**, has no default; relative URLs join against it. **The company code (`01`) goes in the relative path**, not the instance URL.

**Test-connection sequence (wizard / first use):** `GET /{company}/Ping` (liveness + auth + reachability — safest first call) → `GET /{company}/GLAccount?page=1&pageSize=1` (a representative read under the user's permissions).

## Known Unknowns — verify on a test instance before customer rollout

1. **Response JSON shapes** — docs show XML for cross-cutting collections; per-entity JSON field names/types unconfirmed.
2. **Error status codes + body format** (401/404/4xx/5xx): JSON vs XML vs empty; exact code for bad Basic auth vs bad ApiKey vs wrong company code.
3. **Date/time wire format** on JSON responses (XML examples show ISO 8601 — confirm JSON matches).
4. **Per-entity filter parameters** — only generically described; read each entity's article.
5. **Identifier-allocation exceptions** — which entities let the client supply the identifier on POST.
6. **Create/update request bodies** — full POST payload shapes per entity (only sticky-note/approval/report payloads are shown).
7. **Enum/status values** — install-specific (SO/PO status definitions, approval statuses, types).
8. **Sorting coverage** — which entities support `sortBy<n>` yet (rolling out from `ARInvoice`).
9. **Company code(s)** — the customer's actual code(s); `01` is only the documentation example.
10. **Concurrency** — whether `Edition` numbers must be echoed on writes; no `RowHash` equivalent documented.
11. **Attachment up/download encoding limits** — multipart documented for upload; size limits and JSON-vs-binary download shape unconfirmed.
12. **Version drift** — the customer's release gates Global Search (2020.1), sorting (2021), JSON POST (4@8-5), `clearApproval` (post-2018.3), `ReadTimeout` (2019.3), `isPrimary`/`isWebAccessible` (2021.1).

## Known limitations (unique to this section)

- **No batch endpoints** — one POST/DELETE per entity (sticky notes are the only multi-item payload).
- **Per-customer surface drift** — enabled modules, version, company code, and user permissions change what's actually callable.
- (Also: no machine spec → discovery via KB; no API versioning; no total-count/cursor (≤100/request); no events (poll only); no default rate limiting (self-throttle); undocumented errors (XML/JSON/empty — parse defensively) — all detailed in their own sections above.)

## Integration path assessment

**Recommended path:** Direct API via Numa native data connector (`request`), `authType: username-password` with an account-level `ApiKey` header — NOT Pipedream, NOT OAuth.

**Justification:** Greentree combines the two existing twins. Its **dual auth** (account `ApiKey` header + per-user Basic) rides the ProWorkflow path (`_connector_static_headers` injects the `ApiKey`; `_basic_from_fields` injects the user Basic); its **customer-hosted instance URL** rides the Jiwa path (`_resolve_connector_base_url` → admin-set `instance_url`, no fixed base URL). Admin contributes the instance URL + the site serial (ApiKey); each user pastes their personal Greentree login into the chat credential card. Per-user Basic preserves Greentree's own permission enforcement + audit trail — a shared login would collapse all Numa activity onto one Greentree identity and over-privilege everyone.

**Connector compatibility:** not a file source (`list_files`/`download_file` N/A). Per-entity `Attachments` could back a download capability in a later phase once encoding is verified (Known Unknown #11).

**Rollout checklist (per customer):**

1. Customer: Greentree API enabled and running (own service or in the DB service); reachable over HTTPS (reverse proxy / valid cert / public DNS); IP-whitelist allowance for Numa if applicable.
2. Customer: confirm the **company code** (e.g. `01`) and the **site serial number** (ApiKey).
3. Customer: each Numa user has a Greentree login with the right least-privilege permissions.
4. Numa admin: add MYOB Greentree in Integrations → wizard → set **Instance URL** + the **site ApiKey**.
5. Verify: `GET /{company}/Ping` → `GET /{company}/GLAccount?page=1&pageSize=1`.
6. Burn down §Known Unknowns on the first connected instance; update `01-llm-api-rules.md` with findings.
