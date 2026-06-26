---
api_name: 'AutoPlay (Lead API + Listing API)'
api_slug: 'autoplay'
vendor: 'AutoPlay (automotive dealer marketing platform, AU/NZ)'
website: 'https://www.autoplay.co.nz'
investigation_started: '2026-06-26'
investigator: 'Numa API Investigation Agent (open-source module recovery + open-web research; no vendor pack, no credentials)'
investigation_status: 'blocked' # contact-required: Lead API recovered from OSS; Listing API spec NOT public; no credentials
documentation_quality: 'poor' # Lead API partially recovered from an OSS Drupal module; Listing API undocumented publicly
api_types: [SOAP, REST] # Lead API = SOAP/WSDL [RECOVERED]; Listing API = tokenised REST [INFERRED]
overall_confidence: 'low' # Lead API surface medium; Listing API low; nothing live-validated
blockers:
  - 'Lead API surface (WSDL URLs, SaveLead op, auth header) was RECOVERED from an open-source Subaru-NZ Drupal "autoplay" module — useful but not vendor-confirmed and possibly stale.'
  - 'Listing API (the agent-facing vehicle inventory/media REST API) has NO public spec: base URL, endpoints, and token format are all unknown.'
  - 'No AutoPlay credentials available (per-dealer Key + Token issued in the dealer console). No authenticated call has been made to either API.'
  - "The Lead API is SOAP — Numa's connector request layer is REST-oriented; SOAP support is a backend consideration."
generated_date: '2026-06-26'
---

# API Investigation Questionnaire: AutoPlay

