---
api_name: AutoPlay
api_slug: autoplay
connector_id: autoplay
auth_type: api-key # per-dealer Key + Token; admin-supplied (adminFields). Lead API auth rides INSIDE the SOAP envelope, NOT an HTTP header.
status: wired (registry entry exists); Lead API = SOAP `SaveLead`; Listing API = coming soon (no public REST spec)
base_url: https://lead-api.autoplay.co.nz/V2/LeadAPI.svc (test: https://lead-api.aptest.co.nz/LeadAPI.svc) — SOAP endpoint
integration_path: SOAP via the connector request layer — credentials passed in the body, gated by the `soap_token_passthrough` admin toggle
companions: 00=questionnaire (recovered facts + vendor asks), 01=api-rules, 01c=mutation-patterns, 01d=events+errors
confidence: the Numa connector wiring below is the real implementation (registry + backend gate). The AutoPlay SOAP side is RECOVERED from the OSS Subaru-NZ Drupal `autoplay` module — possibly stale, NOT vendor-confirmed, NOT live-validated. [VERIFY WITH WSDL] where noted.
---

# AutoPlay — Connector & Integration Setup

How the `autoplay` connector is wired into Numa, and how an admin configures it. AutoPlay's **Lead
API is SOAP** (`SaveLead`), so this connector differs from every REST connector in one big way: the
auth travels **inside the request envelope**, which means the admin has to explicitly authorise the
agent to handle the token.

> **Status:** the connector is **registered** (registry entry + backend gate exist) but **not yet
> fully callable from chat** — see §6 runtime gaps. The **Listing API** (vehicle inventory pull) is
> **coming soon**: AutoPlay hasn't published a REST spec.

## 1. Product context

|                |                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendor         | AutoPlay — automotive dealer marketing / inventory platform (AU / NZ)                                                                             |
| Marketing site | `www.autoplay.co.nz`                                                                                                                              |
| Dealer app     | `autoplayauto.com`                                                                                                                                |
| Lead API       | **SOAP 1.1** — prod `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc`, test `https://lead-api.aptest.co.nz/LeadAPI.svc`; op `SaveLead` [RECOVERED] |
| Listing API    | REST vehicle inventory + media — **coming soon** (no public spec) [UNKNOWN]                                                                       |
| Credentials    | per-dealer **Key + Token**, created in **Settings → Company Settings → API Management**                                                           |
| Dealer ids     | `DealershipId` (`apid`) + `YardId` (`yardid`)                                                                                                     |

## 2. Auth model — admin-supplied, body-embedded, toggle-gated

Unlike a Bearer/REST connector, AutoPlay's Lead API puts the credentials **in the SOAP body**:

```xml
<API_KEY>{api_key}</API_KEY>
<API_TOKEN>{api_token}</API_TOKEN>
```

plus `<DealershipId>` (`apid`) and `<YardId>` (`yardid`). Consequences for the wiring:

- **The credentials are company-level (admin-supplied), not per-user.** The admin pastes the Key,
  Token and ids once into the connector's `adminFields`; they're stored on the company config.
- **The generic request path canNOT inject them** — they're not an HTTP header. So the **agent has
  to build the envelope itself**, which means the agent needs the key/token.
- **That exposure is gated by an explicit admin opt-in.** The backend releases the key/token to the
  agent **only when BOTH** `lead_api_enabled` **and** `soap_token_passthrough` are on. The handler
  (`get_soap_passthrough_credentials` in `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`)
  is **AutoPlay-pinned** (no other connector can reach it) and **fails closed** — a missing/false
  toggle returns `soap_passthrough_disabled` and leaks nothing.

## 3. Connector Registry entry

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (entry `id: 'autoplay'`).
The live shape:

```typescript
{
  id: 'autoplay',
  displayName: 'AutoPlay',
  icon: 'bi-car-front',
  description: 'Automotive dealership inventory, vehicle listings and lead management (AU/NZ)',
  category: 'Automotive',
  authType: 'api-key',
  // Lead API SOAP endpoint (prod). Test: https://lead-api.aptest.co.nz/LeadAPI.svc
  baseUrl: 'https://lead-api.autoplay.co.nz/V2/LeadAPI.svc',
  adminFields: [
    { key: 'api_key',        type: 'password', required: true  /* Key from API Management */ },
    { key: 'api_token',      type: 'password', required: true  /* Token paired with the Key */ },
    { key: 'dealership_id',  type: 'text',     required: true  /* apid */ },
    { key: 'yard_id',        type: 'text',     required: false /* yardid; multi-yard dealers */ },
    { key: 'lead_api_enabled',       type: 'checkbox', tag: 'SOAP'        /* SaveLead via SOAP */ },
    { key: 'listing_api_enabled',    type: 'checkbox', comingSoon: true   /* inventory pull — pending REST spec */ },
    { key: 'soap_token_passthrough', type: 'checkbox' /* "Authorise passing the API token to the agent" */ },
  ],
}
```

