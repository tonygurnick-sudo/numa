---
api_name: 'MYOB Greentree API'
api_slug: 'greentree'
base_url: '' # per-customer instance URL — there is NO shared host and NO default base URL (customer-hosted, default port 9000)
version: 'unversioned (ships with the Greentree product release; feature availability tracks the release)'
spec_format: 'none' # hand-written HTML docs only — no OpenAPI/Swagger
spec_url: 'none (no machine-readable spec exists)'
docs_url: 'https://enterprisesupport.myob.com/greentree/api-overview + /api-documentation'
date_researched: '2026-06-11'
generated_date: '2026-06-11'
---

# MYOB Greentree — API Specification & Investigation

> Developer reference for the MYOB Greentree API — the condensed output of
> `00-api-investigation-questionnaire.md`. Compiled from the **official MYOB Greentree
> Knowledge Base**: "API overview" (`enterprisesupport.myob.com/greentree/api-overview`) and
> "API documentation — URLs, functions and modifiers"
> (`enterprisesupport.myob.com/greentree/api-documentation`).
>
> ⚠️ **NOT LIVE-VALIDATED.** No test instance and no credentials. Every claim is `[DOCS]`
> (Knowledge Base); inferences are `[UNVERIFIED]`. There is no machine-readable spec and no
> vendor-hosted endpoint to probe (Greentree is customer-hosted). Verify the items in
> §Known Unknowns against a real instance before first customer use.
>
> ⚠️ **NOT OAuth.** Greentree uses **HTTP Basic auth (per-user Greentree login) + an `ApiKey`
> header (the site serial number)** on every call. An earlier internal card (TKT-543) said
> "OAuth" — that was wrong; do not repeat it.

---

## Overview

- **Vendor:** MYOB Greentree — enterprise ERP (GL, AR/AP, sales/purchase orders, inventory, job
  costing, HR/payroll, CRM, fixed assets, manufacturing, service). Built on the **Jade** object
  database. [DOCS]
- **API version:** **unversioned** — no version segment/header/param. The API ships with the
  Greentree product; feature availability tracks the release (2018.3, 2019.2, 2019.3, 2020.1,
  2021.1, 2021.4, plus internal 4@8-5 / 4@11 markers) [DOCS]
- **Base URL:** per-customer, e.g. `http(s)://greentree.customer.com:9000/` — **no shared SaaS
  host, no default**. The API is **its own web server** (no IIS), default port **9000**
  (`ListenPort` in `jadegt.ini`) [DOCS]
- **URL structure:** `http(s)://<server>:<port>/<company>/<entity>/<identifier>` — segment order is
  mandatory; the **company code** (`01`) is part of every path [DOCS]
- **API type:** RESTful HTTP — GET=read, POST=write/create/update, DELETE=delete (same URL,
  different verb) [DOCS]
- **Data format:** XML **or** JSON, selected by `Content-Type` (POST) / `Accept` (response). JSON
  POST bodies supported from Greentree **4@8-5** [DOCS]
- **Spec:** **none** — no OpenAPI/Swagger; documentation is one hand-written KB article per entity.
  No `/RestPaths`-style machine catalog. [DOCS]
- **Typed clients / SDKs:** none [DOCS]
- **Scale:** ~120 documented entities across ~12 modules (full list below) [DOCS]
- **Events:** none — no webhooks/SSE/streams; **poll** [DOCS]

**Summary:** Full-surface enterprise ERP API over the Greentree Jade database. Every object lives at
`/{company}/{Entity}[/{identifier}]`, with shared modifiers for paging, Global Search, sorting, and
including attachments / sticky notes / approvals / plugin properties / linked objects. Reads via
paged list GETs (100-row cap), writes via POST (Greentree allocates identifiers), reports to PDF,
and a generic attachment up/download surface on every entity.

**Numa integration model:** Native data connector (`authType: username-password`, NOT Pipedream,
NOT OAuth). The workspace agent calls
`connectors(name="request", params={connector: "greentree", url: "/01/GLAccount?page=1&pageSize=50", method: "GET"})`.
The backend expands relative URLs against the **admin-configured `instance_url`**
(`connector-config-greentree` — required; no default), injects `Authorization: Basic …` from the
user's personal vault, and injects the account-level **`ApiKey`** header from the company secret.
The agent never sees either credential and never sets either header. **The company code (`01`) is
part of the relative URL the agent supplies** — not config, not a header.