> **This pack is a vendor questionnaire + research record, not a runtime spec.** AutoPlay has
> two confirmed APIs:
>
> - a **Lead API** (SOAP/WSDL) whose surface we **recovered from open-source code** (the
>   Subaru-NZ Drupal `autoplay` module), and
> - a **Listing API** (tokenised REST, vehicle inventory/media) whose **spec is not public**.
>
> This document (a) captures the recovered Lead API facts precisely and (b) lists the open
> questions to send AutoPlay — chiefly the **Listing API** spec, which is the inventory pull the
> workspace agent would actually use.
>
> ⚠️ **NOTHING here is live-validated.** The Lead API facts come from third-party OSS code and
> may be stale; the Listing API is almost entirely unknown. Do not wire a connector from this
> file without confirming against the vendor + a real credential.
>
> ⚠️ **The Lead API is SOAP.** Numa's connector request layer is REST-oriented — SOAP support is
> a **backend consideration**, flagged throughout.
>
> **Confidence markers:**
>
> - `[CONFIRMED]` — verified against a live API (we have NONE — no credentials)
> - `[RECOVERED]` — extracted from the open-source Subaru-NZ Drupal `autoplay` module (third
>   party; high fidelity to _that_ integration's era, but not vendor-confirmed and may be stale)
> - `[WEB]` — public AutoPlay website / marketing
> - `[INFERRED]` — deduced from domain norms / the recovered code's shape
> - `[UNKNOWN]` — could not determine; **this is the questionnaire payload for the vendor**

---

## Phase 0: Why this connector / what it is

**AutoPlay** is an **automotive dealer marketing / inventory platform** used by car dealerships
across **Australia and New Zealand** [WEB]. It manages **vehicle inventory and media** (photos,
videos, window stickers), publishes listings to dealer websites and marketplaces, and captures
**sales leads** back from those surfaces [WEB/INFERRED]. Public footprint: marketing site
`www.autoplay.co.nz`; the dealer application at `autoplayauto.com` [WEB].

**Why an API matters for Numa:** automotive dealer customers want their workspace agent to read
their **inventory** ("what's in stock", "which vehicles have no photos", "stale listings") and
to push/track **leads**. AutoPlay exposes both surfaces:

- **Lead API** — submit/track sales leads (SOAP). Recovered from OSS.
- **Listing API** — vehicle inventory + media (tokenised REST). The **agent-facing read
  surface**; spec not public.

**Disposition:** `contact-required`. This connector is **not yet wired**. The Lead API is
documented here from recovered code; the Listing API spec must be requested from AutoPlay (see
`03-connector-setup.md`).

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** none public found [UNKNOWN]. No developer portal / Swagger
  surface located.
- **Lead API WSDL (production):** `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc?singleWsdl`
  [RECOVERED]
- **Lead API WSDL (test):** `https://lead-api.aptest.co.nz/LeadAPI.svc?singleWsdl` [RECOVERED]
- **Listing API docs URL:** none public [UNKNOWN] — this is the key gap.
- **In-product API setup:** per-dealer **Key + Token** are configured in **Settings → Company
  Settings → API Management** in the AutoPlay dealer console [WEB/RECOVERED].

### 1.2 Supplementary Sources [IMPORTANT]

- **Primary recovery source:** the **open-source Subaru-NZ Drupal `autoplay` module** — a
  third-party Drupal integration that posts leads to AutoPlay's Lead API. It is the source of
  the WSDL URLs, the `SaveLead` operation, the auth-header shape, and the per-dealer id naming
  (`apid`/`yardid`) below [RECOVERED]. **Caveat:** it integrates the **Lead API only** (not the
  Listing API), reflects a specific dealer's era, and may lag the current API.
- **OpenAPI / Postman / official SDKs:** none found [UNKNOWN].

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                               |
| ------------------------- | ------ | ----------------------------------------------------------------------------------- |
| Authentication            | 2      | Lead API header shape recovered [RECOVERED]; Listing API token [UNKNOWN]            |
| Endpoint reference        | 1      | Lead API: one op (`SaveLead`) recovered; full WSDL [UNKNOWN]; Listing API [UNKNOWN] |
| Request/response examples | 1      | Lead API request shape partially recovered; responses [UNKNOWN]                     |
| Error documentation       | 0      | None [UNKNOWN]                                                                      |
| Rate limit documentation  | 0      | None [UNKNOWN]                                                                      |
| Pagination documentation  | 0      | None [UNKNOWN] (relevant for the Listing API inventory pull)                        |
| Webhook documentation     | 0      | None found [UNKNOWN]                                                                |
| SDKs / code examples      | 1      | Only the third-party Drupal module [RECOVERED]                                      |
| Changelog / versioning    | 1      | Lead API path carries `V2` (prod) [RECOVERED]; otherwise [UNKNOWN]                  |

**Overall documentation quality:** **poor** — Lead API partially recovered from OSS; Listing
API effectively undocumented publicly.

### 1.4 Discovery Status [REQUIRED]

- [x] Found a partial machine-readable surface — **Lead API WSDL URLs** [RECOVERED]
- [ ] Found Listing API documentation — **NO** [UNKNOWN]
- [x] Identified Lead API auth shape — SOAP header `<API_KEY>/<API_TOKEN>` [RECOVERED]
- [ ] Identified Listing API auth / token format — **NO** [UNKNOWN]
- [ ] Found a working authenticated example — **NO; no credentials** [UNKNOWN]
- [ ] Identified rate limits / pagination — **NO** [UNKNOWN]
- [ ] Checked webhook/event support — none found [UNKNOWN]

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

**Two distinct APIs:**

| API             | Style                         | What it does                               | Status here                          |
| --------------- | ----------------------------- | ------------------------------------------ | ------------------------------------ |
| **Lead API**    | **SOAP / WSDL** [RECOVERED]   | Submit & track sales leads                 | Surface partially recovered from OSS |
| **Listing API** | **tokenised REST** [INFERRED] | Vehicle inventory + media (the agent read) | **Spec NOT public — ASK VENDOR**     |

**Lead API base/WSDL** [RECOVERED]:

- Production: `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc?singleWsdl`
- Test: `https://lead-api.aptest.co.nz/LeadAPI.svc?singleWsdl`
- (Note the prod path carries `/V2/`; the test URL recovered without it — confirm the test
  version with the vendor.)

**Listing API base URL:** **[UNKNOWN — ASK]** — the single most important question for the
agent-facing inventory read.

### 2.2 Architecture & Protocol [REQUIRED]

**Lead API** [RECOVERED]: SOAP over HTTPS; XML envelope; WSDL-described; the recovered op is
`SaveLead` returning `SaveLeadResult`. ⚠️ **SOAP** — Numa's request layer is REST-oriented.

**Listing API** [INFERRED]: tokenised REST returning vehicle/media records. Transport, data
format, URL pattern, and required headers are all **[UNKNOWN — ASK]**.

### 2.3 Authentication [REQUIRED]

**Both APIs use a per-dealer Key + Token** configured in the AutoPlay dealer console
(**Settings → Company Settings → API Management**) [WEB/RECOVERED].

**Lead API auth** [RECOVERED] — credentials are passed **in the SOAP header** as:

```xml
<API_KEY>{key}</API_KEY>
<API_TOKEN>{token}</API_TOKEN>
```

Plus per-dealer identity values carried in the request body/header [RECOVERED]:

- **`DealershipId`** — recovered as the **`apid`** value (AutoPlay dealer id)
- **`YardId`** — recovered as the **`yardid`** value (a dealer can have multiple yards/lots)

**Listing API auth:** **[UNKNOWN — ASK]** — presumably the **same per-dealer Key + Token**, but
the **token format and where it goes** (header name? query param? bearer?) is unconfirmed.

**Questions for AutoPlay:**

1. **Listing API:** exact auth scheme — is it the same Key + Token, and how is it presented
   (header name / bearer / query param)? Token format and lifetime/rotation? [UNKNOWN]
2. **Lead API:** confirm the current header element names (`API_KEY`/`API_TOKEN`) and whether
   `apid`/`yardid` map exactly to `DealershipId`/`YardId` in the live WSDL. [RECOVERED → confirm]
3. How are per-dealer **Key + Token** issued/rotated, and are they **the same pair** for both
   APIs or separate? [UNKNOWN]

### 2.4 First Successful Call [REQUIRED — CRITICAL GATE — NOT PASSED]

> ⛔ **GATE NOT PASSED.** No AutoPlay credentials (per-dealer Key + Token, Dealership/Yard ids)
> were available. **No authenticated call has been made to either API.** Nothing here is
> `[CONFIRMED]`.

**Planned first calls once credentials exist:**

- **Listing API (priority):** the smallest inventory read (e.g. "list current stock, page 1") —
  but the base URL and endpoint are [UNKNOWN], so this is blocked on the vendor.
- **Lead API:** a `SaveLead` against the **test** WSDL (`lead-api.aptest.co.nz`) with a dummy
  lead, asserting `SaveLeadResult` — exercisable once a test Key/Token + ids are issued, but
  requires a SOAP client (see the SOAP flag).

- [ ] **GATE CHECK: First successful authenticated API call completed and documented** — **NOT
      DONE; blocked on credentials + the Listing API spec.**

---

## Phase 3: Domain Model & Behavior [PARTIAL — Lead recovered, Listing UNKNOWN]

### 3.1 Core Entities

**Lead** [RECOVERED — Lead API]

- Operation: `SaveLead` → `SaveLeadResult`.
- Identity context: `DealershipId` (`apid`), `YardId` (`yardid`).
- **Full field reference is [UNKNOWN]** — the recovered module sends a subset (lead contact
  details, vehicle of interest, source). **ASK for the full WSDL field reference.**

**Vehicle / Listing / Media** [INFERRED — Listing API]

- The agent-facing inventory objects: vehicle (make/model/year/VIN/price/status) and attached
  **media** (photos, videos). **Resource paths, fields, ids, and CRUD are all [UNKNOWN — ASK].**

**Questions for AutoPlay:**

1. **Listing API entities:** vehicle + media resource paths, full field lists, ids, and which
   operations are read-only vs writable. [UNKNOWN]
2. **Lead API:** the complete `SaveLead` request/response field reference (the WSDL), plus any
   other Lead operations (status/lookup?). [UNKNOWN]
3. Relationships (vehicle → media; dealer → yard → vehicle) and lifecycle/states (listing
   active/sold/pending; lead new/contacted/closed). [UNKNOWN]

---

## Phase 4: Endpoint Catalog [PARTIAL]

**Lead API (SOAP)** [RECOVERED]:

| Operation  | Direction         | Notes                                                                                                                                          |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `SaveLead` | client → AutoPlay | Submit a lead; returns `SaveLeadResult`. Auth via SOAP header `API_KEY`/`API_TOKEN`; ids `DealershipId`/`YardId`. Full field schema [UNKNOWN]. |

**Listing API (REST)** [UNKNOWN — ASK]: base URL + the inventory/media endpoint list. This is
the catalog we most need and have least of.

**Questions for AutoPlay:** the **Listing API endpoint list** (base URL, methods, paths) with
worked request/response examples; the **full Lead API WSDL**; and whether a **REST alternative
to the SOAP Lead API** exists. [UNKNOWN]

---

## Phase 5: Query & Filter Capabilities [ASK VENDOR — Listing API]

For the Listing API inventory read: filter by status/make/model/date, sorting, and search
syntax — all [UNKNOWN]. Needed so the agent can answer "show me stale listings" / "vehicles
without photos." [UNKNOWN]

---

## Phase 6: Pagination & Bulk Operations [ASK VENDOR — Listing API]

Listing API pagination model, page size, total-count exposure, and any bulk inventory export —
all [UNKNOWN]. Inventory pulls can be large, so this matters. [UNKNOWN]

---

## Phase 7: Real-Time & Event-Driven [ASK VENDOR]

No webhook/event surface found for either API [UNKNOWN]. **Ask** whether AutoPlay can push
inventory-change or new-lead events, or whether the agent must poll the Listing API for changes.
[UNKNOWN]

---

## Phase 8: Operational Concerns [ASK VENDOR]

Rate limits, error model (SOAP fault shape for the Lead API; HTTP error shape for the Listing
API), idempotency, and media file-handling (how vehicle photos/videos are referenced or
downloaded) — all [UNKNOWN]. [UNKNOWN]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [BLOCKED / split by API]

**Selected integration path:** **[UNDECIDED — blocked on the Listing API spec],** and the two
APIs likely need different treatment:

- **Listing API (agent-facing inventory read):** if it's **tokenised REST/JSON**, this is the
  natural fit for Numa's **native data connector via the generic `request` operation**
  (config-only) — read vehicles + media. This is the surface the workspace agent actually wants.
  **Blocked purely on the missing base URL + endpoint + token spec.**
- **Lead API (SOAP):** ⚠️ **SOAP does NOT fit the generic REST `request` path.** Submitting a
  lead requires building a SOAP envelope, setting the `API_KEY`/`API_TOKEN` header, and parsing
  `SaveLeadResult` — that is **net-new backend code** (a SOAP client), not config-only. Treat
  Lead submission as a **separate backend consideration**, lower priority than the Listing read.

### 9.3 Workspace Agent Capabilities [DRAFT]

**CAN do (intended, once the Listing API spec arrives):** read/search a dealer's vehicle
inventory and media; surface stale/incomplete listings; (lower priority, needs SOAP backend)
submit leads via the Lead API. **CANNOT do (until proven):** anything against the Lead API
through the generic REST path (SOAP); any write without explicit confirmation.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 0–1: product context + recovered Lead API surface captured; sources tagged
- [ ] Phase 2: **PARTIAL** — Lead API auth/WSDL recovered; **Listing API base URL + auth UNKNOWN**;
      first-call gate not passed
- [ ] Phase 3–8: **mostly BLOCKED** — Listing API entirely unknown; Lead API field schema unknown
- [ ] Phase 9: integration path **split & undecided** — Listing API likely config-only REST;
      Lead API needs a SOAP backend

**Overall investigation confidence:** **low** — Lead API surface is medium-confidence (OSS
recovery), Listing API is low (almost nothing), and neither is live-validated.

**Known gaps (these ARE the questions to the vendor):**

1. **Listing API base URL + endpoints + token format** (the agent-facing inventory pull) [UNKNOWN]
2. **Full Lead API WSDL field reference** (`SaveLead` and any other operations) [UNKNOWN]
3. **Whether a REST alternative to the SOAP Lead API exists** [UNKNOWN]
4. Per-dealer **Key + Token** issuance/rotation; same pair for both APIs or separate [UNKNOWN]
5. Rate limits, error models, pagination, media handling, events [UNKNOWN]

### 10.2 Generation Prompts [REQUIRED]

**Do not generate the standard pack (01a/01b/01c/01d/02) yet.** The only outputs today are this
questionnaire (`00`), the `contact-required` stub (`01-llm-api-rules.md`), and the
onboarding/contact path (`03-connector-setup.md`). Generate the rest **only after** AutoPlay
supplies the **Listing API spec** (and confirms/extends the Lead API WSDL). When building, keep
the **REST Listing connector** and the **SOAP Lead backend** as separate work items.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate now? | Confidence | Gaps                                            |
| ---------------------------- | ----------------- | ---------- | ----------------------------------------------- |
| 00-questionnaire (this)      | yes               | n/a        | Captures recovered Lead facts + vendor asks     |
| 01-llm-api-rules (stub)      | yes (stub only)   | n/a        | `contact-required`; SOAP Lead + Listing pending |
| 03-connector-setup (contact) | yes               | n/a        | Onboarding/contact path only                    |
| 01a / 01b / 01c / 01d / 02   | **NO**            | —          | Blocked on the Listing API spec + full WSDL     |

---

_Compiled 2026-06-26. Lead API surface **recovered from the open-source Subaru-NZ Drupal
`autoplay` module** (third-party, possibly stale); Listing API spec **not public**. **No
authenticated call has been made to either API.** Next action: request the **Listing API spec**
and **full Lead API WSDL** from AutoPlay (`support@autoplay.co.nz`) and obtain per-dealer Key +
Token + Dealership/Yard ids (see `03-connector-setup.md`). The Lead API is **SOAP** — a backend
consideration, not the generic REST path._