| Field                    | Meaning                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `authType: 'api-key'`    | Admin-supplied credential wizard (not OAuth). Fields are `adminFields` (company-level).            |
| `baseUrl`                | The **SOAP endpoint**, persisted to the company vault as `base_url`. Test host differs (§1).       |
| `api_key` / `api_token`  | Per-dealer Key + Token — go **into the SOAP envelope**, not a header.                              |
| `dealership_id`          | `apid` — required; the dealer's AutoPlay id.                                                       |
| `yard_id`                | `yardid` — optional; for multi-location dealers.                                                   |
| `lead_api_enabled`       | Enables the SOAP `SaveLead` capability. Tagged **`SOAP`** so the admin knows it isn't a REST call. |
| `listing_api_enabled`    | **Coming soon** (`comingSoon: true`) — AutoPlay hasn't published the inventory REST spec.          |
| `soap_token_passthrough` | The admin's explicit authorisation to expose the API token to the agent (required for SaveLead).   |

## 4. Admin configuration (what the customer does)

In **AutoPlay**:

1. Go to **Settings → Company Settings → API Management** and create an API record. AutoPlay issues a
   unique **Key + Token** (and shows your **Dealership / Yard IDs**).

In **Numa** (Settings → Data Connectors → AutoPlay):

2. Paste the **API Key**, **API Token**, and **Dealership ID** (and **Yard ID** if multi-yard).
3. Tick **"Lead API"** (`lead_api_enabled`) to enable `SaveLead`.
4. **Tick "Authorise passing the API token to the agent"** (`soap_token_passthrough`). This is
   **required** for lead creation: AutoPlay's Lead API is SOAP, so the token must be embedded in the
   request envelope — which means the agent needs it. Without this toggle the agent cannot build a
   SaveLead call (the backend fails closed). Enable only if you accept the agent handling the token.
5. **Listing API** (`listing_api_enabled`) is **coming soon** — leave it; it's pending AutoPlay
   publishing its REST inventory spec.

(These steps mirror the `oauthSetupSteps` shown in the wizard and the i18n hints in
`numa-frontend/src/locales/en/integrations.json` under `dataConnectors.fields.autoplay*`.)

## 5. How these docs reach the workspace agent

`ext-api-doc/` markdown is **not** bundled into the agent image — it's synced to a per-client S3
bucket at infra-deploy time and read at runtime.
File: `infra/stacks/numa-client-stack.ts` (search `Sync ext-api-doc files to S3`).

- Every file in `ext-api-doc/autoplay/` uploads to the client's `extApiDocBucket` under key
  `autoplay/<filename>` (folder name = connector `id`).
- When **AutoPlay** is active, the agent loads `autoplay/01-llm-api-rules.md` plus `01c` and `01d`.
  `00` (questionnaire) and `03` (this file) are **developer-facing reference**, not the agent's
  runtime context.
- `DATA_CONNECTORS_ENABLED` gates connectors + the secrets vault.

## 6. Runtime gaps — be honest about what's NOT callable yet

The connector is registered and the credential gate exists, but **lead creation isn't fully wired
through the CLI**. Two pieces are missing:

1. **Raw SOAP body support.** `numa integrations request` → `connect_request` (`connect_tools.py`)
   sends `--body` as **JSON** with `Content-Type: application/json`. A SOAP envelope is a **raw XML
   string with `Content-Type: text/xml; charset=utf-8`** + a `SOAPAction` header. A raw-XML/text
   body path (or a dedicated `SaveLead` command) is needed before a real SaveLead can go through.
2. **No CLI command to fetch the passthrough credentials.** The backend handler
   (`connect_soap_credentials` / `handle_connect_soap_credentials`, registered in
   `lambdas/python/oauth-workspace-tools/lambda_function.py`) releases the gated key/token, but it
   is **not exposed as a `numa integrations …` command** yet. Until it is, the agent has no in-CLI
   way to obtain the token to build the envelope.

Until both land, the agent should tell the user AutoPlay lead creation is **set up but not yet
callable from chat** (see `01-llm-api-rules.md`). The **Listing API** is independently **coming
soon** (no REST spec).

## 7. Deployment checklist

- [x] Registry entry (`autoplay`, `authType: 'api-key'`, SOAP `baseUrl`, the five admin fields + three toggles)
- [x] i18n hints (`dataConnectors.fields.autoplay*`) in `numa-frontend/src/locales/en/integrations.json`
- [x] Backend credential gate (`get_soap_passthrough_credentials`, AutoPlay-pinned, fails closed) in `connect_tools.py`
- [x] `ext-api-doc/autoplay/` agent-rules files (`01`, `01c`, `01d`) authored
- [ ] **Raw-XML / `text/xml` body path** for `connect_request` (or a dedicated SaveLead command) — required for SaveLead (§6.1)
- [ ] **CLI command** exposing `connect_soap_credentials` so the agent can fetch the gated key/token (§6.2)
- [ ] `?singleWsdl` fetched and the `SaveLead` field reference + `SOAPAction` confirmed — replace every `[VERIFY WITH WSDL]` in `01`/`01c`/`01d`
- [ ] First authenticated `SaveLead` against the **test** host validated end to end
- [ ] Listing API: pending AutoPlay's REST spec (keep `listing_api_enabled` as `comingSoon`)
- [ ] `ext-api-doc/autoplay/*` synced to `extApiDocBucket` on the next client deploy; `DATA_CONNECTORS_ENABLED` on for the client

---

_The connector is wired (registry + gate). The AutoPlay SOAP surface is **recovered from a
third-party OSS module** — confirm against `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc?singleWsdl`
before relying on field names. Lead creation needs the two runtime pieces in §6; the Listing API is
coming soon. Recovered facts + the vendor questions live in `00-api-investigation-questionnaire.md`._