---

## Authentication

**TWO mechanisms, BOTH required on every call** [DOCS]. Same dual-auth shape as ProWorkflow:
account-level key (admin) + per-user login.

### Mechanism 1 — HTTP Basic (per user)

```
Authorization: Basic base64(greentree-username:greentree-password)   ← what Numa injects per user
```

- A **regular Greentree username + password**. The API runs with **exactly that user's Greentree
  permissions** — identical to a desktop login. Two Numa users with different Greentree roles see
  different data through the same connector. [DOCS]

### Mechanism 2 — `ApiKey` (account/site level)

```
ApiKey: {site serial number}                                          ← what Numa injects from company config
```

- The **`ApiKey` is the site's Greentree serial number** (e.g. `23440933`). It is **the same for
  every user** of that Greentree site — account-level, not per-user. [DOCS]
- Can also be passed as a URL parameter (`?ApiKey=…`) — convenient in a browser, but Numa uses the
  **header** so the key never lands in logs/URLs. [DOCS]

### Numa's two-secret mapping

| Credential                 | Level     | Stored where                                     | Sent as                              |
| -------------------------- | --------- | ------------------------------------------------ | ------------------------------------ |
| `ApiKey` (serial number)   | account   | company secret `connector-config-greentree.api_key` + `api_key_header: ApiKey` | `ApiKey: {serial}` header |
| Greentree username/password| per user  | user vault `connector-greentree` (`username`, `password`) | `Authorization: Basic base64(u:p)`  |

**No OAuth, no tokens, no expiry, no refresh, no login call** — both credentials travel on every
request and are long-lived (they fail only when the user's Greentree password changes or the site
serial is reissued).

### Failure semantics [UNVERIFIED]

The docs do **not** state status codes for bad Basic auth vs bad ApiKey. Expect `401` for bad auth
(HTTP Basic convention) and `404` for a wrong company code / entity / identifier in the path.
Confirm on a live instance — error bodies (XML vs JSON vs empty) are undocumented.

---

## URL Structure & Verb Conventions [DOCS]

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

\*Client generally cannot specify the new identifier; **per-entity exceptions are documented in the
entity's article**. [DOCS]

| Segment        | Meaning                                  | Example          |
| -------------- | ---------------------------------------- | ---------------- |
| `<server>:<port>` | Customer's API host (default port 9000) | `greentree.site.com:9000` |
| `<company>`    | Greentree company code (in EVERY path)    | `01`             |
| `<entity>`     | Jade class / entity name                  | `SOPackingSlip`  |
| `<identifier>` | Business primary key (optional)           | `24333.01`       |

Worked example: `GET /01/SOPackingSlip/24333.01` reads a packing slip; `POST` to the same URL
updates it; `DELETE` deletes it. [DOCS]

---

## Shared Query Modifiers (work on any entity)

