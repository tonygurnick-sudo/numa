---
api_name: AutoPlay
api_slug: autoplay
auth_type: token # per-dealer Key + Token; Lead API in a SOAP header, Listing API token format UNKNOWN
status: contact-required — onboarding/contact path only; connector NOT wired
integration_path: undecided # Listing API likely config-only REST; Lead API needs a SOAP backend
confidence: Lead API recovered from OSS (possibly stale); Listing API spec not public; no credentials. See 00-api-investigation-questionnaire.md.
---

# AutoPlay — Connector & Integration Setup (CONTACT / ONBOARDING PATH)

> **`contact-required`.** This is **not** a build guide — there is no registry entry, wizard, or
> backend provider yet. The agent-facing **Listing API** spec is not public, and the **Lead
> API** is **SOAP** (a backend consideration, not the generic REST path). This document is the
> **onboarding path**: how to obtain the Listing API spec, the full Lead API manual, and
> per-dealer credentials so the connector can be specced and built.

## 1. Product context

|                |                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vendor         | AutoPlay — automotive dealer marketing / inventory platform (AU / NZ)                                                                                              |
| Product        | Vehicle inventory + media, listing distribution, sales-lead capture                                                                                                |
| Marketing site | `www.autoplay.co.nz`                                                                                                                                               |
| Dealer app     | `autoplayauto.com`                                                                                                                                                 |
| Lead API       | **SOAP/WSDL** — prod `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc?singleWsdl`, test `https://lead-api.aptest.co.nz/LeadAPI.svc?singleWsdl` (recovered from OSS) |
| Listing API    | **tokenised REST** — vehicle inventory + media; **base URL + endpoints NOT public**                                                                                |
| Credentials    | per-dealer **Key + Token** in **Settings → Company Settings → API Management**                                                                                     |
| Dealer ids     | `DealershipId` (`apid`) + `YardId` (`yardid`)                                                                                                                      |

## 2. Why this is contact-required (not self-service)

- The **Listing API** (the inventory/media read the agent would actually use) has **no public
  spec** — base URL, endpoints, and token format are unknown.
- The **Lead API** surface is only known via a **third-party OSS Drupal module** (possibly
  stale, not vendor-confirmed), and it is **SOAP** — which does not fit Numa's generic REST
  `request` path and would need a dedicated backend.
- Credentials are **per-dealer** and issued inside the dealer console, so each customer must
  generate their own Key + Token + Dealership/Yard ids.

We cannot wire a connector from public information; we must engage AutoPlay first.

## 3. Onboarding path — how to get API access

**Primary contact:** email **`support@autoplay.co.nz`** (AutoPlay support), ideally via the
customer's existing AutoPlay account so the request is tied to their dealership.

**Steps:**

1. **Request the API documentation**, explicitly asking for:
   - The **Listing API specification** — base URL, endpoint list (vehicle inventory + media),
     auth/token format, pagination, and worked examples. **This is the priority** (the
     agent-facing inventory pull).
   - The **Lead API manual / full WSDL** — to confirm the recovered surface
     (`SaveLead`/`SaveLeadResult`, `API_KEY`/`API_TOKEN` header, `DealershipId`/`YardId`) and
     get the complete field reference. Ask whether a **REST alternative to the SOAP Lead API**
     exists.
2. **Have the customer generate per-dealer credentials** in the dealer console:
   **Settings → Company Settings → API Management** → create/copy the **Key + Token**.
3. **Capture the dealer ids:** `DealershipId` (`apid`) and `YardId` (`yardid`) — a dealer may
   have multiple yards/lots; confirm which apply.
4. **Request test access first:** the Lead API has a test WSDL (`lead-api.aptest.co.nz`); ask
   for a **sandbox/test** path for the Listing API too, plus test credentials.
5. **Hand the answers to the questionnaire.** Map responses onto Phases 2–8 of
   `00-api-investigation-questionnaire.md`. Once the Listing API base URL + endpoints + auth are
   known and a **first authenticated call** is made (2.4 gate), generate the full pack and the
   real build-oriented `03-connector-setup.md`.

## 4. What we send the vendor

The questionnaire payload is **Phases 2–8 of `00-api-investigation-questionnaire.md`**. Priority
asks, in order:

1. **Listing API base URL + endpoints + token format** (the inventory/media read). [UNKNOWN]
2. **Full Lead API WSDL field reference** for `SaveLead` (and any other Lead operations). [UNKNOWN]
3. **Whether a REST alternative to the SOAP Lead API exists.** [UNKNOWN]
4. Per-dealer **Key + Token** issuance/rotation; same pair for both APIs or separate. [UNKNOWN]
5. Listing API pagination, filtering, rate limits, error model, and media handling. [UNKNOWN]

## 5. Integration path (split by API; decide after the vendor responds)

- **Listing API (priority, agent-facing):** if it's **tokenised REST/JSON**, fits Numa's
  **native data connector via the generic `request` operation** (config-only) — read vehicles +
  media. **Blocked purely on the missing base URL + endpoint + token spec.**
- **Lead API:** ⚠️ **SOAP** — does **not** fit the generic REST path. Submitting a lead requires
  building a SOAP envelope, setting the `API_KEY`/`API_TOKEN` header, and parsing
  `SaveLeadResult` — **net-new backend code** (a SOAP client). Treat as a **separate, lower-
  priority** work item; prefer a REST alternative if AutoPlay offers one.

## 6. Build checklist — DEFERRED

Pending vendor spec. The standard connector build checklist (registry entry, wizard, backend
provider, vault patterns for per-dealer Key + Token + Dealership/Yard ids, i18n, CI matrix,
deploy) cannot start until the Listing API spec arrives and the SOAP-vs-REST decision for the
Lead API is settled. See `03-connector-setup.template.md` for the full checklist to apply once
the spec is in hand.

---

_`contact-required` onboarding path, 2026-06-26. Not a build guide. The connector is not wired.
Next action: email `support@autoplay.co.nz`, request the **Listing API spec** + **full Lead API
manual/WSDL**, and obtain per-dealer **Key + Token** + **Dealership/Yard ids**. Keep the **REST
Listing connector** and the **SOAP Lead backend** as separate work items._
