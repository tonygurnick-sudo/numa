---
api_name: 'Net-Inspect API'
api_slug: 'net-inspect'
vendor: 'Net-Inspect, LLC (Seattle, WA, USA)'
website: 'https://www.netinspect.com'
investigation_started: '2026-06-26'
investigator: 'Numa API Investigation Agent (open-web research only — no vendor pack, no credentials)'
investigation_status: 'blocked' # contact-required: API confirmed to exist, but no public spec/auth/base-path
documentation_quality: 'nonexistent' # public surface only — no Swagger/OpenAPI/reference found
api_types: [REST] # [INFERRED] — vendor markets "APIs and Webhooks"; transport/style unconfirmed
overall_confidence: 'low'
blockers:
  - 'No public API documentation, OpenAPI/Swagger spec, auth guide, or base-path scheme exists — the vendor markets "readily available APIs and Webhooks" but does not publish them.'
  - 'A real API host resolves at api.net-inspect.com, but it is not browsable: no docs, no discovery endpoints found without credentials.'
  - 'Access is gated behind an account rep / partner agreement (aerospace/ITAR context — likely NDA). No credentials available; no authenticated call has been made.'
generated_date: '2026-06-26'
---

# API Investigation Questionnaire: Net-Inspect

> **This pack is a vendor questionnaire, not a runtime spec.** Net-Inspect has a confirmed
> API surface (`api.net-inspect.com` resolves; the vendor markets "readily available APIs and
> Webhooks"), but **none of the technical detail is public** — no OpenAPI/Swagger, no auth
> guide, no endpoint catalog, no base-path scheme. This document does two jobs:
>
> 1. **Capture everything we DO know** from open-web research (clearly tagged), and
> 2. **Serve as the exact questionnaire we send Net-Inspect** via their account rep / partner
>    channel (see `03-connector-setup.md`).
>
> ⚠️ **NOTHING here describes confirmed API behaviour.** No endpoints, auth scheme, payloads,
> or rate limits have been verified. Do not wire a connector from this file — it tells us what
> to ask, not what to build.
>
> **Confidence markers:**
>
> - `[CONFIRMED]` — verified against a live API (we have NONE — no credentials)
> - `[DOCUMENTED]` — stated in official, retrievable documentation
> - `[WEB]` — stated on the public Net-Inspect website / marketing / public profiles
> - `[INFERRED]` — deduced from domain norms (aerospace SQM, AS9102) or vendor positioning
> - `[UNKNOWN]` — could not determine; **this is the questionnaire payload for the vendor**

---

## Phase 0: Why this connector / what it is

> **Why:** Orient the reader before the questionnaire. Net-Inspect sits in a niche
> (aerospace/defense supplier quality) where Numa has real pull — capturing the known context
> sharpens the questions we send.

**Net-Inspect** is a cloud quality-management / supplier-quality-management (SQM) platform for
**aerospace, defense, and complex-manufacturing** supply chains [WEB]. Its core modules cover
**First Article Inspection (FAI / AS9102)**, **Non-Conformance Reports (NCR)**, **Production
Part Approval Process (PPAP)**, supplier surveys/audits, gauge/calibration management, and
inspection data collection [WEB]. Anchor customers historically include large primes and their
tiered supplier networks (the platform is used to push quality requirements down a supply
chain and pull inspection records back up) [WEB/INFERRED].

**Why an API matters for Numa:** customers in aerospace manufacturing want to ask their
workspace agent questions like "show me open NCRs for supplier X", "which FAIs are overdue",
or "summarise this week's PPAP submissions" — all of which require structured reads against
Net-Inspect. The vendor advertises **APIs and Webhooks**, so the integration is plausible;
the blocker is purely that the technical surface is partner-gated, not that it doesn't exist.

**Disposition:** `contact-required`. This connector is **not yet wired**. The next action is to
send Net-Inspect the questionnaire in Phases 1–9 below via their account rep / partner channel.

---

## Phase 1: Information Sources

> **Why:** Establishes what is and isn't publicly knowable, so the vendor request is precise.

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** none found [UNKNOWN]. No `developer.netinspect.com`,
  `docs.netinspect.com`, `/api`, `/developers`, or `/swagger` surface is publicly reachable.
- **API reference / endpoint catalog URL:** none found [UNKNOWN]
- **Authentication guide URL:** none found [UNKNOWN]
- **Changelog / release notes URL:** none found [UNKNOWN]
- **Status page URL:** none found [UNKNOWN]

> **Discovery note:** The marketing site (`www.netinspect.com`) references integration
> capabilities ("APIs and Webhooks") but routes API access through sales / account management
> rather than a self-serve developer portal [WEB]. This is normal for ITAR-adjacent aerospace
> SaaS — the surface is deliberately not public.

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** none found [UNKNOWN]
- **Postman collection URL:** none found [UNKNOWN]
- **Official SDK repositories:** none found (no `net-inspect` / `netinspect` packages on npm or
  PyPI; no official GitHub org located) [UNKNOWN]
- **Confirmed API host:** **`api.net-inspect.com`** resolves — a real API endpoint exists at
  this host [WEB/INFERRED]. The base-path scheme below it is **[UNKNOWN]** (no `/v1`, `/api`,
  swagger, or discovery path confirmed without credentials).
- **Vendor positioning:** Net-Inspect publicly markets **"readily available APIs and
  Webhooks"** as part of its platform [WEB] — this is the single strongest signal that a
  documented, partner-issued API exists.

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                               |
| ------------------------- | ------ | --------------------------------------------------- |
| Authentication            | 0      | No public auth guide [UNKNOWN]                      |
| Endpoint reference        | 0      | No public catalog [UNKNOWN]                         |
| Request/response examples | 0      | None public [UNKNOWN]                               |
| Error documentation       | 0      | None public [UNKNOWN]                               |
| Rate limit documentation  | 0      | None public [UNKNOWN]                               |
| Pagination documentation  | 0      | None public [UNKNOWN]                               |
| Webhook documentation     | 0      | Vendor markets webhooks [WEB]; mechanics not public |
| SDKs / code examples      | 0      | None found [UNKNOWN]                                |
| Changelog / versioning    | 0      | None public [UNKNOWN]                               |

**Overall documentation quality:** **nonexistent** (publicly). The vendor confirms an API
exists; nothing about it is retrievable without a partner agreement.

### 1.4 Discovery Status [REQUIRED]

- [ ] Found official API documentation — **NO** [UNKNOWN]
- [ ] Found or confirmed no OpenAPI/Swagger spec — could not locate one publicly [UNKNOWN]
- [ ] Identified authentication method — **NO** [UNKNOWN]
- [ ] Found at least one working example — **NO; no credentials** [UNKNOWN]
- [ ] Identified rate limit information — **NO** [UNKNOWN]
- [ ] Identified pagination approach — **NO** [UNKNOWN]
- [x] Checked for webhook/event support — vendor **markets webhooks** [WEB]; mechanics [UNKNOWN]
- [x] Checked for official SDKs — **none found** [UNKNOWN]
- [x] Confirmed a real API host exists — **`api.net-inspect.com`** [WEB/INFERRED]

---

## Phase 2: API Fundamentals — **THE QUESTIONNAIRE STARTS HERE**

> **Why:** These are the non-negotiable basics we cannot proceed without. **Every item below is
> a question to put to Net-Inspect's account rep / partner contact.**

### 2.1 API Identity [REQUIRED — ASK VENDOR]

Known:

- **API name:** [UNKNOWN — ASK] (working name "Net-Inspect API")
- **Vendor / company:** Net-Inspect, LLC [WEB]
- **Confirmed host:** `api.net-inspect.com` [WEB/INFERRED]

**Questions for Net-Inspect:**

1. **What is the production API base URL and path scheme?** Is it `https://api.net-inspect.com/`
   plus a version segment (`/v1`, `/api/v1`, …)? Give the exact base path. [UNKNOWN]
2. **Is there a sandbox / test environment?** Separate host, or the same host with test creds?
   [UNKNOWN]
3. **What API style is it** — REST/JSON, SOAP/XML, GraphQL, or other? (We have inferred REST
   from "APIs and Webhooks" positioning, but this is unconfirmed.) [INFERRED → confirm]
4. **What is the current API version, and how is versioning expressed** (URL path, header,
   query)? [UNKNOWN]

### 2.2 Architecture & Protocol [REQUIRED — ASK VENDOR]

**Questions for Net-Inspect:**

1. Transport (HTTP/1.1 vs HTTP/2), data format (JSON / XML), required `Content-Type` and
   `Accept` headers. [UNKNOWN]
2. The full **URL structure pattern** with a concrete example (e.g.
   `https://api.net-inspect.com/v1/{resource}/{id}`). [UNKNOWN]
3. Any **always-required headers** beyond auth (tenant id, partner id, API version, etc.).
   [UNKNOWN]

### 2.3 Authentication [REQUIRED — ASK VENDOR — most important question]

> **This is the single most important section.** We have **zero** information on how
> Net-Inspect authenticates API calls.

**Questions for Net-Inspect:**

1. **What is the auth model?** OAuth 2.0 (which grant?), API key, bearer token, HMAC-signed
   request, mutual TLS / client certs (plausible in an ITAR/aerospace context), or Basic auth?
   [UNKNOWN]
2. **Where do credentials go** — `Authorization` header, a custom header (`X-API-Key`?), query
   param? Give the exact header name and format. [UNKNOWN]
3. **How are partner/integration credentials issued?** Self-serve in an admin console, or
   minted by Net-Inspect support under the partner agreement? Per-customer-account or one
   partner-wide credential? [UNKNOWN]
4. **If OAuth:** authorize URL, token URL, grant types, scopes, token lifetime, refresh
   behaviour, PKCE. [UNKNOWN]
5. **If API key / token:** how it's obtained, format, lifetime/rotation, and whether it is
   **per end-customer-tenant** or shared. [UNKNOWN]
6. **Is there an IP allowlist or client-cert requirement** for API access (common for
   defense-sector platforms)? [UNKNOWN]

### 2.4 First Successful Call [REQUIRED — CRITICAL GATE — NOT PASSED]

> ⛔ **GATE NOT PASSED.** No Net-Inspect credentials exist and no base path is known. **No
> authenticated call has been made.** Nothing in this pack is `[CONFIRMED]`.

**Ask the vendor to supply a "hello world" example:** the smallest authenticated request and
its response (e.g. "get current user / account" or "list inspection records, page 1"), with the
exact URL, headers, and a sanitised response body. This becomes our first-call gate once
credentials arrive.

- [ ] **GATE CHECK: First successful authenticated API call completed and documented** — **NOT
      DONE; blocked on partner credentials + base path.**

---

## Phase 3: Domain Model & Behavior [ASK VENDOR — fill from the spec]

> **Why:** What makes the connector useful is understanding the entities. We can name the
> _domain_ entities from the product (FAI, NCR, PPAP, suppliers, inspections) but have **no
> field-level schema, no ids, no relationships** from the API.

### 3.1 Expected Core Entities [INFERRED from the product — confirm against the spec]

> These are the domain objects the platform exposes in its UI/modules [WEB/INFERRED]. The
> **API resource names, fields, ids, and CRUD support are all [UNKNOWN]** — request the schema.

| Likely Entity                             | Domain meaning                                             | API resource / fields |
| ----------------------------------------- | ---------------------------------------------------------- | --------------------- |
| First Article Inspection (FAI)            | AS9102 first-article record (Forms 1/2/3, characteristics) | [UNKNOWN — ASK]       |
| Non-Conformance Report (NCR)              | Defect / non-conformance disposition & corrective action   | [UNKNOWN — ASK]       |
| PPAP submission                           | Production Part Approval Process package + elements        | [UNKNOWN — ASK]       |
| Supplier / Company                        | Supply-chain partner record                                | [UNKNOWN — ASK]       |
| Part / Part Number                        | Manufactured part + revision                               | [UNKNOWN — ASK]       |
| Inspection / Measurement / Characteristic | Recorded inspection data & measured features               | [UNKNOWN — ASK]       |
| Purchase Order / Line Item                | Order context for inspections                              | [UNKNOWN — ASK]       |
| Survey / Audit                            | Supplier survey & audit records                            | [UNKNOWN — ASK]       |
| Gauge / Calibration                       | Measurement-equipment calibration records                  | [UNKNOWN — ASK]       |
| Document / Attachment                     | Drawings, certs, reports attached to the above             | [UNKNOWN — ASK]       |

**Questions for Net-Inspect:**

1. For each entity the API exposes: **resource path, full field list (name, type, required,
   writable), and CRUD support.** [UNKNOWN]
2. **Entity relationships** (e.g. FAI → Part → Supplier; NCR → PO line) and how they're
   expressed (nested objects vs id references). [UNKNOWN]
3. **Lifecycle / state machines** — FAI and NCR are workflow-driven (draft → submitted →
   approved/rejected → closed); document the states, transitions, and which are API-driven vs
   UI-only. [UNKNOWN]
4. **Business rules** — required-before-create dependencies, uniqueness constraints, computed
   fields, cascading effects. [UNKNOWN]
5. **Field formats & enums** — date format, id format, and the allowed values for every
   status/disposition picklist. [UNKNOWN]

---

## Phase 4: Endpoint Catalog [ASK VENDOR — supply OpenAPI]

> **Why:** This is the heart of any future spec doc. We have **none of it.**

**Questions for Net-Inspect:**

1. **Is there an OpenAPI / Swagger document or Postman collection?** If so, please send it —
   this single artefact answers most of Phases 2–8. [UNKNOWN]
2. If no machine-readable spec: a **full endpoint list** (method + path + purpose + auth +
   pagination) for at least the read surface (FAI, NCR, PPAP, supplier, part, inspection). [UNKNOWN]
3. For the 5–10 most important endpoints: **worked request/response examples** (sanitised).
   [UNKNOWN]

---

## Phase 5: Query & Filter Capabilities [ASK VENDOR]

**Questions for Net-Inspect:** filter-by-field, date-range filters, full-text search, sorting,
field selection, include-related, and the exact filter syntax — with examples. [UNKNOWN]

---

## Phase 6: Pagination & Bulk Operations [ASK VENDOR]

**Questions for Net-Inspect:** pagination model (offset / cursor / page-number / link-header),
default and max page size, how total count is exposed, how to detect the last page, and whether
any bulk/batch read or export endpoints exist (important — aerospace supply chains pull large
inspection datasets). [UNKNOWN]

---

## Phase 7: Real-Time & Event-Driven [ASK VENDOR — webhooks are marketed]

> **Why:** The vendor explicitly markets **Webhooks** [WEB] — this is a real differentiator for
> Numa Automations (e.g. "alert me when a new NCR is raised for my parts"). We need the
> mechanics.

**Questions for Net-Inspect:**

1. **How are webhooks registered** — via the API, an admin UI, or by Net-Inspect support?
   [UNKNOWN]
2. **Event catalog** — what events fire (NCR created, FAI approved, PPAP submitted, …) and the
   payload of each. [UNKNOWN]
3. **Security** — signature header + algorithm for verifying delivery authenticity; IP
   allowlist. [UNKNOWN]
4. **Reliability** — retry policy, ordering guarantees, duplicate-delivery possibility,
   HTTPS-only requirement. [UNKNOWN]
5. **Polling fallback** — if webhooks aren't available to partners, is there a reliable
   `modified-since` query for change detection? [UNKNOWN]

---

## Phase 8: Operational Concerns [ASK VENDOR]

**Questions for Net-Inspect:**

1. **Rate limits** — per-key/per-account/global thresholds, window, the headers returned, and
   the 429 response shape. [UNKNOWN]
2. **Error model** — standard error response format, HTTP status code usage, validation-error
   structure. [UNKNOWN]
3. **Idempotency** — idempotency-key support for writes. [UNKNOWN]
4. **Async operations** — any long-running operations (bulk export, report generation) and how
   to poll them. [UNKNOWN]
5. **File handling** — how drawings/certs/inspection attachments are uploaded and downloaded
   (multipart, pre-signed URL, base64). [UNKNOWN]
6. **Compliance constraints** — given the aerospace/ITAR context: are there **data-residency,
   export-control, or NDA constraints** on what an integration may read or move out of the
   platform? This materially affects what Numa is permitted to do. [UNKNOWN — ASK EXPLICITLY]

---

## Phase 9: Platform Integration Assessment [PRELIMINARY — cannot finalise without the spec]

### 9.1 Integration Path Decision [BLOCKED]

**Selected integration path:** **[UNDECIDED — blocked on vendor spec].**

**Preliminary lean (revisit once auth + endpoints are known):**

- If auth turns out to be **OAuth 2.0 or a simple API key/token** and the surface is REST/JSON,
  this is a strong fit for Numa's **native data connector via the generic `request` operation**
  (config-only, like JobAdder/spec-driven API connectors) — read-oriented over FAI/NCR/PPAP/
  supplier records.
- If auth is **mutual TLS / client certs / HMAC-signed requests** (plausible for the sector),
  it needs a **custom backend auth provider** — net-new code, not config-only. This is the most
  likely reason the connector slips from "config-only" to "real build."
- If the surface is **SOAP/XML**, note that Numa's connector request layer is REST-oriented;
  SOAP support would be a backend consideration (the same flag we raise for AutoPlay's Lead
  API).

**Justification:** cannot be written until 2.3 (auth) and 4 (endpoints) are answered.

### 9.3 Workspace Agent Capabilities [DRAFT — for when it's built]

**CAN do (intended, once wired):** read/search FAIs, NCRs, PPAP submissions, supplier and part
records; surface overdue/open items; summarise inspection activity; (possibly) react to
webhook events via Numa Automations. **CANNOT do (until proven safe):** any write/disposition
of NCRs or FAIs without explicit human confirmation (quality records are regulated); any action
that conflicts with the vendor's export-control/NDA constraints (Phase 8.6).

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 0 complete: product context captured
- [ ] Phase 1: sources — **confirmed no public docs/spec/auth; API host exists**
- [ ] Phase 2: **BLOCKED** — base URL, path scheme, and auth all [UNKNOWN]; first-call gate not passed
- [ ] Phase 3–8: **BLOCKED** — entirely dependent on the vendor spec
- [ ] Phase 9: integration path **undecided** (auth model determines config-only vs custom backend)

**Overall investigation confidence:** **low** — domain context is solid; the API's technical
surface is entirely partner-gated and unverified.

**Known gaps (these ARE the questions to the vendor):**

1. **Base URL + path scheme** under `api.net-inspect.com` [UNKNOWN]
2. **Auth model** (OAuth / API-key / token / mTLS / HMAC) and how partner creds are issued [UNKNOWN]
3. **Endpoint list / OpenAPI** [UNKNOWN]
4. **Webhook registration + event catalog + signing** [UNKNOWN]
5. **Rate limits & error model** [UNKNOWN]
6. **Per-tenant vs shared host/credential** [UNKNOWN]
7. **Export-control / NDA / data-residency constraints** on integration scope [UNKNOWN]

### 10.2 Generation Prompts [REQUIRED]

**Do not generate the standard pack (01a/01b/01c/01d/02) yet** — there is nothing to generate
from. The only outputs that exist today are this questionnaire (`00`), the `contact-required`
stub (`01-llm-api-rules.md`), and the onboarding/contact path (`03-connector-setup.md`).
Generate the rest **only after** Net-Inspect returns answers to Phases 2–8 (ideally an
OpenAPI/Postman artefact).

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate now? | Confidence | Gaps                                    |
| ---------------------------- | ----------------- | ---------- | --------------------------------------- |
| 00-questionnaire (this)      | yes               | n/a        | Captures knowns + vendor questions      |
| 01-llm-api-rules (stub)      | yes (stub only)   | n/a        | `contact-required`; not wired           |
| 03-connector-setup (contact) | yes               | n/a        | Onboarding/contact path only            |
| 01a / 01b / 01c / 01d / 02   | **NO**            | —          | Blocked on vendor spec (auth+endpoints) |

---

_Compiled 2026-06-26 from open-web research only. **No Net-Inspect API documentation, spec, or
credentials were available — every technical item is a question for the vendor, not a fact.**
Next action: send Phases 2–8 to Net-Inspect via the account rep / partner channel (see
`03-connector-setup.md`)._