| Modifier(s)                                                          | Purpose                                          | Available |
| ------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| `page`, `pageSize`                                                   | Pagination (100-row cap; default page size 100)  | always [DOCS] |
| `globalSearch=<term>`                                               | Global Search (uses the install's config)        | 2020.1 [DOCS] |
| `sortBy<n>=<prop>`, `sortDesc<n>=true`                              | Sorting (multi-key; reference props `x.code`)    | 2021 preview, rolling per endpoint [DOCS] |
| `includeAttachments=true`                                           | Embed attachments collection                     | always [DOCS] |
| `includeStickyNotes=true`, `stickyNoteType=<T>`                    | Embed sticky notes (non-confidential, active)    | read always [DOCS] |
| `includePluginProperties=true`                                     | Embed plugin/dynamic properties                  | 2020 [DOCS] |
| `includeLinkedObjects=true`                                         | Embed generic object links                       | 2020 [DOCS] |
| `includeApprovals=true`                                             | Embed approvals collection                       | always [DOCS] |
| `ApiKey=<serial>`                                                  | Account key as a URL param (Numa uses the header) | always [DOCS] |
| `action=report`, `timeout=<sec>`                                   | Run a report (PDF); override 60s engine timeout  | 2019.2 [DOCS] |
| `action=attachment&name=<n>&modifiedSince=<iso>`                  | Download attachment (skip unchanged)             | always [DOCS] |

**Per-entity filter parameters** ("most … specific to the particular request") are documented in
each entity's KB article and are **[UNVERIFIED]** here. [DOCS]

---

## Entity Inventory (~120 entities by module) [DOCS]

> Names as they appear in the KB index ("API documentation" page). Read each entity's article for
> its identifier shape, fields, and entity-specific query parameters.

| Module | Entities |
| ------ | -------- |
| **GL** | GL Account, GL Account Segment Definition, GL Budget, GL Control, GL Document, GL Period Summary, GL Bank In (Cash Receipts), GL Bank Out (Cash Payments) |
| **AR** | AR Customer, AR Invoice, AR Receipt, AR Credit Note, AR Control, AR SalesPerson |
| **AP** | AP Supplier, AP Invoice, AP Invoice On-Charge, AP Payment, AP Credit Note, AP Control |
| **SO** | SO Sales Order, SO Packing Slip, SO Status Definition, SO Carrier |
| **PO/SCM** | PO Purchase Orders, PO Receipt, PO Shipments, PO Status Definition, SCM Requisitions, Profit Centre |
| **IN** | IN Stock Item, IN Transaction (+ Type), IN Location, IN Storage Profile, IN Forecast, IN Budget, IN Stock Take (+ Item), IN Serial Lot, IN Unit Of Measure, IN Analysis Code, IN Bin Type/Transaction, IN Control, IN Advanced Pricing (Price Level/Customer Code × Stock Item/Analysis Code) |
| **JC** | JC Job, JC Job Type, JC Estimate, JC Timesheet, JC Activity, JC Disbursement, JC Plant Charge, JC Employee, JC Work Centre (+ Plan), JC Status, JC Control |
| **HR** | HR Person, HR Applicant, HR Position, HR Employment Type, HR Leave Request, HR Incident (+ Type/Status/Event Type), HR Injury Type/Severity, HR Training Type, HR Skill Type, HR Certification Type, HR Education Type, HR Medical Role, HR Award Class, HR CV* (Education/Employment/Skill/Training/Medical/Certification) |
| **CRM** | CRM Contact, CRM Organisation, CRM Lead, CRM Quote, CRM Task, CRM Service Request, CRM Communication (+ Priority), CRM Message, CRM Document Rule, CRM Web Timesheet, CRM SV* (Request Type/Status, Contract (+Cost), Location, Asset (+Class/Type/Usage)) |
| **FA** | FA Master, FA Purchase, FA Depreciation, FA Disposal, FA Transfer, FA Revaluation, FA Write Offs, FA Adjustment, FA Balance Adjustment, FA Control |
| **Mfg** | BOM Bill Of Materials, FO Factory Order (+ Receipts) |
| **UT / system** | Company, Branch, Tree, User (+ UDF Definitions, Security Snapshot), EC Web User, Browser Timesheets, UT Tax Code/Payment Term/Currency Code/Country, AH Form Definition, Global search, **Ping** (health check) |

---

## Data Models

> The docs do not publish per-entity JSON schemas. The structures shown in the KB are XML samples
> for the **cross-cutting collections**, reproduced below; per-entity field lists must be read from
> each article and are **[UNVERIFIED]** here. JSON shape mirrors the XML but field-by-field is
> unconfirmed.

### Attachments collection (`?includeAttachments=true`) [DOCS]

```xml
<Attachments collection='true' count='2'>
  <Attachment>
    <Name>desktop.jpg</Name>
    <Edition>3</Edition>
    <OidString>3456.768</OidString>
    <FileName>desktop.jpg</FileName>
    <FileSize>4421</FileSize>
    <ModifiedTimeStamp>2013-08-28T16:19:04</ModifiedTimeStamp>
    <Type>Image</Type>
  </Attachment>
</Attachments>
```

Upload modifiers: `action=attachment`, `name`, `type`, `replaceIfExists`, `summary`, `isPrimary`
(2021.1), `isWebAccessible` (2021.1). Download: `action=attachment&name=<n>[&modifiedSince=<iso>]`.
Upload content is `multipart/form-data`; name/filename come from the `Content-Disposition`. [DOCS]

### Sticky Notes collection (`?includeStickyNotes=true`) [DOCS]

A `<StickyNotes count='N'>` collection of `<StickyNote>` (Edition, `OidString`, Type, Note,
IsActive, optional SortDate). Write rule: include `OidString` to **update** an existing note
(cross-checked against the containing entity); omit it to **create**. Confidential/inactive notes
are never returned. (Create/update 2020.1.)

### Approvals collection (`?includeApprovals=true`) [DOCS]

A `<Approvals count='N'>` collection of `<Approval>` (Code, Status, Reason) each with an
`<Approvers>` collection (Status, ToBeApprovedBy, ApprovedBy, ApprovedTimeStamp). Drive it with
`action=approve` / `action=reject` (payload names the approver/rejector + narration; default = the
API user) or `action=clearApproval` (no payload, post-2018.3, clears all approval state).

### Plugin Properties / Linked Objects (2020) [DOCS]

`?includePluginProperties=true` embeds `<PlugInProperties>` (OID, bookmark text, dynamic props);
`?includeLinkedObjects=true` embeds generic object-to-object links.

### Reports payload (`?action=report`) [DOCS]

POST an `AHFormDefn` naming the report and its `AHParameter` values; response is a PDF. Optional
`<Attachment>` block (with `ReplaceIfExists`, `RespondWithAttachment`) attaches the PDF to the
record. Engine default timeout 60s, override with `?timeout=n`.

### Error / envelope DTOs

**Not documented.** [UNVERIFIED] — no standard error envelope is published. Parse defensively
(status first, negotiated format next, raw text fallback, tolerate empty bodies).

---

## Pagination

- **Type:** page-number — `page` + `pageSize` on list GETs [DOCS]
- **Default page size:** 100; **hard cap 100 per request** [DOCS]
- **Total count:** **not available** — no total-count parameter; detect the end by a short page [DOCS]

```
Page 1: GET /01/SOPackingSlip?page=1&pageSize=20   → 20 rows → continue
Page 2: GET /01/SOPackingSlip?page=2&pageSize=20   → 20 rows → continue
Stop:   when a page returns < pageSize rows
```

Always supply both `page` and `pageSize` for predictable batches; keep `pageSize` small to be polite
to the customer's ERP server.

---

## Rate Limits

| Scope   | Limit               | Notes                                                                            |
| ------- | ------------------- | -------------------------------------------------------------------------------- |
| Default | **none documented** | No API rate limiting. Server-side throughput is governed by Jade worker-thread tuning in `jadegt.ini` (`MaxWorkerThreads`, `MinWorkerThreads`, `QueueDepthLimit`, `QueueDepthLimitTimeout`, `WorkerIdleTimeout`) [DOCS] |

No rate-limit headers documented. **Self-throttle anyway** — this is a customer's production ERP on
their own (often modest) Jade server. `CallDurationLogTrigger` exists server-side to flag slow calls
in `apilog.log`. [DOCS]

---

## Error Handling

**Documented behaviour:** verb semantics only (GET reads, POST writes, DELETE deletes). **Status
codes and error body shapes are NOT documented** [UNVERIFIED]. Server-side diagnosis uses
`ApiTracing` / `ApiLogging` (`[JadeLog]` section → `apilog.log`), queried in real time (don't leave
on in production). [DOCS]

**Expected status codes [UNVERIFIED — confirm live]:**

| Status | Likely meaning                                    | Retryable | Recovery                                |
| ------ | -------------------------------------------------- | --------- | ---------------------------------------- |
| 200    | OK                                                 | —         |                                          |
| 401    | Bad/missing Basic auth or wrong `ApiKey`           | No        | Fix user login / serial; reconnect       |
| 404    | Wrong company code, entity, or identifier in path  | No        | Verify `/{company}/{Entity}/{id}`        |
| 4xx    | Malformed write / business-rule veto               | No        | Fix payload                              |
| 5xx    | Server/Jade error (plugin/report failure, timeout) | Cautiously| Check `apilog.log`; usually environmental|

**Parse defensively:** status first → negotiated format (JSON or XML) → raw text → tolerate empty
bodies.

**Idempotency:** no idempotency keys. GET idempotent (except `action=report`/`approve`/`reject`,
which are POSTs). DELETE idempotent. **POST-create retries can duplicate** records (Greentree
allocates the identifier — no client dedupe key); **query before retrying** after a timeout.
Sticky-note POSTs without `OidString` **append** — retries can duplicate notes.

---

## Webhooks / Events

**None.** No webhook/SSE/streaming mechanism. A future Numa Automations trigger would **poll** a
paged list GET (optionally `sortBy<n>` on a date field where supported) and diff. The only built-in
change hint is attachment `?modifiedSince=<iso>`; there is no universal `LastModified` field. [DOCS]

---

## Deployment Model: customer-hosted, on-premise (THE structural caveat)

There is **no Greentree SaaS API**. Each customer runs the API themselves [DOCS]:

1. **The API is its own web server** — it services queries against the Jade database directly; **no
   IIS** or other web-server tech is required. Default port **9000** (`ListenPort` in `jadegt.ini`).
   It runs either as **its own Windows service** (`jadclient.exe service=install … app=ApiStartup
   schema=ApiSchema`) **or** as part of the database service (`ServerApplication<n>=ApiSchema,
   ApiStartup` in `[JadeServer]`). Note: running as its own service is **not possible from Greentree
   2021.4+** — it must run inside the database service from then on. [DOCS]
2. **Config in `jadegt.ini`** — `[GreentreeApi]` (ListenPort, worker threads, `ReadTimeout`
   (2019.3), `RetainXmlWhitespace`, `CallDurationLogTrigger`) and `[JadeLog]` (`ApiTracing`,
   `ApiLogging`, `LogDirectory`). [DOCS]
3. **TLS / HTTPS** — the docs' examples are internal `http://...:9000`. For internet exposure the KB
   article "Achieving an SSL connection by configuring IIS as a Reverse Proxy" describes fronting the
   API with a reverse proxy to terminate TLS. [DOCS]

**Reachability constraint for Numa:** the Numa backend (AWS Lambda, per-client account) must reach
the customer's instance over the public internet with valid TLS. Consequences (same as Jiwa):

- LAN-only installs **cannot** be connected until the customer publishes the API (public DNS +
  cert + reverse proxy / port-forward / Cloudflare).
- If the customer IP-whitelists, they must allow Numa's egress (per-client egress IPs are not stable
  — coordinate before promising whitelist support).
