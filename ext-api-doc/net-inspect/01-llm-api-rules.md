---
api_name: Net-Inspect
api_slug: net-inspect
status: contact-required — NOT wired, NOT callable
base_url: api.net-inspect.com (host confirmed; base PATH/version scheme UNKNOWN)
auth: UNKNOWN — no public auth guide; must be supplied by the vendor under a partner agreement
call_surface: none yet — no connector registered; agent has no Net-Inspect tool
confidence: open-web research only; nothing live-validated. See 00-api-investigation-questionnaire.md.
---

# Net-Inspect — API Rules (STUB — pending vendor spec)

> **This connector is `contact-required` and NOT yet wired.** There is no Net-Inspect tool
> available to the agent, no registered connector, and no callable surface. This file is a
> placeholder so the slug is a known integration and the research record has a home.

## Current status

- **Disposition:** `contact-required`. The vendor markets "readily available APIs and Webhooks"
  and a real host exists (`api.net-inspect.com`), but **no public docs, OpenAPI/Swagger, auth
  scheme, or base path** exist. Access is gated behind an account rep / partner agreement
  (aerospace/ITAR context — likely NDA).
- **Auth:** UNKNOWN. **Endpoints:** UNKNOWN. **No authenticated call has ever been made.**
- **What we know** (domain context + the exact questions for the vendor) lives in
  `00-api-investigation-questionnaire.md`. The onboarding/contact path lives in
  `03-connector-setup.md`.

## If asked to use Net-Inspect in chat today

There is nothing to call. Tell the user Net-Inspect is not yet integrated and that wiring it
requires Net-Inspect (via the customer's account rep) to supply API & Webhooks documentation
and partner credentials. Do not fabricate endpoints, auth, or payloads.

## To complete this file

**Complete once the vendor supplies the spec.** When Net-Inspect returns answers to Phases 2–8
of the questionnaire (ideally an OpenAPI/Postman artefact), regenerate this file from the
`01-llm-api-rules.template.md` template — auth from Phase 2.3, endpoints from Phase 4, errors
from Phase 8, capabilities from Phase 9 — and produce the companion docs (01a–01d, 02, and the
real 03).
