---
api_name: AutoPlay
api_slug: autoplay
status: contact-required — NOT wired, NOT callable
apis: Lead API = SOAP/WSDL (recovered from OSS); Listing API = tokenised REST (spec NOT public)
lead_api_wsdl_prod: https://lead-api.autoplay.co.nz/V2/LeadAPI.svc?singleWsdl
lead_api_wsdl_test: https://lead-api.aptest.co.nz/LeadAPI.svc?singleWsdl
listing_api_base: UNKNOWN — spec pending vendor
auth: per-dealer Key + Token (Settings → Company Settings → API Management); Lead API passes them in a SOAP header (<API_KEY>/<API_TOKEN>) + DealershipId(apid)/YardId(yardid); Listing API token format UNKNOWN
confidence: Lead API recovered from the OSS Subaru-NZ Drupal autoplay module (possibly stale); Listing API low; nothing live-validated. See 00-api-investigation-questionnaire.md.
---

# AutoPlay — API Rules (STUB — pending vendor spec)

> **This connector is `contact-required` and NOT yet wired.** There is no AutoPlay tool
> available to the agent, no registered connector, and no callable surface. This file is a
> placeholder so the slug is a known integration and the research record has a home.

## Current status

- **Disposition:** `contact-required`. AutoPlay has **two** APIs:
  - **Lead API — SOAP/WSDL** (submit/track leads). Surface recovered from the open-source
    Subaru-NZ Drupal `autoplay` module: prod WSDL
    `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc?singleWsdl`, test WSDL
    `https://lead-api.aptest.co.nz/LeadAPI.svc?singleWsdl`, op `SaveLead`→`SaveLeadResult`, auth
    via SOAP header `<API_KEY>/<API_TOKEN>` + `DealershipId`(apid)/`YardId`(yardid). Third-party
    recovery, possibly stale — **not vendor-confirmed**.
  - **Listing API — tokenised REST** (vehicle inventory + media; the agent-facing read). **Spec
    is NOT public** — base URL, endpoints, and token format are unknown.
- **No authenticated call has been made to either API.** No credentials.
- ⚠️ **The Lead API is SOAP** — Numa's connector request layer is REST-oriented, so Lead
  submission is a **backend consideration** (a SOAP client), not the generic REST path. The
  **Listing API** spec is **pending** the vendor.
- Knowns + the exact vendor questions live in `00-api-investigation-questionnaire.md`; the
  onboarding/contact path lives in `03-connector-setup.md`.

## If asked to use AutoPlay in chat today

There is nothing to call. Tell the user AutoPlay is not yet integrated. Wiring it requires
AutoPlay to supply the **Listing API spec** (and the full Lead API WSDL) plus per-dealer Key +
Token and Dealership/Yard ids. Do not fabricate endpoints, auth, or payloads.

## To complete this file

**Complete once the vendor supplies the spec.** When AutoPlay returns the **Listing API**
spec (and confirms/extends the **Lead API WSDL**), regenerate from `01-llm-api-rules.template.md`
— keeping the **REST Listing connector** and the **SOAP Lead backend** as separate concerns —
and produce the companion docs (01a–01d, 02, and the real 03).