- Connectivity failures look like timeouts / TLS errors, not API errors — the connector test must
  distinguish network-unreachable from auth failures.
- `instance_url` differs per customer and **must include scheme + host (+ port)**; relative connector
  URLs are joined against it. **The company code (`01`) goes in the relative path**, not the
  instance URL. There is no default.

**Recommended test-connection sequence (wizard / first use):**

1. `GET /{company}/Ping` — liveness + auth + reachability (the safest first call)
2. `GET /{company}/GLAccount?page=1&pageSize=1` — proves a representative read works under the
   user's Greentree permissions

---

## Known Unknowns — verify on a test instance before customer rollout

1. **Response JSON shapes** — the docs show XML for the cross-cutting collections; per-entity JSON
   field names/types are unconfirmed.
2. **Error status codes + body format** (401/404/4xx/5xx): JSON vs XML vs empty; the exact code for
   bad Basic auth vs bad ApiKey vs wrong company code.
3. **Date/time wire format** on JSON responses (XML examples show ISO 8601 — confirm JSON matches).
4. **Per-entity filter parameters** — only generically described; read each entity's article.
5. **Identifier-allocation exceptions** — which entities let the client supply the identifier on POST.
6. **Create/update request bodies** — full POST payload shapes per entity (only sticky-note /
   approval / report payloads are shown).
