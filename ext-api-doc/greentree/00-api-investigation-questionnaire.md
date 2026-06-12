---
api_name: 'MYOB Greentree API'
api_slug: 'greentree'
vendor: 'MYOB Greentree (MYOB Australia / formerly Greentree International)'
website: 'https://www.myob.com/au/enterprise/greentree'
investigation_started: '2026-06-11'
investigator: 'Claude Code (official MYOB Greentree docs only — NO live test instance, no credentials)'
investigation_status: 'blocked' # docs research complete; Phase 2.4 live-call gate NOT passed
documentation_quality: 'good'
api_types: [REST]
overall_confidence: 'medium'
blockers:
  - 'No live test instance and no credentials — every answer is docs-derived, none live-verified'
  - 'Customer-hosted on-premise deployment: enabled modules, route surface, Greentree version, and user permissions vary per install'
  - 'Response/error wire shapes (JSON field names, error body format) not shown in the public docs — must be confirmed on a real instance'
generated_date: '2026-06-11'
---

# API Investigation Questionnaire: MYOB Greentree

> **Source:** Official MYOB Greentree Knowledge Base —
> `https://enterprisesupport.myob.com/greentree/api-overview` ("API overview") and
> `https://enterprisesupport.myob.com/greentree/api-documentation` ("API documentation —
> URLs, functions and modifiers", the per-entity catalog). Both pages were captured locally
> for this investigation. The API is a **RESTful HTTP interface** over the Greentree Jade
> database, returning XML or JSON.
>
> ⚠️ **NO TEST INSTANCE was available** and **no credentials were used.** Nothing in this pack
> is live-verified. There was not even an anonymous probe target — Greentree is customer-hosted,
> so there is no vendor-operated host to hit (unlike Jiwa's `api.jiwa.com.au`). Every claim is
> documentation-derived.
>
> ⚠️ **AUTH CORRECTION:** an earlier internal card (TKT-543) described this connector as "OAuth".
> **That is wrong.** Greentree has **no OAuth**. It uses **HTTP Basic authentication** (a regular
> Greentree username + password) **plus an `ApiKey`** (the site's Greentree serial number) on every
> call. Do not repeat the OAuth claim anywhere in the connector or the LLM rules.
>
> **Confidence markers (per repo convention for this connector):**
>
> - `[DOCS]` — stated in MYOB Greentree's official Knowledge Base
> - `[UNVERIFIED]` — inferred; must be checked against a real instance before relied upon
>
> (`[CONFIRMED]` is deliberately absent — there were no live tests.)

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** MYOB Greentree Knowledge Base — "API overview"
  (`enterprisesupport.myob.com/greentree/api-overview`) covers auth, hosting, URL structure,
  paging, response format, attachments, sticky notes, approvals, reports [DOCS]
- **API reference / endpoint catalog URL:** "API documentation" page
  (`enterprisesupport.myob.com/greentree/api-documentation`) — the per-entity index ("URLs,
  functions and modifiers"), one sub-article per entity (GL Account, AR Invoice, IN Stock Item,
  JC Job, PO Purchase Orders, etc.) [DOCS]
- **Authentication guide URL:** the Authentication section of the API overview page [DOCS]
- **Changelog / release notes URL:** No standalone API changelog. Capabilities are tied to the
  Greentree product release — the docs annotate features with the version they appeared in
  (e.g. Global Search "2020.1", Sorting "2021 preview", Reports "2019.2", `ReadTimeout` "2019.3") [DOCS]
- **Status page URL:** None — every customer self-hosts their own Greentree server [DOCS]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** None. There is **no machine-readable spec** — the docs are
  hand-written HTML pages, one per entity. [DOCS]
- **Postman collection URL:** None official found
- **Official SDK repositories:** None. Greentree historically exposes other integration
  technologies (FREE/COM, SOAP/JHP, data import-export) — the docs explicitly position the REST
  API as the modern, lighter-weight replacement for those [DOCS]
- **Official blog / engineering blog:** None specific to the API
- **Community forums / Stack Overflow tag:** Negligible footprint; Greentree is a niche
  ANZ enterprise ERP. Rely on the official KB.
- **Other:** The API server reads its config from `jadegt.ini` (`[GreentreeApi]` section);
  there is a `Ping` / "Health check" entity for liveness, and a `RestPaths`-style route catalog
  is **not** documented (unlike Jiwa) — discovery is via the KB entity index [DOCS]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                                              |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| Authentication            | 4      | Both mechanisms (Basic + ApiKey) clearly stated, with a header example and a URL-parameter example [DOCS]          |
| Endpoint reference        | 4      | Every entity has its own KB article with URL modifiers; ~120 entities indexed. No machine spec though [DOCS]       |
| Request/response examples | 3      | URL examples are plentiful; full JSON response **bodies** are mostly absent (attachments/sticky-notes show XML)   |
| Error documentation       | 1      | HTTP verbs and behaviours are described, but **error status codes and error body shapes are not catalogued** [DOCS] |
| Rate limit documentation  | 2      | No rate limits documented; only server worker-thread tuning (`MaxWorkerThreads`, `QueueDepthLimit`) [DOCS]         |
| Pagination documentation  | 4      | `page` / `pageSize` clearly documented, with the 100-entity cap and the "increment page until short page" idiom [DOCS] |
| Webhook documentation     | 1      | No webhooks. Greentree has no event/push mechanism — polling only [DOCS]                                           |
| SDKs / code examples      | 2      | No SDKs; examples are raw URLs + a couple of XML payloads (POST/approve/report)                                    |
| Changelog / versioning    | 2      | No API versioning; features annotated with the Greentree release they shipped in [DOCS]                            |

**Overall documentation quality:** good (for an on-premise ERP — clear on auth, URLs, paging; weak on errors/response shapes)

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (MYOB Greentree Knowledge Base)
- [ ] Found OpenAPI/Swagger spec — **none exists** (hand-written HTML docs only) [DOCS]
- [x] Identified authentication method (HTTP Basic + `ApiKey` header — see 2.3)
- [ ] Found at least one working example — **NOT live-verified; KB URL examples only** [DOCS]
- [x] Identified rate limit information (**none documented**; server worker-thread tuning only) [DOCS]
- [x] Identified pagination approach (`page` / `pageSize`; 100-entity GET cap) [DOCS]
- [x] Checked for webhook/event support — **none; poll instead** [DOCS]
- [x] Checked for official SDKs — **none** [DOCS]

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Greentree API (the RESTful HTTP interface to the Greentree Jade database) [DOCS]
- **Vendor / company:** MYOB Greentree — an enterprise ERP (GL, AR/AP, job costing, inventory,
  purchasing, HR/payroll, CRM, fixed assets, manufacturing, service). Now part of MYOB; built on
  the **Jade** object database. [DOCS]
- **Current API version:** **Unversioned.** No version segment, header, or query param. The API
  ships with the Greentree product; feature availability tracks the Greentree release
  (e.g. 2018.3, 2019.2, 2019.3, 2020.1, 2021.1, 2021.4) [DOCS]
- **Base URL(s):**
  - Production: **per-customer instance URL** — every customer self-hosts. There is **no MYOB
    cloud host**. Pattern: `http(s)://<server>:<port>/<company>/...` (default port **9000**,
    configurable via `ListenPort` in `jadegt.ini`) [DOCS]
  - Sandbox / testing: None public — a customer would point the API at a test Greentree company
- **API type:** REST (HTTP verbs map to operations: GET=read, POST=write/create, DELETE=delete) [DOCS]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTP/HTTPS. **Critically, the Greentree API is its own web server** — it services
  queries against the Jade database directly and needs **no IIS or other web-server technology**.
  The docs' examples use plain `http://...:9000` because that is the *internal* form; for Numa the
  customer must front it with HTTPS (see 9.2) [DOCS]
- **Data format:** XML **or** JSON. The HTTP `Content-Type` (on POST) and `Accept` (on response)
  headers select the format. Use `application/json` for both to work in JSON. Note: JSON POST
  bodies are supported **from Greentree 4@8-5** onward [DOCS]
- **Content-Type header(s):** `text/xml` / `application/xml` for XML; `application/json` for JSON.
  A documented sample header block: `Accept: application/xml;q=0.9,*/*;q=0.8`,
  `Authorization: Basic c3VwZXI6c3VwZXI=`, `Content-Type: text/xml; charset=UTF-8` [DOCS]
- **Character encoding:** UTF-8 (per the sample `charset=UTF-8`) [DOCS]
- **URL structure pattern:** [DOCS]

```
http://<server>:<port>/<company>/<entity>/<identifier>
```

| Segment        | Meaning                                                                | Example                       |
| -------------- | ---------------------------------------------------------------------- | ----------------------------- |
| `<server>`     | Server name or IP address                                              | `greentree.site.com` / `203.44.22.12` |
| `<port>`       | Port the API listens on (default 9000, `ListenPort` in `jadegt.ini`)   | `9000`                        |
| `<company>`    | The Greentree **company code** — part of EVERY path                    | `01`                          |
| `<entity>`     | The Greentree object type (usually the Jade class name)                | `SOPackingSlip`               |
| `<identifier>` | Primary key of the object (**optional** — omit for a list)             | `24333.01`                    |

> **The order of these segments is mandatory.** Example:
> `http://greentree.site.com:9000/01/SOPackingSlip/24333.01`
> A GET returns that packing slip; a POST to the same URL updates it; a DELETE deletes it. [DOCS]

> ⚠️ **The company code (`01`) is in the path on every request.** It is NOT part of the host and
> NOT a header — it sits between the host and the entity. The Numa agent must include it
> (e.g. `/01/GLAccount`), so it has to know the customer's company code (commonly `01`; confirm
> per customer). [DOCS]

- **Versioning strategy:** None [DOCS]
- **CORS policy:** [UNVERIFIED] — irrelevant for Numa (server-side proxy, not a browser)
- **Required headers (all requests):**

| Header          | Value                                  | Purpose                                                                              |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `Authorization` | `Basic base64(user:password)`          | Per-user Greentree login — what Numa injects from the user vault [DOCS]               |
| `ApiKey`        | `{site serial number}`                 | Account/site-level key — what Numa injects from the admin company secret [DOCS]       |
| `Accept`        | `application/json`                     | Select JSON responses (else XML) [DOCS]                                               |
| `Content-Type`  | `application/json`                     | On POST bodies (JSON supported from 4@8-5) [DOCS]                                     |

- **Important quirk:** the `ApiKey` can ALSO be passed as a URL query parameter
  (`?ApiKey=23440933`) — handy in a browser, but Numa uses the **header** form so the key never
  lands in request logs / URLs [DOCS].

### 2.3 Authentication [REQUIRED]

> **TWO mechanisms, BOTH required on every call** [DOCS]. This is the same dual-auth shape as
> ProWorkflow: an account-level key (admin-managed) **plus** a per-user login.

1. **HTTP Basic Authentication** — a **regular Greentree username + password**. The API runs with
   **exactly that user's Greentree permissions** — identical to that person logging into the
   Greentree desktop client. Two Numa users with different Greentree roles see different data
   through the same connector. [DOCS]
2. **`ApiKey`** — the **site's Greentree serial number** (e.g. `23440933`). It is the SAME for
   every user of that Greentree site (account/site-level, **not** per-user). Passed either as a
   URL parameter (`?ApiKey=…`) or, preferred for programmatic use, as an **`ApiKey` HTTP header**. [DOCS]

- **Auth method:** Dual — HTTP Basic (per user) + `ApiKey` header (account-level). **No OAuth, no
  tokens, no expiry, no refresh, no login handshake** — both credentials travel on every request. [DOCS]
- **Auth location:** Headers (`Authorization` + `ApiKey`)
- **Auth header format:**

```
Authorization: Basic base64(greentree-username:greentree-password)
ApiKey:        {site serial number}
```

**Numa's mapping (the same two-secret model as ProWorkflow):**

- The **`ApiKey` (serial number)** is account-level → admin enters it once in the wizard → stored
  on the company secret `connector-config-greentree` (`api_key`), sent as the `ApiKey` header on
  every call.
- The **Greentree username + password** is per-user → captured in the chat credential card on
  first use → stored in the user's personal vault (`connector-greentree`) → sent as
  `Authorization: Basic …`.
- The admin never collects user passwords; the agent never sees either secret.

**For the account `ApiKey`:**

- **How to obtain:** it is the Greentree **site serial number** — found in the Greentree
  **licensing / About** screen, or from the Greentree administrator [DOCS]
- **Key format / pattern:** a numeric serial (the docs show `23440933` / `34440933`) [DOCS — exact
  format/length not formally specified]
- **Rate limits per key:** none documented (see Phase 8)
- **Key rotation procedure:** the serial changes only if the Greentree licence is reissued; if it
  does, the admin re-saves the wizard with the new value

**Auth failure semantics [UNVERIFIED — not documented]:**

- The docs do **not** state the status codes for bad Basic auth vs bad ApiKey. Expect a `401`
  (HTTP Basic challenge is the convention) for either; treat the exact body as unknown until
  verified on a live instance. A wrong **company code** in the path is more likely a `404`.

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> ⛔ **GATE NOT PASSED.** No instance and no credentials — no authenticated call has ever been made.
> Do NOT treat any request/response shape in this pack as live-verified.

**Endpoint planned for first call (when an instance is available):**

```http
GET /01/Ping HTTP/1.1
Host: {server}:{port}
Authorization: Basic base64(user:password)
ApiKey: {site serial number}
Accept: application/json
```

(`Ping` / "Health check for your Greentree system" is the documented liveness entity — the safest
first call. If it is not enabled, `GET /01/GLAccount?page=1&pageSize=1` is a benign read.) [DOCS]

- **HTTP status code:** expected 200 [UNVERIFIED]
- **No live observation was possible** — there is no vendor-hosted endpoint to probe (every
  Greentree is customer-hosted).
- **Gotchas expected during setup:** the API server must be running and reachable over HTTPS; the
  company code in the path must be correct; the Basic user must have Greentree permissions for the
  entity; the `ApiKey` (serial) must match the site.

- [ ] **GATE CHECK: First successful API call completed and documented above** — **NOT DONE;
  blocked on instance + credentials**

---

## Phase 3: Domain Model & Behavior

> Greentree is a full enterprise ERP. The API exposes ~120 entities (one KB article each), grouped
> by module. Entity names are the Jade class names. Field-level detail lives in each entity's KB
> article; below are the module groupings and the entities Numa users are most likely to ask about.
> Field lists are **[UNVERIFIED]** beyond what the docs name — the per-entity articles were not
> exhaustively transcribed and no response bodies were observed.

### 3.1 Core Modules & Entities [REQUIRED]

| Module                       | Representative entities (Jade class / KB name)                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **General Ledger (GL)**      | `GLAccount`, GL Account Segment Definition, `GLBudget`, `GLControl`, `GLDocument`, GL Period Summary, GL Bank In (Cash Receipts), GL Bank Out (Cash Payments) |
| **Accounts Receivable (AR)** | `ARCustomer`, `ARInvoice`, `ARReceipt`, `ARCreditNote`, `ARControl`, AR SalesPerson                              |
| **Accounts Payable (AP)**    | `APSupplier`, `APInvoice`, AP Invoice On-Charge, `APPayment`, `APCreditNote`, `APControl`                        |
| **Sales Orders (SO)**        | `SOSalesOrder`, `SOPackingSlip`, SO Status Definition, SO Carrier                                                |
| **Purchase Orders (PO)**     | PO Purchase Orders, PO Receipt, PO Shipments, PO Status Definition, SCM Requisitions, Profit Centre              |
| **Inventory (IN)**           | `INStockItem`, IN Transaction (+ Transaction Type), IN Location, IN Storage Profile, IN Forecast, IN Budget, IN Stock Take (+ Item), IN Serial Lot, IN Unit Of Measure, IN Analysis Code, IN Bin Type/Transaction, IN Advanced Pricing (several), IN Control |
| **Job Costing (JC)**         | `JCJob`, JC Job Type, JC Estimate, JC Timesheet, JC Activity, JC Disbursement, JC Plant Charge, JC Employee, JC Work Centre (+ Plan), JC Status, JC Control |
| **HR / Payroll (HR)**        | `HRPerson`, HR Applicant, HR Position, HR Employment Type, HR Leave Request, HR Incident (+ Type/Status/Event Type), HR Injury (Type/Severity), HR Training Type, HR Skill Type, HR Certification (Type), HR CV* (Education/Employment/Skill/Training/Medical/Certification), HR Education Type, HR Medical Role, HR Award Class |
| **CRM**                      | CRM Contact, CRM Organisation, CRM Lead, CRM Quote, CRM Task, CRM Service Request, CRM Communication (+ Priority), CRM Message, CRM Document Rule, CRM Web Timesheet, CRM SV* (Request Type/Status, Contract (+Cost), Location, Asset (+Class/Type/Usage)) |
| **Fixed Assets (FA)**        | FA Master, FA Purchase, FA Depreciation, FA Disposal, FA Transfer, FA Revaluation, FA Write Offs, FA Adjustment, FA Balance Adjustment, FA Control |
| **Manufacturing**            | BOM Bill Of Materials, FO Factory Order (+ Receipts)                                                             |
| **Reference / Utility (UT)** | Company, Branch, Tree, User (+ User Defined Field Definitions, User Security Snapshot), EC Web User, UT Tax Code, UT Payment Term, UT Currency Code, UT Country, AH Form Definition, Browser Timesheets, Global search, **Ping** (health check) |

#### Entity URL shape (applies to every entity) [DOCS]

```
GET    /{company}/{Entity}                       list (capped at 100; page with page/pageSize)
GET    /{company}/{Entity}/{identifier}          read one
POST   /{company}/{Entity}                        create (Greentree allocates the identifier — see 3.4)
POST   /{company}/{Entity}/{identifier}           update an existing object
DELETE /{company}/{Entity}/{identifier}           delete
```

Concrete examples from the docs [DOCS]:

```http
GET  /01/SOPackingSlip/24333.01
GET  /01/SOPackingSlip?page=1&pageSize=20
GET  /01/Customer?globalSearch=041            # Global Search (2020.1)
POST /01/CRMSVRequest/1021?action=report      # run a report
```

### 3.2 Entity Relationships [IMPORTANT]

The docs do not publish a relationship diagram; relationships are implicit in the Jade model
(e.g. AR Invoice → AR Customer, Sales Order → Stock Items, JC Timesheet → JC Job → JC Activity).
Some sort examples hint at reference traversal in queries — e.g.
`ARInvoice?sortBy1=myCustomer.code` sorts invoices by the related customer's code, and
`sortBy1=myBranch.code` by branch [DOCS]. So **dotted reference paths** (`myCustomer.code`) are a
real navigation idiom for sorting (and likely filtering). Concrete per-entity relationships must be
read from each entity's KB article. [UNVERIFIED beyond the sort examples]

### 3.3 Cross-cutting object features (available on EVERY entity) [DOCS]

Greentree attaches several generic capabilities to *any* object, exposed via query-parameter
**modifiers** on the entity URL. These are unusually powerful and worth surfacing to the agent:

| Feature             | How to request                                                            | Available    |
| ------------------- | ------------------------------------------------------------------------- | ------------ |
| **Attachments**     | GET `?includeAttachments=true`; download `?action=attachment&name=<n>`; upload via POST `?action=attachment` as `multipart/form-data` | always |
| **Sticky Notes**    | GET `?includeStickyNotes=true` (`&stickyNoteType=<T>`); create/update via POST | read always; write 2020.1 |
| **Plugin Properties** | `?includePluginProperties=true` (incl. Dynamic Properties)               | 2020         |
| **Linked Objects**  | `?includeLinkedObjects=true` (generic object-to-object links)             | 2020         |
| **Approvals**       | GET `?includeApprovals=true`; POST `?action=approve` / `?action=reject` / `?action=clearApproval` (with payload) | clearApproval post-2018.3 |
| **Reports**         | POST `?action=report` with an `AHFormDefn` payload → returns a PDF (any soft-coded report); optional `?timeout=n` | 2019.2 |
| **Global Search**   | GET `?globalSearch=<term>` on any entity (uses Greentree's Global Search config) | 2020.1 |

⚠️ **Approvals (`action=approve`/`reject`/`clearApproval`) are financially/operationally
significant** — they push records through Greentree's approval workflow. Treat like a mutation:
require explicit human confirmation in the Numa LLM rules (see Phase 9).

### 3.4 Business Rules [IMPORTANT]

**Identifier allocation [DOCS]:**

- A **POST with no `<identifier>` creates** a new entity, and **as a general rule the client cannot
  specify the identifier** — Greentree allocates it. The docs note **exceptions** that are
  documented per-entity, so check the entity article before assuming. [DOCS]
- A **POST to an existing `<identifier>` updates** that object. [DOCS]

**Sticky-note write rules [DOCS]:**

- To **update** an existing sticky note you MUST include its `OidString` — it locates the note and
  is cross-checked against the containing entity so you cannot accidentally modify another entity's
  note. Omitting `OidString` **creates** a new note.
- **Confidential and inactive notes are never returned** via the API.

**Approvals payloads [DOCS]:**

- `action=approve` / `action=reject` accept a small payload naming the approver/rejector and a
  narration; if omitted, the **API (Basic-auth) user** is recorded as the approver/rejector.
- `action=clearApproval` (post-2018.3) takes **no payload** and clears all approval state on the
  record.

**Reports [DOCS]:**

- `action=report` runs a soft-coded report (`AHFormDefn`) and returns the generated **PDF**. It can
  also attach the PDF to a record (`ReplaceIfExists`, `RespondWithAttachment` attributes). Reports
  can be slow — the report engine has a **default 60s timeout**, overridable with `?timeout=n`
  (seconds). A long report can outlive the HTTP call.

### 3.5 Field Format Reference [IMPORTANT]

| Format        | Pattern / Example                          | Notes                                                                       |
| ------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Identifier    | entity-specific, e.g. `24333.01` (packing slip ref), `1021` (CRM SV request), `A0002` (stock item), `1170` | Human-meaningful refs, not opaque GUIDs — Greentree uses the business key in the URL [DOCS] |
| Company code  | `01`                                       | Always present in the path; per-customer (commonly `01`) [DOCS]             |
| OidString     | `3456.768` / `8364.13`                      | Internal object id used for attachments / sticky-note updates [DOCS]        |
| Date/time     | `2013-08-28T16:19:04` / `2014-06-21T23:34:00` (ISO 8601, in XML examples) | Wire format on JSON responses [UNVERIFIED] |
| Booleans      | `true` / `false` (XML element text)         | JSON boolean shape [UNVERIFIED]                                             |
| Currency / numbers | numeric                                | Decimal handling [UNVERIFIED]                                              |
| Enums/status  | string values (e.g. Approval `Status` = `Approved`) | Allowed values NOT enumerated in the docs [UNVERIFIED]              |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

Not documented. Status/type values (SO/PO status definitions, approval statuses, etc.) are
configured **per Greentree install** — there are dedicated definition entities (SO Status
Definition, PO Status Definition, JC Status) you can read to discover the values for a given
customer. Collect these from a live instance before encoding any enum into LLM rules.

---

## Phase 4: Endpoint Catalog

> There is no single endpoint list endpoint and no machine spec. The "endpoints" are the ~120
> entities, each at `/{company}/{Entity}[/{identifier}]`, with shared modifiers. Below are the
> read/write patterns and the highest-value entities for Numa. Full per-entity detail: the KB
> articles under `enterprisesupport.myob.com/greentree/api-documentation`.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /{company}/Ping  (health check)

- **Purpose:** liveness check — the safest test-connection call [DOCS]
- **Auth:** Basic + ApiKey — **Response:** [UNVERIFIED — not shown]

#### Endpoint: GET /{company}/{Entity}  (list)

- **Purpose:** list rows of an entity. **Capped at 100 entities per request.** Page with
  `page` + `pageSize`; increment `page` until a page returns **fewer than `pageSize`** rows [DOCS]
- **Idempotent:** yes — **Paginated:** yes (`page` / `pageSize`)

```http
GET /01/SOPackingSlip?page=1&pageSize=20     # first 20
GET /01/SOPackingSlip?page=1                 # first 100 (default page size)
```

#### Endpoint: GET /{company}/{Entity}/{identifier}  (read one)

```http
GET /01/SOPackingSlip/24333.01
```

#### Endpoint: GET /{company}/{Entity}?globalSearch=<term>  (Global Search, 2020.1)

```http
GET /01/Customer?globalSearch=041            # customers matching Global Search config [DOCS]
```

#### Endpoint: POST /{company}/{Entity}  (create)

- **Purpose:** create a new entity. Greentree allocates the identifier (per-entity exceptions
  exist) [DOCS]. JSON bodies supported from 4@8-5. **Request/response body shapes [UNVERIFIED]** —
  the docs show XML payloads for sticky notes/approvals/reports but not full create bodies.

#### Endpoint: POST /{company}/{Entity}/{identifier}  (update)

- **Purpose:** update the identified object [DOCS]

#### Endpoint: DELETE /{company}/{Entity}/{identifier}  (delete)

```http
DELETE /01/SOPackingSlip/24333.01            # deletes packing slip 24333.01 [DOCS]
```

#### Endpoint: POST /{company}/{Entity}/{id}?action=report  (run a report → PDF)

```http
POST /01/CRMSVRequest/1021?action=report
Content-Type: application/json|xml
<AHFormDefn> … report name + parameters … </AHFormDefn>
→ a PDF (optionally also attached to the record) [DOCS]
```

#### Endpoint: POST /{company}/{Entity}/{id}?action=approve|reject|clearApproval  (approvals)

- **Purpose:** drive Greentree's approval workflow — **financially significant**; human
  confirmation required in Numa [DOCS]

**Common error responses (all endpoints):** **[UNVERIFIED]** — the docs do not catalogue error
status codes or bodies. Expect at least `401` (bad auth), `404` (bad company/entity/identifier),
and a `4xx/5xx` for malformed writes; parse defensively (status first, then body as XML *or*
JSON *or* plain text). Confirm on a live instance.

### 4.2 Full Endpoint Index [IMPORTANT]

See `02-api-spec-investigation.md` §Entity Inventory for the module-by-module entity list. The
authoritative source is the KB "API documentation" page (one article per entity, ~120 entities).
There is no `/RestPaths`-style machine catalog.

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

None documented. (Greentree's older integration surfaces — FREE/COM, SOAP/JHP, data import-export —
are separate technologies, not part of this REST API.) [DOCS]

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                          | Supported?              | Syntax / Notes                                                       |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| Filter by field value               | per-entity [UNVERIFIED] | The docs say "various query parameters … specific to the particular request" — entity-specific filters live in each entity article [DOCS] |
| Global search                       | yes (2020.1)            | `?globalSearch=<term>` on any entity (uses Greentree's Global Search config) [DOCS] |
| Sort by field                       | yes (rolling out 2021)  | `?sortBy<n>=<prop>` (+ `?sortDesc<n>=true`); multi-key; supports reference props (`myCustomer.code`). First on `ARInvoice`, rolling to other endpoints [DOCS] |
| Field selection / sparse fields     | [UNVERIFIED]            | Not documented as a generic modifier                                 |
| Include related/cross-cutting data  | yes                     | `includeAttachments` / `includeStickyNotes` / `includePluginProperties` / `includeLinkedObjects` / `includeApprovals` [DOCS] |
| Pagination                          | yes                     | `page` / `pageSize` (100 cap) [DOCS]                                  |
| Aggregate / count                   | [UNVERIFIED]            | No documented total-count parameter                                  |
| Logical operators (AND/OR)          | [UNVERIFIED]            | Multiple query params separated by `&`; combination semantics not stated |
| Comparison operators                | [UNVERIFIED]            | Not documented generically (may exist per entity)                    |
| Attachment modified-since           | yes (attachments)       | `?modifiedSince=<iso>` when requesting an attachment by name [DOCS]   |

### 5.2 Filter Syntax [REQUIRED]

**General pattern** [DOCS]:

```
GET /{company}/{Entity}?key=value&key2=value2
```

Query parameters follow the base URL after `?`, as `key=value` pairs joined by `&`. **Most
parameters are entity-specific** — the API overview is explicit that "most of these parameters are
specific to the particular request"; only a handful (paging, the `include*` modifiers, sorting,
`globalSearch`, `ApiKey`) are common across entities. **Per-entity filter parameters must be read
from the entity's KB article** and are **[UNVERIFIED]** here.

### 5.3 Sort Syntax [IMPORTANT] [DOCS — 2021 preview, rolling out per endpoint]

```
?sortBy1=orderNumber                          # ascending
?sortBy1=paymentDate&sortDesc1=true           # descending
?sortBy1=myBranch.code&sortBy2=documentDate&sortDesc2=true   # multi-key + reference prop
```

- `sortBy<n>` (n from 1) names the property; `sortDesc<n>=true` makes that key descending
  (default ascending). Any number of keys; reference properties (dotted paths) are allowed.
- **Availability is endpoint-by-endpoint** — `ARInvoice` first, then rolling through the rest.
  Do not assume an arbitrary entity supports sorting; verify per entity.

### 5.4 Field Selection [NICE-TO-HAVE]

No documented sparse-fieldset modifier. Responses return the full entity (plus any `include*`
collections requested). [UNVERIFIED]

### 5.5 Search Capabilities [IMPORTANT]

- **Global Search:** `?globalSearch=<term>` on any entity (2020.1). It uses the customer's Greentree
  **Global Search configuration**, so what it matches is install-specific [DOCS].
- **Per-resource search:** entity-specific query params (read each article).
- **Fuzzy matching:** governed by the Global Search config; not separately documented.

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1 — list with paging (the core read loop):** [DOCS]

```http
GET /01/SOPackingSlip?page=1&pageSize=20
# keep incrementing page until a page returns < pageSize rows
```

**Pattern 2 — global search for a record:** [DOCS]

```http
GET /01/Customer?globalSearch=041
```

**Pattern 3 — read a record with its sticky notes + approvals:** [DOCS]

```http
GET /01/INStockItem/A0002?includeStickyNotes=true&includeApprovals=true
```

**Pattern 4 — AR invoices sorted by payment date, newest first:** [DOCS]

```http
GET /01/ARInvoice?sortBy1=paymentDate&sortDesc1=true&page=1&pageSize=25
```

**Pattern 5 — download a named attachment from a stock item:** [DOCS]

```http
GET /01/StockItem/A0002?action=attachment&name=desktop.jpg
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** page-number (`page` + `pageSize`) [DOCS]
- **Default page size:** **100** — a GET list with no `pageSize` returns up to 100 entities; lists
  are **hard-capped at 100 per request** [DOCS]
- **Maximum page size:** **100** (the documented cap) [DOCS]
- **Total count available:** **No documented total-count parameter** — you discover the end by
  paging until a short page [DOCS]

**Request parameters:** [DOCS]

| Parameter  | Type | Default | Description                                  |
| ---------- | ---- | ------- | -------------------------------------------- |
| `page`     | int  | 1       | 1-based page number                          |
| `pageSize` | int  | 100     | Rows per page; **capped at 100**             |

**How to detect last page:** keep incrementing `page`; **stop when a page returns fewer than
`pageSize` rows** (the documented idiom). There is no total-count field. [DOCS]

### 6.2 Pagination Worked Example [REQUIRED] [DOCS]

```
Page 1: GET /01/SOPackingSlip?page=1&pageSize=20   → 20 rows  → keep going
Page 2: GET /01/SOPackingSlip?page=2&pageSize=20   → 20 rows  → keep going
…
Last:   GET /01/SOPackingSlip?page=N&pageSize=20   → 7 rows (< 20) → stop
```

### 6.3 Bulk Operations [IMPORTANT]

| Operation       | Endpoint                          | Notes                                                          |
| --------------- | --------------------------------- | -------------------------------------------------------------- |
| Bulk create     | none documented                   | One POST per entity                                            |
| Bulk update     | none documented                   | Sticky-note POST can carry **multiple notes** in one payload [DOCS] |
| Bulk delete     | none documented                   | One DELETE per identifier                                      |
| Bulk read       | paged list GETs (`page`/`pageSize`, 100 cap) | The only batch-read path                            |

**Partial failure handling:** [UNVERIFIED] — not documented.

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

No async export. Large pulls = paged GET loops (100/page). Reports (`action=report`) produce PDFs,
not data exports. For bulk *imports*, Greentree's separate data import-export tooling exists outside
this API [DOCS].

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                              |
| ------------------------ | ---------- | -------------------------------------------------- |
| Webhooks                 | **no**     | Greentree has no webhook/push mechanism [DOCS]     |
| WebSocket                | no         |                                                    |
| Server-Sent Events (SSE) | no         |                                                    |
| Long polling             | no         |                                                    |
| Change feeds / streams   | no         | Poll list GETs (+ attachment `modifiedSince`)      |

### 7.2 Webhooks [IMPORTANT]

**None.** There is no event subscription model. A future Numa Automations trigger on Greentree
would have to **poll** (e.g. list an entity periodically and diff). No change-detection timestamp is
documented at the entity level (only attachments support `modifiedSince`), so change detection would
have to lean on entity-specific date fields or sorting newest-first. [DOCS]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** a paged list GET of the entity of interest, optionally
  `sortBy<n>` on a date field (where sorting is supported for that entity) to surface the newest
  records first.
- **Recommended polling interval:** ≥ 60s — this is a customer's production ERP box on their own
  hardware; be polite (no rate limiter protects it).
- **Change detection field(s):** entity-specific date fields; `modifiedSince` for attachments. No
  universal `LastModified` documented. [UNVERIFIED]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope   | Limit             | Notes                                                                         |
| ------- | ----------------- | ----------------------------------------------------------------------------- |
| Default | **none documented** | No rate limiting in the API. Throughput is governed by **server worker-thread tuning** in `jadegt.ini`: `MaxWorkerThreads`, `MinWorkerThreads`, `QueueDepthLimit`, `QueueDepthLimitTimeout`, `WorkerIdleTimeout` [DOCS] |

- **Rate limit headers:** none documented.
- **Practical guidance:** the API is the customer's production ERP, single Jade server. Numa MUST
  self-throttle (small `pageSize`, no parallel fan-out, serial paging) — there is no built-in guard,
  and a heavy query can starve other workers (`CallDurationLogTrigger` exists to log slow calls). [DOCS]

### 8.2 Error Handling [REQUIRED]

**Status codes / error bodies are NOT documented.** [UNVERIFIED] The docs describe verb behaviour
(GET reads, POST writes, DELETE deletes) but never list error responses. What is known:

- Responses can be **XML or JSON** depending on the `Accept` header — error bodies likely follow the
  negotiated format too, but this is unconfirmed.
- Server-side **debugging/tracing** (`ApiTracing` / `ApiLogging` in the `[JadeLog]` section, written
  to `apilog.log`) is the customer-side tool for diagnosing failures — query it in real time;
  **don't leave it on in production** (it grows the log file). [DOCS]

**Expected status codes [UNVERIFIED — to confirm on a live instance]:**

| HTTP Status | Likely meaning                                          | Retryable? | Recovery                                       |
| ----------- | -------------------------------------------------------- | ---------- | ----------------------------------------------- |
| 200         | OK                                                       | —          |                                                 |
| 401         | Bad/missing Basic auth or wrong `ApiKey`                 | No         | Fix user login / serial; reconnect             |
| 404         | Wrong company code, entity, or identifier in the path    | No         | Verify `/{company}/{Entity}/{id}`              |
| 4xx         | Malformed write / business-rule veto                     | No         | Fix the payload                                 |
| 5xx         | Server/Jade error (plugin/report failure, timeout)       | Cautiously | Check `apilog.log`; likely environmental        |

**Parse defensively:** status code first → try the negotiated format (JSON or XML) → fall back to
raw text → tolerate empty bodies.

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** none documented.
- GET: idempotent (except `action=report`/`approve`/`reject` which are POSTs). DELETE: idempotent.
- **POST to a new entity:** retries can **create duplicates** (Greentree allocates the identifier, so
  there is no client-supplied dedupe key). After a write timeout, **query before retrying.**
- **POST to an existing identifier:** an update — re-sending is generally safe for scalar fields, but
  child collections (e.g. multiple sticky notes without `OidString`) **append**, so retries can
  duplicate them.

### 8.4 Async Operations [IMPORTANT]

None — all operations are synchronous. The one long-running case is **reports**: the report engine
has a default 60s wait (override `?timeout=n`) and may outlive the HTTP call; the docs float a
*future* async report token as a possible enhancement (not available today). [DOCS]

### 8.5 File Handling [IMPORTANT]

- **Attachments** are first-class on every entity [DOCS]:
  - List: `GET …?includeAttachments=true` → an `<Attachments>` collection (Name, Edition, OidString,
    FileName, FileSize, ModifiedTimeStamp, Type)
  - Download: `GET …/{id}?action=attachment&name=<name>` (optionally `&modifiedSince=<iso>` to skip
    unchanged files)
  - Upload: `POST …/{id}?action=attachment` as **`multipart/form-data`** — name/filename come from the
    `Content-Disposition`; modifiers `name`, `type`, `replaceIfExists`, `summary`, `isPrimary`
    (2021.1), `isWebAccessible` (2021.1)
- This makes Greentree a candidate for a **download capability** later (attachments are a real,
  browsable per-entity file surface). Out of scope for the initial connector.

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- No optimistic-concurrency token documented (no `RowHash` equivalent). `Edition` numbers appear on
  attachments/sticky notes but their role in concurrency is [UNVERIFIED].
- The Jade database is the single source of truth; the API runs synchronously against it.

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                            | Fits?   | Notes                                                            |
| -------------------------- | ------------------------------------------------------ | ------- | --------------------------------------------------------------- |
| **Data Connector**         | API has file-like content to browse/search/download    | no      | Attachments exist but are per-entity, not a browsable file tree  |
| **Data Connector (Files)** | API is primarily a file storage/document system        | no      |                                                                  |
| **Direct API Only**        | API is action-oriented (no browsable content)          | **yes** | ERP reads + writes via the generic `request` op                  |
| **Hybrid**                 | Browsable content AND actions                          | later   | Attachments could back a download capability in a later phase    |

**Selected integration path:** **Direct API via the Numa native data connector (`request`
operation)** — `authType: username-password` with an account-level `ApiKey` header, NOT Pipedream,
**NOT OAuth**.

**Justification:** the dual-auth shape (account `ApiKey` header + per-user Basic) maps 1:1 onto the
ProWorkflow pattern already in the generic connector backend — zero new auth code. The customer-hosted
instance URL maps onto the Jiwa pattern (admin-set `instance_url`, no fixed base URL). Greentree is
the combination of both twins.

**Numa request flow:**

```
workspace agent → connectors(name="request", params={connector:"greentree",
                              url:"/01/GLAccount?page=1&pageSize=50", method:"GET"})
  → backend resolves connector-config-greentree.instance_url (admin-set; REQUIRED — no default)
  → injects Authorization: Basic base64(user vault: connector-greentree username:password)
  → injects ApiKey: {company secret: connector-config-greentree.api_key}  (header name from api_key_header)
  → forwards; the agent never sees either credential
```

Note the **company code (`01`) is in the relative URL** the agent supplies — it is not config and
not a header. The agent must know the customer's company code (commonly `01`; confirm per customer).

### 9.2 Connector Requirements [IMPORTANT]

Not a file connector — `list_files`/`download_file` mapping N/A (attachments are a possible later add).

- **Auth type for connector:** `username-password` (per-user Greentree login as Basic) **plus** an
  account-level `ApiKey` header (admin-entered serial number). Two-secret model.
- **Per-client config:** `instance_url` (REQUIRED — set in the ApiKeyWizard) + `api_key` (the site
  serial) + `api_key_header` = `ApiKey`.
- **Connector category:** ERP / finance
- **Caching appropriate:** no (live transactional ERP data)

**Deployment-model constraints (surface these in the admin wizard copy):**

1. **Customer-hosted, on-premise only:** the Greentree API is its own web server (default port
   **9000**, no IIS) on the customer's box. There is **no MYOB cloud** — the admin MUST set the
   instance URL, and it is unique per customer. [DOCS]
2. **Internet reachability (same prerequisite as Jiwa):** the docs' examples use internal
   `http://...:9000`, but Numa's Lambdas call from AWS, so the customer must publish the API over
   **HTTPS** to the internet — typically a reverse proxy / **Cloudflare** in front, or a port-forward
   with a valid TLS cert, plus an **IP-whitelist** allowance for Numa's egress if they whitelist.
   The KB even has an article "Achieving an SSL connection by configuring IIS as a Reverse Proxy"
   for exactly this. [DOCS]
3. **Company code in the path:** every URL includes the company code (`01`). The agent must include
   it; confirm the customer's code at onboarding.
4. **Permissions are the Basic user's Greentree permissions:** least-privilege is set on the
   Greentree side per user; the API grants exactly that.
5. **Version sensitivity:** feature availability tracks the Greentree release (Global Search 2020.1,
   sorting 2021 preview, JSON POST 4@8-5, etc.). Confirm the customer's version before relying on
   newer modifiers.

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Read ERP data via paged list GETs and single-record GETs across GL, AR/AP, SO/PO, Inventory,
   Job Costing, HR, CRM, Fixed Assets (with the company code in the path)
2. Use Global Search (`?globalSearch=`) to find records, and sorting (`?sortBy<n>=`) where the
   entity supports it
3. Pull cross-cutting data with `include*` modifiers (attachments metadata, sticky notes, approvals,
   plugin properties, linked objects)
4. Create/update master data and transactions on explicit user request (POST), honouring the
   identifier-allocation rules
5. Run soft-coded reports to PDF (`?action=report`) when asked
6. Diagnostics: `GET /{company}/Ping`

**CANNOT do (out of scope or dangerous — encode in LLM rules):**

1. Drive **approval workflow** (`action=approve`/`reject`/`clearApproval`) without explicit human
   confirmation — these are financially significant
2. **DELETE** without explicit human confirmation (and never bulk-delete loops)
3. Assume an OAuth/token flow — there is none; never try to set `Authorization` itself
4. Hammer the server — no parallel fan-out; serial paging with small `pageSize`
5. Rely on undocumented filters/enums without verifying against the customer's instance

**Default parameters:**

| Parameter   | Default                              | Reason                                              |
| ----------- | ------------------------------------ | --------------------------------------------------- |
| `pageSize`  | 20–25 (max 100)                      | Don't hammer a customer's ERP box; context economy  |
| company code| from the user / onboarding (e.g. `01`)| Mandatory path segment                              |
| `Accept`    | `application/json` (backend-set)     | Get JSON, not XML                                   |
| sort        | only where the entity supports it     | Sorting is rolling out per endpoint                 |

### 9.4 SDK Assessment [NICE-TO-HAVE]

No SDKs exist. Numa uses the generic `request` proxy with raw HTTP + JSON — sufficient.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 **partially**: auth model documented from DOCS; **first-call gate NOT passed (no instance/creds)**
- [x] Phase 3 complete: modules/entities catalogued; cross-cutting features documented; field detail per-entity outstanding
- [x] Phase 4 complete: read/write URL patterns + key entities (response bodies unverified)
- [x] Phase 5 complete: paging, Global Search, sorting, include-modifiers; per-entity filters outstanding
- [x] Phase 6 complete: `page`/`pageSize` (100 cap) with worked example
- [x] Phase 7 complete: no events — polling only
- [x] Phase 8 complete: rate limits/errors flagged UNVERIFIED; attachments/idempotency documented
- [x] Phase 9 complete: integration path selected (Direct API, username-password + ApiKey, customer-hosted)

**Overall investigation confidence:** **medium** — auth, URL structure, paging, and the
cross-cutting modifiers are solidly documented, but there is **no machine spec, no error
catalogue, no response-body examples, and zero live validation**, and the surface varies per
on-premise install.

**Known gaps that will reduce output quality:**

1. **No live verification of anything** — response JSON shapes, error status codes/bodies, exact
   401/404 semantics, date wire format
2. **Per-entity filter parameters** — only named generically in the overview; each entity article
   must be read
3. **Enum/status values** — install-specific (SO/PO status definitions, approval statuses)
4. **Per-customer drift** — enabled modules, Greentree version (feature availability), company code,
   and user permissions all vary
5. **Internet exposure / TLS / whitelisting** — customer-side infrastructure work, not probeable

### 10.2 Generation Prompts [REQUIRED]

Standard pack from this questionnaire (templates in `ext-api-doc/_templates/`):

1. **01-llm-api-rules.md** — Phases 2, 4, 8, 9. **MUST open with a prominent banner:** docs-derived,
   not live-validated; **no OAuth — Basic + ApiKey**; company code is in every path; expect
   per-customer differences (modules, version, permissions). Mandate human confirmation for
   approvals and DELETE.
2. **01a-domain-model-reference.md** — Phase 3 (module/entity map + cross-cutting modifiers)
3. **01b-query-patterns.md** — Phases 5–6 (paging, Global Search, sorting, include-modifiers)
4. **01c-mutation-patterns.md** — Phases 3.4, 4 (create/update, identifier allocation, sticky-note
   `OidString` rule, approvals, reports)
5. **01d-event-and-error-handling.md** — Phases 7–8 (no events; defensive error parsing; attachments)
6. **02-api-spec-investigation.md** — all phases condensed (companion file in this folder)
7. **03-connector-setup.md** — Phase 9 (username-password + account ApiKey; instance_url required;
   customer-hosted reachability)
8. **04-connection-and-reauth.md** — Phase 2.3 + 9 (per-user Basic reconnect; admin ApiKey re-save)

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                                       |
| ---------------------------- | ------------- | ---------- | ----------------------------------------------------------- |
| 01-llm-api-rules             | yes           | medium     | Error bodies, response shapes unverified                    |
| 01a-domain-model-reference   | yes           | medium     | Per-entity fields not transcribed; modules/entities solid   |
| 01b-query-patterns           | yes           | medium-high| Paging/sorting/include-modifiers well documented            |
| 01c-mutation-patterns        | yes           | low-medium | Create bodies unverified; sticky-note/approval rules clear  |
| 01d-event-and-error-handling | yes           | low-medium | No events (certain); error shapes need a live instance      |
| 02-api-spec-investigation    | yes           | medium     | Entity inventory from KB; behaviour partly unverified       |
| 03-connector-setup           | yes           | high       | Dual-auth + instance_url; matches the real implementation   |
| 04-connection-and-reauth     | yes           | high       | Reconnect/rotation flows match the implemented backend      |

---

_Compiled 2026-06-11 from the official MYOB Greentree Knowledge Base
(`enterprisesupport.myob.com/greentree/api-overview` + `/api-documentation`). **No live test
instance and no credentials — docs-derived only. NOT OAuth: HTTP Basic + `ApiKey` header.**
Re-validate flagged items before first customer use._
