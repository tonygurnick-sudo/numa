---
api_name: Net-Inspect
api_slug: net-inspect
auth_type: unknown # to be established with the vendor (OAuth / API-key / token / mTLS / HMAC)
status: contact-required — onboarding/contact path only; connector NOT wired
integration_path: undecided # depends on the auth model the vendor confirms
confidence: open-web research only; no credentials, no spec. See 00-api-investigation-questionnaire.md.
---

# Net-Inspect — Connector & Integration Setup (CONTACT / ONBOARDING PATH)

> **`contact-required`.** This is **not** a build guide — there is no registry entry, no wizard,
> and no backend provider yet, because the API's auth model and endpoints are unknown. This
> document is the **onboarding path**: how to obtain the API & Webhooks documentation and
> credentials from Net-Inspect so the connector can actually be specced and built.

## 1. Product context

|           |                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------- |
| Vendor    | Net-Inspect, LLC (Seattle, WA, USA)                                                            |
| Product   | Cloud supplier-quality / quality-management for aerospace & complex manufacturing              |
| Modules   | First Article Inspection (FAI / AS9102), NCR, PPAP, supplier surveys/audits, gauge/calibration |
| Marketing | App URL `www.netinspect.com`; vendor markets "readily available APIs and Webhooks"             |
| API host  | `api.net-inspect.com` (host confirmed; **base path / version scheme UNKNOWN**)                 |
| API docs  | **None public** — partner-gated behind an account rep / partner agreement (likely NDA, ITAR)   |

## 2. Why this is contact-required (not self-service)

Net-Inspect does **not** publish a developer portal, OpenAPI/Swagger spec, or auth guide. The
API exists (the vendor markets it; the host resolves) but every technical detail — base URL,
path scheme, auth model, endpoint list, webhook mechanics, rate limits — is only available to
**approved partners** under an agreement. Given the aerospace/defense (ITAR-adjacent) context,
expect an **NDA** and possibly export-control constraints on what an integration may read or
move. We cannot wire a connector from public information; we must engage the vendor first.

## 3. Onboarding path — how to get API access

The integration starts with the **customer's Net-Inspect account rep / Customer Success
contact** (Net-Inspect routes API access through account management, not self-serve signup).

**Steps:**

1. **Identify the contact.** Work through the Numa customer's existing Net-Inspect account
   manager / CSM. If the customer doesn't have one, the entry point is Net-Inspect sales/support
   via `www.netinspect.com` (Contact / Support). Aerospace SaaS API access is almost always
   sales-gated.
2. **Request the integration package**, explicitly asking for:
   - The **API documentation** (base URL + path scheme, full endpoint list, or an OpenAPI /
     Swagger / Postman artefact).
   - The **Webhooks documentation** (registration method, event catalog, payloads, signing).
   - **Partner / API credentials** for a **test environment** (sandbox) first, then production.
   - The **authentication model** in writing (OAuth / API-key / bearer token / mTLS / HMAC) and
     how credentials are issued (self-serve console vs minted by support; per-tenant vs shared).
3. **Confirm the legal/compliance posture:** whether an **NDA** is required, and whether there
   are **export-control / data-residency** constraints on what an integration may read or move
   out of the platform. This bounds what Numa is permitted to do and must be settled before
   build.
4. **Hand the answers to the questionnaire.** Map every response onto Phases 2–8 of
   `00-api-investigation-questionnaire.md`. Once auth (2.3) and the endpoint catalog (4) are
   filled and a **first authenticated call** is made (2.4 gate), generate the full pack
   (01a–01d, 02) and the real build-oriented `03-connector-setup.md`.

## 4. What we send the vendor

The questionnaire payload is **Phases 2–8 of `00-api-investigation-questionnaire.md`** — the
sections tagged "ASK VENDOR." The highest-priority asks, in order:

1. **Base URL + exact path scheme** under `api.net-inspect.com`, and whether a sandbox exists.
2. **Auth model** + how partner/API credentials are issued (per-customer-tenant or shared).
3. **OpenAPI/Swagger/Postman** if it exists; otherwise a **full endpoint list** for the read
   surface (FAI, NCR, PPAP, supplier, part, inspection).
4. **Webhook registration + event catalog + signature scheme.**
5. **Rate limits + error model.**
6. **Export-control / NDA / data-residency constraints** on integration scope.

## 5. Integration path (to be decided after the vendor responds)

Undecided — it hinges on the auth model:

- **OAuth 2.0 / simple API-key or token + REST/JSON** → likely Numa **native data connector via
  the generic `request` operation** (config-only).
- **mTLS / client certs / HMAC-signed requests** → **custom backend auth provider** (net-new
  code, not config-only). Most likely reason this becomes a real build rather than a config-only
  connector.
- **SOAP/XML surface** → the connector request layer is REST-oriented; SOAP support is a backend
  consideration.

## 6. Build checklist — DEFERRED

Pending vendor spec. The standard connector build checklist (registry entry, wizard, backend
provider, vault patterns, i18n, CI matrix, deploy) cannot be started until auth and endpoints
are known. See `03-connector-setup.template.md` for the full checklist to apply once the spec
arrives.

---

_`contact-required` onboarding path, 2026-06-26. Not a build guide. The connector is not wired;
the next action is to engage Net-Inspect via the customer's account rep and send Phases 2–8 of
the questionnaire._