7. **Enum/status values** — install-specific (SO/PO status definitions, approval statuses, types).
8. **Sorting coverage** — which entities support `sortBy<n>` yet (rolling out from `ARInvoice`).
9. **Company code(s)** — the customer's actual code(s); `01` is only the documentation example.
10. **Concurrency** — whether `Edition` numbers must be echoed on writes; no `RowHash` equivalent
    documented.
11. **Attachment up/download encoding limits** — multipart is documented for upload; size limits and
    JSON-vs-binary download shape unconfirmed.
12. **Version drift** — the customer's Greentree release gates Global Search (2020.1), sorting (2021),
    JSON POST (4@8-5), `clearApproval` (post-2018.3), `ReadTimeout` (2019.3), `isPrimary`/
    `isWebAccessible` (2021.1).

---

## Known Limitations

1. **No live validation** — the whole pack is docs-derived (see banner)
2. **No machine spec** — no OpenAPI/Swagger and no route-catalog endpoint; discovery is via the KB
3. **Per-customer surface drift** — enabled modules, Greentree version, company code, and user
   permissions change what's actually callable
4. **Customer-hosted reachability** — internet exposure, TLS, and whitelisting are customer-side work
5. **No API versioning** — capability changes arrive with Greentree releases
6. **No batch endpoints** — one POST/DELETE per entity (sticky notes are the one multi-item payload)
7. **No total-count / cursor** — paging stops on a short page; max 100 rows/request
8. **No events** — polling only; no universal change-detection timestamp
9. **No default rate limiting** — Numa must self-throttle against production ERP hardware
10. **Undocumented errors** — defensive parsing mandatory; expect XML *or* JSON *or* empty bodies

---

## SDKs & Tooling

| SDK            | Language | Repository | Notes                                                            |
| -------------- | -------- | ---------- | ---------------------------------------------------------------- |
| None           | —        | —          | No SDKs. Numa uses the generic `request` proxy (raw HTTP + JSON). |

**Postman collection:** Not available
**OpenAPI spec:** None (hand-written KB docs only)

---

## Integration Path Assessment

**Recommended path:** **Direct API via Numa native data connector** (`request` operation),
`authType: username-password` with an account-level `ApiKey` header — NOT Pipedream, **NOT OAuth**.

**Justification:** Greentree is the combination of the two existing twins. Its **dual auth**
(account `ApiKey` header + per-user Basic) rides the ProWorkflow path in the generic backend
(`_connector_static_headers` injects the `ApiKey`; `_basic_from_fields` injects the user Basic);
its **customer-hosted instance URL** rides the Jiwa path (`_resolve_connector_base_url` →
admin-set `instance_url`, no fixed base URL). The admin contributes the **instance URL** + the
**site serial (ApiKey)**; each user pastes their personal **Greentree login** into the chat
credential card. Per-user Basic preserves Greentree's own permission enforcement and audit trail —
a shared login would collapse all Numa activity onto one Greentree identity and over-privilege
everyone.

**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` do not apply).
Per-entity `Attachments` could back a download capability in a later phase once encoding is verified
(Known Unknown #11).

**Rollout checklist (per customer):**

1. Customer: Greentree API enabled and running (own service or in the DB service); reachable over
   HTTPS (reverse proxy / valid cert / public DNS); IP-whitelist allowance for Numa if applicable
2. Customer: confirm the **company code** (e.g. `01`) and the **site serial number** (ApiKey)
3. Customer: each Numa user has a Greentree login with the right least-privilege permissions
4. Numa admin: add MYOB Greentree in Integrations → wizard → set **Instance URL** + the **site
   ApiKey**
5. Verify: `GET /{company}/Ping` → `GET /{company}/GLAccount?page=1&pageSize=1`
6. Burn down §Known Unknowns on the first connected instance; update `01-llm-api-rules.md` with
   findings

---

_Researched 2026-06-11 from the official MYOB Greentree Knowledge Base
(`enterprisesupport.myob.com/greentree/api-overview` + `/api-documentation`). **No live test
instance and no credentials — docs-derived only. NOT OAuth: HTTP Basic + `ApiKey` header; company
code in every path; customer-hosted.** Source: `00-api-investigation-questionnaire.md`._
